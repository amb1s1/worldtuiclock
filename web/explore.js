import {advanceSpring} from './preferences.js';

export const MINUTE=60000;
export const previewOffset=minutes=>Math.max(-48*60,Math.min(48*60,minutes));
export const countdown=milliseconds=>{
  const seconds=Math.ceil(Math.max(0,milliseconds)/1000);
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
};

// Use an absolute deadline so background tabs and slow terminals keep time.
export class FocusTimer {
  minutes=25;
  remaining=25*MINUTE;
  deadline=null;
  completed=false;
  value(now) {return this.deadline===null?this.remaining:Math.max(0,this.deadline-now);}
  reset() {this.remaining=this.minutes*MINUTE;this.deadline=null;this.completed=false;}
  adjust(direction) {if(this.deadline===null){this.minutes=Math.min(90,Math.max(5,this.minutes+direction*5));this.reset();}}
  toggle(now) {
    this.update(now);
    if(this.deadline!==null){this.remaining=this.value(now);this.deadline=null;}
    else {if(this.remaining===0)this.reset();this.deadline=now+this.remaining;this.completed=false;}
  }
  update(now) {
    if(this.deadline!==null && now>=this.deadline){this.remaining=0;this.deadline=null;this.completed=true;return true;}
    return false;
  }
}

