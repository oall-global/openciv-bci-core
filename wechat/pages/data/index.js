// 脑电数据库 (design/wechat-app): the recordings kept on this phone, newest first; 导出 makes the
// desktop's BDF file and hands it to WeChat to send (to 文件传输助手, opened on the computer);
// 删除 removes the recording from the phone; tapping one opens its card. Nothing leaves the phone
// otherwise.
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const core = require('../../lib/core.js');

const two = (n) => String(n).padStart(2, '0');
const length = (s) =>
  s >= 3600
    ? `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(Math.floor(s % 60))}`
    : `${two(Math.floor(s / 60))}:${two(Math.floor(s % 60))}`;

Page({
  data: { items: [] },
  onShow() {
    if (this.getTabBar) this.getTabBar().setData({ selected: 1 });
    this.load();
  },
  load() {
    const items = core.recordings().map((r) => {
      const t = new Date(r.start);
      const mb = (r.samples * 16 * 3) / 1024 / 1024; // the BDF's size
      return {
        id: r.id,
        when: `${t.getMonth() + 1}月${t.getDate()}日 ${two(t.getHours())}:${two(t.getMinutes())}`,
        // the card's title, or the desktop's default name in 数据
        title:
          (r.words && r.words.title) ||
          `录制 · ${two(t.getMonth() + 1)}-${two(t.getDate())} ${two(t.getHours())}:${two(t.getMinutes())}`,
        length: length(r.seconds),
        quality: r.good === null ? '接触 —' : `接触良好 ${Math.round(r.good)}/16`,
        size: mb < 1 ? `${Math.max(1, Math.round(mb * 1024))} KB` : `${mb.toFixed(1)} MB`,
      };
    });
    this.setData({ items });
  },
  // its card (moment/pages/card): drawn from the recording, as the desktop's 数据 opens one
  open(e) {
    wx.navigateTo({ url: `/moment/pages/card/index?id=${e.currentTarget.dataset.id}` });
  },
  share(e) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '正在导出…', mask: true });
    let file;
    try {
      file = core.exportRecording(id);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '导出失败', icon: 'none' });
      return;
    }
    wx.hideLoading();
    wx.shareFileMessage({
      filePath: file.path,
      fileName: file.name,
      fail: (err) => {
        if (!/cancel/.test((err && err.errMsg) || ''))
          wx.showToast({ title: '没有发送出去', icon: 'none' });
      },
    });
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这段脑电？',
      content: '删除后不能恢复',
      confirmText: '删除',
      confirmColor: '#ef7e66',
      success: (r) => {
        if (!r.confirm) return;
        core.removeRecording(id);
        this.load();
      },
    });
  },
});
