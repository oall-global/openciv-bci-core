// 片段播放: one recording (录制脑电, or a task session from 数据) played back as a clip — the whole
// recording as a glowing wave track (scrub, jump to the moment of largest change), and at the
// play head the 16 channels and the rhythm bars, from the complete EEG it kept.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import Waveform from '../Waveform';
import { useReplay, type Recording as FileRecording } from '../useReplay';
import { BANDS } from './brainHistory';
import Help from '../glossary/Help';
import { RECORD, SCENES, WAVE_CH, WAVE_HZ, prepare } from './BrainRecord';

type Meta = {
  id: string;
  title?: string;
  scene?: string;
  sceneName?: string;
  note?: string;
  sign?: string;
  start?: string;
  recordedAt: string;
  seconds: number;
  marks?: { t: number; label: string }[]; // 标记此刻, s from the start
  periods?: { from: number; to: number; name: string }[]; // task sessions: the states, s
};
// the condition periods of a task session from its events (cond.<key>.start … .end)
type SessionEvent = { t: number; label: string; name?: string | null };
function periodsOf(events: SessionEvent[], seconds: number) {
  const open = new Map<string, SessionEvent>(),
    out: { from: number; to: number; name: string }[] = [];
  for (const e of events) {
    const m = /^cond\.(.+)\.(start|end)$/.exec(e.label);
    if (!m) continue;
    if (m[2] === 'start') open.set(m[1], e);
    else if (open.has(m[1])) {
      const s = open.get(m[1])!;
      out.push({ from: s.t, to: e.t, name: s.name || m[1] });
      open.delete(m[1]);
    }
  }
  for (const [key, s] of open) out.push({ from: s.t, to: seconds, name: s.name || key });
  return out.sort((a, b) => a.from - b.from);
}
const PERIOD_FILL = ['rgba(240,170,60,0.13)', 'rgba(127,170,255,0.13)', 'rgba(95,211,164,0.13)'];
const ALL_ON = Array(16).fill(true);
const mmss = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// The six display channels of the whole recording, 50 Hz, for the track.
function trackWave(file: FileRecording) {
  const rate = file.header.metadata.rate;
  const step = Math.max(1, Math.round(rate / WAVE_HZ));
  const out: number[][] = WAVE_CH.map(() => []);
  for (const row of file.events) {
    const e = row.event;
    if (e.type !== 'data') continue;
    WAVE_CH.forEach((c, k) => {
      const d: number[] = e.samples[c];
      for (let i = 0; i + step <= d.length; i += step) {
        let s = 0;
        for (let j = 0; j < step; j++) s += d[i + j];
        out[k].push(s / step);
      }
    });
  }
  return out;
}

