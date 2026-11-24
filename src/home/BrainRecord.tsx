// 录制脑电 (信号工作台 · 主图): keep a moment — a birthday wish, a confession, an afternoon of
// reading — as the brain waves of that moment, marking instants while recording. After recording,
// the user names the moment and the marks; the card (momentCard.ts) shows the recording as light
// on the brain under the sky of that moment, three figures and the band power of every
// electrode over time. Saved as an image or an 8 s video. Built from what the app already holds;
// nothing leaves the computer.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, Film, Flag, Play, Square, X } from 'lucide-react';
import { electrodes } from '../electrodes';
import { brainHistory, type Brain } from './brainHistory';
import {
  CARD_H,
  CARD_W,
  cardData,
  drawCard,
  CARD_LINES,
  SKY_OPEN,
  type CardArt,
  type CardData,
  type CardLines,
  type Wave,
  type Mark,
} from './momentCard';
import { brainArt, skyArt } from './momentArt';
import { cardHero, type Print } from '../data/recordArt';

export type Recording = {
  id: string | null; // 脑电时刻 folder with the complete EEG (null if it could not be saved)
  frames: Brain[]; // 0.5 s brain frames (band power relative to the baseline)
  wave: number[][]; // a few channels, 50 Hz, µV
  start: Date;
  seconds: number;
  rate: number; // samples per second per channel
  brain: string | null; // the 3D brain when it stopped
  marks: Mark[]; // 标记此刻 while recording
};
export type Scene = {
  id: string;
  name: string;
  title: string;
  c1: string;
  c2: string;
  glow: string;
};
// New recordings are a plain 脑电时刻 record (RECORD); the occasions below stay only so moments
// saved with them keep their colours when replayed.
export const RECORD: Scene = {
  id: 'record',
  name: '脑电记录',
  title: '脑电记录',
  c1: '#a8f0d4',
  c2: '#3fc79a',
  glow: 'rgba(95,211,164,',
};
export const SCENES: Scene[] = [
  {
    id: 'birthday',
    name: '生日许愿',
    title: '许下生日愿望的那一刻',
    c1: '#ffd27a',
    c2: '#ff9a3c',
    glow: 'rgba(255,170,70,',
  },
  {
    id: 'love',
    name: '表白',
    title: '说出喜欢你的那一刻',
    c1: '#ffb3c6',
    c2: '#ff5c8a',
    glow: 'rgba(255,92,138,',
  },
  {
    id: 'anniversary',
    name: '纪念日',
    title: '我们的纪念日',
    c1: '#a8f0d4',
    c2: '#3fc79a',
    glow: 'rgba(95,211,164,',
  },
  {
    id: 'first',
    name: '第一次',
    title: '第一次',
    c1: '#c9c2ff',
    c2: '#8b7bff',
    glow: 'rgba(139,123,255,',
  },
  {
    id: 'custom',
    name: '其他时刻',
    title: '这一刻',
    c1: '#a8e4f0',
    c2: '#3fa7c7',
    glow: 'rgba(63,167,199,',
  },
  RECORD,
];
type Moment = { scene: Scene; title: string; note: string; sign: string; marks: Mark[] };
const MIN_S = 5;
export const WAVE_HZ = 50;
export const WAVE_CH = ['Fp1', 'Fp2', 'C3', 'C4', 'O1', 'O2']
  .map((n) => electrodes.findIndex((e) => e.name === n))
  .filter((c) => c >= 0);
const W = CARD_W,
  H = CARD_H;
