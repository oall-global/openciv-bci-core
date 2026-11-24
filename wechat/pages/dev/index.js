// Connects to the OpenBCI Wi-Fi Shield and shows that data arrives. A mini program cannot run
// a TCP server (the phone app's way, src/mobile/shield.ts), so the shield streams over UDP to
// a bound socket: POST /udp {ip, port} (OpenBCI_WIFI firmware, udpSetup).
const { PacketParser } = require('../../lib/openbci.js');

const HOTSPOT = '192.168.4.1';
let udp = null;
let parser = null;
let rows = [];
let timer = 0;
let count = 0;
let last = -1;
let gaps = 0;

function http(ip, method, path, data) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: `http://${ip}${path}`,
      method,
      data,
      header: data ? { 'content-type': 'application/json' } : {},
      dataType: '其他', // the shield answers some routes with plain text
      timeout: 8000,
      success: (r) =>
        r.statusCode === 200 ? resolve(r.data) : reject(new Error(`设备回复 ${r.statusCode}`)),
      fail: () => reject(new Error('设备没有响应，请检查地址和 Wi-Fi')),
    }),
  );
}
const localIp = () =>
  new Promise((resolve, reject) =>
    wx.getLocalIPAddress({
      success: (r) => resolve(r.localip),
      fail: () => reject(new Error('无法获取手机的局域网地址，请确认已连接 Wi-Fi')),
    }),
  );
const rms = (xs) => {
  if (!xs.length) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
};

Page({
  data: {
    ip: HOTSPOT,
    ssid: '',
    status: '未连接',
    error: '',
    running: false,
    busy: false,
    rate: 0,
    total: 0,
    gaps: 0,
    dropped: 0,
    channels: [],
  },

  onLoad(query) {
    // from the device's QR sticker: ?ap=OpenBCI-XXXX
    if (query && /^[\w-]{1,32}$/.test(query.ap || '')) this.setData({ ssid: query.ap });
  },
  // the devices added in 添加脑机接口
  onShow() {
    this.setData({
      bcis: JSON.parse(wx.getStorageSync('bci.devices') || '[]'), // bci/lib/device.js
    });
  },
  onUnload() {
    this.stop();
  },
  onIp(e) {
    this.setData({ ip: e.detail.value.trim() });
  },
  onSsid(e) {
    this.setData({ ssid: e.detail.value.trim() });
  },

  // the device's own hotspot (open network); its address is then 192.168.4.1
  joinHotspot() {
    const SSID = this.data.ssid;
    if (!SSID) return;
    this.setData({ error: '', status: `正在连接 ${SSID}…` });
    wx.startWifi({
      success: () =>
        wx.connectWifi({
          SSID,
          password: '',
          success: () => this.setData({ status: `已连接 ${SSID}`, ip: HOTSPOT }),
          fail: (e) => this.setData({ status: '未连接', error: `连接热点失败：${e.errMsg}` }),
        }),
      fail: (e) => this.setData({ status: '未连接', error: `无法使用 Wi-Fi：${e.errMsg}` }),
    });
  },

  async connect() {
    const ip = this.data.ip;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
      return this.setData({ error: '请填写设备的 IPv4 地址' });
    this.setData({ busy: true, error: '', status: '正在连接设备…' });
    try {
      await http(ip, 'GET', '/board');
      const phone = await localIp();
      parser = new PacketParser();
      rows = Array.from({ length: 16 }, () => []);
      count = 0;
      last = -1;
      gaps = 0;
      udp = wx.createUDPSocket();
      const port = udp.bind();
      udp.onMessage((res) => {
        const got = parser.push(new Uint8Array(res.message));
        for (const s of got) {
          if (last >= 0 && s.index !== (last + 1) % 256) gaps++;
          last = s.index;
          s.channels.forEach((v, c) => rows[c].push(v));
        }
        count += got.length;
      });
      await http(ip, 'POST', '/udp', {
        ip: phone,
        port,
        output: 'raw',
        delimiter: true,
        latency: 10000,
      });
      await http(ip, 'POST', '/command', { command: '~6' }); // 250 Hz, as the phone app
      await http(ip, 'GET', '/stream/start');
      this.setData({ running: true, status: `已连接 ${ip} · 手机 ${phone}:${port}` });
      let before = 0;
      timer = setInterval(() => {
        const channels = rows.map((r, c) => ({
          name: `CH ${String(c + 1).padStart(2, '0')}`,
          uv: rms(r).toFixed(1),
        }));
        rows = rows.map(() => []);
        this.setData({
          rate: count - before,
          total: count,
          gaps,
          dropped: parser.dropped,
          channels,
        });
        before = count;
      }, 1000);
    } catch (e) {
      this.stop();
      this.setData({ status: '未连接', error: e.message });
    }
    this.setData({ busy: false });
  },

  stop() {
    clearInterval(timer);
    if (this.data.running) http(this.data.ip, 'GET', '/stream/stop').catch(() => {});
    if (udp) udp.close();
    udp = null;
    this.setData({ running: false, status: '未连接' });
  },
});
