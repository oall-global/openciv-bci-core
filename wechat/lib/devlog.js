// Development builds only (preview / 开发版): console output, errors and reports from the phone go
// to the log receiver on the developer's computer (scripts/wechat-log.cjs), so a problem on the
// phone shows up there without screenshots. Release builds send nothing.
const HOST = 'http://192.158.0.101:8787/log';

let dev = false;
try {
  dev = wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
} catch (e) {
  dev = false;
}

// Lines not delivered (the phone was on the device's own hotspot, or the app restarted) are kept
// in storage and sent once this computer is reachable again.
const PENDING = 'devlog.pending';
const queue = dev ? JSON.parse(wx.getStorageSync(PENDING) || '[]') : [];
let busy = false;
const keep = () => wx.setStorageSync(PENDING, JSON.stringify(queue.slice(-500)));
function flush() {
  if (busy || !queue.length) return;
  busy = true;
  const batch = queue.slice(0, 50);
  wx.request({
    url: HOST,
    method: 'POST',
    data: { lines: batch },
    timeout: 3000,
    // only this computer's receiver answers 204; anything else is not a delivery
    success: (r) => {
      if (r.statusCode !== 204) return;
      queue.splice(0, batch.length);
      keep();
    },
    complete: (r) => {
      busy = false;
      const delivered = r && r.statusCode === 204;
      if (queue.length) setTimeout(flush, delivered ? 200 : 10000);
    },
  });
}
function send(kind, args) {
  if (!dev) return;
  const text = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
  queue.push(`${new Date().toISOString().slice(11, 23)} [${kind}] ${text}`.slice(0, 4000));
  keep();
  setTimeout(flush, 50);
}

if (dev) {
  ['log', 'info', 'warn', 'error'].forEach((k) => {
    const original = console[k];
    console[k] = (...args) => {
      original.apply(console, args);
      send(k, args);
    };
  });
  wx.onError((e) => send('error', [e]));
  if (wx.onUnhandledRejection) wx.onUnhandledRejection((r) => send('unhandled', [r.reason || r]));
  const info = wx.getSystemInfoSync();
  send('start', [`${info.platform} ${info.system} WeChat ${info.version} SDK ${info.SDKVersion}`]);
}

module.exports = { report: (...args) => send('report', args) };
