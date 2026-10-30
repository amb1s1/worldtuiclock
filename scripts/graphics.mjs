import {setTimeout as delay} from 'node:timers/promises';
import {deleteImage} from '@konaito/terminal-browser/dist/kitty.js';

const ESC='\x1b';

export function encodeImage(png,id) {
  const base64=png.toString('base64'), chunks=[];
  for (let offset=0;offset<base64.length;offset+=4096) {
    const more=offset+4096<base64.length?1:0;
    const control=offset===0?`a=t,f=100,i=${id},q=0,m=${more}`:`m=${more}`;
    chunks.push(`${ESC}_G${control};${base64.slice(offset,offset+4096)}${ESC}\\`);
  }
  return chunks.join('');
}

// Terminal responses share stdin with keyboard/mouse input. Strip complete APC
// messages before the keyboard parser sees them, even across split reads.
export class GraphicsReplies {
  pending=Buffer.alloc(0);
  constructor(onReply) {this.onReply=onReply;}
  feed(chunk) {
    let data=Buffer.concat([this.pending,chunk]);
    this.pending=Buffer.alloc(0);
    const normal=[];
    while (data.length) {
      const start=data.indexOf(`${ESC}_G`);
      if (start<0) {
        let tail=0;
        if (data.at(-1)===27) tail=1;
        else if (data.length>=2 && data.at(-2)===27 && data.at(-1)===95) tail=2;
        normal.push(data.subarray(0,data.length-tail));
        this.pending=data.subarray(data.length-tail);
        break;
      }
      normal.push(data.subarray(0,start));
      const end=data.indexOf(`${ESC}\\`,start+3);
      if (end<0) {this.pending=data.subarray(start);break;}
      const message=data.subarray(start+3,end).toString();
      const separator=message.indexOf(';');
      if (separator>=0) {
        const fields=Object.fromEntries(message.slice(0,separator).split(',').map(field=>field.split('=')));
        this.onReply({id:Number(fields.i),placement:fields.p===undefined?undefined:Number(fields.p),status:message.slice(separator+1)});
      }
      data=data.subarray(end+2);
    }
    return Buffer.concat(normal);
  }
  flushEscape() {
    if (this.pending.length>2) return Buffer.alloc(0);
    const data=this.pending;this.pending=Buffer.alloc(0);return data;
  }
}

export class FrameWriter {
  current=0;
  last=null;
  queued=null;
  busy=false;
  closed=false;
  acknowledgement=null;
  lastSent=0;
  constructor(output,{timeout=8000,minFrameMs=1000/30}={}) {
    this.output=output;this.timeout=timeout;this.minFrameMs=minFrameMs;
  }
  draw(png,size) {
    if (this.closed) return Promise.reject(new Error('Terminal renderer closed'));
    return new Promise((resolve,reject)=>{
      // Only retain one future frame. Slow terminals never build an old backlog.
      this.queued?.resolve(false);
      this.queued={png,size,resolve,reject};
      void this.pump();
    });
  }
  reply(response) {
    const pending=this.acknowledgement;
    if (!pending || response.id!==pending.id) return;
    this.acknowledgement=null;
    clearTimeout(pending.timer);
    if (response.status==='OK') pending.resolve();
    else pending.reject(new Error(`Terminal rejected an image: ${response.status}`));
  }
  write(data) {
    return new Promise((resolve,reject)=>this.output.write(data,error=>error?reject(error):resolve()));
  }
  async command(data,id) {
    let pending;
    const acknowledged=new Promise((resolve,reject)=>{
      pending={id,resolve,reject,timer:setTimeout(()=>{
        if (this.acknowledgement===pending) this.acknowledgement=null;
        reject(new Error('Terminal did not acknowledge an image; rendering stopped.'));
      },this.timeout)};
      this.acknowledgement=pending;
    });
    try {await Promise.all([this.write(data),acknowledged]);}
    finally {
      clearTimeout(pending.timer);
      if (this.acknowledgement===pending) this.acknowledgement=null;
    }
  }
  async pump() {
    if (this.busy || this.closed) return;
    this.busy=true;
    try {
      while (this.queued && !this.closed) {
        const frame=this.queued;this.queued=null;
        try {
          if (this.last?.equals(frame.png) && frame.size.cols===this.lastSize?.cols && frame.size.rows===this.lastSize?.rows) {frame.resolve(false);continue;}
          const pause=this.minFrameMs-(Date.now()-this.lastSent);
          if (pause>0) await delay(pause);
          if (this.closed) {frame.resolve(false);break;}
          this.lastSent=Date.now();
          const next=this.current===1?2:1;
          await this.command(encodeImage(frame.png,next),next);
          // Do not erase the visible frame until both upload and placement work.
          await this.command(`${ESC}[1;1H${ESC}_Ga=p,i=${next},p=1,q=0,C=1,c=${frame.size.cols},r=${frame.size.rows};${ESC}\\`,next);
          if (this.current) await this.write(deleteImage(this.current));
          this.current=next;this.last=frame.png;this.lastSize=frame.size;
          frame.resolve(true);
        } catch(error) {
          frame.reject(error);
          this.queued?.reject(error);this.queued=null;
          this.closed=true;
        }
      }
    } finally {this.busy=false;}
  }
  close() {
    this.closed=true;
    this.queued?.resolve(false);this.queued=null;
    if (this.acknowledgement) {
      clearTimeout(this.acknowledgement.timer);
      this.acknowledgement.reject(new Error('Terminal renderer closed'));
      this.acknowledgement=null;
    }
  }
}