const MAX_MARKS = 6;
// 添加脑电数据 (脑电数据库) opens 信号工作台 and starts recording there: asked here, taken by
// the RecordButton once it is shown (only while streaming)
let asked = 0;
export function recordNow() {
  asked = Date.now();
  window.dispatchEvent(new Event('record-now'));
}
const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export function RecordButton({
  getBrain,
  buffer,
  rate,
  onDone,
}: {
  getBrain: () => string | null;
  buffer: MutableRefObject<number[][]>;
  rate: number;
  onDone: (r: Recording) => void;
}) {
  const [since, setSince] = useState<{ t: number; wall: number; id: string | null } | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const wave = useRef<number[][]>([]);
  const marks = useRef<Mark[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) return;
    wave.current = WAVE_CH.map(() => []);
    marks.current = [];
    const step = Math.max(1, Math.round(rate / WAVE_HZ));
    const n = Math.round(rate * 0.25);
    const id = setInterval(() => {
      // the last 0.25 s of a few channels, 50 Hz
      WAVE_CH.forEach((c, k) => {
        const d = (buffer.current[c] ?? []).slice(-n);
        for (let i = 0; i + step <= d.length; i += step) {
          let s = 0;
          for (let j = 0; j < step; j++) s += d[i + j];
          wave.current[k].push(s / step);
        }
      });
      tick((x) => x + 1);
    }, 250);
    return () => clearInterval(id);
  }, [since, buffer, rate]);
  const elapsed = since ? (Date.now() - since.wall) / 1000 : 0;
  // while recording: a frame around the whole window and a REC badge, as when filming the screen
  // (in document.body: inside the page a transformed ancestor would clip it under the sidebar)
  const frame =
    since &&
    createPortal(
      <div className="rec-frame" aria-hidden="true">
        <span className="rec-badge">
          <i className="rec-dot" />
          REC <b className="mono">{mmss(elapsed)}</b> 正在录制脑电
        </span>
      </div>,
      document.body,
    );
  const start = async () => {
    const f = brainHistory.frames;
    const t = f[f.length - 1]?.t ?? 0;
    setError('');
    setStarting(true);
    // the complete EEG is written to the 脑电时刻 folder while recording
    const started = await window.neuro?.moment('start').catch((e: Error) => {
      setError(e.message);
      return null;
    });
    setStarting(false);
    if (!started?.id) {
      setError((e) => e || '录制未开始，请检查设备连接后重试');
      return;
    }
    setSince({ t, wall: Date.now(), id: started.id });
  };
  useEffect(() => {
    const take = () => {
      // a request older than a few seconds is stale (the page was left meanwhile)
      if (!asked || Date.now() - asked > 5000) return;
      asked = 0;
      void start();
    };
    take();
    window.addEventListener('record-now', take);
    return () => window.removeEventListener('record-now', take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!since)
    return (
      <span className="rec-group">
        <button className="rec-btn" disabled={starting} onClick={() => void start()}>
          <i className="rec-dot" />
          {starting ? '正在开始…' : '录制脑电'}
        </button>
        {error && (
          <small className="rec-error" role="alert">
            {error}
          </small>
        )}
      </span>
    );
  return (
    <span className="rec-group">
      {frame}
      <button
        className="rec-btn on"
        disabled={elapsed < MIN_S}
        title={elapsed < MIN_S ? `至少录制 ${MIN_S} 秒` : '停止录制'}
        onClick={async () => {
          const frames = brainHistory.frames.filter((f) => f.t > since.t && f.r);
          const brain = getBrain();
          setSince(null);
          // the length the recorder wrote (from its samples), so the card and 脑电数据库 agree
          let seconds = elapsed;
          if (since.id) {
            const r = await window.neuro?.moment('stop', { id: since.id }).catch(() => null);
            if (Number.isFinite(r?.seconds) && r.seconds > 0) seconds = r.seconds;
          }
          onDone({
            id: since.id,
            frames,
            wave: wave.current,
            start: new Date(since.wall),
            seconds,
            rate,
            brain,
            marks: marks.current,
          });
        }}
      >
        <Square size={11} fill="currentColor" />
        <span className="mono">{mmss(elapsed)}</span>
        停止录制
      </button>
      <button
        className="rec-btn rec-mark"
        disabled={marks.current.length >= MAX_MARKS}
        title="在这一刻做个标记，生成卡片时可以命名"
        onClick={() => {
          marks.current.push({ t: elapsed, label: `标记 ${marks.current.length + 1}` });
          tick((x) => x + 1);
        }}
      >
        <Flag size={12} />
        标记此刻{marks.current.length ? ` · ${marks.current.length}` : ''}
      </button>
    </span>
  );
}

// Detrended (1 s moving average removed) channels and the moment of the largest 1 s RMS.
export function prepare(rec: Pick<Recording, 'wave'>) {
  const lines = rec.wave.map((x) => {
    const out: number[] = [];
    let s = 0;
    const q: number[] = [];
    for (const v of x) {
      q.push(v);
      s += v;
      if (q.length > WAVE_HZ) s -= q.shift()!;
      out.push(v - s / q.length);
    }
    return out;
  });
  const samples = lines.length ? Math.min(...lines.map((l) => l.length)) : 0;
  // the strongest 1 s, leaving out the first and last second (filter warm-up, button press)
  const energy: number[] = [];
  for (let i = 0; i < samples; i++) energy.push(lines.reduce((a, l) => a + l[i] * l[i], 0));
  let best = -1,
    run = 0,
    at = Math.floor(samples / 2);
  for (let i = WAVE_HZ; i < samples - WAVE_HZ; i++) {
    run += energy[i] - (i >= 2 * WAVE_HZ ? energy[i - WAVE_HZ] : 0);
    if (i >= 2 * WAVE_HZ && run > best) {
      best = run;
      at = i - WAVE_HZ / 2;
    }
  }
  // drawn as at most 180 points per line (bin means, then two light smoothing passes): a calm ribbon
  const n = Math.min(samples, 180);
  const disp = lines.map((l) => {
    const binned = Array.from({ length: n }, (_, k) => {
      const a0 = Math.floor((k * samples) / n),
        a1 = Math.max(a0 + 1, Math.floor(((k + 1) * samples) / n));
      let sum = 0;
      for (let i = a0; i < a1; i++) sum += l[i];
      return sum / (a1 - a0);
    });
    const smooth = (x: number[]) =>
      x.map((v, k) => (x[k - 1] ?? v) * 0.25 + v * 0.5 + (x[k + 1] ?? v) * 0.25);
    return smooth(smooth(binned));
  });
  const all = disp
    .flat()
    .map(Math.abs)
    .sort((x, y) => x - y);
  const scale = all[Math.floor(all.length * 0.95)] || 1;
  return {
    lines: disp,
    n,
    samples,
    peak: Math.round((at / Math.max(1, samples - 1)) * (n - 1)),
    peakS: at / WAVE_HZ,
    scale,
  };
}

export function ShareCard({
  rec,
  onClose,
  onReplay,
}: {
  rec: Recording;
  onClose: () => void;
  onReplay?: (id: string) => void;
}) {
  const [mo, setMo] = useState<Moment | null>(null);
  const scene = RECORD;
  const [title, setTitle] = useState(RECORD.title);
  const [note, setNote] = useState('');
  const [sign, setSign] = useState('');
  const [names, setNames] = useState(() => rec.marks.map((m) => m.label));
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const prep = useRef<ReturnType<typeof prepare> | null>(null);
  prep.current ??= prepare(rec);
  const data = useRef<CardData | null>(null);
  // the chart's frames (1 s every 0.3 s), computed from the 脑电时刻 folder just written
  const [chart, setChart] = useState<Brain[] | null>(null);
  const [wave, setWave] = useState<Wave | null>(null);
  useEffect(() => {
    let gone = false;
    if (rec.id)
      window.neuro
        ?.data('frames', { kind: 'moment', id: rec.id })
        .then((f: { lines: Brain[]; wave?: Wave }) => {
          if (gone) return;
          data.current = null;
          setChart(f.lines);
          setWave(f.wave ?? null);
        })
        .catch(() => {});
    return () => {
      gone = true;
    };
  }, [rec]);
  // the card's pictures (momentArt.ts), null until made
  const [art, setArt] = useState<CardArt | null>(null);
  // the chart's line style, tuned live in a panel opened with Ctrl+Shift+L (kept on this computer)
  const [lines, setLines] = useState<CardLines>(() => {
    try {
      return { ...CARD_LINES, ...JSON.parse(localStorage.getItem('neurolink.cardLines') ?? '{}') };
    } catch {
      return CARD_LINES;
    }
  });
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [tuning, setTuning] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') setTuning((v) => !v);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const tune = (k: keyof CardLines, v: number) => {
    const next = { ...lines, [k]: v };
    setLines(next);
    localStorage.setItem('neurolink.cardLines', JSON.stringify(next));
  };
  const input = (m: Moment) => ({
    frames: rec.frames,
    lines: chart ?? undefined,
    wave: wave ?? undefined,
    start: rec.start,
    seconds: rec.seconds,
    rate: rec.rate,
    marks: m.marks,
    scene: m.scene,
    title: m.title,
    note: m.note,
    sign: m.sign,
  });
  const paint = (
    ctx: CanvasRenderingContext2D,
    m: Moment,
    progress: number,
    t: number,
    stamp: number,
  ) => {
    data.current ??= cardData(input(m));
    drawCard(ctx, input(m), data.current, progress, t, stamp, art ?? undefined, linesRef.current);
  };
  // the pictures depend only on the recording: made once (about a second); in the middle α on
  // the brain with its bar, as the card of 数据 (cardMaker.ts); without spectra, 神经光流
  useEffect(() => {
    let gone = false;
    const sky = skyArt(rec.start, W, H, undefined, undefined, undefined, SKY_OPEN);
    const hero = rec.id
      ? (window.neuro?.data('print', { kind: 'moment', id: rec.id }) as Promise<Print | null>)
          .then((print) => (print ? cardHero(print, W, 625) : null))
          .catch(() => null)
      : Promise.resolve(null);
    Promise.all([brainArt(rec.frames.filter((f) => f.r)).catch(() => null), hero]).then(
      ([brain, hero]) => !gone && setArt({ sky, brain, hero }),
    );
    return () => {
      gone = true;
    };
  }, [rec]);
  // the card opens by drawing the time axis, then the maps, note and strip appear
  useEffect(() => {
    const el = ref.current;
    if (!el || !mo) return;
    const ctx = el.getContext('2d')!;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      paint(ctx, mo, Math.min(1, t / 2.5), t, Math.max(0, Math.min(1, (t - 2.5) / 0.6)));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rec, mo, art, chart]);

  const p2 = (v: number) => String(v).padStart(2, '0');
  const when = `${rec.start.getFullYear()}${p2(rec.start.getMonth() + 1)}${p2(rec.start.getDate())}-${p2(rec.start.getHours())}${p2(rec.start.getMinutes())}`;
  const file = (ext: string) => `OpenCiv-BCI-001-${mo?.scene.name ?? '脑电记录'}-${when}.${ext}`;
  const still = () => {
    const c = document.createElement('canvas');
    c.dataset.native = ''; // dark card colours as drawn (theme.ts maps the others)
    c.width = W;
    c.height = H;
    paint(c.getContext('2d')!, mo!, 1, 1, 1);
    return c;
  };
  const save = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  async function video() {
    setBusy(true);
    setMsg('');
    const c = document.createElement('canvas');
    c.dataset.native = ''; // dark card colours as drawn (theme.ts maps the others)
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const mr = new MediaRecorder(c.captureStream(30), {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 6e6,
    });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (mr.onstop = () => r()));
    mr.start();
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const t = (now - t0) / 1000;
        paint(ctx, mo!, Math.min(1, t / 5.5), t, Math.max(0, Math.min(1, (t - 5.6) / 0.7)));
        if (t < 8) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    mr.stop();
    await done;
    save(new Blob(chunks, { type: 'video/webm' }), file('webm'));
    setBusy(false);
    setMsg('视频已保存');
  }

  // the moment (text and card) is kept with its EEG in 脑电时刻
  const [saved, setSaved] = useState('');
  useEffect(() => {
    if (!mo || !rec.id || !art) return;
    const id = setTimeout(() => {
      window.neuro
        ?.moment('save', {
          id: rec.id,
          scene: mo.scene.id,
          sceneName: mo.scene.name,
          title: mo.title,
          note: mo.note,
          marks: mo.marks,
          sign: mo.sign,
          start: rec.start.toISOString(),
          card: still().toDataURL('image/png'),
        })
        .then(() => setSaved('已保存到「脑电数据库」，包括完整的脑电数据'))
        .catch((e: Error) => setSaved(`保存失败：${e.message}`));
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mo, art]);

  const usable = rec.frames.length >= 4 && (prep.current?.samples ?? 0) > 3 * WAVE_HZ;
  return (
    <div className="share" role="dialog" aria-label="脑电记录">
      <div className="share-box">
        <button className="share-close" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
        {!usable ? (
          <p className="share-empty">
            这段录制里还没有可用的脑电数据（需要先完成初始化并建立基线）。
          </p>
        ) : !mo ? (
          <form
            className="moment-form"
            onSubmit={(e) => {
              e.preventDefault();
              data.current = null;
              setMo({
                marks: rec.marks.map((m, i) => ({ t: m.t, label: names[i]?.trim() || m.label })),
                scene,
                title: title.trim() || scene.title,
                note: note.trim(),
                sign: sign.trim(),
              });
            }}
          >
            <h2>脑电记录</h2>
            <label>
              标题
              <input value={title} maxLength={20} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              备注（可选）
              <input value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} />
            </label>
            {rec.marks.length > 0 && (
              <fieldset className="moment-marks">
                <legend>标记的时刻</legend>
                {rec.marks.map((m, i) => (
                  <label key={i}>
                    <span className="mono">{mmss(m.t)}</span>
                    <input
                      aria-label={`标记 ${i + 1} 的名称`}
                      value={names[i] ?? ''}
                      maxLength={8}
                      onChange={(e) =>
                        setNames((n) => n.map((v, j) => (j === i ? e.target.value : v)))
                      }
                    />
                  </label>
                ))}
              </fieldset>
            )}
            <label>
              署名（可选）
              <input value={sign} maxLength={16} onChange={(e) => setSign(e.target.value)} />
            </label>
            <button className="primary" type="submit">
              生成卡片
            </button>
          </form>
        ) : (
          <>
            <canvas
              ref={ref}
              width={W}
              height={H}
              className="share-canvas"
              data-native
              aria-label="脑电卡片"
            />
            <div className="share-actions">
              <button
                className="primary"
                onClick={() => still().toBlob((b) => b && save(b, file('png')), 'image/png')}
              >
                <Download size={15} />
                保存图片
              </button>
              <button
                className="secondary"
                onClick={() =>
                  still().toBlob(async (b) => {
                    if (!b) return;
                    try {
                      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
                      setMsg('已复制，可以直接粘贴到聊天里');
                    } catch {
                      setMsg('复制失败，请改用保存图片');
                    }
                  }, 'image/png')
                }
              >
                <Copy size={15} />
                复制图片
              </button>
              <button className="secondary" disabled={busy} onClick={() => void video()}>
                <Film size={15} />
                {busy ? '正在生成视频（8 秒）…' : '保存视频'}
              </button>
              {rec.id && onReplay && (
                <button className="secondary" onClick={() => onReplay(rec.id!)}>
                  <Play size={15} />
                  重放脑电
                </button>
              )}
              <button className="text-button" onClick={() => setMo(null)}>
                修改文字
              </button>
              <span className="share-note">{msg || saved}</span>
            </div>
            {tuning && (
              <div className="card-tune" aria-label="线条调整">
                {(
                  [
                    ['mute', '颜色压暗', 0, 1, 0.05],
                    ['width', '线宽', 0.5, 5, 0.1],
                    ['alpha', '不透明度', 0.2, 1, 0.05],
                    ['amp', '起伏幅度', 0.2, 2.5, 0.05],
                    ['glow', '发光', 0, 12, 0.5],
                  ] as [keyof CardLines, string, number, number, number][]
                ).map(([k, label, min, max, step]) => (
                  <label key={k}>
                    <span>{label}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={lines[k]}
                      onChange={(e) => tune(k, Number(e.target.value))}
                    />
                    <b className="mono">{lines[k].toFixed(2)}</b>
                  </label>
                ))}
                <div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setLines(CARD_LINES);
                      localStorage.removeItem('neurolink.cardLines');
                    }}
                  >
                    恢复默认
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void navigator.clipboard.writeText(JSON.stringify(lines))}
                  >
                    复制参数
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
