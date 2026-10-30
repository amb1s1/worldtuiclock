import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSpring, springs, themes, colorVariables, cityCatalog, reflectionStrength} from '../web/preferences.js';

test('reflection preserves legacy levels and progressively obscures the clock up to 100',()=>{
  assert.deepEqual(reflectionStrength(0),{material:0,veil:0,blur:0});
  assert.deepEqual(reflectionStrength(12),{material:.6,veil:0,blur:0});
  assert.deepEqual(reflectionStrength(20),{material:1,veil:0,blur:0});
  let previous=reflectionStrength(20);
  for (let intensity=21;intensity<=100;intensity++) {
    const strength=reflectionStrength(intensity);
    assert.ok(strength.veil>previous.veil && strength.veil<1);
    assert.ok(strength.blur>previous.blur);
    assert.equal(strength.material,1);
    previous=strength;
  }
  assert.ok(previous.veil>=.9,'100 leaves barely any content visible');
  assert.deepEqual(reflectionStrength(100,false),reflectionStrength(0));
});

test('spring strengths have distinct overshoot and all settle',()=>{
  const overshoots=[];
  for (const name of Object.keys(springs)) {
    let position=0, velocity=0, peak=0;
    for (let i=0;i<300;i++) {
      [position,velocity]=advanceSpring(position,velocity,1,name);
      peak=Math.max(peak,position);
    }
    assert.ok(Math.abs(position-1)<.001);
    assert.ok(Math.abs(velocity)<.001);
    overshoots.push(peak-1);
  }
  assert.ok(overshoots[0]<.01);
  assert.ok(overshoots[1]>.05 && overshoots[1]<.15);
  assert.ok(overshoots[2]>.4);
});

test('every theme defines the whole palette and city choices have valid zones',()=>{
  assert.equal(Object.keys(themes).length,6);
  for (const theme of Object.values(themes)) {
    assert.equal(theme.colors.length,colorVariables.length);
    for (const color of theme.colors) assert.match(color,/^#[0-9a-f]{6}$/i);
  }
  for (const city of cityCatalog) assert.doesNotThrow(()=>new Intl.DateTimeFormat('en-US',{timeZone:city.zone}));
});
