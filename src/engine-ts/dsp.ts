// Small numeric helpers for the TypeScript engine, matching what numpy does in engine/*.py.

// numpy.hanning(n)
export function hann(n: number) {
  const w = new Float64Array(n);
  if (n === 1) w[0] = 1;
  else for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export const mean = (x: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
};

// x - mean - slope·(t - t̄), the linear detrend used by engine/contact.py and spectral.py
export function detrend(x: ArrayLike<number>) {
  const n = x.length,
    m = mean(x),
    tm = (n - 1) / 2;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - m) * (i - tm);
    den += (i - tm) * (i - tm);
  }
  const slope = den ? num / den : 0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] - m - slope * (i - tm);
  return out;
}

// |rfft(x)|² for bins 0..maxBin (direct DFT with cached tables: n is not a power of two)
const tables = new Map<number, { cos: Float64Array; sin: Float64Array }>();
function table(n: number) {
  let t = tables.get(n);
  if (!t) {
    const cos = new Float64Array(n),
      sin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    t = { cos, sin };
    tables.set(n, t);
  }
  return t;
}
export function power(x: ArrayLike<number>, maxBin: number) {
  const n = x.length,
    { cos, sin } = table(n);
  const out = new Float64Array(maxBin + 1);
  for (let k = 0; k <= maxBin; k++) {
    let re = 0,
      im = 0,
      idx = 0;
    for (let i = 0; i < n; i++) {
      re += x[i] * cos[idx];
      im -= x[i] * sin[idx];
      idx += k;
      if (idx >= n) idx -= n;
    }
    out[k] = re * re + im * im;
  }
  return out;
}

export function median(x: number[]) {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// population standard deviation (numpy default)
export function std(x: ArrayLike<number>) {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) * (x[i] - m);
  return x.length ? Math.sqrt(s / x.length) : NaN;
}

// numpy.trapezoid(y, x)
export function trapezoid(y: number[], x: number[]) {
  let s = 0;
  for (let i = 1; i < y.length; i++) s += ((y[i] + y[i - 1]) / 2) * (x[i] - x[i - 1]);
  return s;
}

// Python round(v, d) (half to even at exact halves is irrelevant for measured values)
export const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
