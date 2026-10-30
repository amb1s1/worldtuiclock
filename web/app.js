'use strict';
import {advanceSpring, themes, colorVariables, reflectionStrength} from './preferences.js';
import {createWeather} from './weather.js';
import {createSettingsMenu} from './settings-menu.js';
import {createExplore} from './explore.js';

const $ = selector => document.querySelector(selector);
const clock = $('.clock');
const list = $('.zone-list');
const selector = $('.selector');
const notice = $('#notice');
const settings = $('#settings');
let weather, settingsMenu, explore, timeOffset=0;
const clockNow=()=>new Date(Date.now()+timeOffset);
const state = { zones: [], rows: [], cursor: 0, h24: true, temperatureUnit:'c', reflectionType:'frosted', frostedGlass:true, glassIntensity:12, animations:true, spring:'medium', theme:'orbit',
  y: 0, velocity: 0, stopped: false };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionEnabled = () => state.animations && !reducedMotion.matches;
const glyphs = {
  0: ['111','101','101','101','111'], 1: ['010','110','010','010','111'],
  2: ['111','001','111','100','111'], 3: ['111','001','111','001','111'],
  4: ['101','101','111','001','001'], 5: ['111','100','111','001','111'],
  6: ['111','100','111','101','111'], 7: ['111','001','001','001','001'],
  8: ['111','101','111','101','111'], 9: ['111','101','111','001','111'],
};

function fit() {
  const tableHeight=Math.min(5,state.zones.length || 5)*100;
  const height=516+tableHeight;
  list.style.height=`${tableHeight}px`;
  clock.style.height=`${height}px`;
  const insetX = Math.min(68, window.innerWidth * .04);
  const insetTop = Math.min(48, window.innerHeight * .045);
  const insetBottom = Math.min(24, window.innerHeight * .025);
  const scale = Math.min(1, (window.innerWidth - 2*insetX)/1600,
    (window.innerHeight - insetTop - insetBottom)/height);
  clock.style.transform = `scale(${scale})`;
  clock.style.left = `${(window.innerWidth - 1600*scale)/2}px`;
  clock.style.top = `${insetTop}px`;
  clock.style.visibility = 'visible';
}

function createZone(entry, index) {
  const row = document.createElement('div');
  row.className = 'zone-row';
  row.id = `zone-${index}`;
  row.setAttribute('role', 'option');
  row.innerHTML = '<span class="caret" aria-hidden="true">›</span><span class="city"></span>' +
    '<span class="abbreviation"></span><span class="time"></span>' +
    '<span class="offset"></span><span class="bar" aria-hidden="true"></span>';
  row.querySelector('.city').textContent = entry.city;
  for (let h=0; h<24; h++) {
    const cell = document.createElement('i');
    cell.className = 'hour' + (h >= 6 && h < 18 ? ' day' : '');
    row.querySelector('.bar').append(cell);
  }
  row.addEventListener('click', () => { select(index); list.focus({preventScroll:true}); });
  list.append(row);
  return {
    element: row, time: row.querySelector('.time'), abbreviation: row.querySelector('.abbreviation'),
    offset: row.querySelector('.offset'), cells: [...row.querySelector('.bar').children],
    formatter: new Intl.DateTimeFormat('en-US', {timeZone:entry.zone, hourCycle:'h23',
      hour:'2-digit',minute:'2-digit',second:'2-digit',year:'numeric',month:'2-digit',day:'2-digit',timeZoneName:'short'}),
    dateFormatter: new Intl.DateTimeFormat('en-US', {timeZone:entry.zone, weekday:'short',month:'short',day:'2-digit'}),
  };
}

function partsFor(row, now) {
  const p = Object.fromEntries(row.formatter.formatToParts(now).map(p => [p.type,p.value]));
  const zoneEpoch = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  return {...p, offsetMinutes: Math.round((zoneEpoch - now.getTime())/60000)};
}

