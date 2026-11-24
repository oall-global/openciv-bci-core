// 添加脑机接口 (design/wechat): like an app's pairing. The user turns the device on; the mini
// program finds its hotspot (OCBCI + SN, one preset password), joins it, gives the device the Wi-Fi
// the phone was on (docs/无线配网说明.md: POST /wifi on the device's page), the device restarts
// into it, the phone goes back to it, and the device is found there by its SN: 配对成功.
// iPhone cannot list Wi-Fi networks in a mini program: there the QR code on the device card
// names the hotspot (or the SN is typed).
// Pages are ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const bci = require('../../lib/device.js');
const core = require('../../../lib/core.js');
const { report } = require('../../../lib/devlog.js');

const STAGES = {
  join: '正在连接开源文明BCI…',
  provision: '正在把 Wi-Fi 发给开源文明BCI…',
  rejoin: '开源文明BCI正在连接 Wi-Fi…',
  search: '正在 Wi-Fi 中寻找开源文明BCI…',
};
const NAME = '我的 BCI-001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// iPhone: WeChat needs 本地网络 to reach the device; iOS asks the user the first time. The user
// is told first (step localnet); once refused it can only be turned on in the settings.
// 'authorized' · 'denied' · 'not determined', or '' where the phone does not report it (Android)
function localNetwork() {
  try {
    return wx.getAppAuthorizeSetting().localNetworkAuthorized || '';
  } catch (e) {
    return '';
  }
}

/** The SN from the label's code: our connect page link (?ap=) or the bare SN */
function hotspotOf(text) {
  const s = String(text || '').trim();
  const m = /[?&]ap=([\w-]{1,32})/.exec(s);
  if (m) return m[1];
  return /^[\w-]{1,32}$/.test(s) ? s : '';
}

