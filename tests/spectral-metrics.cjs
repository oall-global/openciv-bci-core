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
const { bandPowers } = require('../src/spectralMetrics.ts');
const f = Array.from({ length: 79 }, (_, i) => 1 + i * 0.5);
assert.deepEqual(
  bandPowers(
    f,
    f.map(() => 1),
  ),
  [3, 4, 5, 17, 10],
);
const p = bandPowers(f, f);
assert(Math.abs(p.reduce((a, b) => a + b, 0) - (40 * 40 - 1) / 2) < 1e-8);
assert.equal(bandPowers(f, [NaN]), null);
assert.equal(bandPowers([1, 8, 4, 40], [1, 1, 1, 1]), null);
assert.equal(bandPowers([8, 13], [1, 1]), null);
assert.deepEqual(
  bandPowers(
    f,
    f.map(() => 0),
  ),
  [0, 0, 0, 0, 0],
);
console.log(
  'PASS spectral integration, non-overlapping boundaries, missing/invalid spectrum and zero power',
);
