import {advanceSpring, themes, cityCatalog, reflectionNames, reflectionDetails} from './preferences.js';

const springNames={small:'Small',medium:'Medium',super:'Super bouncing'};
const springDetails={small:'Quick & gentle',medium:'A soft spring',super:'Big, playful motion'};

export function createSettingsMenu({state,motionEnabled,reducedMotion,onChange,onZonesChange,toggleTime}) {
  const $=selector=>document.querySelector(selector);
  const dialog=$('#settings'), viewport=$('#settings-menu'), rows=$('#settings-rows'), highlight=$('#settings-selector');
  let page='main', index=0, items=[], y=0, velocity=0, target=0, panelY=0, panelVelocity=0;
  function cycle(values,current,direction) {
    return values[(values.indexOf(current)+direction+values.length)%values.length];
  }
  function setSpring(name) {
    onChange({spring:name});
    if (motionEnabled()) {panelY=.3;panelVelocity=0;}
  }
  function adjustGlass(direction) {
    const current=state.frostedGlass?state.glassIntensity:0;
    const glassIntensity=Math.min(100,Math.max(0,current+direction));
    onChange({glassIntensity,frostedGlass:glassIntensity>0});
  }
  function chooseCity(entry) {
    if (page==='add') {
      if (state.zones.length>=24) return;
      state.zones.push({...entry});state.cursor=state.zones.length-1;
    } else {
      if (state.zones.length<=1) return;
      const removed=state.zones.indexOf(entry);
      state.zones.splice(removed,1);
      if (removed<state.cursor) state.cursor--;
    }
    onZonesChange();
    back();
  }
  function choices() {
    if (page==='main') return [
      {id:'format',key:'T',label:'Time format',value:state.h24?'24-hour':'12-hour',action:toggleTime,adjust:toggleTime},
      {id:'temperature',label:'Temperature',value:state.temperatureUnit==='c'?'°C':'°F',action:()=>onChange({temperatureUnit:state.temperatureUnit==='c'?'f':'c'}),adjust:()=>onChange({temperatureUnit:state.temperatureUnit==='c'?'f':'c'})},
      {id:'add',key:'A',label:'Add a city',value:`${state.zones.length} cities`,more:true,disabled:state.zones.length>=24,action:()=>openPage('add')},
      {id:'remove',key:'R',label:'Remove a city',value:state.zones.length===1?'Keep one city':'Choose a city',more:true,disabled:state.zones.length<=1,action:()=>openPage('remove')},
      {id:'motion',label:'Remove animations',value:state.animations?'[ ]':'[✓]',checkbox:true,checked:!state.animations,action:()=>onChange({animations:!state.animations}),adjust:()=>onChange({animations:!state.animations})},
      {id:'spring',label:'Spring action',value:springNames[state.spring],more:true,disabled:!motionEnabled(),action:()=>openPage('spring'),adjust:direction=>setSpring(cycle(Object.keys(springNames),state.spring,direction))},
      {id:'theme',label:'Theme',value:themes[state.theme].name,colors:themes[state.theme].colors.slice(1,3),more:true,action:()=>openPage('theme'),adjust:direction=>onChange({theme:cycle(Object.keys(themes),state.theme,direction)})},
      {id:'reflection',label:'Reflection type',value:reflectionNames[state.reflectionType],more:true,action:()=>openPage('reflection'),adjust:direction=>onChange({reflectionType:cycle(Object.keys(reflectionNames),state.reflectionType,direction)})},
      {id:'glass',label:'Reflection intensity',detail:'0 off · 100 almost opaque',value:`${state.frostedGlass?state.glassIntensity:0} / 100`,action:()=>onChange({frostedGlass:!(state.frostedGlass && state.glassIntensity>0),glassIntensity:state.glassIntensity || 12}),adjust:adjustGlass},
    ];
    if (page==='theme') return Object.entries(themes).map(([id,theme])=>({id,label:theme.name,value:state.theme===id?'Selected':'',checked:state.theme===id,colors:theme.colors.slice(1,3),action:()=>onChange({theme:id})}));
    if (page==='spring') return Object.entries(springNames).map(([id,name])=>({id,label:name,detail:springDetails[id],value:state.spring===id?'Selected':'',checked:state.spring===id,action:()=>setSpring(id)}));
    if (page==='reflection') return Object.entries(reflectionNames).map(([id,name])=>({id,label:name,detail:reflectionDetails[id],value:state.reflectionType===id?'Selected':'',checked:state.reflectionType===id,action:()=>onChange({reflectionType:id})}));
    const query=$('#city-search').value.trim().toLowerCase();
    const cities=page==='add'?cityCatalog.filter(entry=>!state.zones.some(saved=>saved.city===entry.city && saved.zone===entry.zone)):state.zones;
    return cities.filter(entry=>`${entry.city} ${entry.zone}`.toLowerCase().includes(query)).map(entry=>({id:entry.city,label:entry.city,detail:entry.zone,value:page==='add'?'＋':'−',action:()=>chooseCity(entry)}));
  }
  function align({focus=false,snap=false}={}) {
    $('#intensity-help').hidden=page!=='main' || items[index]?.id!=='glass';
    const buttons=[...rows.querySelectorAll('.settings-row')];
    buttons.forEach((button,i)=>{
      button.classList.toggle('is-active',i===index);
      button.setAttribute('aria-current',String(i===index));
      button.tabIndex=i===index?0:-1;
    });
    const selected=buttons[index];
    highlight.hidden=!selected;
    if (!selected) return;
    target=selected.offsetTop;
    highlight.style.height=`${selected.offsetHeight}px`;
    if (snap || !motionEnabled()) {y=target;velocity=0;}
    highlight.style.transform=`translateY(${y}px)`;
    if (target<viewport.scrollTop) viewport.scrollTop=target;
    else if (target+selected.offsetHeight>viewport.scrollTop+viewport.clientHeight) viewport.scrollTop=target+selected.offsetHeight-viewport.clientHeight;
    if (focus) selected.focus({preventScroll:true});
  }
  function render({focus=false,snap=false}={}) {
    items=choices();
    index=Math.min(index,Math.max(0,items.length-1));
    rows.replaceChildren();
    for (const [i,item] of items.entries()) {
      const row=document.createElement('button');
      row.className='settings-row';
      row.dataset.setting=item.id;
      row.disabled=!!item.disabled;
      row.setAttribute('aria-label',`${item.label}${item.value?`, ${item.value}`:''}`);
      if (item.checkbox) {row.setAttribute('role','checkbox');row.setAttribute('aria-checked',String(item.checked));}
      else if (page==='theme' || page==='spring' || page==='reflection') row.setAttribute('aria-pressed',String(item.checked));
      const caret=document.createElement('span');caret.className='settings-caret';caret.textContent='›';caret.setAttribute('aria-hidden','true');
      const key=document.createElement('kbd');key.className='settings-shortcut';key.textContent=item.key || '';
      const label=document.createElement('span');label.className='settings-label';label.textContent=item.label;
      if (item.detail) {const detail=document.createElement('small');detail.textContent=item.detail;label.append(detail);}
      const value=document.createElement('span');value.className='settings-value';
      if (item.colors) {
        const swatch=document.createElement('span');swatch.className='settings-swatch';swatch.setAttribute('aria-hidden','true');
        for (const color of item.colors) {const chip=document.createElement('i');chip.style.background=color;swatch.append(chip);}
        value.append(swatch);
      }
      value.append(document.createTextNode(item.value || ''));
      const more=document.createElement('span');more.className='settings-more';more.textContent=item.more?'›':item.checked && !item.checkbox?'✓':'';more.setAttribute('aria-hidden','true');
      row.append(caret,key,label,value,more);
      row.addEventListener('focus',()=>{index=i;align();});
      row.addEventListener('click',()=>{index=i;align();item.action();});
      rows.append(row);
    }
    if (!items.length) {const empty=document.createElement('p');empty.className='settings-empty';empty.textContent='No matching cities.';rows.append(empty);}
    $('#settings-title').textContent={main:'SETTINGS',theme:'THEMES',spring:'SPRING ACTION',reflection:'REFLECTION TYPE',add:'ADD A CITY',remove:'REMOVE A CITY'}[page];
    $('#settings-context').textContent={main:reducedMotion.matches?'System reduced motion is active':'Your clock, your way',theme:'Choose a color palette',spring:'Choose how the highlight moves',reflection:'Choose how light meets your clock',add:'Search, select, and press enter',remove:'Select a city to remove'}[page];
    $('#settings-count').textContent=page==='main'?`${state.zones.length} cities`:page==='add'||page==='remove'?`${items.length} results`:'';
    $('#settings-search').hidden=page!=='add' && page!=='remove';
    align({focus,snap});
  }
  function openPage(next) {
    if (next==='add' && state.zones.length>=24 || next==='remove' && state.zones.length<=1) return;
    page=next;index=0;
    $('#city-search').value='';
    if (page==='theme') index=Object.keys(themes).indexOf(state.theme);
    if (page==='spring') index=Object.keys(springNames).indexOf(state.spring);
    if (page==='reflection') index=Object.keys(reflectionNames).indexOf(state.reflectionType);
    viewport.scrollTop=0;
    render({focus:page!=='add' && page!=='remove',snap:true});
    if (page==='add' || page==='remove') $('#city-search').focus({preventScroll:true});
  }
  function back() {
    if (page==='main') {close();return;}
    const previous=page;
    page='main';
    index=choices().findIndex(item=>item.id===previous);
    render({focus:true,snap:true});
  }
  function move(direction) {
    if (!items.length) return;
    let next=index;
    for (let tries=0;tries<items.length;tries++) {
      next=(next+direction+items.length)%items.length;
      if (!items[next].disabled) break;
    }
    index=next;align({focus:true});
  }
  function activate() {if (items[index] && !items[index].disabled) items[index].action();}
  function keydown(event) {
    const key=event.key.toLowerCase();
    if (key==='escape') {event.preventDefault();back();return;}
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target===$('#close-settings') && (key==='enter' || key===' ')) {event.preventDefault();close();return;}
    const typing=event.target===$('#city-search');
    if (key==='arrowup' || !typing && key==='k') {event.preventDefault();move(-1);}
    else if (key==='arrowdown' || !typing && key==='j') {event.preventDefault();move(1);}
    else if (key==='enter' || !typing && key===' ') {event.preventDefault();if (!event.repeat) activate();}
    else if (!typing && (key==='arrowleft' || key==='arrowright')) {
      event.preventDefault();
      if (items[index] && !items[index].disabled) items[index].adjust?.(key==='arrowright'?1:-1);
    } else if (!typing && items[index]?.id==='glass' && ['+','=','-','_'].includes(key)) {
      event.preventDefault();
      adjustGlass(key==='+' || key==='='?10:-10);
    } else if (!typing && !event.repeat) {
      if (key==='s') {event.preventDefault();close();}
      else if (key==='t') {event.preventDefault();toggleTime();}
      else if (key==='a') {event.preventDefault();openPage('add');}
      else if (key==='r') {event.preventDefault();openPage('remove');}
    }
  }
  function open() {
    if (dialog.open || state.stopped || !state.zones.length) return;
    page='main';index=0;panelY=motionEnabled()?1:0;panelVelocity=0;
    dialog.showModal();
    render({focus:true,snap:true});draw();
  }
  function close() {dialog.close();$('#open-settings').focus({preventScroll:true});}
  function refresh() {if (dialog.open) render({focus:rows.contains(document.activeElement)});}
  function step() {
    [panelY,panelVelocity]=advanceSpring(panelY,panelVelocity,0,state.spring);
    [y,velocity]=advanceSpring(y,velocity,target,state.spring);
  }
  function draw() {
    if (!motionEnabled()) {panelY=0;panelVelocity=0;y=target;velocity=0;}
    dialog.style.transform=`translateY(${panelY*70}px) scale(${1-panelY*.06})`;
    dialog.style.opacity=String(Math.max(0,Math.min(1,1-panelY*.45)));
    highlight.style.transform=`translateY(${y}px)`;
  }
  $('#close-settings').addEventListener('click',close);
  $('#city-search').addEventListener('input',()=>{index=0;render({snap:true});});
  dialog.addEventListener('cancel',event=>{event.preventDefault();back();});
  dialog.addEventListener('click',event=>{
    if (event.target!==dialog) return;
    const b=dialog.getBoundingClientRect();
    if (event.clientX<b.left || event.clientX>b.right || event.clientY<b.top || event.clientY>b.bottom) close();
  });
  return {open,close,keydown,refresh,step,draw};
}
