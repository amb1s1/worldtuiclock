import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay,setImmediate as nextTurn} from 'node:timers/promises';
import {weatherKind, weatherIcon, weatherBackground, createWeather, formatTemperature} from '../web/weather.js';

test('current weather codes select the correct scene, including nighttime',()=>{
  const cases=[[0,true,'sun'],[0,false,'moon'],[2,true,'partly'],[2,false,'partly-night'],[3,true,'cloud'],
    [53,false,'rain'],[65,true,'rain'],[95,false,'thunder'],[96,true,'thunder'],[97,false,'thunder'],[99,true,'thunder'],
    [75,false,'snow'],[45,true,'fog'],[999,true,'unknown']];
  for (const [code,day,expected] of cases) {
    const kind=weatherKind(code,day);
    assert.equal(kind.icon,expected);
    assert.match(weatherIcon(kind.icon),/^<svg/);
  }
  assert.equal(formatTemperature(0,'c'),'0°C');
  assert.equal(formatTemperature(0,'f'),'32°F');
  assert.equal(formatTemperature(8.9,'f'),'48°F');
  assert.equal(formatTemperature(-10,'c'),'-10°C');
});

test('weather backgrounds cover all conditions with a small, deterministic particle budget',()=>{
  for (const kind of ['sun','moon','partly','partly-night','cloud','fog','rain','snow','thunder']) {
    const markup=weatherBackground(kind);
    assert.ok(markup.length>0);
    assert.ok((markup.match(/<i /g)||[]).length<=36);
    assert.equal(weatherBackground(kind),markup,'refreshing conditions should not reposition particles');
  }
  assert.match(weatherBackground('rain'),/ambient-rain/);
  assert.match(weatherBackground('thunder'),/ambient-thunder/);
  assert.match(weatherBackground('snow'),/ambient-snow/);
  assert.equal(weatherBackground('unknown'),'');
});

test('city changes clear the old background, cached weather restores it, and failure hides it',async t=>{
  const elements=new Map();
  const documentBefore=globalThis.document;
  globalThis.document={querySelector(selector){
    if (!elements.has(selector)) elements.set(selector,{dataset:{},setAttribute(){}});
    return elements.get(selector);
  }};
  t.after(()=>{if (documentBefore===undefined) delete globalThis.document;else globalThis.document=documentBefore;});
  let resolveWeather,zone={city:'New York',zone:'America/New_York'};
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{resolveWeather=resolve;}));
  const weather=createWeather({getZone:()=>zone,getUnit:()=>'c',afterSaved:async()=>{}});
  t.after(()=>weather.stop());
  const background=elements.get('#weather-background');
  weather.update();
  assert.equal(background.hidden,true);
  await delay(250);
  resolveWeather({ok:true,json:async()=>({code:61,isDay:true,temperatureC:11,location:'New York',updatedAt:1})});
  await nextTurn();
  assert.equal(background.dataset.kind,'rain');
  assert.equal(background.hidden,false);
  zone={city:'Seattle',zone:'America/Los_Angeles'};
  weather.update();
  assert.equal(background.hidden,true,'New York rain must not linger while Seattle loads');
  await delay(250);
  resolveWeather({ok:false});
  await nextTurn();
  assert.equal(background.hidden,true);
  assert.equal(elements.get('#weather-condition').textContent,'Weather unavailable');
  zone={city:'New York',zone:'America/New_York'};
  weather.update();
  assert.equal(background.dataset.kind,'rain');
  assert.equal(background.hidden,false);
});
