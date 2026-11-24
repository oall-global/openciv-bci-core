// 脑电时刻 card (design/moment-card, share.py): the real sky of that moment behind the whole card,
// the title and when; 神经光流 — the recording as light on the brain; three figures (有效采样点,
// 采集通道, 采样频率); 多通道频段功率时序 — one line per electrode, front to back, over time,
// coloured by the band ahead at that electrode and moment. Drawn on a canvas from the 0.5 s brain
// frames the recording kept; the pictures (momentArt.ts) are made by the caller; progress /
// stamp animate it.
import { electrodes } from '../electrodes';
import type { Brain } from './brainHistory';
import { ART_RGB, bandSeries, smoothTime, spread, surface } from './momentArt';

export const CARD_W = 1080,
  CARD_H = 1620; // 2:3
// the band of the card between the date line and the figures: only the brain and the sky
export const SKY_OPEN: [number, number] = [275, 915];
export type Mark = { t: number; label: string }; // t: s from the start
export type CardScene = { id: string; name: string; c1: string; c2: string; glow: string };
// per channel (electrodes' order) the lowest / highest µV in equal stretches of the recording
export type Wave = { seconds: number; min: number[][]; max: number[][] };
export type CardInput = {
  frames: Brain[];
  lines?: Brain[]; // the chart's frames (1 s every 0.3 s, t from the start); else frames
  wave?: Wave; // the EEG behind the chart's lines (electron/bandFrames.cjs waveEnvelope)
  start: Date;
  seconds: number;
  rate: number; // samples per second per channel
  marks: Mark[];
  scene: CardScene;
  title: string;
  note: string;
  sign: string;
};
export type CardArt = {
  sky: HTMLCanvasElement | null;
  brain: HTMLCanvasElement | null;
  hero?: HTMLCanvasElement | null; // drawn in place of the brain, the whole band 290–915 (数据's cards)
};
const FONT = '"Microsoft YaHei UI", "PingFang SC", sans-serif';
const MONO = '"IBM Plex Mono", Consolas, monospace';
const p2 = (v: number) => String(v).padStart(2, '0');
const BG = '#0a0d0c',
  LINE = '#1f2a26',
  INK = '#e6eeea',
  INK2 = '#b9c6c0',
  INK3 = '#8a9a93',
  INK4 = '#5d6b65',
  TEAL = '#5fd3a4',
  AMBER = '#e8b04a';
// lines of the chart: the band colours pulled towards a grey-green ink by mute; tuned with the
// card's line panel (BrainRecord.tsx, Ctrl+Shift+L)
const GREY = [0.55, 0.62, 0.6];
export type CardLines = { mute: number; width: number; alpha: number; amp: number; glow: number };
export const CARD_LINES: CardLines = { mute: 0.3, width: 2, alpha: 0.95, amp: 0.9, glow: 0 };
const muted = (rgb: number[], mute: number) =>
  rgb.map((v, i) => v * (1 - mute) + GREY[i] * mute * 0.8);
const css = (rgb: number[], a = 1) =>
  `rgba(${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')},${a})`;

