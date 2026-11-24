// The brain seen from above (forehead up) in 2D, from the 3D brain's cortex points
// (lib/brain-points.js, the desktop's model), each point coloured as BrainScene.colorBy: its 4
// nearest electrodes, weighted; in the stepped rainbow of the desktop's 脑图 (src/data/BrainMap.tsx).
// Used by the card (card.ts) and 你的大脑报告's 大脑频段图 (first.ts).
declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Points = {
  count: number;
  stride: number;
  data: string;
};

const STOPS: [number, number[]][] = [
  [0, [38, 48, 140]],
  [0.15, [45, 90, 210]],
  [0.35, [60, 190, 230]],
  [0.5, [150, 220, 120]],
  [0.65, [240, 230, 70]],
  [0.8, [245, 150, 40]],
  [1, [215, 35, 40]],
];
export const STEPS = 12;
export function rainbow(t: number) {
  const q = Math.min(STEPS - 1, Math.max(0, Math.floor(t * STEPS))) / (STEPS - 1);
  let k = 0;
  while (k < STOPS.length - 2 && q > STOPS[k + 1][0]) k++;
  const [a, ca] = STOPS[k],
    [b, cb] = STOPS[k + 1],
    s = (q - a) / (b - a);
  return ca.map((x, i) => Math.round(x + (cb[i] - x) * s));
}
/** The cortex from above (forehead up) coloured by values per electrode, size × size at (cx, cy) */
export function drawBrainTop(
  g: CanvasRenderingContext2D,
  points: Points,
  values: (number | null)[],
  colour: (v: number) => number[],
  cx: number,
  cy: number,
  size: number,
) {
  const buf = wx.base64ToArrayBuffer(points.data) as ArrayBuffer;
  const v = new DataView(buf);
  const n = points.count,
    S = points.stride;
  const R = size * 0.46; // the cortex's length (2 radii) about 0.92 of the size
  const order = Array.from({ length: n }, (_, i) => i);
  const z = (i: number) => v.getInt16(i * S + 4, true);
  order.sort((a, b) => z(a) - z(b));
  const dot = Math.max(2, size / 150);
  for (const i of order) {
    const o = i * S;
    const nz = v.getInt8(o + 8) / 127;
    if (nz < -0.2) continue; // facing down: hidden under the top
    const x = v.getInt16(o, true) / 32767,
      y = v.getInt16(o + 2, true) / 32767;
    const idx = [
      v.getUint8(o + 9) >> 4,
      v.getUint8(o + 9) & 15,
      v.getUint8(o + 10) >> 4,
      v.getUint8(o + 10) & 15,
    ];
    const w3 = [v.getUint8(o + 11) / 255, v.getUint8(o + 12) / 255, v.getUint8(o + 13) / 255];
    const w = [...w3, Math.max(0, 1 - w3[0] - w3[1] - w3[2])];
    let s = 0,
      ws = 0;
    idx.forEach((k, j) => {
      const val = values[k];
      if (val == null || !Number.isFinite(val)) return;
      s += w[j] * val;
      ws += w[j];
    });
    const c = ws ? colour(s / ws) : [41, 41, 41];
    // lit from above: the folds turned away darker, as the 3D brain's shading
    const light = 0.35 + 0.65 * Math.max(0, nz);
    g.fillStyle = `rgb(${c.map((x) => Math.round(x * light)).join(',')})`;
    g.fillRect(cx + x * R - dot / 2, cy - y * R - dot / 2, dot, dot);
  }
}
