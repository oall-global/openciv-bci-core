// The pictures of the 脑电时刻 card (design/moment-card, share.py):
//   brainArt  神经光流: light flowing over the brain (side view) along its folds and around the
//             places whose θ / α / β differ most from usual; colour = the band ahead there.
//             Same recording → same picture (seeded), nothing random added.
//   skyArt    the real sky above Beijing at the start of the recording: Yale Bright Star
//             Catalogue (5th ed., to 6.5 mag) and the Sun and planets (JPL approximate Keplerian
//             elements, Standish), north up and east left.
// Assets from design/moment-card/export_assets.py.
import brainUrl from '../assets/brain-side.png?url';
import STARS from '../assets/stars.json';
import { electrodes } from '../electrodes';
import type { Brain } from './brainHistory';

// Where the pictures are drawn: a page canvas and an image on the desktop; the mini program
// (src/wechat/card.ts) sets its own (offscreen canvases, an image from its package).
export const surface = {
  canvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.dataset.native = ''; // dark card colours as drawn (theme.ts maps the others)
    c.width = w;
    c.height = h;
    return c;
  },
  brainImage(): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(Error('无法加载大脑图像'));
      img.src = brainUrl;
    });
  },
};

// θ blue, α teal, β amber (as the eeg-art pieces)
export const ART_BANDS = [1, 2, 3];
// θ α β in the colours of the band brain (数据's cards and 脑图): θ blue, α gold, β green
export const ART_RGB = [
  [0.31, 0.62, 1.0],
  [1.0, 0.82, 0.4],
  [0.31, 0.84, 0.63],
];
const CITY = { lat: 39.9, lon: 116.4 }; // the sky is drawn for Beijing; the user's location is not read

// ---- frames → band values per electrode ----------------------------------------------------
// log(power / baseline) of θ α β per frame × electrode; gaps filled from the nearest usable frame
export function bandSeries(frames: Brain[]) {
  const T = frames.length,
    C = electrodes.length;
  return ART_BANDS.map((k) => {
    const out = Array.from({ length: T }, () => new Float64Array(C));
    for (let c = 0; c < C; c++) {
      const ok = frames.map((f) => {
        const v = f.r?.[k]?.[c];
        return v !== undefined && Number.isFinite(v) && f.ok?.[c] !== false ? v : NaN;
      });
      let last = NaN;
      const fwd = ok.map((v) => (Number.isFinite(v) ? (last = v) : last));
      last = NaN;
      for (let t = T - 1; t >= 0; t--) {
        if (Number.isFinite(ok[t])) last = ok[t];
        out[t][c] = Number.isFinite(ok[t]) ? ok[t] : Number.isFinite(fwd[t]) ? fwd[t] : last || 0;
      }
    }
    return out;
  });
}
// Gaussian smoothing along time (sigma in frames)
export function smoothTime(rows: Float64Array[], sigma: number) {
  const T = rows.length,
    C = rows[0]?.length ?? 0,
    r = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) =>
    Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)),
  );
  return rows.map((_, t) => {
    const o = new Float64Array(C);
    for (let c = 0; c < C; c++) {
      let s = 0,
        n = 0;
      for (let j = -r; j <= r; j++) {
        const u = Math.min(T - 1, Math.max(0, t + j));
        s += w[j + r] * rows[u][c];
        n += w[j + r];
      }
      o[c] = s / n;
    }
    return o;
  });
}
export function spread(rows: Float64Array[]) {
  let s = 0,
    s2 = 0,
    n = 0;
  for (const row of rows)
    for (const v of row) {
      s += v;
      s2 += v * v;
      n++;
    }
  return n ? Math.sqrt(Math.max(1e-12, s2 / n - (s / n) ** 2)) : 1;
}

// deterministic random numbers (the same recording draws the same picture)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// separable blur, three box passes ≈ Gaussian
function blur(src: Float32Array, w: number, h: number, sigma: number) {
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  let a = Float32Array.from(src),
    b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = s / (2 * r + 1);
        s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / (2 * r + 1);
        s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// ---- the brain -----------------------------------------------------------------------------
type BrainMap = { size: number; mask: Uint8Array; shade: Float32Array; dir: Float32Array };
let brainMap: Promise<BrainMap> | null = null;
function loadBrain() {
  brainMap ??= new Promise((resolve, reject) => {
    surface.brainImage().then((img) => {
      const size = img.width;
      const c = surface.canvas(size, size);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, size, size).data;
      const mask = new Uint8Array(size * size),
        shade = new Float32Array(size * size),
        dir = new Float32Array(size * size * 3);
      for (let i = 0; i < size * size; i++) {
        const a = px[i * 4 + 3];
        if (!a) continue;
        mask[i] = 1;
        shade[i] = (a - 1) / 254;
        for (let k = 0; k < 3; k++) dir[i * 3 + k] = (px[i * 4 + k] / 255) * 2 - 1;
      }
      resolve({ size, mask, shade, dir });
    }, reject);
  });
  return brainMap;
}

