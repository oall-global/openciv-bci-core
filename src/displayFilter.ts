// The waveform processing of OpenBCI GUI (DataProcessing.pde, default filter settings), so the
// traces and µVrms read the same as there:
//   1. band-pass 5–50 Hz, Butterworth order 4 (BrainFlow perform_bandpass: causal, from rest);
//   2. 50 Hz and 60 Hz removal (BrainFlow remove_environmental_noise: Butterworth order 4
//      band-stop 48–52 / 58–62 Hz, run forward then backward with the state carried over);
// applied to the whole buffer on every update. µVrms = standard deviation (÷ n) of the last
// second of the filtered signal. tests/display-filter.cjs checks this against BrainFlow.
type C = [number, number];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const csqrt = ([re, im]: C): C => {
  const r = Math.hypot(re, im);
  const x = Math.sqrt((r + re) / 2),
    y = Math.sqrt(Math.max(0, (r - re) / 2));
  return [x, im < 0 ? -y : y];
};
type Section = { b: number[]; a: number[] }; // a = [a1, a2] (a0 = 1)

// Butterworth band-pass / band-stop of the given order as second-order sections (the design of
// scipy.signal.butter: analog prototype, band transform, bilinear transform with pre-warping).
function butter(order: number, lo: number, hi: number, fs: number, stop: boolean): Section[] {
  const warp = (f: number) => 2 * fs * Math.tan((Math.PI * f) / fs);
  const w1 = warp(lo),
    w2 = warp(hi),
    bw = w2 - w1,
    wo2 = w1 * w2;
  const poles: C[] = [];
  for (let k = 0; k < order; k++) {
    const th = (Math.PI * (2 * k - order + 1)) / (2 * order);
    const p: C = [-Math.cos(th), -Math.sin(th)];
    // low-pass prototype pole → two band poles
    const q: C = stop ? cdiv([bw / 2, 0], p) : [(p[0] * bw) / 2, (p[1] * bw) / 2];
    const r = csqrt([cmul(q, q)[0] - wo2, cmul(q, q)[1]]);
    poles.push([q[0] + r[0], q[1] + r[1]], [q[0] - r[0], q[1] - r[1]]);
  }
  const fs2 = 2 * fs;
  const z = (s: C): C => cdiv([fs2 + s[0], s[1]], [fs2 - s[0], -s[1]]);
  const zp = poles.map(z).filter((p) => p[1] >= 0); // one of each conjugate pair
  // zeros: band-pass at +1 and −1; band-stop at e^(±jθ) with s = ±j·wo
  const zs = z([0, Math.sqrt(wo2)]);
  const b = stop ? [1, -2 * zs[0], 1] : [1, 0, -1];
  const sections = zp.map((p) => ({ b: b.slice(), a: [-2 * p[0], p[0] * p[0] + p[1] * p[1]] }));
  // unit gain at the pass-band centre (band-pass) or at 0 Hz (band-stop)
  const at: C = stop ? [1, 0] : z([0, Math.sqrt(wo2)]);
  let g: C = [1, 0];
  for (const s of sections) {
    const z1 = cdiv([1, 0], at),
      z2 = cmul(z1, z1);
    const num: C = [s.b[0] + s.b[1] * z1[0] + s.b[2] * z2[0], s.b[1] * z1[1] + s.b[2] * z2[1]];
    const den: C = [1 + s.a[0] * z1[0] + s.a[1] * z2[0], s.a[0] * z1[1] + s.a[1] * z2[1]];
    g = cmul(g, cdiv(num, den));
  }
  const k = 1 / Math.hypot(g[0], g[1]);
  sections[0].b = sections[0].b.map((v) => v * k);
  return sections;
}

// Transposed direct form II; state = [z1, z2] per section, kept between calls (passes).
function run(x: Float64Array, sections: Section[], state: Float64Array) {
  sections.forEach((s, i) => {
    let z1 = state[2 * i],
      z2 = state[2 * i + 1];
    const [b0, b1, b2] = s.b,
      [a1, a2] = s.a;
    for (let n = 0; n < x.length; n++) {
      const v = x[n],
        y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[n] = y;
    }
    state[2 * i] = z1;
    state[2 * i + 1] = z2;
  });
}

const designs = new Map<number, { bp: Section[]; stops: Section[][] }>();
function design(rate: number) {
  let d = designs.get(rate);
  if (!d) {
    d = {
      bp: butter(4, 5, Math.min(50, rate / 2 - 1), rate, false),
      stops: [50, 60]
        .filter((c) => c + 2 < rate / 2)
        .map((c) => butter(4, c - 2, c + 2, rate, true)),
    };
    designs.set(rate, d);
  }
  return d;
}

export function displayFilter(values: number[], rate: number): number[] {
  if (!values.length) return values;
  const d = design(rate);
  const x = Float64Array.from(values);
  run(x, d.bp, new Float64Array(d.bp.length * 2));
  for (const s of d.stops) {
    const state = new Float64Array(s.length * 2);
    run(x, s, state);
    x.reverse();
    run(x, s, state);
    x.reverse();
  }
  return Array.from(x);
}

// µVrms as shown next to each channel: standard deviation (÷ n) of the last second.
export function uvrms(filtered: number[], rate: number) {
  const n = Math.min(filtered.length, Math.round(rate));
  if (!n) return NaN;
  let m = 0;
  for (let i = filtered.length - n; i < filtered.length; i++) m += filtered[i];
  m /= n;
  let s = 0;
  for (let i = filtered.length - n; i < filtered.length; i++) s += (filtered[i] - m) ** 2;
  return Math.sqrt(s / n);
}
