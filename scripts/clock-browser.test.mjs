import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import {ClockBrowser} from './clock-browser.mjs';

function browser() {
  const calls=[],cdp=new EventEmitter();
  cdp.send=async(method,params)=>calls.push({method,params});
  const adapter={
    viewport:{width:800,height:600},
    page:{async createCDPSession(){return cdp;}},
    async setViewport(width,height){this.viewport={width,height};},
  };
  return {clock:new ClockBrowser(adapter),calls,cdp};
}

test('Chromium receives a frame acknowledgement only after the terminal consumer finishes',async()=>{
  const {clock,calls,cdp}=browser();
  let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  await clock.startScreencast(async png=>{
    assert.equal(png.toString(),'pixels');await done;
  },assert.fail);
  cdp.emit('Page.screencastFrame',{data:Buffer.from('pixels').toString('base64'),sessionId:9});
  await nextTurn();
  assert.deepEqual(calls.map(call=>call.method),['Page.startScreencast']);
  finish();await nextTurn();
  assert.deepEqual(calls.at(-1),{method:'Page.screencastFrameAck',params:{sessionId:9}});
});

test('consumer failures are reported rather than leaving an unhandled rejected frame',async()=>{
  const {clock,calls,cdp}=browser();
  const errors=[];
  await clock.startScreencast(async()=>{throw new Error('failed transfer');},error=>errors.push(error.message));
  cdp.emit('Page.screencastFrame',{data:'cGl4ZWxz',sessionId:1});
  await nextTurn();
  assert.deepEqual(errors,['failed transfer']);
  assert.equal(calls.at(-1).method,'Page.screencastFrameAck');
});

test('resizing restarts the screencast with the new full-pane dimensions',async()=>{
  const {clock,calls}=browser();
  await clock.startScreencast(async()=>{},assert.fail);
  await clock.setViewport(1200,800);
  assert.deepEqual(calls,[
    {method:'Page.startScreencast',params:{format:'png',everyNthFrame:2,maxWidth:800,maxHeight:600}},
    {method:'Page.stopScreencast',params:undefined},
    {method:'Page.startScreencast',params:{format:'png',everyNthFrame:2,maxWidth:1200,maxHeight:800}},
  ]);
});