export default function MomentPlayer({
  id,
  kind = 'moment',
  title,
  onClose,
}: {
  id: string;
  kind?: 'moment' | 'session';
  title?: string; // the name shown in 数据 (it may have been renamed)
  onClose: () => void;
}) {
  const [typeLabel, setTypeLabel] = useState('录制脑电');
  const replay = useReplay();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState('');
  const [loop, setLoop] = useState(false);
  const track = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        if (kind === 'session') {
          const [file, d] = await Promise.all([
            window.neuro!.data('open', { kind, id }),
            window.neuro!.data('detail', { kind, id }),
          ]);
          if (gone) return;
          setTypeLabel(d.type === 'task' ? '会话录制' : '录制脑电');
          // the condition periods as shaded spans with the state's name; other events as marks
          setMeta({
            id,
            title: d.title,
            recordedAt: d.start,
            seconds: d.seconds,
            periods: periodsOf(d.events, d.seconds),
            marks: d.events
              .filter((e: SessionEvent) => e.label === 'mark')
              .map((e: SessionEvent) => ({ t: e.t, label: e.name || '标记' })),
          });
          replay.load(file);
          replay.setPlaying(true);
          return;
        }
        const [file, list] = await Promise.all([
          window.neuro!.moment('open', { id }),
          window.neuro!.moment('list'),
        ]);
        if (gone) return;
        setMeta(list.find((m: Meta) => m.id === id) ?? null);
        replay.load(file);
        replay.setPlaying(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      gone = true;
      replay.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);
  const scene = SCENES.find((s) => s.id === meta?.scene) ?? RECORD;
  const file = replay.file;
  const prep = useMemo(() => (file ? prepare({ wave: trackWave(file) }) : null), [file]);
  const duration = file?.duration ?? 0;
  const pos = replay.position;
  // loop at the end
  useEffect(() => {
    if (loop && file && !replay.playing && pos >= duration - 50) {
      replay.seek(0);
      replay.setPlaying(true);
    }
  }, [loop, file, replay, pos, duration]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ' && file) {
        e.preventDefault();
        replay.setPlaying(!replay.playing);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [file, replay, onClose]);

  // the track: the whole moment, played part lit, play head, the moment of largest change
  useEffect(() => {
    const el = track.current;
    if (!el || !prep) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (el.width = el.clientWidth * dpr),
      H = (el.height = el.clientHeight * dpr);
    const g = el.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const n = prep.n,
      head = duration ? pos / duration : 0,
      mid = H / 2;
    const x = (i: number) => (i / Math.max(1, n - 1)) * W;
    const draw = (from: number, to: number, alpha: number, glow: number) => {
      g.save();
      g.beginPath();
      g.rect(from * W, 0, (to - from) * W, H);
      g.clip();
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, scene.c2);
      grad.addColorStop(0.5, scene.c1);
      grad.addColorStop(1, scene.c2);
      g.strokeStyle = grad;
      g.shadowColor = scene.glow + '0.9)';
      g.shadowBlur = glow * dpr;
      prep.lines.forEach((l, k) => {
        g.globalAlpha = alpha * (0.3 + 0.12 * (k % 3));
        g.lineWidth = (k === 0 ? 2.4 : 1.4) * dpr;
        g.beginPath();
        l.forEach((v, i) => {
          const y =
            mid + (k - 2.5) * 5 * dpr - Math.max(-1.6, Math.min(1.6, v / prep.scale)) * H * 0.26;
          if (i) g.lineTo(x(i), y);
          else g.moveTo(x(i), y);
        });
        g.stroke();
      });
      g.restore();
    };
    draw(0, head, 1, 14);
    draw(head, 1, 0.28, 0);
    // the moment of largest change
    const px = x(prep.peak);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.arc(px, 10 * dpr, 4 * dpr, 0, Math.PI * 2);
    g.fill();
    g.setLineDash([3 * dpr, 5 * dpr]);
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.beginPath();
    g.moveTo(px, 16 * dpr);
    g.lineTo(px, H);
    g.stroke();
    g.setLineDash([]);
    g.font = `${11 * dpr}px "Microsoft YaHei UI", sans-serif`;
    g.textAlign = 'left';
    // task sessions: each state's period shaded, its name where there is room
    const sx = (t: number) => (duration ? Math.min(1, (t * 1000) / duration) * W : 0);
    const names = [...new Set((meta?.periods ?? []).map((p) => p.name))];
    for (const p of meta?.periods ?? []) {
      const x0 = sx(p.from),
        x1 = sx(p.to),
        k = names.indexOf(p.name);
      g.fillStyle = PERIOD_FILL[k % PERIOD_FILL.length];
      g.fillRect(x0, 0, x1 - x0, H);
      if (x1 - x0 > g.measureText(p.name).width + 10 * dpr) {
        g.fillStyle = k % 2 ? '#b9cdff' : '#f0c27a';
        g.fillText(p.name, x0 + 5 * dpr, 14 * dpr);
      }
    }
    // the moments marked while recording
    for (const m of meta?.marks ?? []) {
      const mx = duration ? Math.min(1, (m.t * 1000) / duration) * W : 0;
      g.setLineDash([4 * dpr, 4 * dpr]);
      g.strokeStyle = 'rgba(240,170,60,0.8)';
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.moveTo(mx, 4 * dpr);
      g.lineTo(mx, H);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#f0c27a';
      g.fillText(m.label, Math.min(mx + 5 * dpr, W - 60 * dpr), 14 * dpr);
    }
    // play head
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * dpr;
    g.shadowColor = '#ffffff';
    g.shadowBlur = 10 * dpr;
    g.beginPath();
    g.moveTo(head * W, 0);
    g.lineTo(head * W, H);
    g.stroke();
  }, [prep, pos, duration, scene, meta]);

  // rhythm bars at the play head: each band's share of 1–40 Hz power, all electrodes
  const alpha = replay.view.alpha;
  const bars = useMemo(() => {
    if (!alpha?.psd?.length) return null;
    const f = alpha.frequencies;
    const p = BANDS.map(([, , lo, hi]) => {
      let s = 0;
      alpha.psd.forEach((row) => f.forEach((fr, i) => fr >= lo && fr < hi && (s += row[i])));
      return s;
    });
    const total = p.reduce((a, b) => a + b, 0) || 1;
    return p.map((v) => v / total);
  }, [alpha]);
  const seekTo = (frac: number) => replay.seek(Math.max(0, Math.min(1, frac)) * duration);
  const when = meta ? new Date(meta.start ?? meta.recordedAt) : null;

  return (
    <div
      className="mp"
      role="dialog"
      aria-label="片段播放"
      style={{ ['--c1' as string]: scene.c1, ['--c2' as string]: scene.c2 }}
    >
      <div
        className="mp-glow"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${scene.glow}0.22), transparent 60%)`,
        }}
      />
      <header className="mp-head">
        <div>
          <small>{typeLabel}</small>
          <h1>{title || meta?.title || '脑电记录'}</h1>
          <span>
            {when?.toLocaleString('zh-CN', { dateStyle: 'long', timeStyle: 'short' })}
            {file
              ? ` · ${mmss(duration)} · ${file.header.metadata.channels} 通道 · ${file.header.metadata.rate} Hz`
              : ''}
          </span>
          {meta?.note && (
            <p>
              「{meta.note}」{meta.sign ? ` —— ${meta.sign}` : ''}
            </p>
          )}
        </div>
        <button className="mp-close" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {error && <p className="task-error">{error}</p>}
      {file && prep && (
        <>
          <div
            className="mp-track"
            role="slider"
            aria-label="播放位置"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration / 1000)}
            aria-valuenow={Math.round(pos / 1000)}
            tabIndex={0}
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seekTo((e.clientX - r.left) / r.width);
              const move = (m: PointerEvent) => seekTo((m.clientX - r.left) / r.width);
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          >
            <canvas ref={track} data-native />
            <span
              className="mp-peak"
              style={{ left: `${(prep.peak / Math.max(1, prep.n - 1)) * 100}%` }}
            >
              变化最明显
            </span>
          </div>
          <div className="mp-ctrl">
            <span className="mp-time mono">
              {mmss(pos)} <small>/ {mmss(duration)}</small>
            </span>
            <button
              className="mp-btn"
              aria-label="后退 5 秒"
              onClick={() => replay.seek(pos - 5000)}
            >
              <SkipBack size={16} />
            </button>
            <button
              className="mp-play"
              aria-label={replay.playing ? '暂停' : '播放'}
              onClick={() => replay.setPlaying(!replay.playing)}
            >
              {replay.playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button
              className="mp-btn"
              aria-label="前进 5 秒"
              onClick={() => replay.seek(pos + 5000)}
            >
              <SkipForward size={16} />
            </button>
            <button className="mp-chip" onClick={() => replay.seek((prep.peakS - 1) * 1000)}>
              跳到变化最明显的一刻
            </button>
            <span className="grow" />
            <button
              className={`mp-chip ${loop ? 'on' : ''}`}
              aria-pressed={loop}
              onClick={() => setLoop(!loop)}
            >
              <RotateCcw size={13} />
              循环
            </button>
            <span className="mp-seg">
              {[0.5, 1, 2].map((v) => (
                <button
                  key={v}
                  className={replay.speed === v ? 'on' : ''}
                  onClick={() => replay.setSpeed(v)}
                >
                  {v}×
                </button>
              ))}
            </span>
            <button
              className="mp-btn"
              title="打开所在文件夹"
              aria-label="打开所在文件夹"
              onClick={() =>
                void (kind === 'session'
                  ? window.neuro?.session('reveal', { id })
                  : window.neuro?.moment('reveal', { id }))
              }
            >
              <FolderOpen size={16} />
            </button>
          </div>
          <div className="mp-live">
            <section className="mp-waves">
              <h3>16 个电极 · 播放位置前 5 秒</h3>
              <Waveform
                buffer={replay.buffer}
                clock={replay.clock}
                rate={file.header.metadata.rate}
                selected={-1}
                paused={!replay.playing}
                enabled={ALL_ON}
                active={replay.view.active}
                rail={replay.view.frame?.rail ?? undefined}
                scale={Number(localStorage.getItem('neurolink.waveScale') ?? 200) || 0}
                plain
              />
            </section>
            <section className="mp-bands">
              <h3>
                这一刻的脑波节律
                <Help note="replayBands" />
              </h3>
              {BANDS.map(([bid, sym, lo, hi], k) => (
                <div key={bid} className="mp-band">
                  <span>
                    <b>{sym}</b> {lo}–{hi} Hz
                  </span>
                  <i>
                    <u style={{ width: `${Math.round((bars?.[k] ?? 0) * 100)}%` }} />
                  </i>
                  <em className="mono">{bars ? `${Math.round(bars[k] * 100)}%` : '—'}</em>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
