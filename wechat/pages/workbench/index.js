// 信号工作台 · 主图 (design/wechat-app), the desktop's 主图 (src/WorkbenchFocus.tsx) on a phone:
// the views 大脑 · 脑电波 · 能量 switched, each filling the screen (the user's choice,
// 2026-11-10); only the one shown is drawn. 大脑: 脑活动图谱 (components/brain3d, coloured by the
// chosen band's power relative to each electrode's baseline). 脑电波: 实时脑电波, the 16 channels
// filtered as OpenBCI GUI shows them. 能量: 脑电能量, each band's whole-brain ratio to baseline,
// α's share and the spectrum of the selected channel. Below: the last 5 minutes in the brain's
// colours, and 录制脑电. 佩戴 n/16 opens 佩戴检查. Data from lib/core.js (the TypeScript engine).
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const core = require('../../lib/core.js');

const CONTACT = { ok: '#5fd3a4', poor: '#e7ae55', off: '#ef7e66' };
const NONE = '#3a4843';
const STATE_LABEL = { ok: '良好', poor: '一般', off: '需调整' };
const PANE_KEY = 'workbench.pane';
// shown in this order (the desktop's BAND_ORDER): α first, it rises within seconds of closing the
// eyes; then β, θ, δ, γ
const BAND_ORDER = [2, 3, 1, 0, 4];
const LO = Math.log(0.5),
  HI = Math.log(3);
