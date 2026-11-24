// Developer-interface processing: band measures from a spectrum, cleaned and α waveforms.
const assert = require('node:assert/strict');
const { bandMeasures, WaveFilter } = require('../electron/dsp.cjs');
const f = Array.from({ length: 79 }, (_, i) => 1 + i / 2); // 1–40 Hz, 0.5 Hz steps
const psd = f.map((x) => 1 / x + 5 * Math.exp(-((x - 10) ** 2)));
const m = bandMeasures(f, psd);
assert.equal(m.alphaPeakHz, 10);
assert.equal(m.dominantHz, 10);
assert.ok(m.bands.alpha.relativePercent > 50);
const sum = Object.values(m.bands).reduce((s, b) => s + b.relativePercent, 0);
assert.ok(Math.abs(sum - 100) < 1, `bands cover 1–40 Hz (${sum})`);

const rate = 250,
  n = rate * 8;
const sig = (t) => 3000 + 20 * Math.sin(2 * Math.PI * 10 * t) + 30 * Math.sin(2 * Math.PI * 50 * t);
const w = new WaveFilter(rate);
const out = { broadband: [], alpha: [], alphaAmplitude: [] };
for (let i = 0; i < n; i += 125) {
  const r = w.push(Array.from({ length: 125 }, (_, k) => sig((i + k) / rate)));
  for (const k in out) out[k].push(...r[k]);
}
assert.ok(w.settled);
const tail = (a) => a.slice(-rate * 2);
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
// Offset and mains removed, 10 Hz kept (RMS of a 20 µV sine ≈ 14.1).
assert.ok(Math.abs(rms(tail(out.broadband)) - 14.1) < 1.5, `broadband ${rms(tail(out.broadband))}`);
// 8 and 13 Hz are the −3 dB edges of the two 4th-order sections: 10 Hz keeps about 88%.
assert.ok(Math.abs(rms(tail(out.alpha)) - 12.4) < 1, `alpha ${rms(tail(out.alpha))}`);
const amp = tail(out.alphaAmplitude);
assert.ok(
  amp.every((v) => Math.abs(v - 17.6) < 2),
  'α amplitude follows the sine',
);
// A 25 Hz signal is outside α.
const b = new WaveFilter(rate);
const beta = b.push(
  Array.from({ length: n }, (_, i) => 20 * Math.sin((2 * Math.PI * 25 * i) / rate)),
);
assert.ok(rms(beta.alpha.slice(-rate * 2)) < 1.5);
console.log('PASS dsp: band shares, α peak, offset/mains removed, α waveform and amplitude');
