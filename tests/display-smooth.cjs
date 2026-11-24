// 主图 display smoothing: gradual change, artefact hold, white only when sustained.
const ts = require('typescript'),
  fs = require('fs'),
  assert = require('assert/strict');
require.extensions['.ts'] = (m, p) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(p, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    p,
  );
// brainHistory touches localStorage at load
global.localStorage = { getItem: () => null, setItem() {} };
const { DisplaySmooth } = require('../src/home/displaySmooth.ts');

const frame = (t, v, over = {}) => ({
  t,
  p: [],
  ok: [],
  rec: {},
  r: [0, 1, 2, 3, 4].map((b) => [0, 1].map((c) => over[`${b},${c}`] ?? v)),
});
const run = (s, seconds) => {
  for (let i = 0; i < seconds * 60; i++) s.step(1 / 60);
};

// gradual: a jump from 1× to 1.4× is not reached at once
let s = new DisplaySmooth(2);
s.push(frame(0, 0));
run(s, 0.1);
assert.equal(s.shown[2][0], 0);
s.push(frame(0.5, Math.log(1.4)));
run(s, 0.2);
assert.ok(s.shown[2][0] > 0.03 && s.shown[2][0] < Math.log(1.4) * 0.5, String(s.shown[2][0]));
run(s, 10);
assert.ok(Math.abs(s.shown[2][0] - Math.log(1.4)) < 0.01);

// white only when sustained: a single 3× frame stays below the white range
s = new DisplaySmooth(2);
s.push(frame(0, 0));
run(s, 0.1);
s.push(frame(0.5, Math.log(3)));
run(s, 0.5);
s.push(frame(1, 0));
run(s, 2);
assert.ok(Math.max(...s.shown[2]) <= Math.log(1.5) + 1e-9);
// sustained, it goes there
s.push(frame(1.5, Math.log(3)));
run(s, 8);
assert.ok(s.shown[2][0] > Math.log(2.5), String(s.shown[2][0]));

// artefact (δ 10×) and a short unusable frame keep the earlier values; long ones are shown
s = new DisplaySmooth(2);
s.push(frame(0, 0.2));
run(s, 10);
s.push(frame(0.5, 0.2, { '0,0': Math.log(10), '2,0': -1 }));
run(s, 1);
assert.ok(Math.abs(s.shown[2][0] - 0.2) < 1e-6, 'held during artefact');
assert.ok(Math.abs(s.shown[2][1] - 0.2) < 1e-6);
s.push(frame(1, 0.2, { '2,1': NaN }));
run(s, 0.5);
assert.ok(Number.isFinite(s.shown[2][1]), 'held while briefly unusable');
for (let t = 1.5; t <= 5; t += 0.5) (s.push(frame(t, 0.2, { '2,1': NaN })), run(s, 0.5));
assert.ok(Number.isNaN(s.shown[2][1]), 'unusable after the hold is shown as such');

// no baseline: nothing shown
s.push({ t: 6, p: [], ok: [], rec: {}, r: null });
assert.equal(s.ready, false);
console.log('display smooth ok');
