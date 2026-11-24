import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { ratioColor, type BrainScene } from './brainScene';
import { STEP, brainHistory, type Brain } from './brainHistory';

const RANGE = 60; // s: the strip is always the last minute
export const clock = (s: number) => {
  const a = Math.abs(s);
  return `${s < 0 ? '−' : ''}${String(Math.floor(a / 60)).padStart(2, '0')}:${(a % 60).toFixed(1).padStart(4, '0')}`;
};

// Video-style timeline over the band power history (运行画面, 信号工作台 · 主图): the strip is
// one value per 0.5 s frame in the brain's colours; drag or click to replay, hover for a
// preview, play / pause, ±5 s, back to live and speed; it spans the last minute. The replay position (cursor,
// null = live) belongs to the parent, which draws the brain at that frame.
export default function BrainTimeline({
  scene,
  band,
  tick,
  cursor,
  setCursor,
  value,
  isTarget,
  marks = [],
  legend,
  extra,
}: {
  scene: BrainScene | null;
  band: number;
  tick: number;
  cursor: number | null;
  setCursor: (c: number | null | ((c: number | null) => number | null)) => void;
  value: (f: Brain) => number;
  isTarget?: (f: Brain) => boolean;
  marks?: number[];
  legend: ReactNode;
  extra?: ReactNode; // more controls after 实时 (主图: 录制脑电)
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);
  const strip = useRef<HTMLCanvasElement | null>(null);
  const preview = useRef<HTMLCanvasElement | null>(null);

  // Keep the replay position on the same moment when old frames are dropped; back to live
  // when the stream restarts.
  const seen = useRef({ dropped: brainHistory.dropped, epoch: brainHistory.epoch });
  useEffect(
    () =>
      brainHistory.subscribe(() => {
        const d = brainHistory.dropped - seen.current.dropped;
        if (brainHistory.epoch !== seen.current.epoch) setCursor(null);
        else if (d) setCursor((c) => (c === null ? null : Math.max(0, c - d)));
        seen.current = { dropped: brainHistory.dropped, epoch: brainHistory.epoch };
      }),
    [setCursor],
  );

  // Replay: one frame per 0.5 s / speed; reaching the end returns to live.
  useEffect(() => {
    if (!playing || cursor === null) return;
    const id = setTimeout(
      () => {
        const next = cursor + 1;
        if (next >= brainHistory.frames.length - 1) {
          setCursor(null);
          setPlaying(false);
        } else setCursor(next);
      },
      (STEP * 1000) / speed,
    );
    return () => clearTimeout(id);
  }, [playing, cursor, speed, setCursor]);

  const h = brainHistory.frames;
  const last = h.length - 1;
  const tEnd = h[last]?.t ?? 0;
  // The strip spans the last minute, or all there is when that is shorter.
  const kept = tEnd - (h[0]?.t ?? tEnd);
  const span = Math.max(STEP, Math.min(RANGE, kept));
  const tStart = tEnd - span;

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const r = el.getBoundingClientRect(),
      dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(r.width * dpr);
    el.height = Math.round(r.height * dpr);
    const g = el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    const X = (t: number) => ((t - tStart) / span) * r.width;
    const top = 12,
      bar = 18;
    const colW = Math.max(1, (STEP / span) * r.width + 0.6);
    for (let i = 0; i < h.length; i++) {
      const f = h[i];
      if (f.t < tStart) continue;
      const v = value(f);
      g.globalAlpha = cursor !== null && i > cursor ? 0.4 : 1;
      g.fillStyle = Number.isFinite(v) ? ratioColor(v) : '#1a2320';
      g.fillRect(X(f.t) - colW, top, colW, bar);
      if (isTarget?.(f)) {
        g.fillStyle = '#e8b04a';
        g.fillRect(X(f.t) - colW, top + bar + 3, colW, 3);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = '#f7c948';
    for (const t of marks)
      if (t >= tStart && t <= tEnd) {
        const x = X(t);
        g.beginPath();
        g.moveTo(x - 4, 1);
        g.lineTo(x + 4, 1);
        g.lineTo(x, 8);
        g.fill();
      }
    // The buffer may have been cut or restarted since this render (new stream).
    const head = h[cursor === null ? h.length - 1 : Math.min(cursor, h.length - 1)];
    if (head) {
      const x = X(head.t);
      g.fillStyle = '#ffffff';
      g.fillRect(x - 1, top - 4, 2, bar + 11);
      g.beginPath();
      g.arc(x, top - 4, 4.5, 0, Math.PI * 2);
      g.fill();
    }
    if (hover) {
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.setLineDash([2, 2]);
      g.beginPath();
      g.moveTo(hover.x + 0.5, 0);
      g.lineTo(hover.x + 0.5, top + bar + 6);
      g.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, band, cursor, hover, marks.length]);

  // Hover preview: the top view at that moment, cortex only (no neurons or fibres).
  useEffect(() => {
    if (!scene || !hover || !preview.current) return;
    const id = requestAnimationFrame(() => {
      scene.paint(h[hover.i]?.r?.[band] ?? null, true);
      scene.draw('top', preview.current!, 1, true);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, hover?.i, band]);

  const indexAt = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const t = tStart + (x / r.width) * span;
    let i = h.findIndex((f) => f.t >= t);
    if (i < 0) i = last;
    return { x, i };
  };
  const seek = (i: number) => {
    if (i >= last) {
      setCursor(null);
      setPlaying(false);
    } else setCursor(Math.max(0, i));
  };
  const step = (n: number) => seek((cursor ?? last) + n);
  const replaying = cursor !== null;
  const shown = h[cursor ?? last];
  const ago = shown ? shown.t - tEnd : 0;

  return (
    <div className="brain-tl">
      {hover && (
        // kept inside the timeline at both ends (past the right edge it scrolled the page)
        <div
          className="brain-preview"
          style={{ left: `clamp(76px, ${hover.x}px, calc(100% - 76px))` }}
        >
          <canvas ref={preview} />
          <span>{clock((h[hover.i]?.t ?? tEnd) - tEnd)}</span>
        </div>
      )}
      <canvas
        ref={strip}
        data-native
        className="brain-strip"
        aria-label="时间轴"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(indexAt(e).i);
        }}
        onPointerMove={(e) => {
          const p = indexAt(e);
          setHover(p);
          if (e.buttons) seek(p.i);
        }}
        onPointerLeave={() => setHover(null)}
      />
      <div className="brain-ticks">
        {[4, 3, 2, 1, 0].map((k) => (
          <span key={k}>{k ? clock((-span * k) / 4).replace(/\.\d$/, '') : '现在'}</span>
        ))}
      </div>
      <div className="brain-ctrl">
        <button
          className="brain-btn"
          aria-label={playing ? '暂停' : replaying ? '播放' : '暂停'}
          onClick={() => {
            if (!replaying) {
              setCursor(last);
              setPlaying(false);
            } else setPlaying(!playing);
          }}
        >
          {replaying && !playing ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button className="brain-btn" aria-label="后退 5 秒" onClick={() => step(-10)}>
          <SkipBack size={13} />
        </button>
        <button className="brain-btn" aria-label="前进 5 秒" onClick={() => step(10)}>
          <SkipForward size={13} />
        </button>
        <span className="brain-time">{replaying ? clock(ago) : '实时'}</span>
        <button
          className={`brain-live ${replaying ? '' : 'on'}`}
          onClick={() => {
            setCursor(null);
            setPlaying(false);
          }}
        >
          <i />
          {replaying ? '回到实时' : '实时'}
        </button>
        {extra}
        <span className="brain-legend">{legend}</span>
        <span className="grow" />
        <span className="brain-seg brain-speed">
          速度
          {[0.5, 1, 2].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
