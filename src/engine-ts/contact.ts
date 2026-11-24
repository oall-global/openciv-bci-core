// Port of engine/contact.py: per-electrode contact from saturation, the reported band / mains /
// share and whole-cap features, and the worn judgement (Wear).
import { detrend, hann, median, power, round, std } from './dsp';
import type { RailState } from './rail';

export const REFERENCE_OFF = 12;
const TEXT: Record<string, string> = {
  ok: '正常',
  poor: '接触差',
  off: '未接触',
  unknown: '无信号',
};

function spectra(x: number[][], rate: number, maxHz: number) {
  const n = x[0].length,
    w = hann(n);
  let ww = 0;
  for (const v of w) ww += v * v;
  const df = rate / n,
    maxBin = Math.min(Math.floor(n / 2), Math.floor(maxHz / df));
  const rows = x.map(detrend);
  const psd = rows.map((r) => {
    const y = r.map((v, i) => v * w[i]);
    return Array.from(power(y, maxBin), (p) => (2 * p) / (rate * ww));
  });
  return { rows, psd, df };
}
const bandSum = (p: number[], df: number, lo: number, hi: number) => {
  let s = 0;
  for (let k = 0; k < p.length; k++) if (k * df >= lo && k * df <= hi) s += p[k];
  return s * df;
};

export function features(x: number[][], rate: number) {
  const { psd, df } = spectra(x, rate, 62);
  const band = psd.map((p) => bandSum(p, df, 1, 40));
  const mains = psd.map((p) => bandSum(p, df, 48, 52) + bandSum(p, df, 58, 62));
  return {
    band: band.map(Math.sqrt),
    mains: mains.map(Math.sqrt),
    share: band.map((b, i) => mains[i] / Math.max(b + mains[i], 1e-12)),
  };
}

export function wearFeatures(x: number[][], rate: number) {
  const high = rate / 2 > 100;
  const { rows, psd, df } = spectra(x, rate, high ? 95 : 47);
  const hf = psd.map((p) => Math.sqrt(high ? bandSum(p, df, 65, 95) : bandSum(p, df, 41, 47)));
  const band = psd.map((p) => bandSum(p, df, 1, 40));
  const keep = rows.filter((r) => std(r) > 1e-9);
  let corr = NaN;
  if (keep.length >= 2) {
    const z = keep.map((r) => {
      const s = std(r),
        m = r.reduce((a, v) => a + v, 0) / r.length;
      return r.map((v) => (v - m) / s);
    });
    let sum = 0;
    for (let i = 0; i < z.length; i++)
      for (let j = i + 1; j < z.length; j++) {
        let c = 0;
        for (let k = 0; k < z[i].length; k++) c += z[i][k] * z[j][k];
        sum += 2 * Math.abs(c / z[i].length);
      }
    corr = sum / (z.length * (z.length - 1));
  }
  const spread = std(band.map((b) => Math.log10(Math.max(b, 1e-12))));
  return { floor: median(hf), corr, spread, hf };
}

export function classify(rail: RailState | string): [string, string] {
  if (rail === 'railed') return ['off', '饱和（超过量程 90%）'];
  if (rail === 'flat') return ['off', '信号不变'];
  if (rail === 'near') return ['poor', '接近饱和（超过量程 75%）'];
  return ['ok', '正常'];
}

export function assess(x: number[][], rate: number, railStates: string[]) {
  if (!x.length || x[0].length < rate) {
    const k = railStates.length;
    return { states: Array(k).fill('unknown'), reasons: Array(k).fill(''), reference: false };
  }
  const { band, mains, share } = features(x, rate);
  const cls = x.map((_, i) => classify(railStates[i] ?? ''));
  const states = cls.map((c) => c[0]);
  const w = wearFeatures(x, rate);
  const r = (v: number, d: number) => (Number.isFinite(v) ? round(v, d) : null);
  return {
    states,
    reasons: cls.map((c) => c[1]),
    band: band.map((v) => round(v, 1)),
    mains: mains.map((v) => round(v, 1)),
    share: share.map((v) => round(v, 2)),
    reference: states.filter((s) => s === 'off').length >= REFERENCE_OFF,
    floor: r(w.floor, 2),
    corr: r(w.corr, 3),
    spread: r(w.spread, 3),
    hf: w.hf.map((v) => round(v, 2)),
  };
}

export function demo(quality: string[]) {
  const m: Record<string, string> = { good: 'ok', warn: 'poor', bad: 'off' };
  const states = quality.map((q) => m[q] ?? 'unknown');
  return { states, reasons: states.map((s) => TEXT[s]), reference: false };
}

// The worn judgement (see engine/contact.py WEAR and Wear for the reasoning).
export const WEAR = {
  RAIL_MAX: 90,
  WINDOW: 30,
  MISSES: 6,
  OFF: 4,
  OFF_OF: 5,
  AGAIN: 5,
  AGAIN_MISSES: 1,
};

export function wearVotes(railPercent?: (number | null)[] | null, th = WEAR) {
  const rails = (railPercent ?? []).filter((p): p is number => p !== null);
  return [!rails.length || median(rails) < th.RAIL_MAX];
}

// Not worn: every electrode shows as not in contact (gray: 'unknown'; 'off' is a saturated one,
// 需调整), whatever its signal (contact.py unworn).
export function unworn(c: Record<string, unknown>) {
  const states = c.states as string[] | undefined;
  if (c.worn === false && states?.length) {
    c.states = states.map(() => 'unknown');
    c.reasons = states.map(() => '未佩戴');
  }
  return c;
}

export class Wear {
  useProbe = false;
  probeOk = false;
  state: boolean | null = null;
  run = 0;
  misses = 0;
  recent: boolean[] = [];
  constructor(
    public again = false,
    public th = WEAR,
  ) {}
  probed() {
    this.probeOk = true;
  }
  update(railPercent?: (number | null)[] | null) {
    const th = this.th;
    const need = this.again ? th.AGAIN : th.WINDOW;
    const votes = wearVotes(railPercent, th);
    let ok = votes.every(Boolean);
    if (this.useProbe && this.state !== true) ok = this.probeOk && ok;
    this.recent = [...this.recent, ok].slice(-th.OFF_OF);
    const failing =
      this.recent.length === th.OFF_OF && this.recent.filter((v) => !v).length >= th.OFF;
    if (this.state === true) {
      if (failing) {
        this.state = false;
        this.run = this.misses = 0;
        this.probeOk = false;
      }
    } else {
      if (ok) this.run += 1;
      else if (this.run) {
        this.misses += 1;
        this.run += 1;
        if (this.misses > (this.again ? th.AGAIN_MISSES : th.MISSES) || failing) {
          this.run = this.misses = 0;
          this.probeOk = false;
        }
      }
      if (this.run >= need) {
        this.state = true;
        this.run = this.misses = 0;
        this.again = true;
      } else if (failing || (this.state === null && this.recent.length === th.OFF_OF && !this.run))
        this.state = false;
    }
    return {
      worn: this.state,
      wornVotes: votes,
      wornHold: this.state !== true ? this.run : 0,
      wornNeed: need,
      wornAgain: this.again,
    };
  }
}
