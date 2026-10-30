// Open-Meteo WMO weather interpretation codes; night skies use a moon.
export function weatherKind(code,isDay) {
  if (code===0 || code===1) return {icon:isDay?'sun':'moon',label:isDay?'Sunny':'Clear night'};
  if (code===2) return {icon:isDay?'partly':'partly-night',label:'Partly cloudy'};
  if (code===3) return {icon:'cloud',label:'Cloudy'};
  if ([45,48].includes(code)) return {icon:'fog',label:'Foggy'};
  if ([51,53,55].includes(code)) return {icon:'rain',label:'Drizzle'};
  if ([56,57,66,67].includes(code)) return {icon:'rain',label:'Freezing rain'};
  if ([61,63,65,80,81,82].includes(code)) return {icon:'rain',label:code===65 || code===82?'Heavy rain':'Raining'};
  if ([71,73,75,77,85,86].includes(code)) return {icon:'snow',label:'Snowing'};
  if ([95,96,97,99].includes(code)) return {icon:'thunder',label:'Thunderstorm'};
  return {icon:'unknown',label:'Conditions unknown'};
}

export function formatTemperature(celsius,unit) {
  return `${Math.round(unit==='f'?celsius*9/5+32:celsius)}°${unit.toUpperCase()}`;
}

// A small, fixed particle budget keeps full-pane PNG rendering practical in
// Ghostty. Positions are deterministic, so refreshing weather does not jump.
export function weatherBackground(kind) {
  const particles=(type,count)=>Array.from({length:count},(_,i)=>
    `<i class="ambient-${type}" style="left:${(i*37+7)%100}%;--phase:${-((i*1.7)%17).toFixed(2)}s;--speed:${type==='rain'?2.2+i%5*.35:type==='snow'?12+i%7:4+i%5}s;--level:${.35+(i%5)*.12};--star-y:${(i*29+11)%84}%"></i>`).join('');
  const clouds='<i class="ambient-cloud"></i><i class="ambient-cloud"></i><i class="ambient-cloud"></i>';
  const sun='<i class="ambient-sun"></i>';
  const night='<i class="ambient-moon"></i>'+particles('star',18);
  if (kind==='rain') return particles('rain',32)+clouds;
  if (kind==='thunder') return particles('rain',32)+clouds+'<i class="ambient-thunder"></i>';
  if (kind==='snow') return particles('snow',24)+clouds;
  if (kind==='cloud') return clouds;
  if (kind==='fog') return '<i class="ambient-fog"></i><i class="ambient-fog"></i>';
  if (kind==='sun') return sun;
  if (kind==='moon') return night;
  if (kind==='partly') return sun+clouds;
  if (kind==='partly-night') return night+clouds;
  return '';
}

export function weatherIcon(kind) {
  const sun='<g class="weather-sun"><circle cx="52" cy="38" r="17"/><g class="sun-rays" fill="none" stroke-width="3.5" stroke-linecap="round"><path d="M52 10v-5M52 66v5M24 38h-5M80 38h5M32 18l-4-4M72 58l4 4M32 58l-4 4M72 18l4-4"/></g></g>';
  const moon='<g class="weather-moon"><path d="M67 15a26 26 0 1 0 19 40A25 25 0 0 1 67 15Z"/><circle cx="32" cy="18" r="1.7"/><circle cx="91" cy="22" r="2.5"/></g>';
  const cloud='<g class="cloud-front"><path d="M27 65a15 15 0 0 1-1-30 25 25 0 0 1 47-6 18 18 0 0 1 19 36Z"/></g>';
  const back='<g class="cloud-back"><path d="M40 49a12 12 0 0 1 0-24 21 21 0 0 1 40-3 15 15 0 0 1 16 27Z"/></g>';
  const rain='<g class="rain-drops" fill="none" stroke-width="3.5" stroke-linecap="round"><path d="m33 74-5 11"/><path d="m55 77-5 11"/><path d="m78 73-5 11"/></g>';
  let content='';
  if (kind==='sun') content=sun;
  else if (kind==='moon') content=moon;
  else if (kind==='partly' || kind==='partly-night') content=`<g transform="translate(22,-6) scale(.8)">${kind==='partly'?sun:moon}</g>${cloud}`;
  else if (kind==='cloud') content=back+cloud;
  else if (kind==='rain') content=cloud+rain;
  else if (kind==='thunder') content=cloud+'<path class="lightning" d="m59 61-15 20h13l-6 17 25-28H62l8-9Z"/>';
  else if (kind==='snow') content=cloud+'<g class="snowflakes"><circle cx="30" cy="79" r="3"/><circle cx="55" cy="85" r="3"/><circle cx="80" cy="77" r="3"/></g>';
  else if (kind==='fog') content=cloud+'<g class="fog-lines" fill="none" stroke-width="3" stroke-linecap="round"><path d="M22 76h68M32 85h51M25 94h65"/></g>';
  else content='<circle class="unknown-weather" cx="60" cy="45" r="22" fill="none" stroke-width="2" stroke-dasharray="3 6"/>';
  return `<svg viewBox="0 0 120 104" class="weather-${kind}" aria-hidden="true">${content}</svg>`;
}

