import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import {encodeImage,FrameWriter,GraphicsReplies} from './graphics.mjs';

const size={cols:80,rows:30};
const response=(id,status='OK')=>({id,status});

function terminal({slow=false,timeout=1000}={}) {
  const writes=[],callbacks=[];
  const writer=new FrameWriter({write(data,callback) {
    writes.push(data);
    if (slow) callbacks.push(callback);else callback();
    return !slow;
  }},{minFrameMs:0,timeout});
  return {writer,writes,callbacks};
}

async function accept(writer,id) {
  writer.reply(response(id));
  await nextTurn();
  writer.reply(response(id));
  await nextTurn();
}

test('PNG uploads are chunked and cannot display or delete an existing image',()=>{
  const png=Buffer.alloc(16000,0xff);
  const commands=[...encodeImage(png,2).matchAll(/\x1b_G([^;]+);([^\x1b]+)\x1b\\/g)];
  assert.equal(commands[0][1],'a=t,f=100,i=2,q=0,m=1');
  assert.equal(commands.at(-1)[1],'m=0');
  for (const [,control,payload] of commands) {
    assert.ok(payload.length<=4096);
    assert.equal(payload.length%4,0);
    assert.ok(!control.includes('a=T'));
  }
  assert.deepEqual(Buffer.from(commands.map(command=>command[2]).join(''),'base64'),png);
});

test('split graphics replies are removed without consuming surrounding keys',()=>{
  const message=Buffer.from('j\x1b_Gi=2;OK\x1b\\\x1b_Gi=1,p=1;ENOENT: no image\x1b\\\x1b[Bq');
  for (let split=0;split<=message.length;split++) {
    const replies=[],parser=new GraphicsReplies(reply=>replies.push(reply));
    const keys=Buffer.concat([parser.feed(message.subarray(0,split)),parser.feed(message.subarray(split))]);
    assert.equal(keys.toString(),'j\x1b[Bq');
    assert.deepEqual(replies,[
      {id:2,placement:undefined,status:'OK'},
      {id:1,placement:1,status:'ENOENT: no image'},
    ]);
  }
  const parser=new GraphicsReplies(()=>assert.fail('incomplete reply'));
  assert.equal(parser.feed(Buffer.from('\x1b')).length,0);
  assert.equal(parser.flushEscape().toString(),'\x1b');
  parser.feed(Buffer.from('\x1b_Gi=2;O'));
  assert.equal(parser.flushEscape().length,0);
});

test('old image stays visible until both the replacement upload and placement succeed',async()=>{
  const {writer,writes}=terminal();
  let frame=writer.draw(Buffer.from('first'),size);
  assert.equal(writes.length,1);
  await accept(writer,1);
  assert.equal(await frame,true);
  frame=writer.draw(Buffer.from('second'),size);
  assert.equal(writes.length,3);
  assert.ok(writes.at(-1).includes('a=t,f=100,i=2'));
  writer.reply(response(99)); // Unrelated terminal replies are ignored.
  await nextTurn();
  assert.equal(writes.length,3);
  writer.reply(response(2));
  await nextTurn();
  assert.equal(writes.length,4);
  assert.ok(writes.at(-1).includes('a=p,i=2,p=1,q=0,C=1,c=80,r=30'));
  assert.ok(!writes.some(data=>data.includes('a=d')));
  writer.reply(response(2));
  assert.equal(await frame,true);
  assert.ok(writes.at(-1).includes('a=d,d=I,i=1'));
  writer.close();
});

test('slow writes and bursts keep at most one in-flight frame and the latest queued frame',async()=>{
  const {writer,writes,callbacks}=terminal({slow:true});
  const first=writer.draw(Buffer.from('first'),size);
  const dropped=writer.draw(Buffer.from('stale'),size);
  const latest=writer.draw(Buffer.from('latest'),size);
  assert.equal(await dropped,false);
  writer.reply(response(1));
  await nextTurn();
  assert.equal(writes.length,1,'terminal ACK alone cannot bypass the pending stream write');
  callbacks.shift()();
  await nextTurn();
  callbacks.shift()();writer.reply(response(1));
  assert.equal(await first,true);
  assert.equal(writes.length,3);
  assert.ok(writes[2].includes(Buffer.from('latest').toString('base64')));
  callbacks.shift()();writer.reply(response(2));
  await nextTurn();
  callbacks.shift()();writer.reply(response(2));
  await nextTurn();
  callbacks.shift()(); // Only now delete the first image.
  assert.equal(await latest,true);
  writer.close();
});

test('unchanged frames are skipped but resizing re-places them at the new size',async()=>{
  const {writer,writes}=terminal();
  const png=Buffer.from('same clock');
  let frame=writer.draw(png,size);
  await accept(writer,1);await frame;
  assert.equal(await writer.draw(png,size),false);
  assert.equal(writes.length,2);
  frame=writer.draw(png,{cols:120,rows:40});
  await accept(writer,2);await frame;
  assert.ok(writes.some(data=>data.includes('c=120,r=40')));
  writer.close();
});

for (const phase of ['upload','placement']) {
  test(`a rejected ${phase} reports the error and does not delete the last good image`,async()=>{
    const {writer,writes}=terminal();
    let frame=writer.draw(Buffer.from('good'),size);
    await accept(writer,1);await frame;
    frame=writer.draw(Buffer.from('bad'),size);
    const failure=assert.rejects(frame,/Terminal rejected an image: ENOMEM/);
    if (phase==='placement') {writer.reply(response(2));await nextTurn();}
    writer.reply(response(2,'ENOMEM'));
    await failure;
    assert.equal(writer.current,1);
    assert.ok(!writes.some(data=>data.includes('a=d')));
    writer.close();
  });
}

test('missing acknowledgement times out even when a stream write is stalled',async()=>{
  const {writer,writes}=terminal({slow:true,timeout:20});
  await assert.rejects(writer.draw(Buffer.from('clock'),size),/did not acknowledge/);
  assert.equal(writes.length,1);
  writer.close();
});

test('closing cancels an in-flight image and releases the queued frame',async()=>{
  const {writer}=terminal();
  const first=assert.rejects(writer.draw(Buffer.from('first'),size),/renderer closed/);
  const queued=writer.draw(Buffer.from('queued'),size);
  writer.close();
  await first;
  assert.equal(await queued,false);
});
