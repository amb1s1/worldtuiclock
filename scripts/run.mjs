import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareBrowser} from './browser.mjs';

const root=await fs.realpath(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
const webOnly=args.includes('--web-only');
const setupOnly=args.includes('--setup-only');
const port=Number(args.find(arg=>arg.startsWith('--port='))?.slice(7) ?? 8787);
const url=`http://127.0.0.1:${port}`;
const children=new Set();
let closing=false;

function start(program, arguments_, stdio='inherit') {
  const child=spawn(program,arguments_,{cwd:root,stdio});
  children.add(child);
  const done=new Promise((resolve,reject)=>{
    child.once('error',error=>{children.delete(child); reject(error);});
    child.once('exit',(code,signal)=>{children.delete(child);resolve({code,signal});});
  });
  // Some processes can fail while the launcher is polling server readiness.
  // Keep that rejection handled until the caller awaits the original promise.
  done.catch(()=>{});
  return {child,done};
}

async function run(program,args_) {
  const result=await start(program,args_).done;
  if (result.code!==0) throw new Error(`${program} failed (${result.code ?? result.signal}).`);
}

async function cleanup() {
  if (closing) return;
  closing=true;
  const owned=[...children];
  for (const child of owned) child.kill('SIGTERM');
  for (let i=0;i<50 && children.size;i++) await delay(100);
  for (const child of owned) if (children.has(child)) child.kill('SIGKILL');
}
for (const signal of ['SIGINT','SIGTERM']) {
  process.once(signal,()=>{void cleanup().then(()=>process.exit(0));});
}

function listening() {
  return new Promise(resolve=>{
    const socket=net.connect({host:'127.0.0.1',port});
    const finish=value=>{socket.destroy();resolve(value);};
    socket.once('connect',()=>finish(true));
    socket.once('error',()=>finish(false));
    socket.setTimeout(1000,()=>finish(true));
  });
}

async function health() {
  const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1500)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function stopPrevious() {
  if (!await listening()) return;
  let status;
  try { status=await health(); } catch { /* Report the ownership failure below. */ }
  if (status?.application!=='worldclock' || status.project!==root) {
    throw new Error(`Port ${port} belongs to an unrecognized server. Leaving it running; choose make run PORT=8788.`);
  }
  console.log(`Restarting World Clock on port ${port}…`);
  const response=await fetch(`${url}/api/quit`,{method:'POST',
    headers:{Origin:url,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});
  if (!response.ok) throw new Error(`The existing clock refused to stop: HTTP ${response.status}`);
  for(let i=0;i<50;i++) { if(!await listening()) return; await delay(100); }
  throw new Error('The previous clock did not shut down. No process was force-killed.');
}

async function main() {
  if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('PORT must be between 1 and 65535.');
  if (setupOnly) { await prepareBrowser(root); return; }
  if (!webOnly && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('Run make run directly in Ghostty. Use make web for a normal browser or non-interactive shell.');
  }
  // Finish setup and compilation before restarting a working clock.
  const terminalBrowser=webOnly ? null : await prepareBrowser(root);
  const output=path.join(root,'.artifacts/bin/worldclock');
  const logPath=path.join(root,'.artifacts/server.log');
  await fs.mkdir(path.dirname(output),{recursive:true});
  await run('go',['build','-o',output,'.']);
  await stopPrevious();
  const log=await fs.open(logPath,'w');
  const server=start(output,['--web',`--port=${port}`],['ignore',log.fd,log.fd]);
  await log.close();
  let ready=false;
  for (let i=0;i<100;i++) {
    if(server.child.exitCode!==null || server.child.signalCode!==null) break;
    try {
      const status=await health();
      if(status.application==='worldclock' && status.project===root && status.pid===server.child.pid) {ready=true;break;}
    } catch { /* Wait for this server's listener. */ }
    await delay(100);
  }
  if(!ready) {
    // An already-open page can send q immediately after a restart, before the
    // launcher observes readiness. A clean server exit is still a normal quit.
    if(server.child.exitCode===0) { console.log('World Clock stopped.'); return; }
    throw new Error(`Clock startup failed. ${await fs.readFile(logPath,'utf8')}`);
  }
  console.log(`World Clock: ${url}`);
  if(webOnly) {
    console.log('Open that URL in your browser. Ctrl+C stops the server.');
    const result=await server.done;
    if(result.code!==0) throw new Error(`Clock exited with ${result.code ?? result.signal}.`);
  } else {
    console.log('Opening the clock inside the terminal. Ctrl+Q quits.');
    const browser=start(process.execPath,[terminalBrowser,url]);
    const result=await Promise.race([browser.done,server.done]);
    if(result.code!==0 && !closing) throw new Error(`Clock exited with ${result.code ?? result.signal}. See ${logPath}`);
  }
}

try { await main(); }
catch(error) { console.error(`worldclock: ${error.message}`); process.exitCode=1; }
finally { await cleanup(); }