export function createExplore({getSpring,motionEnabled,onTimeChange,onAdvance,isSettingsOpen}) {
  const $=selector=>document.querySelector(selector);
  const dialog=$('#explore'), menu=$('#explore-menu'), highlight=$('#explore-selector');
  const timer=new FocusTimer();
  let page='main',index=0,items=[],offset=0,touring=false,tourSeconds=12,nextCity=0;
  let panelY=0,panelVelocity=0,y=0,velocity=0,target=0,lastSecond=-1;
  const currentNow=()=>Date.now();
  function setOffset(minutes) {offset=previewOffset(minutes);onTimeChange(offset*MINUTE);paint();}
  function stopTour() {touring=false;paint();}
  function rows() {
    if(page==='main')return [
      {label:'Time machine',detail:'One moment. Every city.',value:offset?'Previewing':'↗',action:()=>openPage('time')},
      {label:'World tour',detail:'Let the clock take you somewhere.',value:touring?'On':'↗',action:()=>openPage('tour')},
      {label:'Focus session',detail:'A little room for one thing.',value:timer.deadline!==null?countdown(timer.value(currentNow())):'↗',action:()=>openPage('focus')},
    ];
    if(page==='time')return [
      {label:'Travel through time',detail:'←/→ 30 minutes · −/+ 6 hours',value:offset===0?'Now':`${offset>0?'+':'−'}${Math.floor(Math.abs(offset)/60)}h ${Math.abs(offset)%60}m`,adjust:d=>setOffset(offset+d*30),action:()=>setOffset(offset+30)},
      {label:'Return to now',detail:'Weather always shows current conditions.',value:'↶',action:()=>{setOffset(0);close();}},
    ];
    if(page==='tour')return [
      {label:touring?'Pause the tour':'Start the tour',detail:'Visits each saved city, in order.',value:touring?'Ⅱ':'▶',action:()=>{touring=!touring;nextCity=currentNow()+tourSeconds*1000;paint();close();}},
      {label:'Stay in each city',detail:'←/→ change pace',value:`${tourSeconds}s`,adjust:d=>{const choices=[6,12,20];tourSeconds=choices[(choices.indexOf(tourSeconds)+d+3)%3];nextCity=currentNow()+tourSeconds*1000;paint();},action:()=>items[1].adjust(1)},
    ];
    return [
      {label:timer.deadline!==null?'Pause session':timer.completed?'Start again':timer.remaining<timer.minutes*MINUTE?'Resume session':'Begin session',detail:timer.completed?'Complete. Take a breath.':timer.deadline!==null?'Your timer keeps going when you close this panel.':'Choose one thing. Give it your attention.',value:countdown(timer.value(currentNow())),action:()=>{timer.toggle(currentNow());$('#focus-announcement').textContent='';paint();close();}},
      {label:'Session length',detail:timer.deadline!==null?'Pause to change the length.':'←/→ adjust in five-minute steps',value:`${timer.minutes} min`,disabled:timer.deadline!==null,adjust:d=>{timer.adjust(d);paint();},action:()=>{timer.adjust(1);paint();}},
      {label:'Reset session',detail:'Start fresh whenever you need.',value:'↶',action:()=>{timer.reset();$('#focus-announcement').textContent='';paint();}},
    ];
  }
  function align(focus=false,snap=false) {
    const buttons=[...menu.querySelectorAll('.settings-row')];
    buttons.forEach((button,i)=>{button.classList.toggle('is-active',i===index);button.tabIndex=i===index?0:-1;button.setAttribute('aria-current',String(i===index));});
    const selected=buttons[index];
    if(!selected)return;
    target=selected.offsetTop;
    highlight.style.height=`${selected.offsetHeight}px`;
    if(target<menu.scrollTop)menu.scrollTop=target;
    else if(target+selected.offsetHeight>menu.scrollTop+menu.clientHeight)menu.scrollTop=target+selected.offsetHeight-menu.clientHeight;
    if(snap || !motionEnabled()){y=target;velocity=0;}
    if(focus)selected.focus({preventScroll:true});
  }
  function paint(snap=false) {
    const remaining=timer.value(currentNow());
    const badge=$('#focus-status');
    badge.hidden=timer.remaining===timer.minutes*MINUTE && timer.deadline===null && !timer.completed;
    badge.textContent=timer.completed?'✓ complete':`${timer.deadline===null?'Ⅱ':'◷'} ${countdown(remaining)}`;
    badge.classList.toggle('complete',timer.completed);
    badge.setAttribute('aria-label',timer.completed?'Focus session complete':`Focus session ${timer.deadline===null?'paused':'running'}, ${countdown(remaining)} remaining`);
    $('#clock-status').textContent=offset?'↶ live':touring?'◌ touring':'live';
    $('#live-control').setAttribute('aria-label',offset?'Return to current time':touring?'Pause world tour':'Live clock');
    $('#live-control').classList.toggle('is-preview',offset!==0);
    $('#live-control').classList.toggle('is-touring',touring);
    if(!dialog.open)return;
    const focused=menu.contains(document.activeElement);
    items=rows();
    index=Math.min(index,items.length-1);
    menu.querySelectorAll('.settings-row').forEach(row=>row.remove());
    for(const [i,item] of items.entries()){
      const button=document.createElement('button');
      button.className='settings-row';button.disabled=!!item.disabled;
      button.setAttribute('aria-label',`${item.label}, ${item.value}`);
      const caret=document.createElement('span');caret.className='settings-caret';caret.textContent='›';caret.setAttribute('aria-hidden','true');
      const label=document.createElement('span');label.className='settings-label';label.textContent=item.label;
      const detail=document.createElement('small');detail.textContent=item.detail;label.append(detail);
      const value=document.createElement('span');value.className='settings-value';value.textContent=item.value;
      button.append(caret,label,value);
      button.addEventListener('focus',()=>{index=i;align();});
      button.addEventListener('click',()=>{index=i;item.action();});
      menu.append(button);
    }
    $('#explore-title').textContent={main:'AFTER HOURS',time:'TIME MACHINE',tour:'WORLD TOUR',focus:'FOCUS SESSION'}[page];
    $('#explore-caption').textContent={main:'A few things to explore.',time:'Preview up to 48 hours in either direction.',tour:'Manual city changes pause the tour.',focus:timer.completed?'Session complete. Take a moment for yourself.':'Time for one thing.'}[page];
    align(focused,snap);
  }
  function openPage(next){page=next;index=0;paint(true);align(true,true);}
  function open(next='main') {
    if(isSettingsOpen())return;
    if(!dialog.open){panelY=motionEnabled()?1:0;panelVelocity=0;dialog.showModal();}
    openPage(next);draw();
  }
  function close(){dialog.close();$('#open-explore').focus({preventScroll:true});}
  function back(){if(page==='main')close();else openPage('main');}
  function move(direction){
    for(let tries=0;tries<items.length;tries++){index=(index+direction+items.length)%items.length;if(!items[index].disabled)break;}
    align(true);
  }
  function keydown(event){
    if(event.ctrlKey || event.altKey || event.metaKey)return;
    const key=event.key.toLowerCase();
    if(key==='escape'){event.preventDefault();back();}
    else if(event.target===$('#close-explore') && ['enter',' '].includes(key)){event.preventDefault();close();}
    else if(['arrowup','k','arrowdown','j'].includes(key)){event.preventDefault();move(key==='arrowup'||key==='k'?-1:1);}
    else if(['arrowleft','arrowright'].includes(key)){event.preventDefault();if(!items[index]?.disabled)items[index]?.adjust?.(key==='arrowright'?1:-1);}
    else if(['enter',' '].includes(key)){event.preventDefault();if(!event.repeat&&!items[index]?.disabled)items[index]?.action();}
    else if(page==='time' && ['+','=','-','_'].includes(key)){event.preventDefault();setOffset(offset+(key==='+'||key==='='?360:-360));}
  }
  function tick(now){
    const completed=timer.update(now);
    if(touring){
      if(dialog.open || isSettingsOpen())nextCity=now+tourSeconds*1000;
      else if(now>=nextCity){nextCity=now+tourSeconds*1000;onAdvance();}
    }
    const second=Math.floor(now/1000);
    if(completed || second!==lastSecond){lastSecond=second;paint();}
    if(completed){$('#focus-announcement').textContent='Focus session complete. Take a breath.';}
  }
  function step(){
    [panelY,panelVelocity]=advanceSpring(panelY,panelVelocity,0,getSpring());
    [y,velocity]=advanceSpring(y,velocity,target,getSpring());
  }
  function draw(){
    if(!dialog.open)return;
    if(!motionEnabled()){panelY=0;panelVelocity=0;y=target;velocity=0;}
    dialog.style.transform=`translateY(${panelY*70}px) scale(${1-panelY*.06})`;
    dialog.style.opacity=String(Math.max(0,Math.min(1,1-panelY*.45)));
    highlight.style.transform=`translateY(${y}px)`;
  }
  $('#open-explore').addEventListener('click',()=>open());
  $('#focus-status').addEventListener('click',()=>open('focus'));
  $('#live-control').addEventListener('click',()=>{if(offset)setOffset(0);else if(touring)stopTour();});
  $('#close-explore').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();back();});
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();
  });
  paint();
  return {open,keydown,tick,step,draw,stopTour,get isOpen(){return dialog.open;}};
}
