// The brain picture of a recording: α's share (8–12 Hz of 2–40 Hz, from each electrode's spectrum,
// electron/brainPrint.cjs) on the brain seen from above (forehead up), in a 12-step rainbow from
// the lowest to the highest electrode. The 数据 grid picture, and on the card the same larger
// with its bar (ticks, lowest and highest share). Drawn at 340 px and scaled, so the cortex keeps
// its points and sulci as texture.
import { electrodes } from '../electrodes';
import { BrainScene } from '../home/brainScene';

export type Print = { iaf: number; spec: number[][]; good: boolean[] };

const STOPS: [number, number[]][] = [
  [0, [38, 48, 140]],
  [0.15, [45, 90, 210]],
  [0.35, [60, 190, 230]],
  [0.5, [150, 220, 120]],
  [0.65, [240, 230, 70]],
  [0.8, [245, 150, 40]],
  [1, [215, 35, 40]],
];
const STEPS = 12;
function rainbow(t: number) {
  const q = Math.min(STEPS - 1, Math.max(0, Math.floor(t * STEPS))) / (STEPS - 1);
  let k = 0;
  while (k < STOPS.length - 2 && q > STOPS[k + 1][0]) k++;
  const [a, ca] = STOPS[k],
    [b, cb] = STOPS[k + 1],
    s = (q - a) / (b - a);
  return ca.map((x, i) => Math.round(x + (cb[i] - x) * s));
}

let scene: Promise<BrainScene> | null = null;
const brain = () =>
  (scene ??= BrainScene.create(electrodes.map((e) => e.xyz)).then((s) => {
    s.markers(false);
    s.transparent();
    return s;
  }));

// α's share per electrode (null: no signal); 10^spec is the power up to a factor per electrode,
// which a share does not depend on
function alpha(p: Print) {
  return p.spec.map((sp, i) => {
    if (!p.good[i]) return null;
    const pw = sp.map((v) => 10 ** v);
    return pw.slice(6, 11).reduce((x, y) => x + y, 0) / pw.reduce((x, y) => x + y, 0); // 8–12 Hz
  });
}

// the brain without α (a recording too short for spectra, or no electrode with signal): one grey
const GREY = [0.42, 0.46, 0.45];

/** paints α on the brain and draws it into g at (cx, cy), size × size; the range, or null when
 *  there is no α (then the brain is drawn grey) */
export async function drawBrainAlpha(
  g: CanvasRenderingContext2D,
  p: Print | null,
  cx: number,
  cy: number,
  size: number,
) {
  const a = p ? alpha(p) : [],
    ok = a.filter((v): v is number => v != null);
  const lo = ok.length ? Math.min(...ok) : 0,
    hi = ok.length ? Math.max(...ok) : 0,
    s = await brain();
  if (ok.length) s.colorBy(a, (v) => rainbow((v - lo) / (hi - lo || 1)).map((c) => c / 255));
  else
    s.colorBy(
      electrodes.map(() => 0),
      () => GREY,
    );
  const shot = document.createElement('canvas');
  shot.dataset.native = '';
  // a square of its own size (page styles must not stretch it)
  shot.style.cssText =
    'position:fixed;left:-9999px;top:0;width:340px;height:340px;max-width:none;max-height:none;min-width:0;min-height:0';
  document.body.append(shot);
  try {
    s.draw('top', shot, 1.05, true);
    g.drawImage(shot, cx - size / 2, cy - size / 2, size, size);
  } finally {
    shot.remove();
  }
  return ok.length ? { lo, hi } : null;
}

/** the middle of the enlarged card (W × H): the α brain large and its bar (grey, no bar, without α) */
export async function cardHero(p: Print | null, W: number, H: number) {
  const out = document.createElement('canvas');
  out.dataset.native = '';
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!,
    size = H * 0.8;
  const r = await drawBrainAlpha(g, p, W / 2, size / 2 + H * 0.02, size);
  if (!r) return out;
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
  g.fillText(`${(r.lo * 100).toFixed(1)}%`, bx, by + bh + 36);
  g.textAlign = 'right';
  g.fillText(`${(r.hi * 100).toFixed(1)}%`, bx + bw, by + bh + 36);
  return out;
}