// the brain's palette (components/brain3d), for the timeline strip
const STOPS = [
  [0, [10, 45, 55]],
  [0.14, [14, 64, 76]],
  [0.35, [50, 160, 165]],
  [0.55, [240, 170, 60]],
  [0.75, [255, 245, 210]],
  [1, [255, 245, 210]],
];
function ratioColour(r) {
  if (r === null || !(r > 0)) return '#18201d';
  const v = Math.max(0, Math.min(1, (Math.log(r) - LO) / (HI - LO)));
  for (let i = 1; i < STOPS.length; i++)
    if (v <= STOPS[i][0]) {
      const a = STOPS[i - 1],
        b = STOPS[i],
        k = (v - a[0]) / (b[0] - a[0]);
      const c = a[1].map((x, j) => Math.round(x + (b[1][j] - x) * k));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  return 'rgb(255, 245, 210)';
}
// the desktop's timeline clock: −MM:SS on the ticks, −MM:SS.s for the moment shown
const clock = (s) => {
  const a = Math.abs(s);
  return `${s < 0 ? '−' : ''}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(Math.floor(a % 60)).padStart(2, '0')}`;
};
const tenths = (s) => {
  const a = Math.abs(s);
  return `${s < 0 ? '−' : ''}${String(Math.floor(a / 60)).padStart(2, '0')}:${(a % 60).toFixed(1).padStart(4, '0')}`;
};
const MIN_RECORD = 5; // s at least, as the desktop
const MAX_MARKS = 6;
const mmss = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const RANGE = 60; // s on the strip: the last minute (the user's choice; the desktop's 1 分钟)

Page({
  data: {
    connected: false,
    connecting: false,
    status: '未连接',
    demo: false,
    worn: 0,
    panes: [
      { id: 'brain', name: '大脑' },
      { id: 'wave', name: '脑电波' },
      { id: 'bands', name: '能量' },
    ],
    pane: 'brain',
    shown: true, // the page is on screen (brain3d draws only then)
    band: 2, // α
    bands: core.BANDS.map((b) => {
      const [symbol, name] = b.name.split(' ');
      return { symbol, name };
    }),
    bandRows: [],
    ratios: [],
    view: 'spin',
    views: [
      { id: 'top', name: '上' },
      { id: 'left', name: '左' },
      { id: 'right', name: '右' },
      { id: 'back', name: '后' },
      { id: 'spin', name: '自转' },
    ],
    channels: core.ELECTRODES.map((e, i) => ({ i, name: e.name, uv: '—', colour: NONE })),
    selected: 0,
    selectedName: core.ELECTRODES[0].name,
    alphaShare: '—',
    // the timeline
    replaying: false,
    playing: false,
    ago: '',
    ticks: ['−01:00', '−00:30', '现在'],
    // 录制脑电
    recording: false,
    recordTime: '00:00',
    canStop: false,
    markCount: 0,
    sheet: false, // 佩戴检查
    heads: core.ELECTRODES.map((e) => ({ name: e.name, x: e.map[0], y: e.map[1], colour: NONE })),
    good: 0,
    adjust: [],
  },

  onLoad(q) {
    this.unsub = core.subscribe((e) => {
      if (e.type === 'status') this.showStatus();
    });
    const pane = wx.getStorageSync(PANE_KEY);
    if (pane === 'brain' || pane === 'wave' || pane === 'bands') this.setData({ pane });
    this.showBands();
    // development builds only: ?demo=1 runs on the simulated device (as app.js at launch)
    let dev = false;
    try {
      dev = wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
    } catch (e) {
      dev = false;
    }
    if (dev && q && q.demo === '1' && !core.snapshot().streaming) core.connect('demo');
  },
  onUnload() {
    if (this.unsub) this.unsub();
  },
  onShow() {
    if (this.getTabBar) this.getTabBar().setData({ selected: 0 });
    this.setData({ shown: true });
    this.showStatus();
    this.timers = [
      setInterval(() => this.tick(), 500),
      setInterval(() => this.drawWaves(), 250),
      setInterval(() => this.smoothBrain(), 66),
    ];
    const saved = core.savedDevice();
    if (!core.snapshot().streaming && saved && !this.data.connecting)
      this.connect(saved.address, saved.rate);
  },
  onHide() {
    (this.timers || []).forEach(clearInterval);
    this.timers = [];
    this.setData({ shown: false });
  },

  // ---- connection -----------------------------------------------------------------------------
  showStatus() {
    const s = core.snapshot();
    const label =
      s.status.status === 'streaming'
        ? s.status.demo
          ? '模拟设备'
          : '已连接'
        : s.status.status === 'connecting'
          ? '正在连接…'
          : '未连接';
    const connected = s.status.status === 'streaming';
    if (connected !== this.data.connected) this.ctx = {}; // the canvases are made anew
    this.setData({
      status: label,
      demo: s.status.demo,
      connected,
      connecting: s.status.status === 'connecting',
    });
  },
  async connect(address, rate) {
    this.setData({ connecting: true });
    try {
      await core.connect('device', address, rate);
    } catch (e) {
      wx.showToast({ title: e.message || '连接失败', icon: 'none' });
    }
    this.showStatus();
  },
  addDevice() {
    wx.navigateTo({ url: '/bci/pages/add/index' });
  },

  // ---- twice a second: contact, the view shown, the timeline ---------------------------------
  tick() {
    const s = core.snapshot();
    // the device went away while recording: what came is kept, the card follows as after 停止录制
    if (this.rec && !core.recording().active) {
      this.setData({ canStop: true });
      this.stopRecord();
    }
    if (!s.frame) return;
    const states = (s.frame.contact && s.frame.contact.states) || [];
    const colours = this.data.channels.map((c) => CONTACT[states[c.i]] || NONE);
    if (colours.some((c, i) => c !== this.data.channels[i].colour))
      this.setData({
        channels: this.data.channels.map((c, i) => Object.assign({}, c, { colour: colours[i] })),
      });
    const good = states.filter((x) => x === 'ok').length;
    if (good !== this.data.worn) this.setData({ worn: good });
    if (this.data.sheet) return this.showContact(states);
    if (this.data.pane === 'bands') this.drawPsd();
    this.showMoment();
    this.timeline();
  },

  // ---- 脑电波: the 16 channels, 4 s each, four times a second ---------------------------------
  drawWaves() {
    if (this.data.pane !== 'wave' || this.data.sheet || !this.data.connected) return;
    const traces = this.data.channels.map((c) => core.trace(c.i, 4, 2));
    const uv = traces.map((t) =>
      t.uvrms === null || !isFinite(t.uvrms) ? '—' : t.uvrms.toFixed(1),
    );
    if (uv.some((u, i) => u !== this.data.channels[i].uv))
      this.setData({
        channels: this.data.channels.map((c, i) => Object.assign({}, c, { uv: uv[i] })),
      });
    this.canvas('waves', (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const row = h / 16;
      traces.forEach((t, c) => {
        const mid = row * (c + 0.5);
        if (c === this.data.selected) {
          ctx.fillStyle = 'rgba(95, 211, 164, 0.08)';
          ctx.fillRect(0, row * c, w, row);
        }
        if (t.values.length < 2) return;
        // each row scaled to itself (自动, as the desktop's default)
        let peak = 10;
        for (const v of t.values) if (Math.abs(v) > peak) peak = Math.abs(v);
        const n = Math.round(t.rate * 4),
          step = Math.max(1, Math.floor(t.values.length / w)); // about one point a pixel
        ctx.strokeStyle = c === this.data.selected ? '#5fd3a4' : '#8fa39a';
        ctx.lineWidth = c === this.data.selected ? 1.5 : 1;
        ctx.beginPath();
        for (let i = 0; i < t.values.length; i += step) {
          const x = ((i + n - t.values.length) / n) * w,
            y = mid - (t.values[i] / peak) * row * 0.45;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      });
    });
  },
  onWaveTap(e) {
    const t = e.changedTouches && e.changedTouches[0];
    if (!t || !this.ctx || !this.ctx.waves) return;
    this.createSelectorQuery()
      .select('#waves')
      .boundingClientRect((r) => {
        if (!r) return;
        const y = (t.clientY !== undefined ? t.clientY : t.y + r.top) - r.top;
        const i = Math.max(0, Math.min(15, Math.floor((y / r.height) * 16)));
        this.select(i);
      })
      .exec();
  },

  // ---- 能量: each band's whole-brain ratio to baseline ----------------------------------------
  showBands() {
    const now = core.bandSummary(this.cursor === undefined ? null : this.cursor);
    const bandRows = BAND_ORDER.map((k) => {
      const b = core.BANDS[k],
        r = now[k];
      const [symbol, name] = b.name.split(' ');
      const pos = r ? (Math.log(r) - LO) / (HI - LO) : (0 - LO) / (HI - LO);
      return {
        k,
        symbol,
        name,
        range: `${b.low}–${b.high} Hz`,
        ratio: r ? `${r.toFixed(1)}×` : '—',
        width: Math.round(Math.max(3, Math.min(100, pos * 100))),
      };
    });
    const sp = core.spectrumOf(this.data.selected);
    this.setData({
      bandRows,
      alphaShare: sp.alphaShare === null ? '—' : sp.alphaShare.toFixed(1),
    });
  },
  drawPsd() {
    const sp = core.spectrumOf(this.data.selected);
    this.canvas('psd', (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const dpr = w / (this.ctx.psd.css || w);
      const B = h - 16 * dpr,
        X = (hz) => ((hz - 1) / 39) * w;
      ctx.fillStyle = 'rgba(95, 211, 164, 0.12)';
      ctx.fillRect(X(8), 4 * dpr, X(13) - X(8), B - 4 * dpr);
      ctx.strokeStyle = '#232e2a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, B);
      ctx.lineTo(w, B);
      ctx.stroke();
      if (sp.psd.length) {
        const top = Math.max.apply(null, sp.psd) || 1;
        ctx.strokeStyle = '#5fd3a4';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        sp.psd.forEach((v, i) => {
          const x = X(sp.frequencies[i]),
            y = B - (v / top) * (B - 6 * dpr);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      ctx.fillStyle = '#83928b';
      ctx.font = `${10 * dpr}px monospace`;
      [1, 13, 30, 40].forEach((hz) =>
        ctx.fillText(hz === 40 ? '40 Hz' : String(hz), Math.min(X(hz), w - 36 * dpr), h - 3 * dpr),
      );
    });
  },

  // ---- the timeline (the desktop's BrainTimeline, in its phone layout) ----------------------
  // the strip: one column per 0.5 s frame in the brain's colours over the range (5 minutes, or
  // all there is when shorter), ▼ where an ability fired, the playhead; tap or drag to replay
  // (the brain and 能量 show that moment, the frames after it dimmed); ⏸ / ▶, ⏮ ⏭ 5 s, 实时 /
  // 回到实时. Reaching the end of a replay returns to live.
  timeline() {
    const tl = core.timelineOf(this.data.band);
    // the replay position stays on its moment when old frames are dropped; a new stream: live
    const seen = this.seen || { dropped: tl.dropped, epoch: tl.epoch };
    let cursor = this.cursor === undefined ? null : this.cursor;
    if (cursor !== null) {
      if (tl.epoch !== seen.epoch) cursor = null;
      else cursor = Math.max(0, cursor - (tl.dropped - seen.dropped));
    }
    this.seen = { dropped: tl.dropped, epoch: tl.epoch };
    this.cursor = cursor;
    const n = tl.t.length,
      last = n - 1;
    const tEnd = n ? tl.t[last] : 0;
    const kept = n ? tEnd - tl.t[0] : 0;
    const span = Math.max(tl.step, Math.min(RANGE, kept));
    this.tl = { tl, tEnd, span, tStart: tEnd - span, last };
    const shown = cursor === null ? last : cursor;
    const ago = n ? tl.t[shown] - tEnd : 0;
    // three ticks fit a phone (the desktop's phone layout)
    const ticks = [4, 2, 0].map((k) => (k ? clock((-span * k) / 4) : '现在'));
    const replaying = cursor !== null;
    if (
      replaying !== this.data.replaying ||
      ticks.join() !== this.data.ticks.join() ||
      (replaying && this.data.ago !== tenths(ago))
    )
      this.setData({ replaying, ticks, ago: tenths(ago) });
    this.drawStrip();
  },
  drawStrip() {
    const T = this.tl;
    if (!T) return;
    const { tl, tStart, span, tEnd, last } = T;
    const marks = core.fireMarks();
    this.canvas('strip', (ctx, w, h) => {
      const k = w / (this.ctx.strip.css || w); // device px per CSS px
      ctx.clearRect(0, 0, w, h);
      const X = (t) => ((t - tStart) / span) * w;
      const top = 12 * k,
        bar = 18 * k;
      const colW = Math.max(1, (tl.step / span) * w + 0.6 * k);
      const cursor = this.cursor;
      for (let i = 0; i < tl.t.length; i++) {
        if (tl.t[i] < tStart) continue;
        const v = tl.values[i];
        ctx.globalAlpha = cursor !== null && i > cursor ? 0.4 : 1;
        ctx.fillStyle = v !== null && isFinite(v) ? ratioColour(v) : '#1a2320';
        ctx.fillRect(X(tl.t[i]) - colW, top, colW, bar);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f7c948';
      for (const t of marks)
        if (t >= tStart && t <= tEnd) {
          const x = X(t);
          ctx.beginPath();
          ctx.moveTo(x - 4 * k, 1 * k);
          ctx.lineTo(x + 4 * k, 1 * k);
          ctx.lineTo(x, 8 * k);
          ctx.fill();
        }
      const i = cursor === null ? last : Math.min(cursor, last);
      if (i >= 0 && tl.t.length) {
        const x = X(tl.t[i]);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1 * k, top - 4 * k, 2 * k, bar + 11 * k);
        ctx.beginPath();
        ctx.arc(x, top - 4 * k, 4.5 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },
  // the frame under a touch on the strip
  seekAt(e) {
    const t = e.touches && e.touches[0];
    if (!t || !this.tl || !this.stripBox) return;
    const r = this.stripBox;
    const cx = t.clientX !== undefined ? t.clientX : t.x + r.left;
    const x = Math.max(0, Math.min(r.width, cx - r.left));
    const at = this.tl.tStart + (x / r.width) * this.tl.span;
    let i = this.tl.tl.t.findIndex((v) => v >= at);
    if (i < 0) i = this.tl.last;
    this.seek(i);
  },
  onStripStart(e) {
    const touch = { touches: e.touches };
    this.createSelectorQuery()
      .select('#strip')
      .boundingClientRect((r) => {
        this.stripBox = r;
        this.seekAt(touch);
      })
      .exec();
  },
  onStripMove(e) {
    this.seekAt(e);
  },
  seek(i) {
    if (!this.tl) return;
    if (i >= this.tl.last) {
      this.cursor = null;
      this.stopPlay();
    } else this.cursor = Math.max(0, i);
    this.timeline();
    this.showMoment();
  },
  stepBy(e) {
    if (!this.tl) return;
    const n = Number(e.currentTarget.dataset.n);
    this.seek((this.cursor === null ? this.tl.last : this.cursor) + n);
  },
  playPause() {
    if (!this.tl) return;
    if (this.cursor === null) {
      // ⏸ while live: hold this moment
      this.cursor = this.tl.last;
      this.stopPlay();
      this.timeline();
      return;
    }
    if (this.data.playing) return this.stopPlay();
    this.setData({ playing: true });
    this.player = setInterval(() => {
      if (this.cursor === null) return this.stopPlay();
      this.seek(this.cursor + 1);
    }, 500);
  },
  stopPlay() {
    clearInterval(this.player);
    this.player = null;
    if (this.data.playing) this.setData({ playing: false });
  },
  live() {
    this.cursor = null;
    this.stopPlay();
    this.timeline();
    this.showMoment();
  },
  // the brain and 能量 at the moment shown: live, the brain follows gently (the desktop's
  // display smoothing, stepped about 15 times a second) and only while the cap is worn; a replay
  // shows the frames as they are
  showMoment() {
    const at = this.cursor === undefined ? null : this.cursor;
    if (this.data.pane === 'brain' && at !== null)
      this.setData({ ratios: core.bandRatios(this.data.band, at).values });
    if (this.data.pane === 'bands') this.showBands();
  },
  smoothBrain() {
    const now = Date.now(),
      dt = this.lastSmooth ? (now - this.lastSmooth) / 1000 : 0;
    this.lastSmooth = now;
    const replaying = this.cursor !== null && this.cursor !== undefined;
    if (this.data.pane !== 'brain' || this.data.sheet || replaying) return;
    const s = core.snapshot();
    const k = s.frame && s.frame.contact;
    const worn = (k && k.worn === true) || s.status.demo;
    const values = worn ? core.smoothRatios(this.data.band, dt) : [];
    if (values.join() !== (this.data.ratios || []).join()) this.setData({ ratios: values });
  },

  // the 2d context of a canvas by id, sized for the device's pixel ratio (cached)
  canvas(id, draw) {
    this.ctx = this.ctx || {};
    if (this.ctx[id]) return draw(this.ctx[id].ctx, this.ctx[id].w, this.ctx[id].h);
    if (this.ctx[id] === null) return;
    this.ctx[id] = null;
    this.createSelectorQuery()
      .select(`#${id}`)
      .fields({ node: true, size: true })
      .exec((r) => {
        if (!r[0] || !r[0].node) {
          delete this.ctx[id];
          return;
        }
        const node = r[0].node,
          dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
        node.width = r[0].width * dpr;
        node.height = r[0].height * dpr;
        const ctx = node.getContext('2d');
        this.ctx[id] = { ctx, w: node.width, h: node.height, css: r[0].width };
        draw(ctx, node.width, node.height);
      });
  },

  // ---- choices ---------------------------------------------------------------------------------
  pickPane(e) {
    const pane = e.currentTarget.dataset.p;
    if (pane === this.data.pane) return;
    wx.setStorageSync(PANE_KEY, pane);
    this.ctx = {};
    this.setData({ pane });
    this.tick();
  },
  pickBand(e) {
    this.setData({ band: Number(e.currentTarget.dataset.k) });
    this.tick();
  },
  pickView(e) {
    this.setData({ view: e.currentTarget.dataset.v });
  },
  // double-tapped: back to 自转 (the component has turned itself already)
  onReset() {
    this.setData({ view: 'spin' });
  },
  onTurned() {
    this.setData({ view: '' }); // turned by hand: no view chosen until one is tapped
  },
  onPick(e) {
    this.select(e.detail.index);
  },
  pick(e) {
    this.select(Number(e.currentTarget.dataset.i));
  },
  select(i) {
    this.setData({ selected: i, selectedName: core.ELECTRODES[i].name });
    if (this.data.pane === 'bands') {
      this.showBands();
      this.drawPsd();
    }
    if (this.data.pane === 'wave') this.drawWaves();
  },

  // ---- 录制脑电 --------------------------------------------------------------------------------
  // as the desktop's RecordButton (src/home/BrainRecord.tsx): while recording a red frame round
  // the screen with REC and the time, 停止录制 (after 5 s at least), 标记此刻 (up to 6); after it
  // the 脑电记录 card (moment/pages/card). The EEG itself is kept for 脑电数据库 (recorder.ts).
  startRecord() {
    try {
      core.startRecording();
    } catch (e) {
      wx.showToast({ title: e.message || '无法录制', icon: 'none' });
      return;
    }
    this.rec = { t: core.lastFrameTime(), wall: Date.now(), marks: [] };
    this.setData({ recording: true, recordTime: '00:00', canStop: false, markCount: 0 });
    clearInterval(this.recTimer);
    this.recTimer = setInterval(() => {
      const s = (Date.now() - this.rec.wall) / 1000;
      this.setData({ recordTime: mmss(s), canStop: s >= MIN_RECORD });
    }, 250);
  },
  stopRecord() {
    if (!this.rec || !this.data.canStop) return;
    clearInterval(this.recTimer);
    const r = this.rec;
    this.rec = null;
    const kept = core.stopRecording();
    this.setData({ recording: false });
    getApp().moment = {
      since: r.t,
      start: r.wall,
      seconds: (Date.now() - r.wall) / 1000,
      rate: core.snapshot().meta ? core.snapshot().meta.rate : 250,
      marks: r.marks,
      id: kept ? kept.id : null,
    };
    wx.navigateTo({ url: '/moment/pages/card/index' });
  },
  markMoment() {
    if (!this.rec || this.rec.marks.length >= MAX_MARKS) return;
    const t = (Date.now() - this.rec.wall) / 1000;
    this.rec.marks.push({ t, label: `标记 ${this.rec.marks.length + 1}` });
    this.setData({ markCount: this.rec.marks.length });
  },

  // ---- 佩戴检查 --------------------------------------------------------------------------------
  openContact() {
    const s = core.snapshot();
    this.showContact((s.frame && s.frame.contact && s.frame.contact.states) || []);
    // the canvases draw above any overlay: they leave while it is open, and are made anew after
    this.ctx = {};
    this.setData({ sheet: true });
    if (this.getTabBar) this.getTabBar().setData({ hidden: true });
  },
  noop() {},
  closeContact() {
    this.ctx = {};
    this.setData({ sheet: false });
    if (this.getTabBar) this.getTabBar().setData({ hidden: false });
  },
  showContact(states) {
    this.setData({
      heads: core.ELECTRODES.map((e, i) => ({
        name: e.name,
        x: e.map[0],
        y: e.map[1],
        colour: CONTACT[states[i]] || NONE,
      })),
      good: states.filter((x) => x === 'ok').length,
      adjust: core.ELECTRODES.map((e, i) => ({ place: e.place, name: e.name, s: states[i] }))
        .filter((e) => e.s === 'off' || e.s === 'poor')
        .map((e) => `${e.place}（${e.name}）${STATE_LABEL[e.s]}`),
    });
  },
});
