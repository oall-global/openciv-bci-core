// The camera viewfinder of the add flows (lamp/pages/add, bci/pages/add), as Apple Home scans: the
// code found in the picture gets a yellow frame that follows it, and is taken once it has held
// still for a moment. Frames from CameraContext.onCameraFrame are read by jsQR (lib/jsqr.js),
// which gives the code's corners; the camera's own scanCode mode gives no position. Where frames
// are not available the camera falls back to scanCode mode (no frame).
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const jsQR = require('../../lib/jsqr.js');
const decode = jsQR.default || jsQR;

const EVERY = 3; // frames: read one in three
const HOLD = 3; // reads of the same code in a row before it is taken
const LOSE = 6; // reads without a code before the frame disappears

Component({
  data: { fallback: false, box: null },

  lifetimes: {
    ready() {
      wx.createSelectorQuery()
        .in(this)
        .select('.viewfinder')
        .boundingClientRect((rect) => {
          this.rect = rect;
          this.start();
        })
        .exec();
    },
    detached() {
      this.stop();
    },
  },

  methods: {
    start() {
      let ctx;
      try {
        ctx = wx.createCameraContext();
      } catch (e) {
        ctx = null;
      }
      if (!ctx || !ctx.onCameraFrame) return this.setData({ fallback: true });
      let n = 0,
        same = 0,
        missed = 0,
        last = '',
        logged = false;
      this.listener = ctx.onCameraFrame((frame) => {
        if (this.done || n++ % EVERY) return;
        if (!logged) {
          logged = true;
          console.log('scanner frame', frame.width, frame.height);
        }
        const code = decode(new Uint8ClampedArray(frame.data), frame.width, frame.height, {
          inversionAttempts: 'dontInvert',
        });
        if (!code || !code.data) {
          if (++missed >= LOSE && this.data.box) this.setData({ box: null });
          same = 0;
          return;
        }
        missed = 0;
        same = code.data === last ? same + 1 : 1;
        last = code.data;
        this.setData({ box: this.place(code.location, frame.width, frame.height) });
        if (same >= HOLD) {
          this.done = true;
          wx.vibrateShort({ type: 'light' });
          setTimeout(() => this.triggerEvent('code', { result: code.data }), 250);
        }
      });
      this.listener.start({
        fail: (e) => {
          console.warn('scanner frames unavailable', e && e.errMsg);
          this.setData({ fallback: true });
        },
      });
    },
    stop() {
      if (this.listener) this.listener.stop();
      this.listener = null;
    },

    // the code's corners (frame pixels) → a box in the viewfinder (the preview fills it, cropped)
    place(loc, fw, fh) {
      const r = this.rect || { width: 300, height: 300 };
      const scale = Math.max(r.width / fw, r.height / fh);
      const dx = (r.width - fw * scale) / 2,
        dy = (r.height - fh * scale) / 2;
      const pts = [
        loc.topLeftCorner,
        loc.topRightCorner,
        loc.bottomRightCorner,
        loc.bottomLeftCorner,
      ];
      const xs = pts.map((p) => p.x * scale + dx),
        ys = pts.map((p) => p.y * scale + dy);
      const pad = 8;
      const left = Math.min.apply(null, xs) - pad,
        top = Math.min.apply(null, ys) - pad;
      return {
        left,
        top,
        width: Math.max.apply(null, xs) + pad - left,
        height: Math.max.apply(null, ys) + pad - top,
      };
    },

    // fallback: the camera's own scanCode mode
    onScanCode(e) {
      if (this.done) return;
      this.done = true;
      this.triggerEvent('code', { result: e.detail.result });
    },
    onError(e) {
      this.triggerEvent('error', e.detail);
    },
    // a new scan after the page rejected the code (not a Matter code, not a device code)
    reset() {
      this.done = false;
      this.setData({ box: null });
    },
  },
});
