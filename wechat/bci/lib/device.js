// The BCI device from the mini program, as docs/无线配网说明.md: its hotspot (named by its serial
// number, SN), the firmware's configuration page at 192.168.4.1 (GET /wifi/scan lists the
// networks it sees, POST /wifi with ssid and password saves one and restarts the device into it),
// and finding it on the home Wi-Fi afterwards. The device answers GET /status with its identity
// (sn, mode, ip, num_channels, board_connected); the older OpenBCI shield GET /all
// (engine/connection_setup.py, scripts/wifi-provision.py).
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const { report } = require('../../lib/devlog.js');

const HOTSPOT_IP = '192.168.4.1';
const STORE = 'bci.devices';
// every BCI-001 opens a hotspot named by its SN (OCBCI…) with the same password
const HOTSPOT_PREFIX = 'OCBCI';
const HOTSPOT_PASSWORD = 'ocbci369#';

const call = (api, args) =>
  new Promise((resolve, reject) =>
    wx[api](
      Object.assign({}, args, {
        success: resolve,
        fail: (e) => reject(Object.assign(new Error((e && e.errMsg) || api), { raw: e })),
      }),
    ),
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function platform() {
  try {
    return (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform || '';
  } catch (e) {
    return '';
  }
}

/** GET http://ip/path as text; null when nothing answers in time */
function get(ip, path, ms) {
  return new Promise((resolve) =>
    wx.request({
      url: `http://${ip}${path}`,
      dataType: '其他',
      timeout: ms || 3000,
      success: (r) => resolve(r.statusCode === 200 ? String(r.data) : null),
      fail: () => resolve(null),
    }),
  );
}

const json = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
};

/** The device's identity at an address, or null */
async function identify(ip, ms) {
  const r = await probe(ip, '/status', ms);
  if (!r) return null; // nothing at this address: no second request
  const info = r.status === 200 ? json(r.text) : null;
  if (info && ('sn' in info || 'num_channels' in info || 'board_connected' in info))
    return {
      ip,
      sn: info.sn || '',
      name: info.sn || '',
      mac: '',
      mode: info.mode,
      channels: info.num_channels || 0,
      connected: !!info.board_connected,
    };
  const old = json(await get(ip, '/all', ms));
  if (!old || !('board_connected' in old)) return null;
  return {
    ip,
    sn: '',
    name: old.name || '',
    mac: old.mac || '',
    channels: old.num_channels || 0,
    connected: !!old.board_connected,
  };
}
/** GET with the status: { status, text }, or null when nothing answers at all */
function probe(ip, path, ms) {
  return new Promise((resolve) =>
    wx.request({
      url: `http://${ip}${path}`,
      dataType: '其他',
      timeout: ms || 3000,
      success: (r) => resolve({ status: r.statusCode, text: String(r.data || '') }),
      fail: (e) => {
        lastFail = (e && e.errMsg) || '';
        resolve(null);
      },
    }),
  );
}
let lastFail = ''; // why the last request got no answer (for the development log)
/** One device's key (its SN, or the older shield's MAC) */
const keyOf = (d) => (d && (d.sn || d.mac)) || '';

/**
 * The BCI-001 hotspots nearby, strongest first (Android: the phone can list Wi-Fi networks).
 * null where the phone cannot list them (iPhone: WeChat opens the system settings instead).
 */
async function findHotspots(ms) {
  // iPhone: getWifiList opens WeChat's page in the system settings every time, so it is not asked
  if (platform() === 'ios') return null;
  await call('startWifi', {});
  return new Promise((resolve) => {
    let done = false;
    const finish = (list) => {
      if (done) return;
      done = true;
      if (wx.offGetWifiList) wx.offGetWifiList(onList);
      resolve(list);
    };
    const onList = (r) => {
      const seen = {};
      (r.wifiList || []).forEach((w) => {
        if (w.SSID && w.SSID.indexOf(HOTSPOT_PREFIX) === 0 && !(seen[w.SSID] >= w.signalStrength))
          seen[w.SSID] = w.signalStrength || 0;
      });
      finish(Object.keys(seen).sort((a, b) => seen[b] - seen[a]));
    };
    wx.onGetWifiList(onList);
    wx.getWifiList({ fail: () => finish(null) });
    setTimeout(() => finish([]), ms || 8000);
  });
}

/** Joins the device's hotspot (the system asks the user to confirm) and checks it is the device */
async function joinHotspot(ssid, password) {
  await call('startWifi', {});
  // `maunal` is spelled so in WeChat's API (false: join from the mini program, not settings)
  await call('connectWifi', {
    SSID: ssid,
    password: password || HOTSPOT_PASSWORD,
    maunal: false,
  });
  // the phone needs a moment on the new network before the device answers
  for (let i = 0; i < 10; i++) {
    const device = await identify(HOTSPOT_IP, 2000);
    if (device) return device;
    await sleep(1000);
  }
  throw Error('已连接热点，但没有找到开源文明BCI');
}

/** The networks the device sees, strongest first: [{ ssid, rssi, locked }]; [] when it cannot
 *  scan (it answers 503 while streaming) */
function networks() {
  return new Promise((resolve) =>
    wx.request({
      url: `http://${HOTSPOT_IP}/wifi/scan?ts=${Date.now()}`,
      dataType: '其他',
      timeout: 10000,
      success: (r) => {
        const j = r.statusCode === 200 ? json(String(r.data)) : null;
        const best = {};
        ((j && j.networks) || []).forEach((n) => {
          if (n && n.ssid && (!best[n.ssid] || best[n.ssid].rssi < n.rssi))
            best[n.ssid] = { ssid: n.ssid, rssi: n.rssi, locked: !!n.enc };
        });
        resolve(
          Object.keys(best)
            .map((k) => best[k])
            .sort((a, b) => b.rssi - a.rssi),
        );
      },
      fail: () => resolve([]),
    }),
  );
}

/** Saves the home Wi-Fi on the device (its page's form). It answers, then restarts into it;
 *  no answer at all can also mean it restarted first, which the search afterwards tells. */
function provision(ssid, password) {
  const form = (o) =>
    Object.keys(o)
      .map((k) => `${k}=${encodeURIComponent(o[k])}`)
      .join('&');
  return new Promise((resolve, reject) =>
    wx.request({
      url: `http://${HOTSPOT_IP}/wifi`,
      method: 'POST',
      header: { 'content-type': 'application/x-www-form-urlencoded' },
      data: form({ ssid, password: password || '' }),
      dataType: '其他',
      timeout: 8000,
      success: (r) =>
        r.statusCode === 200
          ? resolve(true)
          : reject(Error(`开源文明BCI没有保存 Wi-Fi（回复 ${r.statusCode}）`)),
      fail: () => resolve(false),
    }),
  );
}

/** The phone's current Wi-Fi network name, or '' */
async function currentSsid() {
  const w = await currentWifi();
  return w.ssid;
}
/** The phone's current Wi-Fi: { ssid, ghz5 } (ghz5 where the phone tells the frequency) */
async function currentWifi() {
  try {
    await call('startWifi', {});
    const r = await call('getConnectedWifi', {});
    const w = r.wifi || {};
    return { ssid: w.SSID || '', ghz5: w.frequency > 4900 };
  } catch (e) {
    return { ssid: '', ghz5: false };
  }
}

/** Every address of the phone's /24 asked who it is; the device (by its key), or null */
async function findOnNetwork(key) {
  const { localip } = await call('getLocalIPAddress', {});
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(localip);
  if (!m) return null;
  // where devices were before first (the router usually gives them the same address again)
  const hosts = devices()
    .map((d) => d.ip)
    .filter((ip) => ip && ip.indexOf(`${m[1]}.`) === 0);
  for (let i = 1; i < 255; i++) hosts.push(`${m[1]}.${i}`);
  const todo = hosts.filter((h, i) => h !== localip && hosts.indexOf(h) === i);
  let found = null;
  const worker = async () => {
    while (todo.length && !found) {
      const device = await identify(todo.shift(), 1200);
      // a device still in its hotspot (mode 1 at 192.168.4.1) is not on the Wi-Fi yet
      const hotspot = device && device.ip === HOTSPOT_IP && String(device.mode) === '1';
      if (device && !hotspot && (!key || keyOf(device) === key)) found = device;
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(worker)); // wx.request allows 10 at once
  if (!found) report('bci search', localip, todo.length, lastFail);
  return found;
}

// WeChat lets a mini program reach only these addresses without a registered domain
const LAN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
/** Why the device is not found on the Wi-Fi, as far as the phone can tell: { ip, blocked, ssid } */
async function diagnose() {
  let ip = '';
  try {
    ip = (await call('getLocalIPAddress', {})).localip || '';
  } catch (e) {
    ip = '';
  }
  const blocked = (!!ip && !LAN.test(ip)) || /domain list/.test(lastFail);
  return { ip, blocked, ssid: await currentSsid(), lastFail };
}

const devices = () => JSON.parse(wx.getStorageSync(STORE) || '[]');
function saveDevice(d) {
  wx.setStorageSync(
    STORE,
    JSON.stringify(
      devices()
        .filter((x) => keyOf(x) !== keyOf(d))
        .concat(d),
    ),
  );
}

module.exports = {
  joinHotspot,
  identify,
  networks,
  provision,
  keyOf,
  currentSsid,
  currentWifi,
  findHotspots,
  HOTSPOT_PREFIX,
  findOnNetwork,
  diagnose,
  devices,
  saveDevice,
};
