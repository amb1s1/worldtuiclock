import {pathToFileURL} from 'node:url';
import {AnsiParser} from '@konaito/terminal-browser/dist/ansi.js';
import {ClockBrowser} from './clock-browser.mjs';
import {deleteImage} from '@konaito/terminal-browser/dist/kitty.js';
import {Term} from '@konaito/terminal-browser/dist/term.js';
import {ClockSession} from './clock-session.mjs';
import {FrameWriter,GraphicsReplies} from './graphics.mjs';

// Reuse Chromium/Kitty rendering without creating the wrapper's toolbar page.
export async function openClock(url, {
  input=process.stdin,
  output=process.stdout,
  signals=process,
  launch=(width,height)=>ClockBrowser.launch(width,height),
}={}) {
  if (!input.isTTY || !output.isTTY) throw new Error('Run make run directly in Ghostty.');
  const term=new Term(input,output);
  const parser=new AnsiParser();
  const frames=new FrameWriter(output);
  const replies=new GraphicsReplies(response=>frames.reply(response));
  let browser, session, size, pixelTimer, escapeTimer, resolvePixels, failure;
  let stopping=false;
  let resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const stop=error=>{
    if (error instanceof Error) failure ??= error;
    stopping=true;
    resolveDone();
  };
  const run=commands=>{
    if (stopping) return;
    for (const command of commands) {
      switch (command.type) {
        case 'write': term.write(command.data); break;
        case 'cdp': void browser.send(command.method,command.params).catch(stop); break;
        case 'reload': void browser.reload().catch(stop); break;
        case 'setViewport': void browser.setViewport(command.width,command.height).catch(stop); break;
        case 'quit': stop(); break;
      }
    }
  };
  const onData=chunk=>{
    const keys=replies.feed(chunk);
    // Graphics ACKs arrive continuously; they must not keep postponing a user's
    // standalone Escape. Only keyboard bytes restart the ambiguity timeout.
    const hasInput=keys.length>0 || replies.pending.length>0 && replies.pending.length<=2;
    if (hasInput) clearTimeout(escapeTimer);
    for (const event of parser.feed(keys)) {
      if (event.type==='pixelSize') {
        if (event.width>0 && event.height>0) resolvePixels?.({width:event.width,height:event.height});
      } else if (session) {
        run(session.handleTerm(event));
      } else if (event.type==='key' && event.ctrl && ['c','q'].includes(event.key)) {
        stop();
      }
    }
    // A standalone Escape has no trailing byte; flush it so dialogs can close.
    if (hasInput) escapeTimer=setTimeout(()=>{
      const buffered=parser.feed(replies.flushEscape());
      if (session) for (const event of [...buffered,...parser.flush()]) run(session.handleTerm(event));
    },35);
  };
  const onResize=()=>{
    if (!session || stopping) return;
    const {cols,rows}=term.cells();
    run(session.handleResize({cols,rows,
      pxWidth:Math.max(1,Math.round(size.pxWidth/size.cols*cols)),
      pxHeight:Math.max(1,Math.round(size.pxHeight/size.rows*rows)),
    }));
  };
  const onSignal=()=>stop();
  input.on('data',onData);
  output.on('resize',onResize);
  signals.on('SIGINT',onSignal);
  signals.on('SIGTERM',onSignal);
  try {
    term.enter();
    const pixels=new Promise(resolve=>{
      resolvePixels=resolve;
      pixelTimer=setTimeout(()=>{
        const {cols,rows}=term.cells();
        resolve({width:cols*10,height:rows*20});
      },500);
      term.queryPixelSize();
    });
    const px=await Promise.race([pixels,done]);
    clearTimeout(pixelTimer);
    clearTimeout(escapeTimer);
    resolvePixels=null;
    if (stopping) return;
    size={...term.cells(),pxWidth:px.width,pxHeight:px.height};
    browser=await launch(px.width,px.height);
    if (stopping) return;
    session=new ClockSession(size);
    browser.browser?.once('disconnected',onSignal);
    await browser.startScreencast(png=>frames.draw(png,term.cells()),stop);
    if (stopping) {
      if (failure) throw failure;
      return;
    }
    await browser.navigate(url);
    await done;
    if (failure) throw failure;
  } finally {
    stopping=true;
    frames.close();
    clearTimeout(pixelTimer);
    clearTimeout(escapeTimer);
    input.off('data',onData);
    output.off('resize',onResize);
    signals.off('SIGINT',onSignal);
    signals.off('SIGTERM',onSignal);
    term.write(deleteImage(1)+deleteImage(2));
    term.restore();
    await browser?.closeAll();
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  openClock(process.argv[2]).catch(error=>{
    console.error(`worldclock: ${error.message}`);
    process.exitCode=1;
  });
}
