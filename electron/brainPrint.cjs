// The figures the 数据 grid picture (the brain by band) is drawn from: each electrode's power 2–40 Hz in dB
// (db) and its spectrum shape (spec, minus its own mean), and the alpha peak frequency, over the
// whole recording. Filtered as the interface's waves
// topic (WaveFilter: 1–40 Hz, 50 Hz notch); Welch spectra of 2 s Hann windows every 0.5 s.
const { WaveFilter } = require('./dsp.cjs');

const BINS = Array.from({ length: 39 }, (_, i) => 2 + i); // 2..40 Hz, 1 Hz steps
const BACK = ['O1', 'O2', 'P3', 'P4', 'P7', 'P8'];

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const j = i + k + len / 2,
          vr = re[j] * cr - im[j] * ci,
          vi = re[j] * ci + im[j] * cr;
        re[j] = re[i + k] - vr;
        im[j] = im[i + k] - vi;
        re[i + k] += vr;
        im[i + k] += vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** channels: 16 × samples (raw µV); names: electrode per channel. null when too short. */
function brainPrint(channels, rate, names) {
  let N = 1;
  while (N < 2 * rate) N <<= 1; // about 2 s
  const step = Math.round(rate / 2),
    hz = rate / N,
    settle = 2 * rate; // the filters settle within about 2 s
  const hann = Float64Array.from(
    { length: N },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)),
  );
  const filtered = channels.map((c) => new WaveFilter(rate).push(c).broadband.slice(settle));
  const len = Math.min(...filtered.map((c) => c.length));
  if (len < N + 5 * step) return null;
  const psd = filtered.map(() => new Float64Array(N / 2));
  for (let s = 0; s + N <= len; s += step)
    filtered.forEach((c, i) => {
      let m = 0;
      for (let k = 0; k < N; k++) m += c[s + k];
      m /= N;
      const re = Float64Array.from({ length: N }, (_, k) => (c[s + k] - m) * hann[k]),
        im = new Float64Array(N);
      fft(re, im);
      for (let f = 0; f < N / 2; f++) psd[i][f] += re[f] ** 2 + im[f] ** 2;
    });
  // a flat channel (railed, or not sending) has no spectrum to show
  const good = filtered.map((c) => {
    let a = 0,
      q = 0;
    for (let k = 0; k < len; k++) ((a += c[k]), (q += c[k] * c[k]));
    return Math.sqrt(Math.max(0, q / len - (a / len) ** 2)) > 0.5;
  });
  const at = (p, f) => {
    const x = f / hz,
      i = Math.floor(x),
      t = x - i;
    return p[i] * (1 - t) + p[i + 1] * t;
  };
  // relative log spectrum per channel (minus its own mean, so contact level drops out)
  const spec = psd.map((p) => {
    const l = BINS.map((f) => Math.log10(at(p, f) + 1e-9)),
      m = l.reduce((a, b) => a + b, 0) / l.length;
    return l.map((v) => +(v - m).toFixed(4));
  });
  // power in dB, the same windows (the Welch sum over windows: a constant offset, the same for all)
  const db = psd.map((p) => BINS.map((f) => +(10 * Math.log10(at(p, f) + 1e-12)).toFixed(2)));
  // alpha peak: centre of gravity 7–13 Hz over the back channels (all good ones if none)
  const back = BACK.map((n) => names.indexOf(n)).filter((i) => i >= 0 && good[i]);
  const use = back.length ? back : good.flatMap((g, i) => (g ? [i] : []));
  const f0 = Math.ceil(7 / hz),
    f1 = Math.floor(13 / hz);
  let num = 0,
    den = 0;
  for (let f = f0; f <= f1; f++) {
    const p = use.reduce((a, i) => a + psd[i][f] - (psd[i][f0] + psd[i][f1]) / 2, 0);
    if (p > 0) ((num += p * f * hz), (den += p));
  }
  return { iaf: den ? num / den : 10, spec, db, good };
}

module.exports = { brainPrint, BINS };
