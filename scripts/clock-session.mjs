import {Geometry} from '@konaito/terminal-browser/dist/coords.js';
import {Session} from '@konaito/terminal-browser/dist/session.js';

// The pinned terminal-browser renderer normally reserves two rows for its UI.
// Reuse its input handling, but give the clock the full pane. FrameWriter owns
// image delivery so upstream's fire-and-forget frame lane is never used.
class ClockGeometry extends Geometry {
  contentSize() {
    return {width:this.size.pxWidth, height:this.size.pxHeight};
  }

  cellToChromePx() { return null; }

  cellToContentPx(col, row) {
    return {
      x:Math.floor((col-0.5)*this.cellWidth),
      y:Math.floor((row-0.5)*this.cellHeight),
    };
  }
}

export class ClockSession extends Session {
  constructor(size) {
    super({size});
    this.geo=new ClockGeometry(size);
    this.content.row=1;
  }

  handleResize(size) {
    this.geo=new ClockGeometry(size);
    this.content.invalidate();
    return [{type:'setViewport', ...this.contentSize()}];
  }

  handleTerm(event) {
    // There are no tabs or address field in clock mode to focus accidentally.
    if (event.type==='key' && event.ctrl && ['l','t','n','w'].includes(event.key)) return [];
    return super.handleTerm(event);
  }
}