/** 神经光流 of these frames: an RGBA canvas of the brain (transparent outside it). */
export async function brainArt(frames: Brain[]) {
  const { size: S, mask, shade, dir } = await loadBrain();
  const T = Math.max(1, frames.length);
  const series = bandSeries(frames).map((rows) => smoothTime(rows, Math.max(1.5, T / 25)));
  const sd = series.map(spread);
  // electrode directions in the model frame (x right, y anterior, z superior)
  const E = electrodes.map((e) => {
    const v = [e.xyz[0], e.xyz[2], e.xyz[1]];
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });
  // the data on a coarse grid: the app's 6 nearest electrodes, weight 1 / (1.02 − cos)³
  const SM = 4,
    G = Math.floor(S / SM);
  const near = new Int8Array(G * G * 6).fill(-1),
    wgt = new Float32Array(G * G * 6);
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const i = (gy * SM + SM / 2) * S + gx * SM + SM / 2;
      if (!mask[i]) continue;
      const cos = E.map((e) => e[0] * dir[i * 3] + e[1] * dir[i * 3 + 1] + e[2] * dir[i * 3 + 2]);
      const order = cos.map((_, k) => k).sort((p, q) => cos[q] - cos[p]);
      let sum = 0;
      for (let j = 0; j < 6 && j < order.length; j++) {
        const k = order[j];
        near[(gy * G + gx) * 6 + j] = k;
        sum += wgt[(gy * G + gx) * 6 + j] = 1 / (1.02 - cos[k]) ** 3;
      }
      for (let j = 0; j < 6; j++) wgt[(gy * G + gx) * 6 + j] /= sum || 1;
    }
  // folds: lines of equal lighting follow the gyri (full resolution, once)
  const sm = blur(shade, S, S, 6);
  const tx = new Float32Array(S * S),
    ty = new Float32Array(S * S);
  for (let y = 1; y < S - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const gx = (sm[i + 1] - sm[i - 1]) / 2,
        gy = (sm[i + S] - sm[i - S]) / 2;
      const n = Math.hypot(gx, gy) || 1e-9;
      tx[i] = -gy / n;
      ty[i] = gx / n;
    }
  // the field of window k on the coarse grid: direction, speed, colour
  let cachedK = -1;
  const fdx = new Float32Array(G * G),
    fdy = new Float32Array(G * G),
    fsp = new Float32Array(G * G),
    fcol = new Float32Array(G * G * 3);
  const field = (k: number) => {
    if (k === cachedK) return;
    cachedK = k;
    const vals = [0, 1, 2].map(() => new Float32Array(G * G));
    for (let i = 0; i < G * G; i++) {
      if (near[i * 6] < 0) continue;
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let j = 0; j < 6; j++) s += wgt[i * 6 + j] * series[b][k][near[i * 6 + j]];
        vals[b][i] = s / sd[b];
      }
    }
    const pot = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) pot[i] = vals[1][i] - vals[0][i] + vals[2][i];
    const ps = blur(pot, G, G, 3);
    for (let y = 0; y < G; y++)
      for (let x = 0; x < G; x++) {
        const i = y * G + x;
        const gx = (ps[y * G + Math.min(G - 1, x + 1)] - ps[y * G + Math.max(0, x - 1)]) / 2,
          gy = (ps[Math.min(G - 1, y + 1) * G + x] - ps[Math.max(0, y - 1) * G + x]) / 2;
        const n = Math.hypot(gx, gy) || 1e-9;
        fdx[i] = gy / n;
        fdy[i] = -gx / n;
        fsp[i] = Math.min(
          1.5,
          (Math.abs(vals[0][i]) + Math.abs(vals[1][i]) + Math.abs(vals[2][i])) / 3,
        );
        const w = [0, 1, 2].map((b) => Math.exp(1.6 * vals[b][i]));
        const sw = w[0] + w[1] + w[2];
        for (let c = 0; c < 3; c++)
          fcol[i * 3 + c] =
            (w[0] * ART_RGB[0][c] + w[1] * ART_RGB[1][c] + w[2] * ART_RGB[2][c]) / sw;
      }
  };
  // particles
  let seed = 7;
  for (const f of frames.slice(0, 64))
    seed = (seed * 31 + Math.round((f.r?.[2]?.[0] ?? 0) * 1e4)) | 0;
  const rand = rng(seed);
  const inside: number[] = [];
  for (let i = 0; i < S * S; i++) if (mask[i]) inside.push(i);
  const N = 1400,
    STEPS = 900,
    scale = S / 900;
  const px = new Float32Array(N),
    py = new Float32Array(N),
    life = new Int32Array(N);
  const spawn = (p: number) => {
    const i = inside[Math.floor(rand() * inside.length)];
    px[p] = (i % S) + rand();
    py[p] = Math.floor(i / S) + rand();
    life[p] = 120 + Math.floor(rand() * 280);
  };
  for (let p = 0; p < N; p++) spawn(p);
  const img = new Float32Array(S * S * 3);
  for (let s = 0; s < STEPS; s++) {
    field(Math.min(T - 1, Math.floor((s / STEPS) * T)));
    for (let p = 0; p < N; p++) {
      const ix = Math.min(S - 1, Math.max(0, px[p] | 0)),
        iy = Math.min(S - 1, Math.max(0, py[p] | 0));
      const i = iy * S + ix,
        g = Math.min(G - 1, (iy / SM) | 0) * G + Math.min(G - 1, (ix / SM) | 0);
      let vx = 0.6 * tx[i] + 0.7 * fdx[g],
        vy = 0.6 * ty[i] + 0.7 * fdy[g];
      const vn = Math.hypot(vx, vy) || 1e-9,
        v = (0.9 + 1.6 * fsp[g]) * scale;
      vx = (vx / vn) * v;
      vy = (vy / vn) * v;
      const lum = 0.35 + 0.9 * shade[i];
      for (let q = 0; q < 3; q++) {
        const qx = (px[p] + (vx * q) / 3) | 0,
          qy = (py[p] + (vy * q) / 3) | 0;
        if (qx < 0 || qy < 0 || qx >= S || qy >= S || !mask[qy * S + qx]) continue;
        const o = (qy * S + qx) * 3;
        for (let c = 0; c < 3; c++) img[o + c] += fcol[g * 3 + c] * lum;
      }
      px[p] += vx;
      py[p] += vy;
      const jx = px[p] | 0,
        jy = py[p] | 0;
      if (--life[p] <= 0 || jx < 0 || jy < 0 || jx >= S || jy >= S || !mask[jy * S + jx]) spawn(p);
    }
  }
  // exposure from the brain's own brightness, glow, tone map, the brain faintly underneath
  const peaks: number[] = [];
  for (let i = 0; i < S * S; i += 3)
    if (mask[i]) peaks.push(Math.max(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]));
  peaks.sort((a, b) => a - b);
  const expo = 1.2 / (peaks[Math.floor(peaks.length * 0.993)] || 1);
  const ch = [0, 1, 2].map((c) => {
    const a = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) a[i] = img[i * 3 + c] * expo;
    return a;
  });
  const glow = ch.map((a) => blur(a, S, S, 4 * scale));
  const out = surface.canvas(S, S);
  const g2 = out.getContext('2d')!;
  const data = g2.createImageData(S, S);
  const base = [0.1, 0.17, 0.17];
  for (let i = 0; i < S * S; i++) {
    if (!mask[i]) continue;
    for (let c = 0; c < 3; c++) {
      const v = (1 - Math.exp(-(ch[c][i] + glow[c][i] * 1.6))) ** 1.2;
      data.data[i * 4 + c] = Math.round(255 * Math.min(1, v + base[c] * shade[i] * (1 - v)));
    }
    data.data[i * 4 + 3] = 255;
  }
  g2.putImageData(data, 0, 0);
  return out;
}

