import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

function command(program, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {cwd, stdio:'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited with ${code}`)));
  });
}

export async function prepareBrowser(root) {
  const wanted = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).dependencies;
  let installNeeded = false;
  for (const [name, version] of Object.entries(wanted)) {
    try {
      const installed=JSON.parse(await fs.readFile(path.join(root,'node_modules',name,'package.json'),'utf8'));
      if (installed.version !== version) installNeeded=true;
    } catch { installNeeded=true; }
  }
  if (installNeeded) {
    console.log('Installing the terminal browser (first run)…');
    let locked=true;
    try { await fs.access(path.join(root,'package-lock.json')); } catch { locked=false; }
    // Browser installation is handled below; avoid a partially extracted cache
    // from Puppeteer's npm postinstall hook on this Node/macOS combination.
    await command('npm',[locked?'ci':'install','--ignore-scripts','--no-audit','--no-fund'],root);
  }
  const {default:puppeteer, PUPPETEER_REVISIONS} = await import('puppeteer');
  const executable=puppeteer.executablePath({headless:'shell'});
  try {
    await fs.access(executable,constants.X_OK);
  } catch {
    const {install, Browser, detectBrowserPlatform}=await import('@puppeteer/browsers');
    const buildId=PUPPETEER_REVISIONS['chrome-headless-shell'];
    const platform=detectBrowserPlatform();
    if (!['mac','mac_arm','linux'].includes(platform)) {
      throw new Error('Automatic browser setup supports macOS and Linux x64. Use make web on this platform.');
    }
    console.log(`Installing Chrome Headless Shell ${buildId}…`);
    const archive=await install({browser:Browser.CHROMEHEADLESSSHELL,buildId,platform,
      cacheDir:puppeteer.configuration.cacheDirectory,unpack:false});
    const destination=path.dirname(path.dirname(executable));
    await fs.mkdir(path.dirname(destination),{recursive:true});
    const staging=await fs.mkdtemp(path.join(path.dirname(destination),'.worldclock-extract-'));
    // Native unzip reliably extracts the complete archive, including executable
    // modes; the npm extractor was exiting after extracting only license files.
    await command('unzip',['-q',archive,'-d',staging],root);
    await fs.access(path.join(staging,path.relative(destination,executable)),constants.X_OK);
    try {
      await fs.rename(destination,`${destination}.incomplete-${Date.now()}`);
    } catch(error) { if(error.code!=='ENOENT') throw error; }
    await fs.rename(staging,destination);
  }
  await command(executable,['--version'],root);
  return path.join(root,'scripts/terminal.mjs');
}
