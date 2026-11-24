// 神经层 (design/neural-sim, stages 1 and 2): simulated neural activity driven by the EEG.
//   computePlv  phase locking value between electrodes per band, from the raw signal
//   NeuralSim   one phase oscillator per electrode and band; amplitude from the band power
//               relative to baseline, coupling from the PLV (Kuramoto), so strongly locked
//               electrodes swing together
// Rhythms are shown slowed down (DISPLAY_SPEED) so a 10 Hz wave is visible on a 60 Hz screen.

export const BAND_HZ = [2.5, 6, 10, 20, 35]; // δ θ α β γ centre frequencies
export const BAND_RANGES: [number, number][] = [
  [1, 4],
  [4, 8],
  [8, 13],
  [13, 30],
  [30, 40],
];
// Cold, restrained palette (δ θ α β γ): indigo → azure → cyan → ice → near white.
export const BAND_COLORS = ['#6a74f0', '#3f8fff', '#35d7d0', '#9fd2ff', '#e6f2ff'];
export const DISPLAY_SPEED = 0.12; // α about 1.2 pulses per second: calm, not a strobe
const N = 16,
  B = 5;

// ---- PLV ---------------------------------------------------------------------------------
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inverse ? 2 : -2) * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k],
          ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// PLV[b][i*16+j] in 0..1 over the last 512 samples (about 2 s at 250 Hz): band-limited
// analytic signal per channel (FFT, keep positive frequencies of the band), phase difference.
// lag[b][i*16+j]: the mean phase difference, phase i minus phase j (radians; > 0: i leads).
export function computePlv(
  buffer: number[][],
  rate: number,
): { plv: Float32Array[]; lag: Float32Array[] } | null {
  const n = 512;
  if (buffer.length < N || buffer.some((ch) => (ch?.length ?? 0) < n)) return null;
  const spectra = buffer.slice(0, N).map((ch) => {
    const x = ch.slice(-n);
    const mean = x.reduce((a, v) => a + v, 0) / n;
    const re = new Float64Array(n),
      im = new Float64Array(n);
    for (let i = 0; i < n; i++)
      re[i] = (x[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fft(re, im, false);
    return [re, im] as const;
  });
  const out: Float32Array[] = [],
    lags: Float32Array[] = [];
  for (const [lo, hi] of BAND_RANGES) {
    const k0 = Math.ceil((lo * n) / rate),
      k1 = Math.floor((hi * n) / rate);
    // unit phasors of the analytic signal per channel and sample
    const ph = spectra.map(([sr, si]) => {
      const re = new Float64Array(n),
        im = new Float64Array(n);
      for (let k = k0; k <= k1; k++) {
        re[k] = 2 * sr[k];
        im[k] = 2 * si[k];
      }
      fft(re, im, true);
      for (let i = 0; i < n; i++) {
        const m = Math.hypot(re[i], im[i]) || 1;
        re[i] /= m;
        im[i] /= m;
      }
      return [re, im] as const;
    });
    const plv = new Float32Array(N * N),
      lag = new Float32Array(N * N);
    // skip the window edges (the Hann taper makes their phase unreliable)
    const from = n / 8,
      to = n - n / 8;
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
        let sr = 0,
          si = 0;
        const [ar, ai] = ph[i],
          [br, bi] = ph[j];
        for (let t = from; t < to; t++) {
          sr += ar[t] * br[t] + ai[t] * bi[t];
          si += ai[t] * br[t] - ar[t] * bi[t];
        }
        const v = Math.hypot(sr, si) / (to - from);
        plv[i * N + j] = plv[j * N + i] = v;
        lag[i * N + j] = Math.atan2(si, sr);
        lag[j * N + i] = -lag[i * N + j];
      }
    out.push(plv);
    lags.push(lag);
  }
  return { plv: out, lag: lags };
}

// ---- oscillators ---------------------------------------------------------------------------
export class NeuralSim {
  // per electrode and band: amp in 0..1 (synchrony shown), phase in radians
  amp = new Float32Array(N * B);
  phase = new Float32Array(N * B);
  private target = new Float32Array(N * B);
  plv: Float32Array[] | null = null;

  constructor() {
    for (let i = 0; i < this.phase.length; i++) this.phase[i] = Math.random() * Math.PI * 2;
  }

  // ratios[b][c] = log(power / baseline), NaN where unusable
  setRatios(ratios: number[][] | null) {
    for (let b = 0; b < B; b++)
      for (let c = 0; c < N; c++) {
        const r = ratios?.[b]?.[c];
        // below baseline → little synchrony; 1× → some; 2× and above → full
        this.target[c * B + b] =
          r === undefined || !Number.isFinite(r)
            ? 0.15 // no baseline yet / unusable electrode: a little activity, not none
            : Math.max(0, Math.min(1, 0.3 + (Math.exp(r) - 1) * 0.7));
      }
  }

  step(dt: number) {
    dt = Math.min(dt, 0.05);
    const k = 1 - Math.exp(-dt * 3);
    for (let i = 0; i < this.amp.length; i++) this.amp[i] += (this.target[i] - this.amp[i]) * k;
    const next = new Float32Array(this.phase);
    for (let b = 0; b < B; b++) {
      const w = 2 * Math.PI * BAND_HZ[b] * DISPLAY_SPEED;
      const plv = this.plv?.[b];
      for (let i = 0; i < N; i++) {
        let pull = 0;
        if (plv)
          for (let j = 0; j < N; j++)
            if (j !== i)
              pull += plv[i * N + j] * Math.sin(this.phase[j * B + b] - this.phase[i * B + b]);
        next[i * B + b] = this.phase[i * B + b] + (w + 1.5 * pull) * dt;
      }
    }
    this.phase = next;
  }
}