// ---- the sky -------------------------------------------------------------------------------
const rad = Math.PI / 180;
export const julian = (d: Date) => 2440587.5 + d.getTime() / 86400000;
export function altaz(ra: number, dec: number, jd: number) {
  const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360;
  const ha = (((gmst + CITY.lon - ra) % 360) + 360) % 360;
  const h = ha * rad,
    d = dec * rad,
    la = CITY.lat * rad;
  const alt = Math.asin(Math.sin(d) * Math.sin(la) + Math.cos(d) * Math.cos(la) * Math.cos(h));
  const az =
    Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(la) - Math.tan(d) * Math.cos(la)) + Math.PI;
  return [alt / rad, az / rad];
}
// a, e, I, L, ϖ, Ω and rates per century (J2000), valid 1800–2050
const ELEMENTS: Record<string, number[][]> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
};
// colour and drawn size (px, not to scale)
const BODIES: [string, string, number][] = [
  ['sun', '#fff1c8', 22],
  ['mercury', '#c9c0b4', 4.5],
  ['venus', '#fff4dc', 7],
  ['mars', '#ff9a6a', 5.3],
  ['jupiter', '#f3dcb8', 7],
  ['saturn', '#e8d29a', 6.1],
  ['uranus', '#a9e3ea', 4.2],
  ['neptune', '#8aa8ff', 4.2],
];
function helio(name: string, T: number) {
  const [el, rate] = ELEMENTS[name];
  const [a, e, I, L, w, O] = el.map((v, i) => v + rate[i] * T);
  const M = (((((L - w + 180) % 360) + 360) % 360) - 180) * rad;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e),
    yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const om = (w - O) * rad,
    Om = O * rad,
    i = I * rad;
  return [
    (Math.cos(om) * Math.cos(Om) - Math.sin(om) * Math.sin(Om) * Math.cos(i)) * xp +
      (-Math.sin(om) * Math.cos(Om) - Math.cos(om) * Math.sin(Om) * Math.cos(i)) * yp,
    (Math.cos(om) * Math.sin(Om) + Math.sin(om) * Math.cos(Om) * Math.cos(i)) * xp +
      (-Math.sin(om) * Math.sin(Om) + Math.cos(om) * Math.cos(Om) * Math.cos(i)) * yp,
    Math.sin(om) * Math.sin(i) * xp + Math.cos(om) * Math.sin(i) * yp,
  ];
}
/** alt, az of the Sun and the planets (exported for the test) */
export function bodies(start: Date) {
  const jd = julian(start),
    T = (jd - 2451545.0) / 36525;
  const earth = helio('earth', T),
    eps = 23.43928 * rad;
  return BODIES.map(([name, colour, size]) => {
    const g = name === 'sun' ? earth.map((v) => -v) : helio(name, T).map((v, k) => v - earth[k]);
    const x = g[0],
      y = g[1] * Math.cos(eps) - g[2] * Math.sin(eps),
      z = g[1] * Math.sin(eps) + g[2] * Math.cos(eps);
    const ra = (((Math.atan2(y, x) / rad) % 360) + 360) % 360,
      dec = Math.atan2(z, Math.hypot(x, y)) / rad;
    const [alt, az] = altaz(ra, dec, jd);
    return { name, colour, size, alt, az, ra, dec };
  });
}

