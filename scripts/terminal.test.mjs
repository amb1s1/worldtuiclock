import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {ClockSession} from './clock-session.mjs';
import {openClock} from './terminal.mjs';

test('clock occupies the full pane and mouse coordinates start at its first row',()=>{
  const session=new ClockSession({cols:80,rows:30,pxWidth:800,pxHeight:600});
  assert.deepEqual(session.contentSize(),{width:800,height:600});
  for (const [col,row,x,y] of [[1,1,5,10],[80,30,795,590]]) {
    const [click]=session.handleTerm({type:'mouse',action:'press',button:'left',col,row});
    assert.equal(click.method,'Input.dispatchMouseEvent');
    assert.equal(click.params.x,x);
    assert.equal(click.params.y,y);
  }
  assert.deepEqual(session.handleResize({cols:120,rows:40,pxWidth:1200,pxHeight:800}),
    [{type:'setViewport',width:1200,height:800}]);
  const [click]=session.handleTerm({type:'mouse',action:'press',button:'left',col:120,row:40});
  assert.equal(click.params.x,1195);
  assert.equal(click.params.y,790);
});

test('clock keys keep working and hidden browser controls cannot take focus',()=>{
  const session=new ClockSession({cols:80,rows:30,pxWidth:800,pxHeight:600});
  for (const key of ['l','t','n','w']) {
    assert.deepEqual(session.handleTerm({type:'key',key,ctrl:true}),[]);
  }
  for (const key of ['c','q']) {
    assert.deepEqual(session.handleTerm({type:'key',key,ctrl:true}),[{type:'quit'}]);
  }
  for (const text of ['j','k','t','q']) {
    const [command]=session.handleTerm({type:'text',text});
    assert.equal(command.type,'cdp');
    assert.equal(command.params.key,text);
  }
  for (const key of ['ArrowUp','ArrowDown']) {
    assert.equal(session.handleTerm({type:'key',key})[0].params.key,key);
  }
});

function fakeTerminal() {
  const input=new EventEmitter();
  const output=new EventEmitter();
  const signals=new EventEmitter();
  const writes=[],rawModes=[];
  input.isTTY=output.isTTY=true;
  output.columns=80;
  output.rows=30;
  input.setRawMode=value=>rawModes.push(value);
  input.resume=()=>{};
  input.pause=()=>{};
  output.write=(value,callback)=>{
    writes.push(value);
    if (value==='\x1b[14t') queueMicrotask(()=>input.emit('data',Buffer.from('\x1b[4;600;800t')));
    const command=value.match(/a=([tp]),[^;]*i=(\d+)/);
    if (command) queueMicrotask(()=>input.emit('data',Buffer.from(`\x1b_Gi=${command[2]};OK\x1b\\`)));
    queueMicrotask(()=>callback?.());
    return true;
  };
  return {input,output,signals,writes,rawModes};
}

for (const quit of ['Ctrl+Q','SIGTERM']) {
  test(`launcher renders only the clock, resizes, and restores the terminal on ${quit}`,async()=>{
    const terminal=fakeTerminal();
    const calls=[];
    const adapter={
      async startScreencast(onFrame) {await onFrame(Buffer.from('clock pixels'));},
      async navigate(url) {
        calls.push(['navigate',url]);
        terminal.output.columns=120;
        terminal.output.rows=40;
        terminal.output.emit('resize');
        if (quit==='Ctrl+Q') terminal.input.emit('data',Buffer.from('\x11'));
        else terminal.signals.emit('SIGTERM');
      },
      async setViewport(width,height) {calls.push(['resize',width,height]);},
      async closeAll() {calls.push(['close']);},
      async initChrome() {assert.fail('must never create a browser toolbar');},
    };
    await openClock('http://127.0.0.1:8787',{
      ...terminal,
      launch:async(width,height)=>{calls.push(['launch',width,height]);return adapter;},
    });
    assert.deepEqual(calls,[['launch',800,600],['navigate','http://127.0.0.1:8787'],
      ['resize',1200,800],['close']]);
    assert.equal(terminal.writes.filter(value=>value.includes('a=t')).length,1);
    assert.ok(terminal.writes.find(value=>value.startsWith('\x1b[1;1H')));
    assert.deepEqual(terminal.rawModes,[true,false]);
    assert.ok(terminal.writes.at(-1).includes('\x1b[?1049l'));
    assert.equal(terminal.input.listenerCount('data'),0);
    assert.equal(terminal.signals.listenerCount('SIGTERM'),0);
  });
}

test('browser launch failure restores the shell before reporting the error',async()=>{
  const terminal=fakeTerminal();
  await assert.rejects(openClock('http://127.0.0.1:8787',{
    ...terminal,launch:async()=>{throw new Error('browser unavailable');},
  }),/browser unavailable/);
  assert.deepEqual(terminal.rawModes,[true,false]);
  assert.ok(terminal.writes.at(-1).includes('\x1b[?1049l'));
});

test('a standalone Escape reaches the clock so settings can close',async()=>{
  const terminal=fakeTerminal();
  const keys=[];
  await openClock('http://127.0.0.1:8787',{
    ...terminal,launch:async()=>({
      async startScreencast(){},
      async navigate(){terminal.input.emit('data',Buffer.from('\x1b'));},
      async send(method,params){
        if (method==='Input.dispatchKeyEvent') keys.push(params.key);
        if (params.type==='keyUp') terminal.signals.emit('SIGTERM');
      },
      async closeAll(){},
    }),
  });
  assert.deepEqual(keys,['Escape','Escape']);
});

test('a renderer failure during startup is reported after restoring the terminal',async()=>{
  const terminal=fakeTerminal();
  await assert.rejects(openClock('http://127.0.0.1:8787',{
    ...terminal,launch:async()=>({
      async startScreencast(onFrame,onError){onError(new Error('Terminal rejected an image'));},
      async navigate(){assert.fail('do not navigate after renderer failure');},
      async closeAll(){},
    }),
  }),/Terminal rejected an image/);
  assert.deepEqual(terminal.rawModes,[true,false]);
  assert.ok(terminal.writes.at(-1).includes('\x1b[?1049l'));
});

test('continuous graphics acknowledgements cannot starve the Escape key',async()=>{
  const terminal=fakeTerminal();
  const keys=[];
  let replies,deadline;
  try {
    await openClock('http://127.0.0.1:8787',{
      ...terminal,launch:async()=>({
        async startScreencast(){},
        async navigate(){
          terminal.input.emit('data',Buffer.from('\x1b'));
          replies=setInterval(()=>terminal.input.emit('data',Buffer.from('\x1b_Gi=99;OK\x1b\\')),5);
          deadline=setTimeout(()=>terminal.signals.emit('SIGTERM'),300);
        },
        async send(method,params){
          if (method==='Input.dispatchKeyEvent') keys.push(params.key);
          if (params.type==='keyUp') terminal.signals.emit('SIGTERM');
        },
        async closeAll(){},
      }),
    });
  } finally {clearInterval(replies);clearTimeout(deadline);}
  assert.deepEqual(keys,['Escape','Escape']);
});
