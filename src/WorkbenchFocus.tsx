import { boxOf } from './elementBox';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Check, ChevronsLeft, ChevronsRight, LoaderCircle, Plug, X } from 'lucide-react';
import type { AlphaFrame, Frame, Metadata } from './types';
import { displayFilter, uvrms } from './displayFilter';
import { RecordButton, ShareCard, type Recording } from './home/BrainRecord';
import Waveform from './Waveform';
import { electrodeNames, electrodes } from './electrodes';
import { BrainScene, PALETTE_CSS, ratioPosition, type View } from './home/brainScene';
import { BAND_COLORS, NeuralSim, computePlv } from './home/neural';
import BrainTimeline, { clock as timeText } from './home/BrainTimeline';
import { BANDS, BAND_ORDER, READY, STEP, brainHistory } from './home/brainHistory';
import { DisplaySmooth } from './home/displaySmooth';
import Help from './glossary/Help';
import { CONTACT_COLORS, ContactHead, ContactLegend, contactSummary } from './ContactMap';
import { HeadScene } from './lab/head3d/HeadScene.jsx';
import { useHeadBrain, useHeadStore } from './lab/HeadModel';
import './lab/head3d/head3d.css';
import { ELECTRODE_CARDS } from './electrodeCards';

type Band = (typeof BANDS)[number][0];
type WaveClock = { epoch: number; count: number };
const BAND_NAME: Record<Band, string> = {
  delta: 'Delta',
  theta: 'Theta',
  alpha: 'Alpha',
  beta: 'Beta',
  gamma: 'Gamma',
};
// Preset angles for the freely rotated brain: [view, label, azimuth, elevation] (degrees).
const VIEWS: [View, string, number, number][] = [
  ['top', '上', 0, 89.5],
  ['left', '左', -90, 10],
  ['right', '右', 90, 10],
  ['back', '后', 0, 10],
];
// 主图 opens on the 3D head (三维头像's, the brain inside) from the front and above, then zooms in
// to the brain; zooming out past the brain comes back to the head. One view drives both: the
// brain's orbit (az 0 from behind, 90 from the right; el above the horizon; zoom), the head's
// camera following it at the distance where its brain is drawn as large (HEAD_K / zoom, measured).
// Zoomed in, the head stays behind the brain, faint.
const HEAD_ZOOM = 0.6, // the whole head in view
  BRAIN_ZOOM = 0.9, // from here on, the brain alone (the head faint behind)
  // the head through a narrow lens, nearly flat as the brain (drawn orthographic): the scalp's
  // electrodes not pushed outwards by perspective. HEAD_K was measured at the head's own 37°.
  HEAD_FOV = 12,
  HEAD_K = (6.9 * Math.tan((37 / 360) * Math.PI)) / Math.tan((HEAD_FOV / 360) * Math.PI),
  HEAD_FAINT = 0.3, // the head behind the brain once zoomed in
  HEAD_SHOWN = 0.6, // the head itself, before zooming in: see-through, the brain inside
  OVERVIEW_ZOOM = 0.82,
  OPEN_ANGLE = { az: 180, el: 42 },
  ZOOM_MS = 1600;
