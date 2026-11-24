// The Wi-Fi this computer is on, and its saved password, for pairing the device (设备 → 配网).
// The password is read here from the computer's saved profile and never sent to the page.
const { execFile } = require('node:child_process');

function run(cmd, args) {
  return new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8' }, (e, out) => resolve(e ? '' : out)),
  );
}

/** The Wi-Fi this computer is on: { ssid } (Windows only for now) */
async function currentWifi() {
  if (process.platform !== 'win32') return null;
  const out = await run('netsh', ['wlan', 'show', 'interfaces']);
  const m = /^\s*SSID\s*:\s*(.+)$/m.exec(out);
  return m ? { ssid: m[1].trim() } : null;
}
async function wifiPassword(ssid) {
  const out = await run('netsh', ['wlan', 'show', 'profile', `name=${ssid}`, 'key=clear']);
  const m = /^\s*(?:Key Content|关键内容)\s*:\s*(.+)$/m.exec(out);
  return m ? m[1].trim() : '';
}

module.exports = { currentWifi, wifiPassword };