function timeText(p) {
  if (state.h24) return `${p.hour}:${p.minute}:${p.second}`;
  return `${String(+p.hour%12 || 12).padStart(2,'0')}:${p.minute}:${p.second} ${+p.hour<12?'AM':'PM'}`;
}

function drawDigits(p) {
  const hour = state.h24 ? p.hour : String(+p.hour%12 || 12).padStart(2,'0');
  const groups = [hour, p.minute, p.second];
  let rects = '';
  groups.forEach((pair, group) => {
    [...pair].forEach((digit, column) => {
      glyphs[digit].forEach((pixels, y) => {
        for (let x=0; x<3; x++) {
          if (pixels[x]!=='1') continue;
          const start=x;
          while (x+1<3 && pixels[x+1]==='1') x++;
          rects += `<rect x="${group*346 + column*116 + start*30}" y="${y*50}" width="${(x-start+1)*30}" height="49.7"/>`;
        }
      });
    });
    if (group < 2) {
      const x=group*346 + 266;
      rects += `<g opacity="${motionEnabled() && +p.second%2 ? 0 : 1}"><rect x="${x}" y="65" width="20" height="20"/><rect x="${x}" y="165" width="20" height="20"/></g>`;
    }
  });
  $('#digits').innerHTML = '<defs><linearGradient id="clock-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="900" y2="0"><stop stop-color="var(--pink)"/>' +
    '<stop offset=".5" stop-color="var(--middle)"/><stop offset="1" stop-color="var(--purple)"/></linearGradient></defs>' +
    `<g fill="url(#clock-gradient)">${rects}</g>`;
  $('#digits').setAttribute('aria-label', timeText(p));
}

function render(now) {
  if (!state.rows.length || state.stopped) return;
  const localOffset = -now.getTimezoneOffset();
  const localHour = state.h24 ? String(now.getHours()).padStart(2,'0') : String(now.getHours()%12 || 12);
  $('#local-time').textContent = `local ${localHour}:${String(now.getMinutes()).padStart(2,'0')}${state.h24?'':now.getHours()<12?' AM':' PM'}`;
  state.rows.forEach((row, i) => {
    const p=partsFor(row, now);
    row.time.textContent = timeText(p);
    row.abbreviation.textContent = p.timeZoneName;
    const diff=(p.offsetMinutes-localOffset)/60;
    row.offset.textContent = diff===0 ? 'local' : `${diff>0?'+':''}${diff}h`;
    row.element.setAttribute('aria-selected', String(i===state.cursor));
    row.element.setAttribute('aria-label', `${state.zones[i].city}, ${timeText(p)}, ${p.timeZoneName}`);
    row.cells.forEach((cell,h) => cell.classList.toggle('current',h===+p.hour));
    if (i===state.cursor) {
      $('#selected-city').textContent = state.zones[i].city + (state.h24?'':` · ${+p.hour<12?'AM':'PM'}`);
      $('#selected-date').textContent = row.dateFormatter.format(now);
      $('#selected-zone').textContent = `${state.zones[i].zone} · ${p.timeZoneName}`;
      drawDigits(p);
    }
  });
  list.setAttribute('aria-activedescendant', `zone-${state.cursor}`);
}

function select(index,{automatic=false}={}) {
  if (state.stopped || !state.zones.length) return;
  if (!automatic) explore?.stopTour();
  state.cursor = (index + state.zones.length) % state.zones.length;
  const top=state.cursor*100;
  if (top<list.scrollTop) list.scrollTop=top;
  else if (top+100>list.scrollTop+list.clientHeight) list.scrollTop=top+100-list.clientHeight;
  render(clockNow());
  weather?.update();
}

function toggleTime() {
  if (state.stopped) return;
  changeSettings({h24:!state.h24});
}

