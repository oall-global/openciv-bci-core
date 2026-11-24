// 脑电记录 (after 录制脑电 on 信号工作台): the words (标题, 备注, the marks' names, 署名), then
// 生成卡片 — the desktop's latest card (moment/lib/card.js: card8, α's share on the brain from
// above), computed from the recording's raw EEG with the desktop's code and drawn here; the user
// keeps it with a screenshot. The EEG itself is already kept in 脑电数据库.
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const card = require('../../lib/card.js');
const POINTS = require('../../../lib/brain-points.js');

const two = (n) => String(n).padStart(2, '0');
const mmss = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

Page({
  data: { usable: true, made: false, title: '脑电记录', note: '', sign: '', marks: [] },
  // after 录制脑电 (getApp().moment), or a recording in 脑电数据库 (?id=): its card at once, with
  // the words it was made with (none yet: 录制 · date, as the desktop's 数据)
  onLoad(q) {
    if (q && q.id) {
      const meta = card.metaOf(q.id);
      if (!meta) return this.setData({ usable: false });
      const t = new Date(meta.start);
      const w = meta.words || {
        title: `录制 · ${two(t.getMonth() + 1)}-${two(t.getDate())} ${two(t.getHours())}:${two(t.getMinutes())}`,
        note: '',
        sign: '',
        marks: meta.marks || [],
      };
      this.rec = { id: q.id, marks: w.marks };
      this.setData({
        title: w.title,
        note: w.note,
        sign: w.sign,
        marks: w.marks.map((x) => ({ t: x.t, at: mmss(x.t), label: x.label })),
      });
      return this.make();
    }
    const m = getApp().moment;
    if (!m || !m.id) return this.setData({ usable: false });
    this.rec = m;
    this.setData({ marks: m.marks.map((x) => ({ t: x.t, at: mmss(x.t), label: x.label })) });
  },
  onUnload() {
    this.gone = true;
  },
  onTitle(e) {
    this.setData({ title: e.detail.value });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },
  onSign(e) {
    this.setData({ sign: e.detail.value });
  },
  onMark(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ [`marks[${i}].label`]: e.detail.value });
  },
  words() {
    const d = this.data;
    return {
      title: d.title.trim() || '脑电记录',
      note: d.note.trim(),
      sign: d.sign.trim(),
      marks: d.marks.map((m, i) => ({ t: m.t, label: m.label.trim() || `标记 ${i + 1}` })),
    };
  },
  async make() {
    wx.showLoading({ title: '正在生成…', mask: true });
    // the figures depend only on the recording: computed once (a few seconds)
    if (!this.prepared)
      try {
        this.prepared = await card.prepare(this.rec.id, this.words().marks, POINTS);
      } catch (e) {
        console.error('card', e && e.message);
      }
    wx.hideLoading();
    if (this.gone) return;
    if (!this.prepared || !this.prepared.usable) return this.setData({ usable: false });
    this.setData({ made: true });
    const words = this.words();
    try {
      card.saveWords(this.rec.id, words); // 脑电数据库 opens it with these
    } catch (e) {
      console.error('card words', e && e.message);
    }
    this.createSelectorQuery()
      .select('#card')
      .fields({ node: true })
      .exec((r) => {
        if (!r[0] || !r[0].node) return;
        const node = r[0].node;
        node.width = card.CARD_W;
        node.height = card.CARD_H;
        const ctx = node.getContext('2d');
        const cache = {};
        // opens by drawing the time axis, then the figures appear (as the desktop)
        const t0 = Date.now();
        const frame = () => {
          if (this.gone || !this.data.made) return;
          const t = (Date.now() - t0) / 1000;
          const stamp = Math.max(0, Math.min(1, (t - 2.5) / 0.6));
          card.draw(ctx, this.prepared, words, Math.min(1, t / 2.5), t, stamp, cache);
          if (t < 3.3) node.requestAnimationFrame(frame);
        };
        node.requestAnimationFrame(frame);
      });
  },
  edit() {
    this.setData({ made: false });
  },
  close() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/workbench/index' }) });
  },
});
