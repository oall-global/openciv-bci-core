// Port of engine/wearprobe.py: while the cap is not worn, measure Fp1's impedance with the
// 6 nA lead-off tone (31.2 Hz); the impedance follows OpenBCI GUI's conversion (MIT, see
// engine/connection_check.py). Switching the tone on and off needs the stream restarted.
import { mean, std } from './dsp';

export const CHANNEL = 0; // Fp1
const SELECTORS = '12345678QWERTYUI';
export const INJECT = [`x${SELECTORS[CHANNEL]}000100X`, `z${SELECTORS[CHANNEL]}01Z`];
export const RESTORE = [`z${SELECTORS[CHANNEL]}00Z`, `x${SELECTORS[CHANNEL]}060110X`];
const ON = 3;
const SETTLE = 1;

export type ProbeIO = { commands: (list: string[]) => Promise<void> };

// Impedance (kΩ) from 3 s of a channel carrying the test tone; as connection_check.contact_result
// but band-limited by a narrow DFT at the tone instead of BrainFlow's filters.
export function contactResult(x: number[], rate: number) {
  if (x.length < rate * 3 || !x.every(Number.isFinite)) return { kohm: null, quality: 'unknown' };
  if (Math.max(...x.map(Math.abs)) > 4.5e6 * 0.9) return { kohm: null, quality: 'bad' };
  const seg = x.slice(-rate);
  const m = mean(seg);
  let re = 0,
    im = 0;
  for (let i = 0; i < seg.length; i++) {
    const a = (2 * Math.PI * 31.25 * i) / rate;
    re += (seg[i] - m) * Math.cos(a);
    im += (seg[i] - m) * Math.sin(a);
  }
  const amp = (2 * Math.hypot(re, im)) / seg.length; // tone amplitude (µV)
  const rms = amp / Math.SQRT2;
  const kohm = Math.max(0, (Math.SQRT2 * rms * 1e-6) / 6e-9 - 2200) / 1000;
  const total = std(seg);
  if (kohm <= 0 || total < 0.2 || rms / total < 0.5)
    return { kohm: Math.round(kohm * 10) / 10, quality: 'unknown' };
  return {
    kohm: Math.round(kohm * 10) / 10,
    quality: kohm < 750 ? 'good' : kohm <= 2500 ? 'warn' : 'bad',
  };
}

export class WearProbe {
  active = false;
  failed = false;
  switching = false;
  private samples: number[] = [];
  private good = 0;
  private since = 0;
  result: { kohm: number | null; quality: string } | null = null;
  constructor(
    private io: ProbeIO | null,
    private rate: number,
  ) {}
  usable() {
    return !!this.io && !this.failed && !this.switching;
  }
  async start() {
    if (!this.io || this.active) return;
    this.active = this.switching = true;
    try {
      await this.io.commands(INJECT);
      this.samples = [];
      this.good = 0;
      this.since = performance.now() / 1000;
    } catch {
      this.failed = true;
      await this.io.commands(RESTORE).catch(() => {});
      this.active = false;
    }
    this.switching = false;
  }
  async stop() {
    if (!this.io || !this.active) return;
    this.switching = true;
    try {
      await this.io.commands(RESTORE);
      this.active = false;
    } catch {
      this.failed = true;
      this.active = false;
    }
    this.switching = false;
  }
  feed(x: number[]) {
    if (!this.active || this.switching || performance.now() / 1000 - this.since < SETTLE) return;
    this.samples.push(...x);
    if (this.samples.length > this.rate * 4)
      this.samples.splice(0, this.samples.length - this.rate * 4);
  }
  // about once a second while active: true once the impedance has been acceptable ON times
  measure() {
    if (!this.active || this.samples.length < this.rate * 3) return false;
    this.result = contactResult(this.samples.slice(-this.rate * 3), this.rate);
    const ok =
      this.result.kohm !== null &&
      (this.result.quality === 'good' || this.result.quality === 'warn');
    this.good = ok ? this.good + 1 : 0;
    return this.good >= ON;
  }
  report() {
    return {
      channel: CHANNEL,
      active: this.active,
      failed: this.failed,
      kohm: this.active ? (this.result?.kohm ?? null) : null,
      quality: this.active ? (this.result?.quality ?? null) : null,
    };
  }
}
