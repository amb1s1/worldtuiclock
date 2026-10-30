export const springs = {
  small: {omega:12, damping:.86},
  medium: {omega:7, damping:.6},
  super: {omega:8, damping:.24},
};

export const reflectionNames={frosted:'Frosted glass',clear:'Clear glass',liquid:'Liquid glass',prism:'Prism',matte:'Matte'};
export const reflectionDetails={frosted:'Soft light & a frosted texture',clear:'Transparent, with a crisp rim',liquid:'Glossy curves & bright reflections',prism:'A subtle spectrum of color',matte:'Soft texture & a low-glare finish'};

export function reflectionStrength(intensity,enabled=true) {
  const level=enabled?Math.min(100,Math.max(0,intensity)):0;
  // Preserve existing 0–20 settings; the extended range obscures the clock.
  const obscurity=Math.max(0,(level-20)/80);
  return {material:Math.min(level/20,1),veil:.94*obscurity**1.3,blur:10*obscurity**1.7};
}

export function advanceSpring(position, velocity, target, preset='medium', dt=1/30) {
  const {omega,damping}=springs[preset];
  const damped=omega*Math.sqrt(1-damping*damping);
  const decay=Math.exp(-damping*omega*dt), cos=Math.cos(damped*dt), sin=Math.sin(damped*dt);
  const offset=position-target;
  return [target+decay*(offset*cos+(velocity+damping*omega*offset)/damped*sin),
    decay*(velocity*cos-(damping*omega*velocity+omega*omega*offset)/damped*sin)];
}

export const themes = {
  orbit: {name:'Orbit', colors:['#1b1726','#ff5f87','#7d56f4','#bd64ee','#e5e0ee','#b8b2cc','#a49ab5','#817792','#2e2942','#302447','#342236','#231d30','#40364e']},
  aurora: {name:'Aurora', colors:['#10221f','#78efc6','#36a89e','#6ad3a1','#e0f3e9','#b5d1c7','#93b7ac','#7a9f94','#203b35','#1c4539','#183b3d','#172d28','#335047']},
  ember: {name:'Ember', colors:['#251a17','#ff9169','#d9a341','#f6b769','#f4e6dc','#d6c0b0','#b8a192','#9c8173','#42312a','#4a2d28','#45371f','#30221c','#584032']},
  glacier: {name:'Glacier', colors:['#121d2b','#6dd9f3','#6482f6','#72afff','#e1ecfa','#b7c8df','#97acc8','#7b91b1','#25364c','#203d51','#2c3150','#1b283b','#354962']},
  rose: {name:'Rose', colors:['#261922','#ffa0b5','#c770ae','#e88ca6','#f8e4ee','#d7b8c9','#bd9bad','#a17f92','#402a39','#4c2b41','#493134','#321f2b','#58394d']},
  mono: {name:'Moonlight', colors:['#181a20','#eef0f7','#949caf','#bac0d0','#f0f1f5','#c2c6d1','#a7abba','#8c91a2','#2c303a','#333944','#30323b','#22252e','#424755']},
};

export const colorVariables=['background','pink','purple','middle','text','time','muted','dim','night','selection-start','selection-end','panel','line'];

export const cityCatalog = [
  ['New York','America/New_York'],['Los Angeles','America/Los_Angeles'],['Amsterdam','Europe/Amsterdam'],
  ['Texas','America/Chicago'],['Seattle','America/Los_Angeles'],['Chicago','America/Chicago'],
  ['San Francisco','America/Los_Angeles'],['Denver','America/Denver'],['Phoenix','America/Phoenix'],
  ['Miami','America/New_York'],['Toronto','America/Toronto'],['Vancouver','America/Vancouver'],
  ['Mexico City','America/Mexico_City'],['São Paulo','America/Sao_Paulo'],['Buenos Aires','America/Argentina/Buenos_Aires'],
  ['Honolulu','Pacific/Honolulu'],['Anchorage','America/Anchorage'],['London','Europe/London'],
  ['Paris','Europe/Paris'],['Berlin','Europe/Berlin'],['Madrid','Europe/Madrid'],['Rome','Europe/Rome'],
  ['Lisbon','Europe/Lisbon'],['Stockholm','Europe/Stockholm'],['Helsinki','Europe/Helsinki'],
  ['Warsaw','Europe/Warsaw'],['Kyiv','Europe/Kyiv'],['Athens','Europe/Athens'],['Istanbul','Europe/Istanbul'],
  ['Dubai','Asia/Dubai'],['Riyadh','Asia/Riyadh'],['Tel Aviv','Asia/Jerusalem'],['Cairo','Africa/Cairo'],
  ['Cape Town','Africa/Johannesburg'],['Nairobi','Africa/Nairobi'],['Lagos','Africa/Lagos'],
  ['Mumbai','Asia/Kolkata'],['New Delhi','Asia/Kolkata'],['Kathmandu','Asia/Kathmandu'],
  ['Bangkok','Asia/Bangkok'],['Singapore','Asia/Singapore'],['Hong Kong','Asia/Hong_Kong'],
  ['Shanghai','Asia/Shanghai'],['Taipei','Asia/Taipei'],['Tokyo','Asia/Tokyo'],['Seoul','Asia/Seoul'],
  ['Jakarta','Asia/Jakarta'],['Manila','Asia/Manila'],['Perth','Australia/Perth'],
  ['Adelaide','Australia/Adelaide'],['Sydney','Australia/Sydney'],['Melbourne','Australia/Melbourne'],
  ['Auckland','Pacific/Auckland'],['UTC','Etc/UTC'],
].map(([city,zone])=>({city,zone})).sort((a,b)=>a.city.localeCompare(b.city));
