// Port of engine/spectral.py: the 4 s descriptive spectrum per channel (alpha share, flags,
// 1–40 Hz PSD) and the stream that emits it every 0.25 s.
import { hann, mean, power, trapezoid } from './dsp';

export const AMPLITUDE_UV = 100;

export function spectrum(x: number[][], rate: number) {
  if (!x.length || x[0].length < rate * 4)
    throw Error('Four seconds of finite channel samples required');
  const n = rate * 2,
    w = hann(n);
  let ww = 0;
  for (const v of w) ww += v * v;
  const trend = Array.from({ length: n }, (_, i) => i - (n - 1) / 2);
  const tt = trend.reduce((a, t) => a + t * t, 0);
  const freq = Array.from({ length: n / 2 + 1 }, (_, k) => (k * rate) / n);
  const maxBin = Math.floor((40 * n) / rate);
  const total = freq.map((f, k) => (f >= 1 && f <= 40 ? k : -1)).filter((k) => k >= 0);
  const alpha = freq.map((f, k) => (f >= 8 && f <= 13 ? k : -1)).filter((k) => k >= 0);
  const absolute: number[] = [],
    relative: number[] = [],
    flags: string[] = [],
    psdOut: number[][] = [];
  for (const full of x) {
    const row = full.slice(-rate * 4);
    const psd = new Float64Array(maxBin + 1);
    let segs = 0;
    for (let start = 0; start + n <= row.length; start += n / 2) {
      const seg = row.slice(start, start + n);
      const m = mean(seg);
      let b = 0;
      for (let i = 0; i < n; i++) b += (seg[i] - m) * trend[i];
      b /= tt;
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) y[i] = (seg[i] - m - b * trend[i]) * w[i];
      const p = power(y, maxBin);
      for (let k = 0; k <= maxBin; k++)
        psd[k] += ((k > 0 && k < n / 2 ? 2 : 1) * p[k]) / (rate * ww);
      segs++;
    }
    for (let k = 0; k <= maxBin; k++) psd[k] /= segs;
    const abs = trapezoid(
      alpha.map((k) => psd[k]),
      alpha.map((k) => freq[k]),
    );
    const tot = trapezoid(
      total.map((k) => psd[k]),
      total.map((k) => freq[k]),
    );
    const m = mean(row);
    let ss = 0;
    for (const v of row) ss += (v - m) * (v - m);
    const rms = Math.sqrt(ss / row.length);
    const bandRms = Math.sqrt(Math.max(tot, 0));
    absolute.push(abs);
    relative.push(tot > 1e-12 ? (100 * abs) / tot : 0);
    flags.push(rms < 0.2 ? 'flat' : bandRms > AMPLITUDE_UV ? 'amplitude' : '');
    psdOut.push(total.map((k) => psd[k]));
  }
  return { absolute, relative, flags, frequencies: total.map((k) => freq[k]), psd: psdOut };
}

export class AlphaStream {
  rows: number[][] = []; // channels × samples (last 4 s)
  lastTimestamp: number | null = null;
  lastEmit = 0;
  constructor(
    public rate = 250,
    public every = 0.25,
  ) {}
  clear() {
    this.rows = [];
    this.lastTimestamp = null;
    this.lastEmit = 0;
  }
  push(signals: number[][], timestamps: number[], now: number) {
    const gap = Math.max(0.1, 5 / this.rate);
    let start = 0;
    for (let i = 1; i < timestamps.length; i++)
      if (timestamps[i] - timestamps[i - 1] > gap) start = i;
    if (start) {
      this.clear();
    } else if (this.lastTimestamp !== null && timestamps[0] - this.lastTimestamp > gap)
      this.clear();
    if (!this.rows.length) this.rows = signals.map(() => []);
    signals.forEach((s, c) => {
      const r = this.rows[c];
      for (let i = start; i < s.length; i++) r.push(s[i]);
      if (r.length > this.rate * 4) r.splice(0, r.length - this.rate * 4);
    });
    this.lastTimestamp = timestamps[timestamps.length - 1];
    if (this.rows[0].length < this.rate * 4 || now - this.lastEmit < this.every) return null;
    this.lastEmit = now;
    return { ...spectrum(this.rows, this.rate), timestamp: this.lastTimestamp, windowSeconds: 4 };
  }
}
