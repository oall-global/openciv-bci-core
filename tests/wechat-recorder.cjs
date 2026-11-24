// 录制脑电 in the mini program (src/wechat/recorder.ts): samples kept in its files, the recording
// listed, and the BDF export byte for byte the desktop's (electron/export.cjs writeBdf) for the
// same samples — trailing partial second padded and marked, a minute-long read in pieces.
// wx's file system is played by node's.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { writeBdf } = require('../electron/export.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-recorder-'));
const bundle = path.join(tmp, 'recorder.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../src/wechat/recorder.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'error',
});

const buf = (d) =>
  typeof d === 'string' ? d : Buffer.from(d instanceof ArrayBuffer ? d : d.buffer);
const fds = new Map();
let nextFd = 1;
global.wx = {
  env: { USER_DATA_PATH: path.join(tmp, 'usr') },
  getFileSystemManager: () => ({
    accessSync: (p) => fs.accessSync(p),
    readdirSync: (p) => fs.readdirSync(p),
    statSync: (p) => fs.statSync(p),
    mkdirSync: (p, recursive) => fs.mkdirSync(p, { recursive }),
    writeFileSync: (p, d, enc) => fs.writeFileSync(p, buf(d), enc),
    appendFileSync: (p, d) => fs.appendFileSync(p, buf(d)),
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    rmdirSync: (p, recursive) => fs.rmSync(p, { recursive }),
    openSync: ({ filePath }) => {
      const fd = nextFd++;
      fds.set(fd, fs.openSync(filePath, 'r'));
      return fd;
    },
    readSync: ({ fd, arrayBuffer, offset, length, position }) =>
      fs.readSync(fds.get(fd), new Uint8Array(arrayBuffer), offset, length, position),
    closeSync: ({ fd }) => fs.closeSync(fds.get(fd)),
  }),
};
fs.mkdirSync(wx.env.USER_DATA_PATH, { recursive: true });
const rec = require(bundle);

const rate = 250,
  labels = [
    'Fp1',
    'Fp2',
    'C3',
    'C4',
    'P7',
    'P8',
    'O1',
    'O2',
    'F7',
    'F8',
    'F3',
    'F4',
    'T7',
    'T8',
    'P3',
    'P4',
  ];
// 61.5 s: more than one minute-long piece, and a partial last second
const n = Math.round(rate * 61.5);
const value = (c, i) => 1000 * (c - 8) + 50 * Math.sin((2 * Math.PI * 10 * i) / rate) + 0.123;
// float32 as stored on the phone
const f32 = (v) => Math.fround(v);

rec.start(rate, labels);
assert.equal(rec.active().active, true);
for (let s = 0; s < n; s += 25) {
  const m = Math.min(25, n - s);
  rec.push(
    Array.from({ length: 16 }, (_, c) => Array.from({ length: m }, (_, i) => value(c, s + i))),
  );
  if (s % rate === 0) rec.contact(14);
}
const meta = rec.stop();
assert.equal(rec.active().active, false);
assert.equal(meta.samples, n);
assert.equal(meta.seconds, 61.5);
assert.equal(meta.good, 14);
const list = rec.list();
assert.equal(list.length, 1);
assert.equal(list[0].id, meta.id);

const out = rec.exportBdf(meta.id);
assert.match(out.name, /^OpenCiv-BCI-001-\d{8}-\d{6}\.bdf$/);
const phone = fs.readFileSync(out.path);

const desktopFile = path.join(tmp, 'desktop.bdf');
writeBdf(desktopFile, {
  rate,
  labels,
  data: Array.from({ length: 16 }, (_, c) => Array.from({ length: n }, (_, i) => f32(value(c, i)))),
  start: new Date(meta.start),
  patient: 'X X X X',
  recording: 'OpenCiv_BCI_001_recording',
});
const desktop = fs.readFileSync(desktopFile);
assert.equal(phone.length, desktop.length, 'same size as the desktop export');
assert.ok(phone.equals(desktop), 'byte for byte the desktop export');

// a second export replaces the first; removing the recording removes its files
rec.exportBdf(meta.id);
assert.equal(fs.readdirSync(path.join(wx.env.USER_DATA_PATH, 'export')).length, 1);
rec.remove(meta.id);
assert.equal(rec.list().length, 0);

// under a second is not kept
rec.start(rate, labels);
rec.push(Array.from({ length: 16 }, () => [1, 2, 3]));
assert.equal(rec.stop(), null);
assert.equal(rec.list().length, 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  'PASS wechat-recorder: recording kept and listed; BDF export byte for byte the desktop’s (61.5 s, padded); one export at a time; short recordings dropped',
);
