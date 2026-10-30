import {BrowserAdapter} from '@konaito/terminal-browser/dist/browser.js';

// The upstream adapter acknowledges Chromium frames immediately, even if the
// terminal has not consumed them. Await the consumer to apply backpressure.
export class ClockBrowser {
  constructor(adapter) {this.adapter=adapter;this.browser=adapter.browser;this.cdp=null;this.onFrame=null;this.onError=null;}
  static async launch(width,height) {return new ClockBrowser(await BrowserAdapter.launch(width,height));}
  navigate(url) {return this.adapter.navigate(url);}
  reload() {return this.adapter.reload();}
  send(method,params) {return this.adapter.send(method,params);}
  async startScreencast(onFrame,onError) {
    this.onFrame=onFrame;this.onError=onError;
    this.cdp=await this.adapter.page.createCDPSession();
    this.adapter.cdp=this.cdp;
    const cdp=this.cdp;
    cdp.on('Page.screencastFrame',async event=>{
      try {await this.onFrame(Buffer.from(event.data,'base64'));}
      catch(error) {this.onError?.(error);}
      finally {await cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});}
    });
    await this.beginFrames();
  }
  beginFrames() {
    return this.cdp.send('Page.startScreencast',{format:'png',everyNthFrame:2,
      maxWidth:this.adapter.viewport.width,maxHeight:this.adapter.viewport.height});
  }
  async setViewport(width,height) {
    await this.adapter.setViewport(width,height);
    if (!this.cdp) return;
    await this.cdp.send('Page.stopScreencast');
    await this.beginFrames();
  }
  closeAll() {return this.adapter.closeAll();}
}