Page({
  data: {
    // power · localnet · finding · scan · more · hotspot · wifi · adding · done · error
    step: 'power',
    hotspot: '',
    device: null,
    ssid: '', // the Wi-Fi the phone was on, given to the device
    password: '',
    networks: [], // what the device sees (shown when the phone's Wi-Fi is not among them)
    showList: false,
    scanning: false,
    stage: '',
    error: '',
    errorTitle: '',
    reasons: [],
    blocked: false, // the Wi-Fi's addresses are out of WeChat's reach
    name: NAME,
    denied: false, // 本地网络 refused before
  },

  // ?ap=…: opened from the label's link (扫普通链接二维码打开小程序); ?preview: screenshots
  async onLoad(q) {
    this.preview = !!(q && q.preview);
    this.first = !!(q && q.first);
    const ap = hotspotOf(q && q.ap ? `?ap=${q.ap}` : '');
    if (ap) this.setData({ hotspot: ap });
    // the phone's Wi-Fi now, before it joins the device's hotspot
    if (!this.preview) this.home = await bci.currentWifi();
    // from 首次打开 the device was just switched on there (已打开): no second 已开机
    if (this.first && !this.preview) this.powered();
  },

  // ---- 1 turn the device on, then find it ----------------------------------------------------
  powered() {
    const local = this.preview ? '' : localNetwork();
    if (local === 'not determined' || local === 'denied')
      return this.setData({ step: 'localnet', denied: local === 'denied' });
    this.find();
  },
  // 本地网络: told, then iOS asks (on the first request to the device) — or the settings
  allowLocal() {
    if (!this.data.denied) {
      // any request into the local network makes iOS ask now, right after the explanation
      wx.request({ url: 'http://192.168.4.1/status', timeout: 1500, fail: () => {} });
      return this.find();
    }
    wx.openAppAuthorizeSetting({
      complete: () => this.setData({ denied: localNetwork() === 'denied' }),
    });
  },
  // A device already on the phone's Wi-Fi is paired at once; otherwise its hotspot (Android lists
  // the OCBCI hotspots first, which is quicker than searching the network; iPhone cannot).
  async find() {
    if (this.data.hotspot) return this.join();
    this.setData({ step: 'finding', error: '' });
    const found = await bci.findHotspots(8000).catch(() => null);
    report('bci hotspots', found);
    if (found && found.length) {
      this.setData({ hotspot: found[0] });
      return this.join();
    }
    if (localNetwork() === 'denied') return this.setData({ step: 'localnet', denied: true });
    // iPhone (no list) or nothing nearby: the card's code at once; a device already on this Wi-Fi
    // is looked for meanwhile (asking every address takes about half a minute) and, found while
    // the code is still awaited, paired straight away
    this.setData({ step: 'scan' });
    const home = this.home || { ssid: '' };
    if (home.ssid && home.ssid.indexOf(bci.HOTSPOT_PREFIX) !== 0) {
      const device = await bci.findOnNetwork('').catch(() => null);
      report('bci on network', device);
      if (device && ['scan', 'more', 'hotspot'].indexOf(this.data.step) >= 0) this.paired(device);
    }
  },
  paired(device) {
    bci.saveDevice({
      sn: device.sn,
      mac: device.mac,
      ip: device.ip,
      name: NAME,
      channels: device.channels,
    });
    core.rememberDevice(device.ip); // 信号工作台 connects to it
    this.setData({ device, step: 'done' });
  },
  onScanCode(e) {
    if (this.data.step !== 'scan') return;
    const ap = hotspotOf(e.detail.result);
    if (!ap) {
      wx.showToast({ title: '这不是开源文明BCI的二维码', icon: 'none' });
      return this.selectComponent('#scanner').reset();
    }
    this.setData({ hotspot: ap });
    this.join();
  },
  onCameraError(e) {
    report('camera', e.detail);
    if (!this.preview) this.setData({ step: 'more' });
  },
  showMore() {
    this.setData({ step: 'more' });
  },
  backToStart() {
    // the prefix alone is no serial number
    this.setData({
      step: 'power',
      error: '',
      hotspot: this.data.hotspot === 'OCBCI' ? '' : this.data.hotspot,
    });
  },
  // every serial number starts with OCBCI: it is there already, only the rest is typed
  enterHotspot() {
    this.setData({ step: 'hotspot', hotspot: this.data.hotspot || 'OCBCI' });
  },
  onHotspot(e) {
    this.setData({ hotspot: e.detail.value.trim().toUpperCase() });
  },

  // ---- 2 join the device's hotspot -----------------------------------------------------------
  async join() {
    this.setData({ step: 'adding', stage: STAGES.join, error: '' });
    try {
      const device = await bci.joinHotspot(this.data.hotspot);
      report('bci device', device);
      const home = this.home || { ssid: '', ghz5: false };
      const networks = await bci.networks();
      const seen = networks.some((n) => n.ssid === home.ssid);
      this.setData({
        device,
        ssid: seen ? home.ssid : '',
        networks,
        // the phone's Wi-Fi is unknown, 5 GHz, or out of the device's reach: choose one
        showList: !seen,
        step: 'wifi',
      });
    } catch (e) {
      report('bci join failed', e);
      if (localNetwork() === 'denied') return this.setData({ step: 'localnet', denied: true });
      this.setData({
        step: 'error',
        error: `没有连上开源文明BCI ${this.data.hotspot}。请确认它已开机，并且就在手机旁边`,
      });
    }
  },

  // ---- 3 the Wi-Fi for the device ------------------------------------------------------------
  async scan() {
    this.setData({ scanning: true });
    const networks = await bci.networks();
    this.setData({ networks, scanning: false });
  },
  pickNetwork(e) {
    this.setData({ ssid: e.currentTarget.dataset.ssid });
  },
  onSsid(e) {
    this.setData({ ssid: e.detail.value });
  },
  onPassword(e) {
    this.setData({ password: e.detail.value });
  },
  async add() {
    const key = bci.keyOf(this.data.device);
    this.setData({ step: 'adding', stage: STAGES.provision, error: '' });
    try {
      await bci.provision(this.data.ssid, this.data.password);
      // the device restarts into the Wi-Fi (10–20 s) and its hotspot goes; the phone goes back
      // to that Wi-Fi on its own
      this.setData({ stage: STAGES.rejoin });
      await sleep(15000);
      let device = null;
      let why = null;
      for (let i = 0; i < 8 && !device; i++) {
        this.setData({ stage: STAGES.search });
        device = await bci.findOnNetwork(key).catch(() => null);
        if (device) break;
        // a Wi-Fi WeChat will not let the mini program reach: no use searching on
        why = await bci.diagnose();
        if (why.blocked) break;
        await sleep(5000);
      }
      if (!device) return this.failed(why || (await bci.diagnose()));
      this.paired(device);
    } catch (e) {
      report('bci add failed', e);
      this.setData({ step: 'error', errorTitle: '', reasons: [], error: e.message || String(e) });
    }
  },
  // not found on the Wi-Fi: what the phone can tell, else the usual causes to check
  failed(why) {
    report('bci add failed', why);
    const ssid = this.data.ssid;
    if (why.blocked)
      // the why (the router's addresses) only behind 「?」 (whyBlocked)
      return this.setData({
        step: 'error',
        errorTitle: 'Wi-Fi 连接失败',
        error: '这个 Wi-Fi 暂时不能用来连接开源文明BCI',
        blocked: true,
        reasons: [],
      });
    this.setData({
      step: 'error',
      errorTitle: 'Wi-Fi 连接失败',
      error: `开源文明BCI没有连上「${ssid}」`,
      blocked: false,
      reasons: [
        'Wi-Fi 密码是否正确',
        '家里有两个名字相近的 Wi-Fi 时，选名字里不带「5G」的那个',
        `手机是否还连着「${ssid}」`,
      ],
    });
  },
  whyBlocked() {
    wx.showModal({
      title: '为什么不能用',
      content:
        '微信只允许小程序在 192.168、10、172.16–31 开头的局域网地址里找设备。这个 Wi-Fi 的路由器用的是别的地址，可以在路由器设置里把局域网地址改成 192.168 开头（例如 192.168.1.1），或换一个 Wi-Fi。',
      showCancel: false,
      confirmText: '知道了',
    });
  },
  retry() {
    this.setData({ step: 'power', error: '', errorTitle: '', reasons: [] });
  },
  // paired: back where 添加脑机接口 was opened from
  wear() {
    this.finish();
  },
  finish() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/workbench/index' }) });
  },
});