async function quit() {
  if (state.stopped) return;
  try {
    await saveQueue;
    const response=await fetch('/api/quit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if (!response.ok) throw new Error('Could not stop the local clock server.');
    state.stopped=true;
    weather?.stop();
    notice.textContent='World Clock stopped. You can close this window.';
    notice.hidden=false;
  } catch (error) {
    notice.textContent=`${error.message} Use Ctrl+C in the terminal to quit.`;
    notice.hidden=false;
  }
}

document.addEventListener('keydown', event => {
  if (event.altKey || event.metaKey) return;
  const key=event.key.toLowerCase();
  if (settings.open) { settingsMenu.keydown(event); return; }
  if (explore?.isOpen) { explore.keydown(event); return; }
  if (event.ctrlKey && key!=='c') return;
  if (event.key==='ArrowUp' || event.key==='k') { event.preventDefault(); select(state.cursor-1); }
  else if (event.key==='ArrowDown' || event.key==='j') { event.preventDefault(); select(state.cursor+1); }
  else if (key==='s' && !event.repeat) { event.preventDefault(); settingsMenu.open(); }
  else if ((key==='e' || key==='?') && !event.repeat) { event.preventDefault(); explore.open(); }
  else if (event.key==='q' || (event.ctrlKey && event.key==='c')) { event.preventDefault(); quit(); }
});
$('#open-settings').addEventListener('click', () => settingsMenu.open());
$('#quit').addEventListener('click', quit);
window.addEventListener('resize', fit);
reducedMotion.addEventListener('change', () => { state.y=state.cursor; state.velocity=0; refreshSettings(); });


let lastFrame=0, accumulator=0, lastSecond=-1;
function frame(timestamp) {
  if (state.stopped) return;
  accumulator+=Math.min((timestamp-lastFrame)/1000,.1);
  lastFrame=timestamp;
  while (accumulator>=1/30) {
    [state.y,state.velocity]=advanceSpring(state.y,state.velocity,state.cursor,state.spring);
    if (settings.open) settingsMenu.step();
    if (explore?.isOpen) explore.step();
    accumulator-=1/30;
  }
  if (!motionEnabled()) { state.y=state.cursor; state.velocity=0;  }
  selector.style.transform=`translateY(${state.y*100}px)`;
  if (settings.open) settingsMenu.draw();
  explore?.tick(Date.now());
  explore?.draw();
  const now=clockNow(), second=Math.floor(now.getTime()/1000);
  if (second!==lastSecond) { render(now); lastSecond=second; }
  requestAnimationFrame(frame);
}

let saveQueue=Promise.resolve(), saveRevision=0;
function saveSettings() {
  const revision=++saveRevision;
  const snapshot=JSON.stringify({h24:state.h24,temperatureUnit:state.temperatureUnit,reflectionType:state.reflectionType,frostedGlass:state.frostedGlass,glassIntensity:state.glassIntensity,animations:state.animations,spring:state.spring,theme:state.theme,zones:state.zones});
  $('#save-status').textContent='Saving…';
  $('#save-status').classList.remove('error');
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    const response=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot});
    if (!response.ok) throw new Error((await response.text()).trim() || 'Could not save settings');
    if (revision===saveRevision) $('#save-status').textContent='All changes saved';
  }).catch(error=>{
    if (revision===saveRevision) {
      $('#save-status').textContent=`${error.message}. Changes may be lost on restart.`;
      $('#save-status').classList.add('error');
    }
  });
}

