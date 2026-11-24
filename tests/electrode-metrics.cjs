const ts = require('typescript'),
  fs = require('fs'),
  assert = require('assert/strict');
require.extensions['.ts'] = (m, p) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(p, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    p,
  );
const { electrodeMetric: m, electrodeNames } = require('../src/electrodeMetrics.ts');
assert.deepEqual(electrodeNames, [
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
]);
const f = { epoch: 1, at: 100, rms: [25], rail: { states: ['normal'], percentages: [75] } },
  a = { epoch: 1, at: 100, flags: [''], relative: [40], absolute: [123] };
for (const [state, color] of [
  ['normal', '#299b77'],
  ['near', '#e6a13d'],
  ['railed', '#e45d57'],
  ['flat', '#e45d57'],
]) {
  f.rail.states[0] = state;
  assert.equal(m('railed', 0, f, a, true, 100000).color, color);
}
assert(m('alpha', 0, f, a, true, 100000).text.includes('40.0%'));
assert(m('rms', 0, f, a, true, 100000).text.includes('25.00'));
for (const mode of ['alpha', 'rms', 'railed']) {
  assert.equal(m(mode, 0, f, a, false, 100000).text, '等待有效数据');
  assert.equal(m(mode, 0, f, a, true, 102000).text, '等待有效数据');
}
a.flags[0] = 'railed';
assert.equal(m('alpha', 0, f, a, true, 100000).text, '等待有效数据');
a.flags[0] = '';
a.epoch = 2;
assert.equal(m('alpha', 0, f, a, true, 100000).text, '等待有效数据');
console.log(
  'PASS canonical labels, unchanged rail state display, Alpha units, stale/disconnect/epoch and flagged data rejection',
);
