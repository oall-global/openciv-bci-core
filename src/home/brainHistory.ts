// Band power history for 运行画面 (BrainView), collected in the background from the moment the
// device streams, whatever page is open, so the baseline exists before the page is opened.
// The baseline (median of the last 60 s per band × electrode) is saved on this computer and
// used at the next start until enough new data has come in.
import type { AlphaFrame, Frame } from '../types';
import { electrodeNames } from '../electrodes';

export const BANDS = [
  ['delta', 'δ', 1, 4],
  ['theta', 'θ', 4, 8],
  ['alpha', 'α', 8, 13],
  ['beta', 'β', 13, 30],
  ['gamma', 'γ', 30, 40],
] as const;
// Shown in this order: easiest to see with dry electrodes first (α rises within seconds of
// closing the eyes), then β (mixed with muscle), θ, δ (eye movements), γ (mostly muscle).
export const BAND_ORDER = [2, 3, 1, 0, 4].map((k) => [...BANDS[k], k] as const);
export const STEP = 0.5; // s between frames
const BASELINE = 60; // s of history for the baseline
export const READY = 20; // frames (10 s) before the live baseline is used
const KEEP = 30 * 60; // s kept for replay
const SAVE_EVERY = 60; // frames (30 s)
const KEY = 'neurolink.brainBaseline.v2'; // v1 mixed simulated and real data

// One 0.5 s frame: band power, log(power / baseline) per band × electrode (NaN where the
// electrode is unusable; null before any baseline), and what each running task recognised.
export type Brain = {
  t: number;
  p: number[][];
  ok: boolean[]; // per electrode: usable (touching, not flat or railed) at this frame
  r: number[][] | null;
  rec: Record<string, [string, number]>;
};

const frames: Brain[] = [];
let dropped = 0; // frames removed from the front (replay positions shift by this)
let epoch = 0; // increases when the stream restarts
let source: 'live' | 'saved' | null = null;
const listeners = new Set<() => void>();

function loadSaved(): { names: string; p: number[][] } | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}
let saved = loadSaved();
// Only for the same electrode positions (checked at use: the montage is applied after start).
const savedBase = () =>
  saved && saved.names === electrodeNames.join(',') && sourceKind === 'device' ? saved.p : null;

function bandPowers(alpha: AlphaFrame): number[][] {
  const f = alpha.frequencies,
    df = f.length > 1 ? f[1] - f[0] : 1;
  return BANDS.map(([, , lo, hi]) =>
    alpha.psd.map((row) => {
      let s = 0;
      for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] < hi) s += row[i] * df;
      return s;
    }),
  );
}
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : NaN;
};

let since = 0; // frames before this index are left out of the baseline (重置基线)
let sourceKind = '';
// Start of the current run of wearing evidence that is not yet confirmed (30 s, engine
// contact.Wear). Those frames build the baseline; if the run breaks (the cap was only held in
// the hand), they are taken out again.
let pendingT: number | null = null;
// Start the baseline again: the next 10 s of usable signal (e.g. after putting the cap on).
export function resetBaseline() {
  since = frames.length;
  listeners.forEach((l) => l());
}

export function pushAlpha(alpha: AlphaFrame, frame: Frame | null, demo = false) {
  // Baselines of the simulated and the real device never mix.
  const kind = demo ? 'demo' : 'device';
  if (kind !== sourceKind) {
    sourceKind = kind;
    since = frames.length;
  }
  const last = frames[frames.length - 1];
  if (last && alpha.timestamp - last.t < STEP - 0.05 && alpha.timestamp >= last.t) return;
  if (last && alpha.timestamp < last.t) {
    frames.length = 0; // new stream
    epoch++;
  }
  const p = bandPowers(alpha);
  // Usable: the cap is worn or being confirmed (whole-cap judgement), the electrode not off,
  // the signal not flat.
  const k = frame?.contact;
  const confirming = !demo && k?.worn !== true && !!k?.wornHold;
  if (confirming) pendingT ??= alpha.timestamp;
  else {
    if (pendingT !== null && k?.worn !== true)
      for (const x of frames) if (x.t >= pendingT) x.ok = x.ok?.map(() => false);
    pendingT = null;
  }
  const worn = demo || k?.worn === true || confirming;
  const ok = electrodeNames.map(
    (_, c) =>
      worn &&
      frame?.contact?.states[c] !== 'off' &&
      !['flat', 'amplitude'].includes(alpha.flags[c] ?? ''),
  );
  // Baseline: per electrode, only frames where it was usable (not before 重置基线); needs
  // 10 s of usable signal on most electrodes.
  const recent = frames.slice(since).filter((x) => alpha.timestamp - x.t <= BASELINE);
  const usableCount = electrodeNames.map((_, c) => recent.filter((x) => x.ok?.[c]).length);
  let base: number[][] | null = null;
  if (usableCount.filter((n) => n >= READY).length >= electrodeNames.length / 2) {
    base = BANDS.map((_, k) =>
      electrodeNames.map((_, c) =>
        usableCount[c] >= READY
          ? median(
              recent
                .filter((x) => x.ok?.[c])
                .map((x) => x.p[k][c])
                .filter((v) => v > 0),
            )
          : NaN,
      ),
    );
    source = 'live';
  } else if (savedBase()) {
    base = savedBase();
    source = 'saved';
  } else source = null;
  const r = base
    ? BANDS.map((_, k) =>
        electrodeNames.map((_, c) => {
          const b = base![k][c];
          return p[k][c] > 0 && b > 0 && ok[c] ? Math.log(p[k][c] / b) : NaN;
        }),
      )
    : null;
  frames.push({
    t: alpha.timestamp,
    p,
    ok,
    r,
    rec: {},
  });
  const drop = frames.findIndex((x) => alpha.timestamp - x.t <= KEEP);
  if (drop > 0) {
    frames.splice(0, drop);
    dropped += drop;
    since = Math.max(0, since - drop);
  }
  if (source === 'live' && !demo && frames.length % SAVE_EVERY === 0 && base) {
    saved = { names: electrodeNames.join(','), p: base };
    localStorage.setItem(KEY, JSON.stringify(saved));
  }
  listeners.forEach((l) => l());
}

export const brainHistory = {
  frames,
  get dropped() {
    return dropped;
  },
  get epoch() {
    return epoch;
  },
  get source() {
    return source;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
