// The device's own hotspot (首次打开, src/onboarding/FirstRun.tsx): every BCI-001 opens one named by
// its serial number (OCBCI…) with the same preset password (as the mini program,
// wechat/bci/lib/device.js). The computer joins it for a moment, gives the device the Wi-Fi
// through the firmware's page (POST 192.168.4.1/wifi with ssid and password; the device saves
// it and restarts into it) and goes back to its own Wi-Fi. USB stays the other way.
// Windows: netsh. macOS: networksetup / system_profiler (not yet tried with a real device).
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const PREFIX = 'OCBCI';
const PASSWORD = 'ocbci369#';
const DEVICE = '192.168.4.1';
const VALID = /^OCBCI[0-9A-Z]{1,27}$/;

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout }, (e, out) =>
      resolve(e ? '' : out),
    ),
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET or POST http://192.168.4.1 (no proxy): { status, text }, or null when nothing answers */
function request(pathname, body, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: DEVICE,
        port: 80,
        path: pathname,
        method: body ? 'POST' : 'GET',
        timeout,
        headers: body
          ? {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c.length + text.length < 16384 ? c : ''));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(body);
  });
}

/** The Wi-Fi this computer is on now (Windows; null elsewhere or when off Wi-Fi) */
async function currentSsid() {
  if (process.platform !== 'win32') return null;
  const out = await run('netsh', ['wlan', 'show', 'interfaces']);
  const m = /^\s*SSID\s*:\s*(.+)$/m.exec(out);
  return m ? m[1].trim() : null;
}

async function macDevice() {
  const out = await run('networksetup', ['-listallhardwareports']);
  const m = /Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/.exec(out);
  return m ? m[1] : 'en0';
}

/** The device hotspots this computer sees: ['OCBCI…'], strongest first where known */
async function list() {
  let names = [];
  if (process.platform === 'win32') {
    const out = await run('netsh', ['wlan', 'show', 'networks']);
    names = [...out.matchAll(/^\s*SSID \d+\s*:\s*(.+)$/gm)].map((m) => m[1].trim());
  } else if (process.platform === 'darwin') {
    try {
      const j = JSON.parse(await run('system_profiler', ['SPAirPortDataType', '-json']));
      for (const i of j.SPAirPortDataType?.[0]?.spairport_airport_interfaces ?? [])
        for (const n of i.spairport_airport_other_local_wireless_networks ?? [])
          names.push(n._name);
    } catch {
      // no Wi-Fi: nothing seen
    }
  }
  return [...new Set(names.filter((n) => n.startsWith(PREFIX) && VALID.test(n)))];
}

function xml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function join(ssid) {
  if (process.platform === 'win32') {
    const file = path.join(os.tmpdir(), `neurolink-${ssid}.xml`);
    fs.writeFileSync(
      file,
      `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xml(ssid)}</name>
  <SSIDConfig><SSID><name>${xml(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType><connectionMode>manual</connectionMode>
  <MSM><security>
    <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xml(PASSWORD)}</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>`,
    );
    try {
      await run('netsh', ['wlan', 'add', 'profile', `filename=${file}`, 'user=current']);
    } finally {
      fs.rmSync(file, { force: true });
    }
    await run('netsh', ['wlan', 'connect', `name=${ssid}`, `ssid=${ssid}`]);
  } else if (process.platform === 'darwin') {
    await run('networksetup', ['-setairportnetwork', await macDevice(), ssid, PASSWORD], 30000);
  } else throw Error('这台电脑不支持自动连接设备热点，请用 USB 连接');
  // the device answers on its own address once the computer is on its hotspot. Windows may
  // leave a hotspot without internet for a saved network that has it: join it again.
  for (let i = 0; i < 30; i++) {
    if (process.platform === 'win32' && i % 3 === 2) {
      const now = await currentSsid();
      if (now && now !== ssid)
        await run('netsh', ['wlan', 'connect', `name=${ssid}`, `ssid=${ssid}`]);
    }
    const r = await request('/status', '', 2000);
    if (r?.status === 200) {
      try {
        return JSON.parse(r.text);
      } catch {
        return {};
      }
    }
    await sleep(1000);
  }
  return null;
}

/** back to the computer's own Wi-Fi; the hotspot's profile is not kept. On Windows: the
 * network it is on afterwards (Windows may pick another saved one when this fails, e.g. the
 * own Wi-Fi is out of reach), asked for again when it is not that one. */
async function leave(ssid, back, password) {
  if (process.platform === 'win32') {
    let now = null;
    for (let i = 0; back && i < 2 && now !== back; i++) {
      await run('netsh', ['wlan', 'connect', `name=${back}`]);
      for (let t = 0; t < 10 && (now = await currentSsid()) !== back; t++) await sleep(1000);
    }
    await run('netsh', ['wlan', 'delete', 'profile', `name=${ssid}`]);
    return now ?? (await currentSsid());
  } else if (process.platform === 'darwin' && back) {
    const args = ['-setairportnetwork', await macDevice(), back];
    await run('networksetup', password ? [...args, password] : args, 30000);
  }
  return back;
}

// the device that took the Wi-Fi while the computer came back on another network: once the
// computer is on that Wi-Fi again, the next attempt goes on without the hotspot (it is gone)
let given = null;

function wrongWifi(now, back) {
  return Error(
    now
      ? `电脑连到了「${now}」，不是「${back}」，请切回「${back}」后再试一次`
      : `电脑没有连回「${back}」，请连上「${back}」后再试一次`,
  );
}

/** Join the hotspot, give the device the Wi-Fi name / password, come back: { sn } */
async function provision({ hotspot, name, password, back }) {
  if (!VALID.test(hotspot)) throw Error('设备热点名无效');
  if (given?.hotspot === hotspot && given.name === name && Date.now() - given.at < 600000) {
    const now = await currentSsid();
    if (now !== given.back) throw wrongWifi(now, given.back);
    const { sn } = given;
    given = null;
    return { sn };
  }
  const status = await join(hotspot);
  let sn = null;
  try {
    if (!status) throw Error('没有连上设备热点，请确认设备已打开');
    const body = new URLSearchParams({ ssid: name, password }).toString();
    let r = await request('/wifi', body, 6000);
    if (r?.status !== 200 && process.platform === 'win32' && (await currentSsid()) !== hotspot) {
      // Windows left the hotspot just now: back on it, once
      if (await join(hotspot)) r = await request('/wifi', body, 6000);
    }
    // never pass the reply on: it may echo what was sent
    if (r?.status !== 200) throw Error('设备没有收到 Wi-Fi，请再试一次');
    sn = typeof status.sn === 'string' ? status.sn.slice(0, 32) : hotspot;
    return { sn };
  } finally {
    const now = await leave(hotspot, back, password);
    if (sn && back && now !== back) {
      given = { hotspot, name, back, sn, at: Date.now() };
      // eslint-disable-next-line no-unsafe-finally
      throw wrongWifi(now, back);
    }
  }
}

module.exports = { list, provision, VALID };
