import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { advanceHead, type WaveClock } from './wavePlayback';
import { displayFilter, uvrms } from './displayFilter';
import { tc } from './theme';
import { electrodeNames } from './electrodes';
import type { Rail } from './types';
import './Waveform.css';
export default function Waveform({
  buffer,
  clock,
  rate,
  selected,
  paused,
  enabled,
  active,
  scale = 0,
  rail,
  plain = false,
}: {
  buffer: MutableRefObject<number[][]>;
  clock: MutableRefObject<WaveClock>;
  rate: number;
  selected: number;
  paused: boolean;
  enabled: boolean[];
  active: boolean;
  scale?: number; // µV at the row edge; 0: each row scaled to its own signal
  rail?: Rail; // per channel: share of the amplifier range used (raw, with the offset)
  // the ordinary flows (重放, 采集): rows named by electrode (Fp1, O1 …), and a readout only when
  // a channel is unusable — no CH numbers, µVrms or 未饱和 percentages (the workbench keeps them)
  plain?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    head = useRef<number | null>(null);
  const frozen = useRef<{ data: number[][]; count: number; head: number } | null>(null);
  const latest = useRef({ rate, selected, enabled, active, paused, scale, rail, plain });
  latest.current = { rate, selected, enabled, active, paused, scale, rail, plain };
  // rows under 13 px (set below): lighter drawing, see render
  const denseRef = useRef(false);
  const readouts = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    frozen.current = paused
      ? {
          data: buffer.current.map((x) => x.slice()),
          count: clock.current.count,
          head: head.current ?? clock.current.count,
        }
      : null;
    if (!paused) head.current = null;
  }, [paused, buffer, clock]);
  useEffect(() => {
    const el = canvas.current!,
      ctx = el.getContext('2d')!;
    let raf = 0,
      inView = true,
      width = 0,
      height = 0,
      last = performance.now(),
      epoch = -1,
      lastCount = -1,
      drawCount = 0,
      fpsStart = performance.now(),
      readAt = 0,
      drawnAt = 0,
      statsAt = 0,
      filtered = -1, // the count the filtered copy was made at
      pixels: ImageData | null = null; // dense rows: the traces written as pixels
    const off = document.createElement('canvas');
    let stats: { mean: number; amplitude: number }[] = [],
      scales: number[] = [],
      shown: number[][] = [], // the buffer through the display filter, redone when data arrives
      shownFrom: number[][] | null = null;
    // Draw at the screen's pixel density (sharp on scaled displays), but keep the canvas under
    // about 1.6 million pixels: enlarged panels at DPR 2 stall integrated graphics.
    const resize = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      let dpr = Math.min(2, window.devicePixelRatio || 1);
      if (width * height * dpr * dpr > 1.6e6)
        dpr = Math.max(1, Math.sqrt(1.6e6 / Math.max(1, width * height)));
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
    });
    resize.observe(el);
    const visibility = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? false;
      if (!inView) delete el.dataset.fps;
      drawCount = 0;
      fpsStart = performance.now();
    });
    visibility.observe(el);
    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      // 16 rows in a short strip (首次佩戴): at most 30 redraws a second, the traces as pixels
      // (below); skipped before dt so the scrolling keeps its speed
      if (denseRef.current && now - drawnAt < 32) return;
      drawnAt = now;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!inView || document.hidden || width <= 68 || !height) return;
      drawCount++;
      if (now - fpsStart >= 1000) {
        el.dataset.fps = String(Math.round((drawCount * 1000) / (now - fpsStart)));
        drawCount = 0;
        fpsStart = now;
      }
      const s = latest.current,
        freeze = frozen.current,
        raw = freeze?.data ?? buffer.current,
        count = freeze?.count ?? clock.current.count;
      if (filtered !== count || shownFrom !== raw) {
        shown = raw.map((values) => displayFilter(values, s.rate));
        shownFrom = raw;
        filtered = count;
      }
      const data = shown;
      if (epoch !== clock.current.epoch) {
        epoch = clock.current.epoch;
        head.current = null;
        lastCount = -1;
        stats = [];
        scales = [];
      }
      const end =
        freeze?.head ??
        (s.active ? advanceHead(head.current, count, s.rate, dt) : (head.current ?? count));
      head.current = end;
      const windowSamples = s.rate * 5; // 5 s, as OpenBCI GUI shows by default
      // dense rows: the scales (a sort per row) at most 4 times a second; they ease anyway
      if (lastCount !== count && !(denseRef.current && now - statsAt < 250 && stats.length)) {
        lastCount = count;
        statsAt = now;
        // Centre and scale from the median and the median absolute deviation: a step or a
        // drift in the window (electrode settling, movement) must not squash the rest of the
        // trace flat. The step itself is clipped at the row edge.
        stats = data.map((values) => {
          const start = Math.max(0, values.length - windowSamples),
            n = values.length - start;
          if (!n) return { mean: 0, amplitude: 20 };
          const stride = Math.max(1, Math.floor(n / 1000)),
            sample: number[] = [];
          for (let i = start; i < values.length; i += stride) sample.push(values[i]);
          const median = (a: number[]) => {
            const s = [...a].sort((x, y) => x - y);
            return s[s.length >> 1];
          };
          const mid = median(sample);
          const mad = median(sample.map((v) => Math.abs(v - mid)));
          // at least ±20 µV per row, so a quiet or flat channel stays calm instead of magnified
          return { mean: mid, amplitude: Math.max(20, mad * 1.4826 * 2.5) };
        });
      }
      ctx.setTransform(el.width / width, 0, 0, el.height / height, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const ids = s.enabled.flatMap((v, i) => (v ? [i] : [])),
        gap = height / Math.max(1, ids.length),
        left = 56,
        span = width - left - 12;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#edf0ee';
      for (let i = 0; i <= 5; i++) {
        const x = left + (span * i) / 5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      const dense = denseRef.current,
        sx = el.width / width,
        sy = el.height / height;
      if (dense) {
        if (!pixels || pixels.width !== el.width || pixels.height !== el.height) {
          pixels = ctx.createImageData(el.width, el.height);
          off.width = el.width;
          off.height = el.height;
        } else pixels.data.fill(0);
      }
      for (let row = 0; row < ids.length; row++) {
        const channel = ids[row],
          y = (row + 0.5) * gap,
          chosen = s.selected === channel;
        if (chosen) {
          ctx.fillStyle = '#eef6f2';
          ctx.fillRect(0, row * gap, width, gap);
        }
        ctx.strokeStyle = '#ecf0ed';
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        const values = data[channel] ?? [],
          origin = count - values.length,
          from = Math.max(0, Math.ceil(end - windowSamples - origin)),
          to = Math.min(values.length, Math.floor(end - origin));
        if (to - from < 2) continue;
        const stat = s.scale
            ? { mean: 0, amplitude: s.scale }
            : (stats[channel] ?? { mean: 0, amplitude: 20 }),
          target = (s.scale ? 0.44 : 0.36) / stat.amplitude;
        scales[channel] ??= target;
        if (!s.paused) scales[channel] += (target - scales[channel]) * (1 - Math.exp(-dt * 6));
        const yy = (value: number) =>
          y -
          Math.max(-gap * 0.44, Math.min(gap * 0.44, (value - stat.mean) * scales[channel] * gap));
        if (dense) {
          // Dense rows: each device pixel column filled from its minimum to its maximum (joined to
          // the column before), about as wide as the stroke. Stroking 16 traces cost ~60 ms a
          // frame; this is a few.
          const [cr, cg, cb] = rgb(tc(s.active ? '#1f5443' : '#8d9a94'));
          const d = pixels!.data,
            W = el.width,
            half = Math.max(1, 0.8 * sx),
            at = (X: number) => ((X / sx - left) / span - 1) * windowSamples + end - origin;
          let prev = NaN;
          for (let X = Math.ceil(left * sx); X < W; X++) {
            // more columns than samples: a column between two samples takes the earlier one
            const i0 = Math.max(from, Math.floor(at(X))),
              i1 = Math.min(to, Math.max(i0 + 1, Math.floor(at(X + 1))));
            if (i0 >= to) break;
            if (i1 <= i0) continue;
            let min = Infinity,
              max = -Infinity;
            for (let j = i0; j < i1; j++) {
              if (values[j] < min) min = values[j];
              if (values[j] > max) max = values[j];
            }
            let top = yy(max) * sy,
              bottom = yy(min) * sy;
            if (Number.isFinite(prev)) {
              top = Math.min(top, prev);
              bottom = Math.max(bottom, prev);
            }
            prev = yy(values[i1 - 1]) * sy;
            const y0 = Math.max(0, Math.round(top - half)),
              y1 = Math.min(el.height - 1, Math.round(bottom + half));
            for (let Y = y0; Y <= y1; Y++) {
              const o = (Y * W + X) * 4;
              d[o] = cr;
              d[o + 1] = cg;
              d[o + 2] = cb;
              d[o + 3] = 255;
            }
          }
          continue;
        }
        // A 1 px anti-aliased curve looks washed out on a light background: draw wider and
        // darker, with round joins so steep EEG edges stay solid.
        ctx.strokeStyle = s.active ? (chosen ? '#123a2c' : '#1f5443') : '#8d9a94';
        ctx.lineWidth = chosen ? 2 : 1.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let started = false;
        const bucket = Math.max(1, Math.ceil((to - from) / span));
        for (let i = from; i < to; i += bucket) {
          const x = left + span * (1 + (origin + i - end) / windowSamples);
          if (bucket === 1) {
            if (started) ctx.lineTo(x, yy(values[i]));
            else {
              ctx.moveTo(x, yy(values[i]));
              started = true;
            }
          } else {
            let min = Infinity,
              max = -Infinity;
            for (let j = i; j < Math.min(to, i + bucket); j++) {
              min = Math.min(min, values[j]);
              max = Math.max(max, values[j]);
            }
            // Min–max per pixel column, joined into one continuous trace (no gaps).
            if (started) ctx.lineTo(x, yy(min));
            else {
              ctx.moveTo(x, yy(min));
              started = true;
            }
            ctx.lineTo(x, yy(max));
          }
        }
        ctx.stroke();
      }
      if (dense) {
        off.getContext('2d')!.putImageData(pixels!, 0, 0);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(off, 0, 0);
        ctx.restore();
      }
      // per row, as OpenBCI GUI: railed state and share of the range (raw, last 3 s) and µVrms
      // (standard deviation of the filtered last second), twice a second
      if (now - readAt > 500) {
        readAt = now;
        ids.forEach((channel, row) => {
          const span = readouts.current[row];
          if (!span) return;
          const rms = uvrms(data[channel] ?? [], s.rate);
          const pct = s.rail?.percentages[channel],
            state = s.rail?.states[channel];
          const label =
            state === 'flat'
              ? '数据不变'
              : pct == null
                ? ''
                : `${state === 'railed' ? '饱和' : state === 'near' ? '接近饱和' : '未饱和'} ${pct.toFixed(2)}%`;
          if (s.plain) {
            span.textContent =
              state === 'flat'
                ? '没有信号'
                : state === 'railed'
                  ? '信号不可用'
                  : state === 'near'
                    ? '接触不稳'
                    : '';
          } else
            span.textContent = [
              label,
              Number.isFinite(rms) ? `${rms.toFixed(rms >= 100 ? 0 : 1)} µVrms` : '—',
            ]
              .filter(Boolean)
              .join(' · ');
          span.className =
            state === 'railed' || state === 'flat' ? 'railed' : state === 'near' ? 'near' : '';
          span.title =
            state === 'railed'
              ? '已饱和：信号超出放大器量程，这个通道的数据不可用'
              : state === 'near'
                ? '接近饱和：直流偏置已占用大部分量程，检查接触'
                : '';
        });
      }
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      delete el.dataset.fps;
      resize.disconnect();
      visibility.disconnect();
    };
  }, [buffer, clock]);
  const visible = enabled.flatMap((v, i) => (v ? [i] : []));
  // Rows under 13 px (16 channels in a short strip) leave no room for the labels and readouts:
  // they overlapped and were cut off, so only the traces are drawn.
  const surface = useRef<HTMLDivElement>(null);
  const [dense, setDense] = useState(false);
  denseRef.current = dense;
  const rows = Math.max(1, visible.length);
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const check = () => setDense(el.clientHeight > 0 && el.clientHeight / rows < 13);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);
  return (
    <div ref={surface} className={`wave-surface ${dense ? 'dense' : ''}`}>
      <canvas
        ref={canvas}
        className="wave-canvas"
        aria-label={`16 通道实时波形，5–50 Hz 带通，去除 50/60 Hz 工频，最近 5 秒，${scale ? `纵向 ±${scale} µV` : '纵向自动缩放'}`}
        role="img"
      />
      <div
        className="wave-channel-labels"
        style={{ gridTemplateRows: `repeat(${Math.max(1, visible.length)},minmax(0,1fr))` }}
      >
        {visible.map((i) => (
          <span key={i} className={selected === i ? 'selected' : ''}>
            {plain ? electrodeNames[i] : `CH ${String(i + 1).padStart(2, '0')}`}
          </span>
        ))}
      </div>
      <div
        className="wave-readouts"
        style={{ gridTemplateRows: `repeat(${Math.max(1, visible.length)},minmax(0,1fr))` }}
      >
        {visible.map((i, row) => (
          <span key={i} ref={(el) => void (readouts.current[row] = el)} />
        ))}
      </div>
    </div>
  );
}

// '#rrggbb' or 'rgb(r, g, b)' → [r, g, b]
function rgb(color: string): number[] {
  if (color.startsWith('#')) return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return (color.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
}
