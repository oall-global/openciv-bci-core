// The card of a recording in the mini program (moment/pages/card), the desktop's latest (src/data/
// cardMaker.ts, card11): drawCard (src/home/momentCard.ts) on the real sky of that moment, in the
// middle α's share (8–12 Hz of 2–40 Hz) per electrode on the brain seen from above in the 12-step
// rainbow with its bar (src/data/recordArt.ts cardHero), the three figures and 多通道频段功率时序.
// Its figures come from the recording's raw EEG with the desktop's own code: the 0.5 s frames and
// the chart's 1 s every 0.3 s (electron/bandFrames.cjs), the spectra (electron/brainPrint.cjs).
// The brain from above is drawn here in 2D from the 3D brain's cortex points (lib/brain-points.js,
// the desktop's model), coloured as BrainScene.colorBy: its 4 nearest electrodes, weighted.
import { surface, brainArt, skyArt } from '../home/momentArt';
import {
  CARD_H,
  CARD_W,
  CARD_LINES,
  SKY_OPEN,
  cardData,
  drawCard,
  type Wave,
} from '../home/momentCard';
import type { Brain } from '../home/brainHistory';
import { electrodes } from '../electrodes';
import { readChannels, saveWords, metaOf } from './recorder';
import { STEPS, rainbow, drawBrainTop, type Points } from './brainTop';
export { saveWords, metaOf };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bandFrames, waveEnvelope } = require('../../electron/bandFrames.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { brainPrint } = require('../../electron/brainPrint.cjs');

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// the desktop's scene for a recording (src/home/BrainRecord.tsx RECORD; that module is React)
const RECORD = {
  id: 'record',
  name: '脑电记录',
  title: '脑电记录',
  c1: '#a8f0d4',
  c2: '#3fc79a',
  glow: 'rgba(95,211,164,',
};
const BRAIN_IMAGE = '/moment/images/brain-side.png';
const offscreen = (w: number, h: number) =>
  wx.createOffscreenCanvas({ type: '2d', width: w, height: h }) as HTMLCanvasElement;
surface.canvas = offscreen;
surface.brainImage = () =>
  new Promise((resolve, reject) => {
    const img = (offscreen(1, 1) as unknown as { createImage(): HTMLImageElement }).createImage();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error('无法加载大脑图像'));
    img.src = BRAIN_IMAGE;
  });

export { CARD_W, CARD_H };
type Print = { iaf: number; spec: number[][]; good: boolean[] };

// ---- α on the brain from above (recordArt.ts) ------------------------------------------------
// α's share per electrode (null: no signal), as recordArt.ts
function alpha(p: Print) {
  return p.spec.map((sp, i) => {
    if (!p.good[i]) return null;
    const pw = sp.map((v) => 10 ** v);
    return pw.slice(6, 11).reduce((x, y) => x + y, 0) / pw.reduce((x, y) => x + y, 0); // 8–12 Hz
  });
}

/** The middle of the card (W × H): the α brain large and its bar (cardHero) */
function cardHero(p: Print, points: Points, W: number, H: number) {
  const a = alpha(p),
    ok = a.filter((x): x is number => x != null);
  if (!ok.length) return null;
  const lo = Math.min(...ok),
    hi = Math.max(...ok);
  const out = offscreen(W, H);
  const g = out.getContext('2d')!,
    size = H * 0.8;
  drawBrainTop(
    g,
    points,
    a,
    (x) => rainbow((x - lo) / (hi - lo || 1)),
    W / 2,
    size / 2 + H * 0.02,
    size,
  );
  const bw = W * 0.4,
    bx = (W - bw) / 2,
    by = H * 0.87,
    bh = 12;
  for (let k = 0; k < STEPS; k++) {
    g.fillStyle = `rgb(${rainbow((k + 0.5) / STEPS).join(',')})`;
    g.fillRect(bx + (k * bw) / STEPS, by, bw / STEPS + 0.5, bh);
  }
  g.fillStyle = '#8a9a93';
  for (let k = 0; k <= 6; k++) g.fillRect(bx + (k * bw) / 6 - 1, by + bh, 2, 8);
  g.fillStyle = '#c9d4cf';
  g.font = '22px "IBM Plex Mono", Consolas, monospace';
  g.textAlign = 'left';
  g.fillText(`${(lo * 100).toFixed(1)}%`, bx, by + bh + 36);
  g.textAlign = 'right';
  g.fillText(`${(hi * 100).toFixed(1)}%`, bx + bw, by + bh + 36);
  return out;
}

export type Prepared = {
  input: Parameters<typeof cardData>[0] & {
    start: Date;
    marks: { t: number; label: string }[];
  };
  art: {
    sky: HTMLCanvasElement | null;
    brain: HTMLCanvasElement | null;
    hero: HTMLCanvasElement | null;
  };
  usable: boolean;
};

/** Everything the card needs from one recording (a few seconds on a phone) */
export async function prepare(
  id: string,
  marks: { t: number; label: string }[],
  points: Points,
): Promise<Prepared> {
  const { channels, rate, meta } = readChannels(id);
  const ch = channels.map((c) => Array.from(c));
  const startS = meta.start / 1000;
  const frames: Brain[] = bandFrames(ch, rate, startS);
  const lines: Brain[] = bandFrames(ch, rate, -0.5, false, 1, 0.3);
  const wave: Wave = waveEnvelope(ch, rate);
  const print: Print | null = brainPrint(
    ch,
    rate,
    electrodes.map((e) => e.name),
  );
  const start = new Date(meta.start);
  const usable = frames.filter((f) => f.r);
  const hero = print ? cardHero(print, points, CARD_W, 625) : null;
  // without spectra (too short), 神经光流 as on the desktop
  const brain = hero || !usable.length ? null : await brainArt(usable).catch(() => null);
  return {
    input: { frames, lines, wave, start, seconds: meta.seconds, rate, marks },
    art: {
      sky: skyArt(start, CARD_W, CARD_H, undefined, undefined, undefined, SKY_OPEN),
      brain,
      hero,
    },
    usable: usable.length >= 4,
  };
}

/** One frame of the card on ctx (1080 × 1620): progress 0..1 of the chart, t s, stamp 0..1 */
export function draw(
  ctx: CanvasRenderingContext2D,
  prepared: Prepared,
  words: { title: string; note: string; sign: string; marks: { t: number; label: string }[] },
  progress: number,
  t: number,
  stamp: number,
  cache: { data?: ReturnType<typeof cardData>; key?: string },
) {
  const full = { ...prepared.input, ...words, scene: RECORD };
  const key = JSON.stringify(words.marks);
  if (!cache.data || cache.key !== key) {
    cache.data = cardData(full);
    cache.key = key;
  }
  drawCard(ctx, full, cache.data, progress, t, stamp, prepared.art, CARD_LINES);
}
