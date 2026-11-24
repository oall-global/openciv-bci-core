// Simulated device for the TypeScript engine: 16 channels at `rate` with background noise, a
// posterior alpha rhythm that rises every half minute ("eyes closed" for 10 s), frontal blinks,
// a little mains hum and a DC offset like a real amplifier. Deterministic per seed.
import { electrodes } from '../electrodes';

export class DemoSource {
  private n = 0;
  private seed: number;
  private state: number | null = null; // task demo pattern (0 = alpha up, 1 = beta up, …)
  constructor(
    public rate = 250,
    seed = 1,
  ) {
    this.seed = seed;
  }
  private rand() {
    // xorshift32 → uniform, then a Gaussian by Box–Muller
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0 || 1;
    return this.seed / 4294967296;
  }
  private gauss() {
    const u = Math.max(1e-12, this.rand()),
      v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  setState(index: number | null) {
    this.state = index;
  }
  // The next `count` samples: channels × count (µV) and their sample indices.
  next(count: number) {
    const out = electrodes.map(() => new Array<number>(count));
    const idx: number[] = [];
    for (let j = 0; j < count; j++) {
      const t = this.n / this.rate;
      const closed = this.state === 0 || (this.state === null && t % 30 > 18 && t % 30 < 28);
      const blink = t % 7 < 0.25 ? Math.sin(((t % 7) / 0.25) * Math.PI) : 0;
      electrodes.forEach((e, c) => {
        const back = /^(O|P)/.test(e.name),
          front = /^Fp/.test(e.name);
        let v = 1500 + 200 * c; // DC offset
        v += 6 * this.gauss();
        v += (back ? (closed ? 22 : 7) : 4) * Math.sin(2 * Math.PI * 10 * t + c);
        v += (this.state === 1 ? 10 : 3) * Math.sin(2 * Math.PI * 20 * t + 2 * c);
        v += 2 * Math.sin(2 * Math.PI * 6 * t + 3 * c);
        v += 1.5 * Math.sin(2 * Math.PI * 50 * t);
        if (front) v += 120 * blink;
        out[c][j] = v;
      });
      idx.push(Math.floor(this.n / 1) % 256);
      this.n++;
    }
    return { samples: out, indices: idx };
  }
}
