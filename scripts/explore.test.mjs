import assert from 'node:assert/strict';
import test from 'node:test';
import {FocusTimer,countdown,previewOffset,MINUTE} from '../web/explore.js';

test('session timing remains accurate after delayed frames and a long pause',()=>{
  const timer=new FocusTimer();
  const now=1000000;
  timer.toggle(now);
  assert.equal(timer.value(now+3*MINUTE),22*MINUTE);
  timer.toggle(now+3*MINUTE);
  assert.equal(timer.value(now+30*MINUTE),22*MINUTE);
  timer.toggle(now+30*MINUTE);
  assert.equal(timer.value(now+51*MINUTE),MINUTE);
  assert.equal(timer.update(now+60*MINUTE),true);
  assert.equal(timer.value(now+60*MINUTE),0);
  assert.equal(timer.completed,true);
  assert.equal(timer.update(now+61*MINUTE),false,'complete only once');
  timer.toggle(now+62*MINUTE);
  assert.equal(timer.completed,false);
  assert.equal(timer.value(now+62*MINUTE),25*MINUTE);
});

test('length controls cannot change a running session and reset uses the chosen length',()=>{
  const timer=new FocusTimer();
  timer.adjust(1);
  assert.equal(timer.minutes,30);
  timer.toggle(0);
  timer.adjust(-1);
  assert.equal(timer.minutes,30);
  timer.reset();
  assert.equal(timer.deadline,null);
  assert.equal(timer.remaining,30*MINUTE);
  for(let i=0;i<30;i++)timer.adjust(-1);
  assert.equal(timer.minutes,5);
  for(let i=0;i<30;i++)timer.adjust(1);
  assert.equal(timer.minutes,90);
});

test('countdown rounds up instead of announcing completion early',()=>{
  assert.equal(countdown(25*MINUTE),'25:00');
  assert.equal(countdown(1),'00:01');
  assert.equal(countdown(0),'00:00');
  assert.equal(countdown(-1000),'00:00');
  assert.equal(countdown(90*MINUTE),'90:00');
});

test('preview crosses date and DST boundaries as one shared instant',()=>{
  const original=Date.parse('2026-11-01T05:30:00Z');
  const next=original+previewOffset(60)*MINUTE;
  const format=zone=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'});
  assert.equal(format('America/New_York').format(original),'01:30 EDT');
  assert.equal(format('America/New_York').format(next),'01:30 EST');
  assert.equal(format('Europe/Amsterdam').format(next),'07:30 GMT+1');
  assert.equal(previewOffset(9999),2880);
  assert.equal(previewOffset(-9999),-2880);
});