function applyAppearance() {
  themes[state.theme].colors.forEach((value,index)=>document.documentElement.style.setProperty(`--${colorVariables[index]}`,value));
  clock.classList.toggle('twelve-hour',!state.h24);
  document.documentElement.classList.toggle('glass',state.frostedGlass && state.glassIntensity>0);
  document.documentElement.dataset.reflection=state.reflectionType;
  const strength=reflectionStrength(state.glassIntensity,state.frostedGlass);
  const frost=strength.material;
  const veil=$('#reflection-veil');
  veil.hidden=strength.veil===0;
  veil.style.setProperty('--veil-opacity',String(strength.veil));
  veil.style.setProperty('--veil-blur',`${strength.blur}px`);
  const glass={
    'blur':`${2+70*frost**1.3}px`,
    'backdrop-blur':`${28*frost}px`,
    'saturation':`${100+80*frost}%`,
    'fill':String(.38+.24*frost),
    'frost':String(.005+.10*frost),
    'sheen':String(.015+.16*frost),
    'border':String(.025+.20*frost),
    'ambient':String(.08+.92*frost),
    'grain':String(.005+.045*frost),
  };
  if (state.reflectionType==='clear') Object.assign(glass,{
    blur:`${4*frost}px`,'backdrop-blur':`${3*frost}px`,fill:String(.14+.18*frost),
    frost:'0',sheen:String(.015+.12*frost),border:String(.04+.32*frost),
    ambient:String(.08+.5*frost),grain:'0',saturation:`${100+20*frost}%`,
  });
  if (state.reflectionType==='liquid') Object.assign(glass,{
    blur:`${18*frost}px`,'backdrop-blur':`${12*frost}px`,fill:String(.26+.16*frost),
    frost:String(.01+.025*frost),sheen:String(.02+.34*frost),border:String(.03+.35*frost),
    ambient:String(.08+.72*frost),grain:'0',saturation:`${100+60*frost}%`,
  });
  if (state.reflectionType==='prism') Object.assign(glass,{
    blur:`${34*frost}px`,'backdrop-blur':`${16*frost}px`,fill:String(.34+.16*frost),
    frost:String(.01+.035*frost),sheen:String(.02+.22*frost),border:String(.03+.26*frost),
    ambient:String(.08+.92*frost),grain:String(.004+.012*frost),saturation:`${100+90*frost}%`,
  });
  if (state.reflectionType==='matte') Object.assign(glass,{
    blur:`${24+48*frost}px`,'backdrop-blur':`${24*frost}px`,fill:String(.64+.28*frost),
    frost:String(.008+.065*frost),sheen:'0',border:String(.01+.05*frost),
    ambient:String(.04+.22*frost),grain:String(.008+.045*frost),saturation:'90%',
  });
  for (const [name,value] of Object.entries(glass)) document.documentElement.style.setProperty(`--glass-${name}`,value);
  document.documentElement.classList.toggle('still',!motionEnabled());
}

function changeSettings(patch) {
  Object.assign(state,patch);
  applyAppearance();
  refreshSettings();
  render(clockNow());
  saveSettings();
  weather?.update();
}

function rebuildRows() {
  for (const row of state.rows) row.element.remove();
  state.rows=state.zones.map(createZone);
  state.cursor=Math.min(state.cursor,state.zones.length-1);
  state.y=state.cursor;
  state.velocity=0;
  fit();
  select(state.cursor);
}

function refreshSettings() {
  document.documentElement.classList.toggle('still',!motionEnabled());
  settingsMenu?.refresh();
}

settingsMenu=createSettingsMenu({state,motionEnabled,reducedMotion,onChange:changeSettings,
  onZonesChange(){rebuildRows();saveSettings();weather?.update();},toggleTime});

explore=createExplore({getSpring:()=>state.spring,motionEnabled,isSettingsOpen:()=>settings.open,
  onAdvance:()=>select(state.cursor+1,{automatic:true}),
  onTimeChange(offset){
    timeOffset=offset;
    document.documentElement.classList.toggle('preview-time',offset!==0);
    $('#weather-preview-note').hidden=offset===0;
    render(clockNow());
  },
});

async function start() {
  try {
    const response=await fetch('/api/settings');
    if (!response.ok) throw new Error(await response.text());
    Object.assign(state,await response.json());
    rebuildRows();
    applyAppearance();
    refreshSettings();
    await document.fonts.ready;
    fit();
    render(clockNow());
    weather=createWeather({getZone:()=>state.zones[state.cursor],getUnit:()=>state.temperatureUnit,afterSaved:()=>saveQueue});
    weather.update();
    requestAnimationFrame(frame);
  } catch(error) {
    notice.textContent=error.message;
    notice.hidden=false;
  }
}
start();
