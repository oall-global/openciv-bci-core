// 主图 display smoothing: the brain follows the 0.5 s frames gently instead of switching every
// frame. Display only: the frames, tasks and recordings keep the real values.
//   - every frame on screen moves towards the latest values (time constant TAU, at most RATE
//     per second), so colours rise and fall instead of jumping
//   - an electrode keeps its colour while a frame is an artefact (blink, jaw, movement: δ or γ
//     far above baseline) or briefly unusable; after HOLD s the real state is shown
//   - white (the top of the palette) only after the value has stayed there for SUSTAIN s
import { BANDS, STEP, type Brain } from './brainHistory';

export const TAU = 0.6; // s
const RATE = 2; // log units per second, at most
const HOLD = 3; // s
const ARTIFACT = Math.log(5); // δ or γ above 5× baseline
const WHITE = Math.log(1.5); // the palette turns from amber to white above about 1.5×
const SUSTAIN = 0.8; // s
const B = BANDS.length;

export class DisplaySmooth {
  // log(power / baseline) per band × electrode as shown; NaN = not shown
  shown: number[][];
  private target: number[][] | null = null;
  private held: number[]; // s an electrode has been kept at its earlier value
  private high: number[][]; // s the target has been in the white range
  private lastT = NaN;

  constructor(private n = 16) {
    this.shown = Array.from({ length: B }, () => new Array(n).fill(NaN));
    this.held = new Array(n).fill(0);
    this.high = Array.from({ length: B }, () => new Array(n).fill(0));
  }

  get ready() {
    return this.target !== null;
  }

  // A new 0.5 s frame (the latest of brainHistory).
  push(f: Brain | undefined) {
    if (!f || f.t === this.lastT) return;
    const dt = Number.isFinite(this.lastT) ? Math.min(2, Math.max(0, f.t - this.lastT)) : STEP;
    this.lastT = f.t;
    const r = f.r;
    if (!r) {
      this.target = null;
      return;
    }
    const prev = this.target;
    const next = r.map((row) => [...row]);
    for (let c = 0; c < this.n; c++) {
      const bad = r.some((row) => !Number.isFinite(row[c]));
      const artifact = r[0][c] > ARTIFACT || r[B - 1][c] > ARTIFACT;
      const before = prev && prev.every((row) => Number.isFinite(row[c]));
      if ((bad || artifact) && before && this.held[c] < HOLD) {
        this.held[c] += dt;
        for (let b = 0; b < B; b++) next[b][c] = prev![b][c];
      } else if (!bad && !artifact) this.held[c] = 0;
    }
    this.target = next;
  }

  // Advance the picture by dt seconds; true while it is still changing.
  step(dt: number) {
    dt = Math.min(dt, 0.1);
    const t = this.target,
      k = 1 - Math.exp(-dt / TAU);
    let moving = false;
    for (let b = 0; b < B; b++)
      for (let c = 0; c < this.n; c++) {
        const goal = t?.[b][c] ?? NaN,
          s = this.shown[b][c];
        if (!Number.isFinite(goal)) {
          moving ||= Number.isFinite(s);
          this.shown[b][c] = NaN;
          this.high[b][c] = 0;
          continue;
        }
        this.high[b][c] = goal > WHITE ? this.high[b][c] + dt : 0;
        const capped = this.high[b][c] >= SUSTAIN ? goal : Math.min(goal, WHITE);
        if (!Number.isFinite(s)) {
          this.shown[b][c] = capped;
          moving = true;
          continue;
        }
        const d = Math.max(-RATE * dt, Math.min(RATE * dt, (capped - s) * k));
        this.shown[b][c] = s + d;
        moving ||= Math.abs(capped - s) > 0.003;
      }
    return moving;
  }
}