/** The sky for a card of w × h, zenith at (cx, cy); the horizon circle reaches past the corners.
 * open: the band [top, bottom] (px) with no text or chart, where the Sun and planets may be drawn;
 * elsewhere they are left out (behind a chart a bright disc reads as a data point). */
export function skyArt(
  start: Date,
  w: number,
  h: number,
  cx = w / 2,
  cy = h / 2,
  radius = 1000,
  open: [number, number] = [0, h],
) {
  const c = surface.canvas(w, h);
  const g = c.getContext('2d')!;
  const jd = julian(start);
  // north up, east left, as the sky really stood: a low Sun may fall outside the card
  const sol = bodies(start).filter((b) => b.alt > 0);
  const at = (alt: number, az: number) => {
    const r = Math.tan(((90 - alt) * rad) / 2) * radius; // stereographic
    return [cx - r * Math.sin(az * rad), cy - r * Math.cos(az * rad)];
  };
  for (const [ra, dec, mag, bv] of STARS as number[][]) {
    const [alt, az] = altaz(ra, dec, jd);
    if (alt <= 0) continue;
    const [x, y] = at(alt, az);
    if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
    const k = Math.min(1, Math.max(0, (bv + 0.3) / 1.9));
    const col = [0.7 + 0.3 * k, 0.8, 1 - 0.45 * k].map((v) => Math.round(v * 255)).join(',');
    const d = (Math.sqrt(0.4 + (6.6 - mag) ** 2.1 * 0.5) * 100) / 72;
    const alpha = Math.min(1, Math.max(0.25, 0.25 + (6.5 - mag) / 6));
    if (mag < 2.5) {
      g.fillStyle = `rgba(${col},0.10)`;
      g.beginPath();
      g.arc(x, y, d * 1.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = `rgba(${col},${alpha})`;
    g.beginPath();
    g.arc(x, y, d / 2, 0, Math.PI * 2);
    g.fill();
  }
  for (const b of sol) {
    const [x, y] = at(b.alt, b.az);
    const reach = (b.size * 7) / 2; // the glow
    if (y - reach < open[0] || y + reach > open[1]) continue;
    g.fillStyle = b.colour;
    for (const [k, a] of [
      [7, 0.05],
      [4, 0.1],
      [2.2, 0.22],
      [1, 1],
    ]) {
      g.globalAlpha = a;
      g.beginPath();
      g.arc(x, y, (b.size * k) / 2, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (b.name === 'saturn') {
      g.strokeStyle = b.colour;
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(x, y, b.size * 2.1, b.size * 0.65, -20 * rad, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return c;
}