// What the card shows, computed once per recording.
export function cardData(
  input: Pick<CardInput, 'frames' | 'lines' | 'wave' | 'seconds' | 'marks' | 'rate'>,
) {
  const frames = input.frames.filter((f) => f.r);
  const t0 = frames.length ? frames[0].t - 0.5 : 0;
  const span = Math.max(1, input.seconds);
  const lines = input.lines?.filter((f) => f.r);
  const chart = lines?.length ? lines : frames;
  const T = chart.length;
  // electrodes front to back (nose first), then left to right
  const order = electrodes
    .map((e, c) => ({ c, z: e.xyz[2], x: e.xyz[0] }))
    .sort((a, b) => b.z - a.z || a.x - b.x)
    .map((e) => e.c);
  const series = T ? bandSeries(chart) : [];
  // light smoothing (0.6 s at the 0.3 s step), more only when a line would have more points than
  // the chart has pixels (validation/card-lines: the old T / 60 left a few slow waves)
  const sigma = Math.max(2, T / 600);
  const sm = series.map((rows) => smoothTime(rows, sigma));
  const usable = chart.map((f) =>
    order.map((c) => f.ok[c] !== false && Number.isFinite(f.r?.[2]?.[c])),
  );
  // height: θ+α+β relative to usual
  const h = sm.length
    ? sm[0].map((_, t) => order.map((c) => (sm[0][t][c] + sm[1][t][c] + sm[2][t][c]) / 3))
    : [];
  // what every electrode does at once (movement, a blink, the whole head) taken out at each moment,
  // so each line shows its own electrode; electrodes without signal stay flat
  h.forEach((row, t) => {
    const v = row.filter((_, i) => usable[t][i]).sort((x, y) => x - y);
    const m = v.length ? v[v.length >> 1] : 0;
    row.forEach((_, i) => (row[i] = usable[t][i] ? row[i] - m : 0));
  });
  // each electrode's change over time (its own level removed), scaled by its own robust spread
  // (median absolute deviation), so one artefact does not flatten the line; peaks bent softly
  // instead of cut flat
  const height = order.map((_, i) => {
    const col = h.map((row) => row[i]);
    const mid = [...col].sort((x, y) => x - y)[col.length >> 1] ?? 0;
    const dev = col.map((v) => Math.abs(v - mid)).sort((x, y) => x - y);
    const sd = Math.max(1e-6, (dev[dev.length >> 1] ?? 0) * 1.4826);
    return col.map((v) => {
      const z = (v - mid) / sd;
      return 0.65 * (z > 0 ? 3 * Math.tanh(z / 3) : 2 * Math.tanh(z / 2));
    });
  });
  const heightT = h.map((_, t) => order.map((_, i) => height[i][t]));
  // colour: the band ahead, each band in units of its own spread
  const bsd = sm.map(spread);
  const colour = sm.length
    ? sm[0].map((_, t) =>
        order.map((c) => {
          const w = [0, 1, 2].map((b) => Math.exp(2.2 * (sm[b][t][c] / bsd[b])));
          const sw = w[0] + w[1] + w[2];
          return [0, 1, 2].map(
            (k) => (w[0] * ART_RGB[0][k] + w[1] * ART_RGB[1][k] + w[2] * ART_RGB[2][k]) / sw,
          );
        }),
      )
    : [];
  // the moment that differed most from usual (not the first or last second)
  const change = frames.map((f) => {
    let a = 0,
      m = 0;
    f.r!.forEach((row) =>
      row.forEach((v, c) => {
        if (Number.isFinite(v) && f.ok[c] !== false) {
          a += Math.abs(v);
          m++;
        }
      }),
    );
    return m ? a / m : NaN;
  });
  let peak = -1;
  change.forEach((v, i) => {
    const t = frames[i].t - t0;
    if (t >= 1 && t <= span - 1 && Number.isFinite(v) && (peak < 0 || v > change[peak])) peak = i;
  });
  const peakT = peak >= 0 ? frames[peak].t - t0 : span / 2;
  const user = input.marks.filter((m) => m.t >= 0 && m.t <= span).slice(0, 6);
  // 有效采样点: samples × channels from usable electrodes (each frame stands for 0.5 s)
  const valid =
    frames.reduce(
      (a, f) => a + f.ok.filter((ok, c) => ok !== false && Number.isFinite(f.r![2][c])).length,
      0,
    ) *
    0.5 *
    input.rate;
  // the EEG behind: each electrode in units of its own usual swing (median half range of the
  // stretches), bent softly so a movement or blink does not cover the rows around it; an
  // electrode without signal (no usable frame) is left out
  const wave = input.wave?.min.length
    ? order.map((c, i) => {
        const lo = input.wave!.min[c],
          hi = input.wave!.max[c];
        if (!lo || !hi || !usable.some((row) => row[i])) return null;
        const half = hi.map((v, k) => (v - lo[k]) / 2).sort((x, y) => x - y);
        const s = Math.max(1e-3, half[half.length >> 1] ?? 0);
        const bend = (v: number) => 0.62 * Math.tanh(((v / s) * 0.22) / 0.62);
        return { lo: lo.map(bend), hi: hi.map(bend) };
      })
    : null;
  return {
    span,
    wave,
    waveSeconds: input.wave?.seconds ?? 0,
    times: lines?.length ? lines.map((f) => f.t) : frames.map((f) => f.t - t0),
    names: order.map((c) => electrodes[c].name),
    height: heightT,
    colour,
    marks: user.length ? user : [{ t: peakT, label: '' }],
    valid,
    channels: electrodes.length,
    rate: input.rate,
  };
}
export type CardData = ReturnType<typeof cardData>;
// the chart's lines drawn once per card and line settings; y range of the card they cover
const chartCache = new WeakMap<CardData, { key: string; c: HTMLCanvasElement }>();
const CHART = [1090, 1560];