const headDir = (az: number, el: number) => {
  const a = (az * Math.PI) / 180,
    e = (el * Math.PI) / 180;
  return [-Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};
const CONTACT: Record<string, [string, string]> = {
  ok: ['正常', 'ok'],
  poor: ['接触差', 'poor'],
  off: ['未接触', 'off'],
};
const geoMean = (a: number[]) => {
  const ok = a.filter(Number.isFinite);
  return ok.length ? Math.exp(ok.reduce((x, y) => x + y, 0) / ok.length) : NaN;
};
const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#5fd3a4';

export type Look = {
  layout: 'standard' | 'big' | 'immersive' | 'cinema' | 'mobile'; // mobile: the phone app (src/mobile)
  glass: boolean; // see-through brain
  spin: number; // degrees per second, 0 = still
  pointScale: number;
  brainZoom: number;
  labels: boolean; // electrode names on the brain
  regions: boolean; // brain region names on the brain
  neurons?: boolean; // 神经层: simulated neurons driven by the EEG
  links?: boolean; // 神经层: fibres lit by phase locking between electrodes
  neuronGain?: number; // flash brightness (1 = default)
  neuronBase?: number; // steady glow
  neuronSize?: number;
  linkGain?: number; // connection brightness
  linkSpeed?: number; // connection pulse speed
  linkSize?: number;
  neuronColor?: 'band' | 'mono' | 'surface'; // band = 主导节律 colour (default)
  neuronFollow?: boolean; // neurons follow only the band the cortex shows
  neuronQuiet?: boolean; // background glow only above baseline
  hud: boolean; // selected channel / strongest / colour scale over the brain
  trace: boolean; // selected channel waveform
  timeline: boolean;
  vignette: boolean; // glow behind the brain
};
// The look saved from 主图布局 (设为主图), used by the workbench's 主图.
const LOOK_KEY = 'neurolink.mainLook';
export function savedLook(): Look {
  try {
    // the brain's size, region names and the waveform row are the default's: a look saved
    // earlier kept the brain large (1.1), the names on and the waveform under the brain
    return {
      ...DEFAULT_LOOK,
      ...JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}'),
      brainZoom: DEFAULT_LOOK.brainZoom,
      regions: DEFAULT_LOOK.regions,
      trace: DEFAULT_LOOK.trace,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}
export function saveLook(look: Look | null) {
  if (look) localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  else localStorage.removeItem(LOOK_KEY);
}
// The original layout (三栏 + 通道状态), kept as a preset in 主图布局.
export const STANDARD_LOOK: Look = {
  layout: 'standard',
  glass: false,
  spin: 0,
  pointScale: 1,
  brainZoom: 1,
  labels: true,
  regions: false,
  hud: true,
  trace: true,
  timeline: true,
  vignette: false,
};
// The workbench's 主图 out of the box: the brain fills the view with floating panels, a slowly
// turning see-through brain (chosen in 主图布局, 2026-10-10; region names off since 2026-10-26).
export const DEFAULT_LOOK: Look = {
  layout: 'immersive',
  glass: true,
  spin: 6,
  pointScale: 0.8,
  brainZoom: 0.93, // two wheel steps smaller than the original 1.1 (1.1 × 0.92²; 2026-10-27)
  labels: true,
  regions: false, // no region names on the brain (2026-10-26)
  hud: true,
  trace: false, // no channel waveform under the brain (2026-11-03)
  timeline: true,
  vignette: true,
  neurons: true,
  links: true,
  neuronGain: 5.4,
  neuronBase: 2.05,
  neuronColor: 'surface',
  neuronFollow: true,
  neuronQuiet: true,
  linkGain: 1.35,
  linkSize: 1.15,
};

// The task shown in 任务 · 运行画面 (src/home/TaskPage.tsx).
export type TaskView = {
  id: string;
  name: string;
  running: boolean;
  region: string; // the model's region / method label
  group: number[]; // its electrodes
  modelBand?: Band;
  targets: Set<string>; // states that trigger
  marks: number[]; // trigger times (s)
};

// 信号工作台 · 主图 layout (default): the digital brain of 运行画面 in the middle; around it
// only what is needed to read it — band energy (left), channel state (right), raw signal
// (bottom). Everything follows the linked channel.
export default function WorkbenchFocus({
  buffer,
  clock,
  frame,
  alpha,
  meta,
  active,
  paused,
  selected,
  select,
  enabled,
  navigate,
  connecting = false,
  look = DEFAULT_LOOK,
  task,
  onReplay,
}: {
  buffer: MutableRefObject<number[][]>;
  clock: MutableRefObject<WaveClock>;
  frame: Frame | null;
  alpha: AlphaFrame | null;
  meta: Metadata | null;
  active: boolean;
  paused: boolean;
  selected: number;
  select: (i: number) => void;
  enabled: boolean[];
  navigate: (page: string) => void;
  connecting?: boolean;
  look?: Look; // 主图布局 (WorkbenchLab): layout and display options
  task?: TaskView; // 任务 · 运行画面: the same view plus the task's recognition and triggers
  onReplay?: (momentId: string) => void; // 脑电时刻: play a recorded moment back
}) {
  const [band, setBand] = useState<Band>(task?.modelBand ?? 'alpha');
  // 电极卡片: a point on the head clicked; × or Esc closes it
  const [card, setCard] = useState<number | null>(null);
  useEffect(() => {
    if (card === null) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setCard(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [card]);
  const [shared, setShared] = useState<Recording | null>(null); // 录制脑电 → 脑纹
  const [view, setView] = useState<View | null>(null); // preset, or null after dragging
  // Camera: free rotation by dragging, zoom by scrolling; presets turn to their angle smoothly.
  const orbit = useRef({ ...OPEN_ANGLE, zoom: HEAD_ZOOM });
  const drag = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const turn = useRef(0);
  // Drawing the brain goes straight to the scene (drawRef), at most once a frame, not through
  // a re-render of the whole 主图: the animations (rotation, smoothing, 神经层) each re-rendered
  // it every frame. Nothing is drawn while the window is hidden or minimised.
  const drawRef = useRef(() => {});
  const frameReq = useRef(0);
  const requestDraw = () => {
    if (frameReq.current) return;
    frameReq.current = requestAnimationFrame(() => {
      frameReq.current = 0;
      if (!document.hidden) drawRef.current();
    });
  };
  const redraw = (_: (n: number) => number) => requestDraw();
  // Auto-rotation: on by default when the look spins; stops when the user moves the brain;
  // the 自转 button turns it back on.
  // 神经元 / 脑区连接: as the look sets them (their legend is gone from the 主图)
  const showNeurons = !!look.neurons,
    showLinks = !!look.links;
  const [spinning, setSpinning] = useState(look.spin > 0);
  const [fitOpen, setFitOpen] = useState(false);
  // immersive layout: the floating side panels stay within the brain area and scroll
  const [panelBounds, setPanelBounds] = useState({ top: 60, height: 360 });
  // 时间序列: fixed µV per row (shared with the 时间序列 chart) or each row scaled to its signal
  // 时间序列 panel: as wide as the left panel, or widened for more readable signal
  // 频段能量 and 时间序列 share one panel, switched by its tabs
  const [sideTab, setSideTab] = useState<'bands' | 'wave'>(() =>
    localStorage.getItem('neurolink.sideTab') === 'wave' ? 'wave' : 'bands',
  );
  const tab = (t: 'bands' | 'wave') => {
    setSideTab(t);
    localStorage.setItem('neurolink.sideTab', t);
  };
  const [waveWide, setWaveWide] = useState(
    () => localStorage.getItem('neurolink.waveWide') === '1',
  );
  const [waveScale, setWaveScale] = useState(
    () => Number(localStorage.getItem('neurolink.waveScale')) || 0,
  );
  // 佩戴检查 in the workbench header
  useEffect(() => {
    const on = () => setFitOpen((v) => !v);
    window.addEventListener('brainlab:fit-check', on);
    return () => window.removeEventListener('brainlab:fit-check', on);
  }, []);
  useEffect(() => setSpinning(look.spin > 0), [look.spin]);
  const goTo = (v: View) => {
    setSpinning(false);
    const [, , az, el] = VIEWS.find(([id]) => id === v)!;
    const from = { ...orbit.current };
    // Shortest way round.
    const dAz = ((((az - from.az) % 360) + 540) % 360) - 180;
    const start = performance.now();
    cancelAnimationFrame(turn.current);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450),
        e = 1 - (1 - k) ** 3;
      orbit.current.az = from.az + dAz * e;
      orbit.current.el = from.el + (el - from.el) * e;
      redraw((n) => n + 1);
      if (k < 1) turn.current = requestAnimationFrame(step);
    };
    turn.current = requestAnimationFrame(step);
    setView(v);
  };
  const [scene, setScene] = useState<BrainScene | null>(null);
  // the head (HEAD_ZOOM above): its brain painted as this one, its electrodes from the data
  const inner = useHeadBrain(false);
  const head = useHeadStore(meta?.rate || 250, meta?.boardId === -1, active);
  const headApi = useRef<{
    place: (dir: number[], distance: number, fov?: number) => void;
    project: () => Record<string, { x: number; y: number; fade: number }>;
  } | null>(null);
  const faceRef = useRef(null);
  useEffect(() => {
    if (frame) head.feed(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null); // replay position; null: live
  const [labels, setLabels] = useState<({ x: number; y: number; fade: number } | null)[]>([]);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [regions, setRegions] = useState<{ name: string; x: number; y: number }[]>([]);
  // on opening: the head for a moment, then into the brain
  useEffect(() => {
    let raf = 0;
    const id = setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / ZOOM_MS),
          e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        orbit.current.zoom = HEAD_ZOOM + (1 - HEAD_ZOOM) * e;
        redraw((n) => n + 1);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, 1500);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, []);
  useEffect(() => {
    let s: BrainScene | null = null,
      gone = false;
    BrainScene.create(
      electrodes.map((e) => e.xyz),
      { glass: look.glass },
    )
      .then((created) => {
        if (gone) created.dispose();
        else {
          created.showSky(true); // the real sky of this moment around the brain
          created.transparent(); // the head shows behind it
          setScene((s = created));
        }
      })
      .catch(() => setError('无法加载大脑模型'));
    return () => {
      gone = true;
      s?.dispose();
    };
  }, [look.glass]);
  // Slow automatic rotation (paused while dragging or turning to a preset).
  useEffect(() => {
    if (!spinning) return;
    const speed = look.spin || 6;
    let raf = 0,
      prev = performance.now();
    const step = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      if (!drag.current) {
        orbit.current.az += speed * dt;
        if (orbit.current.el > 60) orbit.current.el = 35; // a turning brain reads best from the side
        redraw((n) => n + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [spinning, look.spin]);
  useEffect(() => brainHistory.subscribe(() => setTick((n) => n + 1)), []);
  // 神经层 (design/neural-sim stages 1–2): oscillators per electrode and band, driven by the
  // band power; PLV between electrodes every 2 s couples them and lights the fibres.
  const sim = useRef<NeuralSim | null>(null);
  const bandRef = useRef(0);
  // Effects only while the cap is worn (engine whole-cap judgement; undecided = not worn).
  const worn = !!active && frame?.contact?.worn === true;
  // Live: the brain follows the frames gently (displaySmooth); replay shows the frames as they are.
  const smooth = useRef(new DisplaySmooth(electrodeNames.length));
  useEffect(() => {
    if (!scene || !worn || cursor !== null) return;
    let raf = 0,
      prev = performance.now();
    const step = (now: number) => {
      const s = smooth.current,
        h = brainHistory.frames;
      s.push(h[h.length - 1]);
      if (s.step((now - prev) / 1000)) redraw((n) => n + 1);
      prev = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scene, worn, cursor]);
  const neuronsOn = showNeurons && worn,
    linksOn = showLinks && worn;
  const styleRef = useRef<{ colorMode: number }>({ colorMode: 0 });
  bandRef.current = BANDS.findIndex(([id]) => id === band);
  useEffect(() => {
    if (!scene) return;
    try {
      scene.showNeurons(neuronsOn);
      scene.showLinks(linksOn);
      scene.setNeuralStyle(style);
    } catch (e) {
      console.error('neural layer', e);
    }
    redraw((n) => n + 1);
    if (!neuronsOn && !linksOn) return;
    sim.current ??= new NeuralSim();
    const s = sim.current;
    let raf = 0,
      prev = performance.now(),
      lastPlv = 0;
    const show = new Float32Array(120),
      target = new Float32Array(120),
      lead = new Float32Array(120);
    let lags: Float32Array[] | null = null;
    const step = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      s.setRatios(smooth.current.ready ? smooth.current.shown : null);
      if (now - lastPlv > 2000) {
        lastPlv = now;
        const p = computePlv(buffer.current, meta?.rate || 250);
        if (p) {
          s.plv = p.plv;
          lags = p.lag;
        }
      }
      s.step(dt);
      scene.setNeural(s.amp, s.phase, now / 1000, bandRef.current);
      const plv = s.plv?.[bandRef.current];
      if (plv) {
        // show the strongest quarter of the pairs, scaled above that level
        const vals: number[] = [];
        for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) vals.push(plv[i * 16 + j]);
        const sorted = [...vals].sort((a, b) => a - b);
        const thr = Math.max(0.35, sorted[Math.floor(sorted.length * 0.75)]);
        vals.forEach(
          (v, k) =>
            (target[k] = Math.max(
              0,
              Math.min(1, (v - thr) / (1 - thr) + 0.25 * (v > thr ? 1 : 0)),
            )),
        );
      }
      // fade towards the new locking (no popping every 2 s)
      const k = 1 - Math.exp(-dt / 0.8);
      for (let i = 0; i < show.length; i++) show[i] += (target[i] - show[i]) * k;
      const lag = lags?.[bandRef.current];
      if (lag)
        for (let i = 0, k = 0; i < 16; i++)
          for (let j = i + 1; j < 16; j++) lead[k++] = lag[i * 16 + j];
      scene.setLinks(
        show,
        lag ? lead : null,
        styleRef.current.colorMode ? '#c8e6ff' : BAND_COLORS[bandRef.current],
        now / 1000,
      );
      redraw((n) => n + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, neuronsOn, linksOn]);
  const style = {
    gain: look.neuronGain ?? 1,
    base: look.neuronBase ?? 1,
    size: look.neuronSize ?? 1,
    linkGain: look.linkGain ?? 1,
    linkSpeed: look.linkSpeed ?? 1,
    linkSize: look.linkSize ?? 1,
    colorMode: look.neuronColor === 'mono' ? 1 : look.neuronColor === 'surface' ? 2 : 0,
    follow: !!look.neuronFollow,
    quiet: !!look.neuronQuiet,
  };
  styleRef.current = style;
  useEffect(() => {
    scene?.setNeuralStyle(style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scene,
    style.gain,
    style.base,
    style.size,
    style.linkGain,
    style.linkSpeed,
    style.linkSize,
    style.colorMode,
    style.follow,
    style.quiet,
  ]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const brain = canvas.current?.parentElement;
    const root = brain?.closest('.wbf');
    if (!brain || !root) return;
    const measure = () => {
      const box = brain.getBoundingClientRect(),
        outer = root.getBoundingClientRect();
      const next = { top: box.top - outer.top + 52, height: Math.max(100, box.height - 100) };
      setPanelBounds((p) => (p.top === next.top && p.height === next.height ? p : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(brain);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, [look.layout]);
  const floatingPanelStyle =
    look.layout === 'immersive'
      ? { marginTop: panelBounds.top, maxHeight: panelBounds.height, overflowY: 'auto' as const }
      : undefined;

  const headShown = Math.max(
    0,
    Math.min(1, (BRAIN_ZOOM - orbit.current.zoom) / (BRAIN_ZOOM - HEAD_ZOOM)),
  );
  const h = brainHistory.frames;
  const latest = h[h.length - 1];
  // The frame on screen: the latest, or the one being replayed on the timeline.
  const last = h[cursor === null ? h.length - 1 : Math.min(cursor, h.length - 1)];
  const b = BANDS.findIndex(([id]) => id === band);
  const values =
    cursor === null
      ? smooth.current.ready
        ? smooth.current.shown[b]
        : null
      : (last?.r?.[b] ?? null);
  const ratio = (c: number) => (values && Number.isFinite(values[c]) ? Math.exp(values[c]) : NaN);
  const ranked = electrodeNames
    .map((_, c) => c)
    .filter((c) => Number.isFinite(ratio(c)))
    .sort((x, y) => ratio(y) - ratio(x));
  // each name beside its point: outwards (left of it on the left half), or inwards where it
  // would cover another electrode; outer ones placed first
  const labelLeft = (() => {
    const mid = (canvas.current?.clientWidth ?? 0) / 2,
      boxes: number[][] = [],
      dots = labels.map((p) => (p && p.fade > 0.02 ? p : null)),
      left: boolean[] = [];
    const order = dots
      .map((p, c) => c)
      .filter((c) => dots[c])
      .sort((a, b) => Math.abs(dots[b]!.x - mid) - Math.abs(dots[a]!.x - mid));
    for (const c of order) {
      const p = dots[c]!,
        w = 14 + 7.5 * electrodeNames[c].length,
        box = (l: boolean) =>
          l
            ? [p.x - 10 - w, p.y - 12, p.x - 10, p.y + 12]
            : [p.x + 10, p.y - 12, p.x + 10 + w, p.y + 12],
        clear = (b: number[]) =>
          boxes.every((o) => b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]) &&
          dots.every(
            (o, k) =>
              k === c || !o || o.x < b[0] - 6 || o.x > b[2] + 6 || o.y < b[1] - 6 || o.y > b[3] + 6,
          );
      const out = p.x < mid;
      left[c] = clear(box(out)) || !clear(box(!out)) ? out : !out;
      boxes.push(box(left[c]));
    }
    return left;
  })();

  // Every animation frame redraws the brain; the cortex colours (every vertex) and the labels
  // (a re-render) follow at most 10 and 30 times a second while only the values drift — at
  // once when the band, the electrode, the replay or the look changes. Together they held the
  // 主图 under 50 fps, and a Wi-Fi burst dropped frames.
  const lazy = useRef({ key: '', paintAt: 0, labelAt: 0 });
  // the labels re-render the 主图 only when one has moved (a still brain: never)
  const still =
    (next: ({ x: number; y: number; fade: number } | null)[]) =>
    (prev: ({ x: number; y: number; fade: number } | null)[]) =>
      prev.length === next.length &&
      next.every(
        (p, i) =>
          p === prev[i] ||
          (p &&
            prev[i] &&
            Math.abs(p.x - prev[i]!.x) < 0.5 &&
            Math.abs(p.y - prev[i]!.y) < 0.5 &&
            Math.abs(p.fade - prev[i]!.fade) < 0.02),
      )
        ? prev
        : next;
  drawRef.current = () => {
    if (!scene || !canvas.current) return;
    const now = performance.now(),
      l = lazy.current,
      key = `${band}|${selected}|${worn}|${cursor}|${tick}`,
      moved = key !== l.key;
    if (moved || now - l.paintAt > 100) {
      scene.paint(worn || cursor !== null ? values : null);
      scene.highlight(selected);
      inner.scene?.paint(worn || cursor !== null ? values : null);
      l.paintAt = now;
    }
    const o = orbit.current;
    // the head follows; its own brain only while the head is what one sees
    headApi.current?.place(headDir(o.az, o.el), HEAD_K / o.zoom, HEAD_FOV);
    if (inner.brain) inner.brain.visible = o.zoom < (HEAD_ZOOM + BRAIN_ZOOM) / 2;
    // the electrodes where they are worn, on the head, also when zoomed into the brain
    const onHead = headApi.current?.project();
    if (onHead && (moved || now - l.labelAt > 33))
      setLabels(still(electrodeNames.map((n) => onHead[n] ?? null)));
    if (o.zoom <= HEAD_ZOOM + 0.01) {
      l.labelAt = now;
      return; // only the head is on screen
    }
    // at most 1.6 million pixels (as the waveforms): at DPR 2 the GPU held the 主图 under 50 fps
    scene.markers(false);
    scene.drawOrbit(canvas.current, o.az, o.el, o.zoom * look.brainZoom, look.pointScale, 1.6e6);
    scene.markers(true);
    if (moved || now - l.labelAt > 33) {
      if (!onHead) setLabels(still(scene.project()));
      setRegions(look.regions ? scene.projectRegions() : []);
      l.labelAt = now;
    }
    l.key = key;
  };
  useEffect(() => {
    if (!document.hidden) drawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, inner.scene, inner.brain, tick, band, selected, look]);
  useEffect(() => {
    const on = () => !document.hidden && requestDraw();
    document.addEventListener('visibilitychange', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      cancelAnimationFrame(frameReq.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    lazy.current.key = ''; // a new look: everything at once
  }, [look]);

  const contact = (c: number) => CONTACT[frame?.contact?.states[c] ?? ''] ?? ['—', 'unknown'];
  const sym = BANDS[b][1];
  const absolute = last?.p[b][selected];

  // 任务 · 运行画面: recognition of the frame on screen, the model's electrodes, last trigger.
  const rec = task ? (last?.rec?.[task.id] ?? null) : null;
  const regionRatio = (f: (typeof h)[number] | undefined, k: number) =>
    f?.r ? geoMean(task?.group.length ? task.group.map((c) => f.r![k][c]) : f.r[k]) : NaN;
  const fireAgo = task?.marks.length
    ? (latest?.t ?? Date.now() / 1000) - Math.max(...task.marks)
    : NaN;
  const lastFire = !task?.marks.length
    ? '尚未触发'
    : fireAgo < 60
      ? `${Math.max(0, Math.round(fireAgo))} 秒前`
      : `${Math.round(fireAgo / 60)} 分钟前`;

  // One status at a time in the middle of the brain; the panels around step back meanwhile.
  const status: { kind: string; title: string; progress?: number } | null =
    !active || cursor !== null
      ? null
      : error
        ? { kind: 'error', title: error }
        : !worn
          ? frame?.contact?.wornHold
            ? frame.contact.wornAgain
              ? {
                  kind: 'confirm',
                  title: `正在确认佩戴（${frame.contact.wornHold}/${frame.contact.wornNeed ?? 5} 秒）`,
                  progress: frame.contact.wornHold / (frame.contact.wornNeed ?? 5),
                }
              : {
                  kind: 'baseline',
                  title: `初始化中（正在建立基线，${frame.contact.wornHold}/${frame.contact.wornNeed ?? 30} 秒）`,
                  progress: frame.contact.wornHold / (frame.contact.wornNeed ?? 30),
                }
            : frame?.contact?.worn === false
              ? { kind: 'unworn', title: '请戴上设备' }
              : { kind: 'checking', title: '正在检测信号' }
          : !latest?.r
            ? {
                kind: 'baseline',
                title: `初始化中（正在建立基线，${Math.min(10, Math.round(Math.min(h.length, READY) * STEP))}/10 秒）`,
                progress: Math.min(1, h.length / READY),
              }
            : null;

  return (
    <div
      className={`wbf v-${look.layout} ${waveWide && sideTab === 'wave' ? 'wave-wide' : ''} ${look.vignette ? 'vignette' : ''} ${look.labels ? '' : 'no-labels'} ${look.hud ? '' : 'no-hud'} ${status && status.kind !== 'error' ? 'quiet' : ''}`}
    >
      {task && (
        <aside className="wbf-side wbf-left" style={floatingPanelStyle}>
          {
            <section className="wbf-task" aria-label="能力识别">
              <div className="wbf-head">
                <h2>{task.name}</h2>
                <span className={task.running ? 'on' : ''}>
                  {task.running ? '运行中' : '未运行'}
                </span>
              </div>
              <div className="wbf-task-rec">
                <strong className={rec && task.targets.has(rec[0]) ? 'target' : ''}>
                  {rec ? rec[0] : '—'}
                </strong>
                <small>{rec ? `${Math.round(rec[1] * 100)}%` : '启用或预览后显示识别结果'}</small>
              </div>
              <div className="wbf-task-bar">
                <i style={{ width: `${rec ? Math.round(rec[1] * 100) : 0}%` }} />
              </div>
              <dl>
                <dt>
                  {task.region || '全部电极'}
                  {task.group.length
                    ? `（${task.group.map((c) => electrodeNames[c]).join(' ')}）`
                    : ''}
                </dt>
                <dd>
                  {Number.isFinite(regionRatio(last, b))
                    ? `${regionRatio(last, b).toFixed(1)}×`
                    : '—'}
                </dd>
                <dt>最近触发</dt>
                <dd>{lastFire}</dd>
              </dl>
            </section>
          }
        </aside>
      )}

      <div className="wbf-center">
        <section
          className={`wbf-brain ${headShown > 0.5 ? 'head-on' : ''}`}
          onWheel={(e) => {
            setSpinning(false);
            // out past the brain: the head (HEAD_ZOOM)
            orbit.current.zoom = Math.max(
              HEAD_ZOOM,
              Math.min(2.2, orbit.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08)),
            );
            requestDraw();
          }}

          style={
            {
              '--head': HEAD_FAINT + headShown * (HEAD_SHOWN - HEAD_FAINT),
              '--brain': 1 - headShown,
            } as React.CSSProperties
          }
        >
          {cursor !== null && last && latest && (
            <span className="wbf-replay">回放 · {timeText(last.t - latest.t)}</span>
          )}
          {status && (
            <div className={`wbf-notice ${status.kind !== 'error' ? 'wear' : ''}`} role="status">
              {status.kind !== 'error' && <FitPanel states={frame?.contact?.states ?? []} />}
              <div className="wbf-notice-text">
                {status.kind !== 'error' && (
                  <span className="wbf-notice-device">
                    <i />
                    设备已连接
                  </span>
                )}
                <b>{status.title}</b>
                {status.progress !== undefined && (
                  <div className="wbf-notice-bar">
                    <i style={{ width: `${Math.round(status.progress * 100)}%` }} />
                  </div>
                )}
                {status.kind === 'unworn' && (
                  <>
                    <p>戴好后自动开始，不需要其他操作。</p>
                    <ol>
                      <li>拔掉 USB 数据线（只在配对时使用）</li>
                      <li>电极贴紧头皮，拨开头发</li>
                      <li>头顶的参考电极拨开头发、贴紧头皮</li>
                      <li>额头中间偏上的接地电极（GND）贴紧皮肤</li>
                      <li>坐好，保持放松</li>
                    </ol>
                    <span className="wbf-notice-wait">
                      <i />
                      等待佩戴
                    </span>
                  </>
                )}
                {status.kind === 'baseline' && (
                  <>
                    <p>请保持放松，尽量不要眨眼和咬牙。</p>
                  </>
                )}
              </div>
            </div>
          )}
          {active && !status && fitOpen && (
            <div className="wbf-notice wear wbf-fitpanel" role="dialog" aria-label="佩戴检查">
              <FitPanel states={frame?.contact?.states ?? []} />
              <div className="wbf-notice-text">
                <b>佩戴检查</b>
                <FitAdvice states={frame?.contact?.states ?? []} />
                <p className="wbf-fit-note">
                  颜色按信号量程判断。需要阻抗数值时可单独测量，测量期间暂停分析。
                </p>
                <div className="wbf-fit-actions">
                  <button className="secondary" onClick={() => navigate('fit')}>
                    测量阻抗
                  </button>
                  <button className="text-button" onClick={() => setFitOpen(false)}>
                    关闭
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* the head, behind the brain */}
          <div className="wbf-head3d h3d" aria-hidden="true">
            <HeadScene
              selected={null}
              onSelect={() => {}}
              onClear={() => {}}
              signal={head.store}
              viewCommand={null}
              faceRef={faceRef}
              faceEnabled={false}
              visualStyle="pulse"
              visualMetric="rms"
              codeFlow={false}
              inner={inner.brain}
              contact={Object.fromEntries(
                electrodeNames.map((n, c) => [n, frame?.contact?.states[c] ?? 'none']),
              )}
              tooltips={false}
              handle={headApi}
              zoom={false}
              bare
              plumeEach
            />
          </div>
          <canvas
            ref={canvas}
            aria-label="数字大脑"
            className="wbf-orbit"
            onPointerDown={(e) => {
              setSpinning(false);
              e.currentTarget.setPointerCapture(e.pointerId);
              cancelAnimationFrame(turn.current);
              drag.current = { x: e.clientX, y: e.clientY, ...orbit.current };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              orbit.current.az = d.az - (e.clientX - d.x) * 0.4;
              orbit.current.el = Math.max(-80, Math.min(89.5, d.el + (e.clientY - d.y) * 0.4));
              if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) setView(null);
              requestDraw();
            }}
            onPointerUp={() => (drag.current = null)}
            onDoubleClick={() => {
              // from above, a little back: all 16 electrodes in view
              orbit.current.zoom = OVERVIEW_ZOOM;
              goTo('top');
            }}
          />
          <div className="wbf-brain-head">
            <div>
              <h2>
                脑活动图谱
                <Help id="brainmap" />
              </h2>
            </div>
          </div>
          <div className="wbf-focus">
            <small>选中通道</small>
            <b>{electrodeNames[selected]}</b>
            <span>
              {sym} {Number.isFinite(ratio(selected)) ? `${ratio(selected).toFixed(1)}×` : '—'}
              {absolute !== undefined ? ` · ${absolute.toFixed(1)} µV²` : ''}
            </span>
            <span className={`wbf-dot ${contact(selected)[1]}`}>信号{contact(selected)[0]}</span>
          </div>
          <div className="wbf-peak">
            <small>最强</small>
            <span>
              {ranked.length
                ? `${sym} ${ranked
                    .slice(0, 2)
                    .map((c) => `${electrodeNames[c]} ${ratio(c).toFixed(1)}×`)
                    .join(' · ')}`
                : '—'}
            </span>
          </div>
          <div className="wbf-regions" aria-hidden>
            {regions.map((r) => (
              <span key={r.name} style={{ left: r.x, top: r.y }}>
                {r.name}
              </span>
            ))}
          </div>
          <div className="wbf-labels">
            {labels.map((pos, c) =>
              pos && pos.fade > 0.02 ? (
                <button
                  key={c}
                  className={`wbf-label ${c === selected ? 'on' : ''} ${labelLeft[c] ? 'left' : ''}`}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    opacity: pos.fade,
                    // the point glows in its contact colour, as on 首次佩戴; gray with none
                    // (not worn, or no signal yet)
                    ['--dot' as string]:
                      CONTACT_COLORS[frame?.contact?.states[c] ?? ''] ?? '#3a4843',
                    pointerEvents: pos.fade < 0.5 ? 'none' : undefined,
                  }}
                  title={`选中 ${electrodeNames[c]}（CH ${c + 1}）`}
                  onClick={() => {
                    select(c);
                    setCard(c);
                  }}
                >
                  {electrodeNames[c]}
                </button>
              ) : null,
            )}
          </div>
          {card !== null && ELECTRODE_CARDS[electrodeNames[card]] && (
            <ElectrodeCardView
              name={electrodeNames[card]}
              live={(id) => {
                const k = BANDS.findIndex(([b]) => b === id),
                  x = last?.r?.[k]?.[card];
                return x !== undefined && Number.isFinite(x) ? `${Math.exp(x).toFixed(1)}×` : '—';
              }}
              contact={contact(card)}
              onClose={() => setCard(null)}
            />
          )}
          <div className="wbf-views wbf-views-corner" role="radiogroup" aria-label="视角">
            {VIEWS.map(([v, label]) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                className={view === v ? 'on' : ''}
                onClick={() => goTo(v)}
              >
                {label}
              </button>
            ))}
            <button
              className={spinning ? 'on' : ''}
              aria-pressed={spinning}
              title={spinning ? '停止自动旋转' : '自动旋转'}
              onClick={() => {
                setView(null);
                setSpinning(!spinning);
              }}
            >
              自转
            </button>
          </div>
        </section>
        {look.trace && (
          <ChannelTrace
            buffer={buffer}
            rate={meta?.rate || 250}
            channel={selected}
            paused={paused || cursor !== null}
            replaying={cursor !== null}
            fixed={waveScale}
          />
        )}
        {look.timeline && (
          <div className="wbf-tl">
            <BrainTimeline
              scene={scene}
              band={b}
              tick={tick}
              cursor={cursor}
              setCursor={setCursor}
              extra={
                active && !task ? (
                  <RecordButton
                    getBrain={() => canvas.current?.toDataURL('image/png') ?? null}
                    buffer={buffer}
                    rate={meta?.rate || 250}
                    onDone={setShared}
                  />
                ) : undefined
              }
              value={(f) => regionRatio(f, b)}
              isTarget={
                task ? (f) => !!f.rec[task.id] && task.targets.has(f.rec[task.id][0]) : undefined
              }
              marks={task?.marks}
              legend={
                <>
                  <b style={{ background: PALETTE_CSS.replace('0deg', '90deg') }} />
                  {task ? task.region || '全脑' : '全脑'} {sym}（相对基线）
                  {task && (
                    <>
                      <b style={{ background: '#e8b04a' }} />
                      识别为目标状态
                      <em>▼ 触发</em>
                    </>
                  )}
                </>
              }
            />
          </div>
        )}
      </div>

      <aside className="wbf-side wbf-right" style={floatingPanelStyle}>
        <div className="wbf-head">
          <div className="wbf-tabs" role="tablist" aria-label="面板">
            {(
              [
                ['bands', '脑电能量'],
                ['wave', '实时脑电波'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={sideTab === id}
                className={sideTab === id ? 'on' : ''}
                onClick={() => tab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {sideTab === 'bands' ? (
            <>
              <Help id="bands" />
              <span>全脑平均</span>
            </>
          ) : (
            <>
              <Help id="contact" label="接触状态" />
              <span>{waveWide ? '4 秒 · µVrms' : 'µVrms'}</span>
              <select
                className="wbf-scale-select"
                aria-label="纵向刻度"
                value={waveScale}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setWaveScale(v);
                  localStorage.setItem('neurolink.waveScale', String(v));
                }}
              >
                <option value={0}>自动</option>
                {[50, 100, 200, 500].map((v) => (
                  <option key={v} value={v}>
                    ±{v} µV
                  </option>
                ))}
              </select>
              <button
                className="wbf-wide-btn"
                aria-label={waveWide ? '收窄时间序列' : '展宽时间序列'}
                title={waveWide ? '收窄' : '展宽'}
                onClick={() => {
                  setWaveWide(!waveWide);
                  localStorage.setItem('neurolink.waveWide', waveWide ? '0' : '1');
                }}
              >
                {waveWide ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
              </button>
            </>
          )}
        </div>
        {sideTab === 'bands' ? (
          <>
            <div className="wbf-bands" role="radiogroup" aria-label="频段">
              {BAND_ORDER.map(([id, s, lo, hi, k]) => {
                const r = last?.r ? geoMean(last.r[k]) : NaN;
                return (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={band === id}
                    className={band === id ? 'on' : ''}
                    onClick={() => setBand(id)}
                  >
                    <span className="wbf-band-name">
                      <i>{s}</i>
                      {BAND_NAME[id]}
                      {task?.modelBand === id && <mark className="wbf-model">模型</mark>}
                      <small>
                        {lo}–{hi} Hz
                      </small>
                    </span>
                    <b>{Number.isFinite(r) ? `${r.toFixed(1)}×` : '—'}</b>
                    <em>
                      <u
                        style={{
                          width: `${Math.max(3, Math.min(100, ratioPosition(Number.isFinite(r) ? r : 1) * 100))}%`,
                        }}
                      />
                    </em>
                  </button>
                );
              })}
            </div>
            {!task && (
              <div className="wbf-alpha">
                <span>α 占 1–40 Hz 能量 · {electrodeNames[selected]}</span>
                <strong>
                  {alpha ? alpha.relative[selected].toFixed(1) : '—'}
                  <small>%</small>
                </strong>
              </div>
            )}
            {!task && <MiniPsd alpha={alpha} channel={selected} />}
          </>
        ) : (
          <Channels
            scale={waveScale}
            buffer={buffer}
            clock={clock}
            rate={meta?.rate || 250}
            frame={frame}
            selected={selected}
            select={select}
            contact={contact}
            paused={paused}
          />
        )}
      </aside>

      <section className="wbf-side wbf-status">
        <div className="wbf-head">
          <h2>通道状态</h2>
          <span>
            正常 {frame?.contact ? frame.contact.states.filter((s) => s === 'ok').length : '—'} /{' '}
            {electrodeNames.length}
          </span>
        </div>
        <div className="wbf-tiles" aria-label="通道状态">
          {electrodeNames.map((name, c) => (
            <button
              key={c}
              className={`wbf-tile ${contact(c)[1]} ${c === selected ? 'on' : ''}`}
              onClick={() => select(c)}
              aria-label={`通道 ${c + 1} ${name} ${contact(c)[0]}`}
              title={frame?.contact?.reasons?.[c] ?? ''}
            >
              <span className="mono">CH {String(c + 1).padStart(2, '0')}</span>
              <b>{name}</b>
              <em>{contact(c)[0]}</em>
              <small className="mono">{frame ? `${frame.rms[c].toFixed(1)} µV` : '—'}</small>
            </button>
          ))}
        </div>
        {frame?.contact?.reference && (
          <p className="wbf-ref">
            多数通道未接触：请检查头顶的参考电极和额头的接地电极（GND）是否贴紧。
          </p>
        )}
      </section>
      {shared && (
        <ShareCard
          rec={shared}
          onClose={() => setShared(null)}
          onReplay={(id) => {
            setShared(null);
            window.dispatchEvent(new CustomEvent('brainlab:replay-moment', { detail: id }));
          }}
        />
      )}
      {!active && (
        // Not connected: the whole view is masked, the one thing to do is connect.
        <div className="wbf-mask">
          <div className="wbf-mask-card">
            {connecting ? (
              <>
                <LoaderCircle size={30} className="spin" />
                <b>正在连接设备…</b>
              </>
            ) : (
              <>
                <span className="wbf-mask-icon">
                  <Plug size={26} />
                </span>
                <b>连接脑电设备</b>
                <button className="primary" onClick={() => navigate('devices')}>
                  <Plug size={16} />
                  连接脑电设备
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Spectrum of the linked channel, 1–40 Hz, the α band shaded.
function MiniPsd({ alpha, channel }: { alpha: AlphaFrame | null; channel: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect(),
      dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(r.width * dpr);
    el.height = Math.round(r.height * dpr);
    const g = el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    const f = alpha?.frequencies ?? [];
    const row = alpha?.psd[channel] ?? [];
    const B = r.height - 16,
      X = (hz: number) => ((hz - 1) / 39) * r.width;
    g.fillStyle = css('--accent-soft');
    g.fillRect(X(8), 4, X(13) - X(8), B - 4);
    g.strokeStyle = css('--line');
    g.beginPath();
    g.moveTo(0, B + 0.5);
    g.lineTo(r.width, B + 0.5);
    g.stroke();
    if (row.length) {
      const top = Math.max(...row) || 1;
      g.strokeStyle = css('--accent');
      g.lineWidth = 1.5;
      g.beginPath();
      row.forEach((v, i) => {
        const x = X(f[i]),
          y = B - (v / top) * (B - 6);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    }
    g.fillStyle = css('--ink4');
    g.font = '10px Consolas, monospace';
    for (const hz of [1, 13, 30, 40])
      g.fillText(hz === 40 ? '40 Hz' : `${hz}`, Math.min(X(hz), r.width - 30), r.height - 3);
  }, [alpha, channel]);
  return (
    <div className="wbf-psd">
      <span>功率频谱 · µV²/Hz · 最近 4 秒</span>
      <canvas ref={ref} data-native aria-label="选中通道功率频谱" />
    </div>
  );
}

// 16 channels: contact state, the last 4 s of signal drawn in detail (min–max per pixel),
// µVrms; click to link.
function Channels({
  buffer,
  clock,
  rate,
  frame,
  selected,
  select,
  contact,
  paused,
  scale,
}: {
  scale: number;
  buffer: MutableRefObject<number[][]>;
  clock: MutableRefObject<WaveClock>;
  rate: number;
  frame: Frame | null;
  selected: number;
  select: (i: number) => void;
  contact: (c: number) => [string, string];
  paused: boolean;
}) {
  const lines = useRef<(HTMLCanvasElement | null)[]>([]);
  const values = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const draw = () => {
      const colour = css('--accent'),
        dim = css('--ink4');
      lines.current.forEach((el, c) => {
        if (!el) return;
        const r = boxOf(el);
        if (r.width < 4) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (el.width !== Math.round(r.width * dpr) || el.height !== Math.round(r.height * dpr)) {
          el.width = Math.round(r.width * dpr);
          el.height = Math.round(r.height * dpr);
        }
        const g = el.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, r.width, r.height);
        const seg = recentFiltered(buffer.current[c] ?? [], rate);
        const n = seg.length;
        if (n < 2) return;
        const mean = seg.reduce((a, v) => a + v, 0) / n;
        const sd = Math.sqrt(seg.reduce((a, v) => a + (v - mean) ** 2, 0) / n) || 1;
        // µVrms as OpenBCI GUI: standard deviation of the filtered last second
        const out = values.current[c];
        if (out) {
          const rms = uvrms(seg, rate);
          out.textContent = rms.toFixed(rms >= 100 ? 0 : 1);
        }
        const edge = scale || sd * 3;
        g.strokeStyle = c === selected ? colour : dim;
        g.lineWidth = 1;
        g.beginPath();
        const y = (v: number) =>
          r.height / 2 -
          Math.max(-1, Math.min(1, (v - (scale ? 0 : mean)) / edge)) * (r.height / 2 - 1);
        const per = n / r.width;
        for (let px = 0; px < r.width; px++) {
          let lo = Infinity,
            hi = -Infinity;
          for (let i = Math.floor(px * per); i < Math.min(n, Math.floor((px + 1) * per) + 1); i++) {
            lo = Math.min(lo, seg[i]);
            hi = Math.max(hi, seg[i]);
          }
          px ? g.lineTo(px, y(hi)) : g.moveTo(px, y(hi));
          g.lineTo(px, y(lo));
        }
        g.stroke();
      });
    };
    if (paused) return;
    const id = setInterval(draw, 100);
    return () => clearInterval(id);
  }, [buffer, clock, rate, selected, paused, scale]);
  const rail = frame?.rail;
  return (
    <div className="wbf-channels">
      {electrodeNames.map((name, c) => (
        <button
          key={c}
          className={`wbf-ch ${c === selected ? 'on' : ''}`}
          onClick={() => select(c)}
          aria-label={`选中通道 ${c + 1} ${name}`}
        >
          <i className={`wbf-dot ${contact(c)[1]}`} title={contact(c)[0]} />
          <b>{name}</b>
          <canvas ref={(el) => void (lines.current[c] = el)} data-native />
          <em
            className={`mono ${rail?.states[c] === 'railed' ? 'railed' : rail?.states[c] === 'near' ? 'near' : ''}`}
            ref={(el) => void (values.current[c] = el)}
            title={
              rail?.percentages[c] != null
                ? `5–50 Hz 最近 1 秒的有效值；量程已用 ${Math.round(rail.percentages[c]!)}%${
                    rail.states[c] === 'railed'
                      ? '（已饱和，数据不可用）'
                      : rail.states[c] === 'near'
                        ? '（接近饱和，检查接触）'
                        : ''
                  }`
                : '5–50 Hz 最近 1 秒的有效值'
            }
          >
            {frame ? '' : '—'}
          </em>
        </button>
      ))}
    </div>
  );
}

// The last 4 s through the display filter (OpenBCI GUI's 5–50 Hz and 50/60 Hz removal), the
// whole buffer filtered as the GUI does: without it electrode drift draws a slope.
function recentFiltered(data: number[], rate: number) {
  return displayFilter(data, rate).slice(-Math.min(data.length, rate * 4));
}

// The selected channel's signal, last 4 s, between the brain and its timeline. While
// replaying it stops (the raw buffer holds only the last seconds).
function ChannelTrace({
  buffer,
  rate,
  channel,
  paused,
  replaying,
  fixed = 0,
}: {
  fixed?: number;
  buffer: MutableRefObject<number[][]>;
  rate: number;
  channel: number;
  paused: boolean;
  replaying: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const draw = () => {
      const el = ref.current;
      if (!el) return;
      const r = boxOf(el),
        dpr = Math.min(2, window.devicePixelRatio || 1);
      if (r.width < 4) return;
      if (el.width !== Math.round(r.width * dpr)) {
        el.width = Math.round(r.width * dpr);
        el.height = Math.round(r.height * dpr);
      }
      const g = el.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, r.width, r.height);
      g.strokeStyle = '#1a2320';
      g.beginPath();
      g.moveTo(0, r.height / 2 + 0.5);
      g.lineTo(r.width, r.height / 2 + 0.5);
      g.stroke();
      const seg = recentFiltered(buffer.current[channel] ?? [], rate);
      const n = seg.length;
      if (n < 2) return;
      const mean = seg.reduce((a, v) => a + v, 0) / n;
      const sorted = seg.map((v) => Math.abs(v - mean)).sort((a, b) => a - b);
      const half = fixed || Math.max(10, sorted[Math.floor(n * 0.98)] * 1.1); // µV at the edge
      setScale((s) => (Math.abs(s - half) / half > 0.2 ? Math.round(half) : s));
      g.strokeStyle = '#5fd3a4';
      g.lineWidth = 1.3;
      g.beginPath();
      const per = n / r.width;
      for (let px = 0; px < r.width; px++) {
        let lo = Infinity,
          hi = -Infinity;
        for (let i = Math.floor(px * per); i < Math.min(n, Math.floor((px + 1) * per) + 1); i++) {
          lo = Math.min(lo, seg[i]);
          hi = Math.max(hi, seg[i]);
        }
        const y = (v: number) =>
          r.height / 2 - Math.max(-1, Math.min(1, (v - mean) / half)) * (r.height / 2 - 2);
        px ? g.lineTo(px, y(hi)) : g.moveTo(px, y(hi));
        g.lineTo(px, y(lo));
      }
      g.stroke();
    };
    draw();
    if (paused) return;
    const id = setInterval(draw, 60);
    return () => clearInterval(id);
  }, [buffer, rate, channel, paused, fixed]);
  return (
    <div className="wbf-trace">
      <div className="wbf-trace-head">
        <b>{electrodeNames[channel]}</b>
        <span>
          CH {channel + 1} · 5–50 Hz · 最近 4 秒{scale ? ` · ±${scale} µV` : ''}
          {replaying ? ' · 回放时不更新' : ''}
          <Help id="raw" />
        </span>
      </div>
      <canvas ref={ref} data-native aria-label="选中通道波形" />
    </div>
  );
}

// The contact map in the wear card and in 佩戴检查.
function FitPanel({ states }: { states: string[] }) {
  // near railed counts as in contact (as 佩戴 N/16 above); its colour still marks it
  const { good } = contactSummary(states.map((s) => (s === 'poor' ? 'ok' : s)));
  return (
    <div className="wbf-fit">
      <span className="wbf-fit-count">
        接触良好 <b>{good}</b> / 16
      </span>
      <ContactHead states={states} />
      <ContactLegend />
    </div>
  );
}
function FitAdvice({ states }: { states: string[] }) {
  const { bad, good } = contactSummary(states);
  // electrodes without a contact state yet are not counted as good
  const unknown = electrodes.filter((_, i) => !['ok', 'poor', 'off'].includes(states[i]));
  if (good === electrodes.length) return <p>全部电极接触良好。</p>;
  if (!bad.length && unknown.length) return <p>等待接触数据。</p>;
  return (
    <>
      <p>需要调整：拨开头发，按住几秒，每次调整后等 5 秒。</p>
      <ul className="wbf-fit-list">
        {bad.slice(0, 6).map((e) => (
          <li key={e.name}>
            <b className={e.s === 'off' ? 'bad' : 'warn'}>{e.name}</b> {e.place} ·{' '}
            {e.s === 'off' ? '信号饱和' : '接近饱和'}
          </li>
        ))}
        {bad.length > 6 && <li>另有 {bad.length - 6} 个</li>}
        {unknown.length > 0 && <li>等待数据：{unknown.map((e) => e.name).join('、')}</li>}
      </ul>
    </>
  );
}

// 电极卡片 (design/electrode-card): where the electrode lies, what it is related to, the signals
// read there, what can be built on them; at the bottom its bands now and its contact
function ElectrodeCardView({
  name,
  live,
  contact,
  onClose,
}: {
  name: string;
  live: (band: string) => string;
  contact: [string, string];
  onClose: () => void;
}) {
  const c = ELECTRODE_CARDS[name];
  // bottom left when it fits under the ability card (a large screen), else at the top over it
  const ref = useRef<HTMLElement | null>(null);
  const [low, setLow] = useState(false);
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current,
        box = el?.parentElement?.getBoundingClientRect(),
        above = document.querySelector('.wbf-left')?.getBoundingClientRect();
      if (!el || !box) return setLow(false);
      setLow(box.bottom - (above?.bottom ?? box.top + 52) - 28 >= el.offsetHeight);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [name]);
  return (
    <section
      ref={ref}
      className={`wbf-card ${low ? 'low' : ''}`}
      role="dialog"
      aria-label={`${name} 电极`}
    >
      <div className="wbf-card-tools">
        <Help note="electrode" />
        <button className="wbf-card-x" aria-label="关闭" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <h3>
        <b>{name}</b>
        {c.place}
      </h3>
      <p className="wbf-card-ana">{c.anatomy}</p>
      <dl>
        <dt>相关功能</dt>
        <dd>{c.func}</dd>
        <dt>常观察的信号</dt>
        <dd>{c.signals}</dd>
        <dt>可以开发的功能</dt>
        <dd>
          <ul>
            {c.abilities.map(([t, g]) => (
              <li key={t}>
                <span>{t}</span>
                <i className={`wbf-tag t-${g}`}>{g}</i>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      <div className="wbf-card-live">
        <small>此刻</small>
        {c.live.map(([sym, id]) => (
          <span key={sym}>
            {sym}
            <em>{live(id)}</em>
          </span>
        ))}
        <span className={`wbf-dot ${contact[1]}`}>信号{contact[0]}</span>
      </div>
    </section>
  );
}
