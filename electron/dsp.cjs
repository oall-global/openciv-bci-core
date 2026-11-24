// Processing for the developer interface: band measures from the engine's spectrum, and
// causal filters (state kept across packets) for the cleaned and α waveforms.
const BANDS = [
  ['delta', 1, 4],
  ['theta', 4, 8],
  ['alpha', 8, 13],
  ['beta', 13, 30],
  ['gamma', 30, 40],
];
// Trapezoid over [lo, hi] of a spectrum sampled at frequencies f.
function area(f, p, lo, hi) {
  let s = 0;
  for (let i = 1; i < f.length; i++)
    if (f[i - 1] >= lo && f[i] <= hi) s += ((p[i - 1] + p[i]) / 2) * (f[i] - f[i - 1]);
  return s;
}
function peak(f, p, lo, hi) {
  let best = -1;
  for (let i = 1; i < f.length - 1; i++)
    if (
      f[i] >= lo &&
      f[i] <= hi &&
      p[i] >= p[i - 1] &&
      p[i] >= p[i + 1] &&
      (best < 0 || p[i] > p[best])
    )
      best = i;
  return best < 0 ? null : f[best];
}
// Per channel: absolute power (µV²) and share of 1–40 Hz (%) for each band, the α peak
// frequency (local maximum in 7–14 Hz, null when there is none) and the strongest frequency.
function bandMeasures(frequencies, psd) {
  const total = area(frequencies, psd, 1, 40);
  const bands = {};
  for (const [name, lo, hi] of BANDS) {
    const a = area(frequencies, psd, lo, hi);
    bands[name] = { absoluteUv2: a, relativePercent: total > 1e-12 ? (100 * a) / total : 0 };
  }
  let top = 0;
  for (let i = 1; i < psd.length; i++) if (psd[i] > psd[top]) top = i;
  return {
    bands,
    totalUv2: total,
    alphaPeakHz: peak(frequencies, psd, 7, 14),
    dominantHz: frequencies[top] ?? null,
  };
}
// RBJ biquads, direct form I.
function biquad(type, rate, f0, q) {
  const w = (2 * Math.PI * f0) / rate,
    c = Math.cos(w),
    a = Math.sin(w) / (2 * q);
  let b;
  if (type === 'lowpass') b = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  else if (type === 'highpass') b = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  else b = [1, -2 * c, 1]; // notch
  const a0 = 1 + a;
  return {
    b: b.map((v) => v / a0),
    a: [(-2 * c) / a0, (1 - a) / a0],
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}
function step(s, x) {
  const y = s.b[0] * x + s.b[1] * s.x1 + s.b[2] * s.x2 - s.a[0] * s.y1 - s.a[1] * s.y2;
  s.x2 = s.x1;
  s.x1 = x;
  s.y2 = s.y1;
  s.y1 = y;
  return y;
}
// Fourth-order Butterworth sections (two biquads with these Q values).
const BUTTER4 = [0.5412, 1.3066];
function chain(rate, specs) {
  return specs.flatMap(([type, f0]) =>
    type === 'notch'
      ? [biquad('notch', rate, f0, 30)]
      : BUTTER4.map((q) => biquad(type, rate, f0, q)),
  );
}
// One per channel. broadband: 1–40 Hz with the 50 Hz mains notch; alpha: 8–13 Hz;
// alphaAmplitude: √2 × RMS of the α waveform over the last 0.5 s (its envelope).
class WaveFilter {
  constructor(rate, mainsHz = 50) {
    this.rate = rate;
    const notch = mainsHz < rate / 2 ? [['notch', mainsHz]] : [];
    this.broad = chain(rate, [['highpass', 1], ['lowpass', 40], ...notch]);
    this.alpha = chain(rate, [
      ['highpass', 8],
      ['lowpass', 13],
    ]);
    this.ring = new Float64Array(Math.max(1, Math.round(rate / 2)));
    this.at = 0;
    this.sum = 0;
    this.count = 0; // samples processed; the filters settle within about 2 s
  }
  push(samples) {
    const broadband = [],
      alpha = [],
      alphaAmplitude = [];
    for (const raw of samples) {
      // Start from the first value so the electrode offset does not ring through the filters.
      if (!this.count) for (const s of [this.broad[0], this.alpha[0]]) s.x1 = s.x2 = raw;
      let b = raw;
      for (const s of this.broad) b = step(s, b);
      let a = raw;
      for (const s of this.alpha) a = step(s, a);
      const sq = a * a;
      this.sum += sq - this.ring[this.at];
      this.ring[this.at] = sq;
      this.at = (this.at + 1) % this.ring.length;
      broadband.push(b);
      alpha.push(a);
      alphaAmplitude.push(Math.SQRT2 * Math.sqrt(Math.max(0, this.sum) / this.ring.length));
      this.count++;
    }
    return { broadband, alpha, alphaAmplitude };
  }
  get settled() {
    return this.count >= this.rate * 2;
  }
}
module.exports = { BANDS, bandMeasures, WaveFilter };
