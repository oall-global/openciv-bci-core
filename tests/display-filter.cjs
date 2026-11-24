// Waveform processing equals OpenBCI GUI's (BrainFlow band-pass 5–50 Hz and 50/60 Hz removal):
// the same random signal through BrainFlow (engine Python) and through src/displayFilter.ts.
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict'),
  { execFileSync } = require('child_process');
require.extensions['.ts'] = (m, p) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(p, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    p,
  );
const { displayFilter, uvrms } = require('../src/displayFilter.ts');
const python = require('../electron/python-path.cjs').pythonPath(path.resolve(__dirname, '..'));
const script = `
import json, sys, numpy as np
from brainflow.data_filter import DataFilter, FilterTypes, NoiseTypes
out = {}
for fs in (250, 125):
    rng = np.random.default_rng(7)
    t = np.arange(fs * 10) / fs
    x = rng.normal(0, 25, t.size) + 20 * np.sin(2 * np.pi * 10 * t) + 40 * np.sin(2 * np.pi * 50 * t) - 160000 + 3000 * t
    y = x.copy()
    DataFilter.perform_bandpass(y, fs, 5.0, 50.0, 4, FilterTypes.BUTTERWORTH.value, 0)
    DataFilter.remove_environmental_noise(y, fs, NoiseTypes.FIFTY.value)
    DataFilter.remove_environmental_noise(y, fs, NoiseTypes.SIXTY.value)
    out[fs] = {"x": x.tolist(), "y": y.tolist()}
json.dump(out, sys.stdout)
`;
const ref = JSON.parse(
  execFileSync(python, ['-W', 'ignore', '-c', script], { maxBuffer: 1 << 26 }).toString(),
);
for (const rate of [250, 125]) {
  const { x, y } = ref[rate];
  const ours = displayFilter(x, rate);
  let worst = 0;
  for (let i = 0; i < y.length; i++) worst = Math.max(worst, Math.abs(ours[i] - y[i]));
  // the input carries a −160 mV offset: agree to well under a microvolt everywhere
  assert.ok(worst < 1e-3, `${rate} Hz: differs from BrainFlow by ${worst} µV`);
  const a = uvrms(ours, rate),
    b = uvrms(y, rate);
  assert.ok(Math.abs(a - b) < 1e-6, `${rate} Hz µVrms ${a} vs ${b}`);
}
assert.deepEqual(displayFilter([], 250), []);
console.log(
  'PASS display filter: identical to OpenBCI GUI processing (BrainFlow 5–50 Hz, 50/60 Hz) at 250 and 125 Hz, µVrms',
);