export function createWeather({getZone,getUnit,afterSaved}) {
  const card=document.querySelector('#weather');
  const icon=document.querySelector('#weather-icon');
  const temperature=document.querySelector('#weather-temperature');
  const condition=document.querySelector('#weather-condition');
  const source=document.querySelector('#weather-source');
  const background=document.querySelector('#weather-background');
  const cache=new Map();
  let activeKey='', timer, request;
  function setBackground(kind) {
    if (background.dataset.kind===kind) return;
    background.dataset.kind=kind;
    background.innerHTML=weatherBackground(kind);
    background.hidden=kind==='unknown';
  }
  function show(data,zone) {
    const kind=weatherKind(data.code,data.isDay);
    setBackground(kind.icon);
    const markup=weatherIcon(kind.icon);
    if (icon.dataset.kind!==kind.icon) {icon.innerHTML=markup;icon.dataset.kind=kind.icon;}
    temperature.textContent=formatTemperature(data.temperatureC,getUnit());
    condition.textContent=kind.label;
    const location=data.location!==zone.city?`${data.location} · `:'';
    source.textContent=`${location}${data.stale?'Earlier · ':''}Open-Meteo`;
    card.setAttribute('aria-label',`${zone.city}: ${temperature.textContent}, ${kind.label}${data.stale?', earlier conditions':''}`);
    card.title=`${data.location} · ${kind.label} · ${new Date(data.updatedAt*1000).toLocaleString()}\nCurrent conditions from Open-Meteo weather models`;
  }
  function unavailable(zone) {
    setBackground('unknown');
    icon.innerHTML=weatherIcon('unknown');
    icon.dataset.kind='unknown';
    temperature.textContent='—';
    condition.textContent='Weather unavailable';
    source.textContent='Open-Meteo';
    card.title='Weather needs an internet connection and a city location. Retrying shortly.';
    card.setAttribute('aria-label',`${zone.city}: weather unavailable`);
  }
  function update() {
    const zone=getZone();
    if (!zone) return;
    const key=`${zone.city}|${zone.zone}`;
    const cached=cache.get(key);
    if (key===activeKey && (timer || request)) return;
    if (key!==activeKey) {clearTimeout(timer);timer=null;request?.abort();request=null;}
    activeKey=key;
    if (cached && cached.until>Date.now()) {
      if (cached.data) show(cached.data,zone); else unavailable(zone);
      return;
    }
    temperature.textContent='—';
    condition.textContent='Loading weather';
    setBackground('unknown');
    source.textContent='Open-Meteo';
    icon.innerHTML='';
    icon.dataset.kind='';
    card.title='';
    card.setAttribute('aria-label',`${zone.city}: loading weather`);
    timer=setTimeout(async()=>{
      timer=null;
      const controller=new AbortController();
      request=controller;
      const deadline=setTimeout(()=>controller.abort(),15000);
      try {
        await afterSaved();
        const params=new URLSearchParams({city:zone.city,zone:zone.zone});
        const response=await fetch(`/api/weather?${params}`,{signal:controller.signal});
        if (!response.ok) throw new Error('Weather unavailable');
        const data=await response.json();
        cache.set(key,{data,until:Date.now()+600000});
        if (key===activeKey && request===controller) show(data,zone);
      } catch {
        if (key===activeKey && request===controller) {cache.set(key,{until:Date.now()+60000});unavailable(zone);}
      } finally {
        clearTimeout(deadline);
        if (request===controller) request=null;
      }
    },220);
  }
  const refresh=setInterval(update,60000);
  return {update, stop(){clearInterval(refresh);clearTimeout(timer);request?.abort();setBackground('unknown');}};
}