const short = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`;
const clock = (s: number) => `${p2(Math.floor(s / 60))}:${p2(Math.floor(s % 60))}`;
const duration = (s: number) => {
  s = Math.round(s);
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s / 60} 分钟`;
  return `${Math.floor(s / 3600)} 小时 ${Math.round((s % 3600) / 60)} 分`;
};
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > width && line) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out;
}
function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCard(
  ctx: CanvasRenderingContext2D,
  input: CardInput,
  data: CardData,
  progress: number, // 0..1 of the chart drawn
  t: number, // s, for the mark pulse
  stamp: number, // 0..1 the figures appearing
  art: CardArt = { sky: null, brain: null },
  lines: CardLines = CARD_LINES,
) {
  const W = CARD_W,
    H = CARD_H,
    X = 48;
  const d = input.start;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  if (art.sky) ctx.drawImage(art.sky, 0, 0, W, H);

  // name, title, when
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText('开源文明 BCI-001', X, 81);
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText(wrap(ctx, input.title, W - 2 * X)[0] ?? '', X, 204);
  const end = new Date(d.getTime() + input.seconds * 1000);
  const hms = (e: Date) => `${p2(e.getHours())}:${p2(e.getMinutes())}:${p2(e.getSeconds())}`;
  ctx.font = `22px ${MONO}`;
  ctx.fillStyle = INK3;
  ctx.fillText(
    [
      `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}`,
      `${hms(d)}–${hms(end)}`,
      duration(input.seconds),
      input.sign,
    ]
      .filter(Boolean)
      .join('  ·  '),
    X,
    259,
  );
  if (input.note) {
    ctx.font = `21px ${FONT}`;
    ctx.fillStyle = INK2;
    ctx.fillText(`「${input.note}」`, X, 296);
  }

  if (art.hero) {
    ctx.globalAlpha = Math.min(1, progress * 2.5);
    ctx.drawImage(art.hero, 0, 290, W, 625);
    ctx.globalAlpha = 1;
  }
  // 神经光流: rows 72–640 of the 720 px picture (the empty margins left out), 760 px tall
  else if (art.brain) {
    const S = art.brain.width,
      top = 0.1 * S,
      rows = 0.789 * S,
      hh = 600,
      ww = (S * hh) / rows;
    ctx.globalAlpha = Math.min(1, progress * 2.5);
    ctx.drawImage(art.brain, 0, top, S, rows, W / 2 - ww / 2, 300, ww, hh);
    ctx.globalAlpha = 1;
  }

  // three figures
  ctx.globalAlpha = Math.max(0, Math.min(1, stamp));
  const fy = 925,
    cw = (W - 2 * X) / 3;
  ctx.fillStyle = LINE;
  ctx.fillRect(X, fy, W - 2 * X, 1.5);
  ctx.fillRect(X, fy + 150, W - 2 * X, 1.5);
  const cells: [string, string, string][] = [
    [short(data.valid), '', '有效采样点'],
    [`${data.channels}`, 'CH', '采集通道'],
    [`${data.rate}`, 'Hz', '采样频率'],
  ];
  cells.forEach(([big, unit, label], i) => {
    const cx = X + cw * (i + 0.5);
    if (i) ctx.fillRect(X + cw * i, fy + 26, 1.5, 98);
    ctx.font = `700 68px ${MONO}`;
    const w1 = ctx.measureText(big).width;
    ctx.font = `28px ${MONO}`;
    const w2 = unit ? ctx.measureText(' ' + unit).width : 0;
    const x0 = cx - (w1 + w2) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 68px ${MONO}`;
    ctx.fillStyle = INK;
    ctx.fillText(big, x0, fy + 86);
    if (unit) {
      ctx.font = `28px ${MONO}`;
      ctx.fillStyle = TEAL;
      ctx.fillText(' ' + unit, x0 + w1, fy + 86);
    }
    ctx.textAlign = 'center';
    ctx.font = `20px ${FONT}`;
    ctx.fillStyle = INK3;
    ctx.fillText(label, cx, fy + 124);
    ctx.fillStyle = LINE;
  });
  ctx.globalAlpha = 1;

  // 多通道频段功率时序
  ctx.textAlign = 'left';
  ctx.font = `18px ${FONT}`;
  ctx.fillStyle = INK3;
  ctx.fillText('多通道频段功率时序', 76, 1118);
  ['θ', 'α', 'β'].forEach((name, i) => {
    ctx.fillStyle = css(muted(ART_RGB[i], lines.mute));
    ctx.font = `17px ${MONO}`;
    ctx.fillText(`■ ${name}`, 260 + i * 62, 1118);
  });
  rounded(ctx, X, 1137, W - 2 * X, 413, 18);
  ctx.fillStyle = 'rgba(17,23,21,0.45)'; // the stars show through
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  const ax = { x: 72, y: 1157, w: W - 144, h: 368 };
  const T = data.height.length;
  if (T > 1) {
    const span = data.times[T - 1] - data.times[0] || 1,
      lo = data.times[0] - span * 0.06,
      hi = data.times[T - 1] + span * 0.06,
      amp = lines.amp,
      yLo = -1.4,
      yHi = 16 + amp * 2;
    const px = (s: number) => ax.x + ((s - lo) / (hi - lo)) * ax.w;
    const py = (v: number) => ax.y + ax.h - ((v - yLo) / (yHi - yLo)) * ax.h;
    const shown = Math.max(0, Math.min(1, progress));
    data.names.forEach((name, i) => {
      const base = 15 - i;
      ctx.font = `12.5px ${MONO}`;
      ctx.fillStyle = INK4;
      ctx.textAlign = 'right';
      ctx.fillText(name, px(data.times[0] - span * 0.015), py(base + 0.05));
      ctx.textAlign = 'left';
      ctx.fillText(name, px(data.times[T - 1] + span * 0.015), py(base + 0.05));
    });
    // the lines are detailed (about one point per pixel), so they are drawn once per card and
    // settings into a canvas of their own; the animation only reveals it from the left
    const key = JSON.stringify(lines);
    let drawn = chartCache.get(data);
    if (!drawn || drawn.key !== key) {
      const c = surface.canvas(W, CHART[1] - CHART[0]);
      const g = c.getContext('2d')!;
      g.translate(0, -CHART[0]);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      // behind the lines the EEG itself, thin and faint: in each stretch a stroke from its lowest
      // to its highest value, joined to the next
      if (data.wave) {
        const n = data.wave.find(Boolean)?.lo.length ?? 0;
        g.lineWidth = 0.9;
        g.strokeStyle = 'rgba(185,198,192,0.16)';
        data.wave.forEach((w, i) => {
          if (!w) return;
          const base = 15 - i;
          g.beginPath();
          for (let k = 0; k < n; k++) {
            const x = px(((k + 0.5) / n) * data.waveSeconds);
            if (k) g.lineTo(x, py(base + w.hi[k]));
            else g.moveTo(x, py(base + w.hi[k]));
            g.lineTo(x, py(base + w.lo[k]));
          }
          g.stroke();
        });
      }
      g.lineWidth = lines.width;
      g.shadowBlur = lines.glow;
      const step = Math.max(1, Math.ceil(T / 1000));
      data.names.forEach((_, i) => {
        const base = 15 - i;
        // each stretch in its moment's colour; neighbours of the same colour (to 1/24) in one path
        const q = (v: number) => Math.round(v * 24) / 24;
        let style = '';
        for (let k = 0; k < T - 1; k += step) {
          const k2 = Math.min(T - 1, k + step);
          const col = muted(data.colour[k][i], lines.mute).map(q);
          const s = css(col, lines.alpha);
          if (s !== style) {
            if (style) g.stroke();
            style = s;
            g.strokeStyle = s;
            if (lines.glow) g.shadowColor = css(col, 0.8);
            g.beginPath();
            g.moveTo(px(data.times[k]), py(base + data.height[k][i] * amp));
          }
          g.lineTo(px(data.times[k2]), py(base + data.height[k2][i] * amp));
        }
        if (style) g.stroke();
      });
      drawn = { key, c };
      chartCache.set(data, drawn);
    }
    const reveal = px(data.times[Math.max(1, Math.round(shown * (T - 1)))]) + lines.width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, CHART[0], reveal, CHART[1] - CHART[0]);
    ctx.clip();
    ctx.drawImage(drawn.c, 0, CHART[0]);
    ctx.restore();
    // the marked moments (or the one that differed most): amber dashed lines
    data.marks.forEach((m, i) => {
      const x = px(Math.min(data.times[T - 1], m.t));
      ctx.strokeStyle = `rgba(232,176,74,${0.75 + 0.2 * Math.sin(t * 3 + i)})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, ax.y);
      ctx.lineTo(x, ax.y + ax.h);
      ctx.stroke();
      ctx.setLineDash([]);
      if (m.label) {
        ctx.fillStyle = AMBER;
        ctx.font = `14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(m.label, x, ax.y - 4);
      }
    });
    const inner = ax.w / 1.12;
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = INK4;
    [0, 0.5, 1].forEach((f) => {
      ctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center';
      ctx.fillText(clock(data.times[0] + f * span), W / 2 + (f - 0.5) * inner, 1542);
    });
  }

  // footer
  ctx.textAlign = 'left';
  ctx.fillStyle = INK4;
  ctx.font = `18px ${FONT}`;
  ctx.fillText('开源文明 BCI-001', X, H - 40);
  ctx.restore();
}
