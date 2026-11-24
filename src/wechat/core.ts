// The mini program's core (wechat/lib/core.js, design/wechat-app): the TypeScript engine on a
// device source, and one stream every page subscribes to — what src/App.tsx keeps for the desktop
// workbench (status, metadata, the latest frame, spectra, the last seconds of samples).
import './storage';
import { brainHistory, pushAlpha, STEP } from '../home/brainHistory';
import { DisplaySmooth } from '../home/displaySmooth';
import { DemoDevice, Engine, type Source } from '../engine-ts/engine';
import { electrodes } from '../electrodes';
import { displayFilter, uvrms } from '../displayFilter';
import { bandPowers, bands } from '../spectralMetrics';
import { UdpShield } from './udpShield';
import * as recorder from './recorder';

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const KEEP_SECONDS = 10;
const STORE_DEVICE = 'device';

export type Status = { status: string; detail: string; demo: boolean };
export type Frame = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Listener = (event: { type: string }) => void;

const listeners = new Set<Listener>();
let status: Status = { status: 'disconnected', detail: '', demo: false };
let meta: { rate: number } | null = null;
let frame: Frame | null = null;
let alpha: Frame | null = null;
let rows: number[][] = Array.from({ length: 16 }, () => []);
let lastData = 0;
let lastContact = 0;

// Band power every 0.5 s and the baseline for 主图: the desktop's own (src/home/brainHistory.ts —
// per band × electrode the median of the last 60 s where the electrode was usable, saved for the
// next start; the last 30 minutes kept, for the timeline and its replay).
/** exp(mean log) of the usable values: the whole brain's ratio to baseline, or null */
function geoMean(logs: (number | null)[]) {
  const ok = logs.filter((x): x is number => x !== null && Number.isFinite(x));
  return ok.length ? Math.exp(ok.reduce((x, y) => x + y, 0) / ok.length) : null;
}

// The phone runs this without JIT: the spectrum every 0.5 s (主图 takes band power every 0.5 s
// anyway) and EMG once a second, not every 0.25 s as the desktop.
const engine = new Engine(
  (e) => {
    if (e.type === 'status') {
      status = e as unknown as Status;
      if (status.status !== 'streaming') recorder.stop(); // the device is gone: keep what came
    } else if (e.type === 'metadata') {
      meta = e as unknown as { rate: number };
      rows = Array.from({ length: 16 }, () => []);
    } else if (e.type === 'data') {
      frame = e;
      lastData = Date.now();
      recorder.push(e.samples as number[][]);
      if (lastData - lastContact >= 1000) {
        lastContact = lastData;
        const states = (e.contact as { states?: string[] } | undefined)?.states;
        if (states) recorder.contact(states.filter((x) => x === 'ok').length);
      }
      const max = (meta?.rate ?? 250) * KEEP_SECONDS;
      (e.samples as number[][]).forEach((s, c) => {
        const r = rows[c];
        for (const v of s) r.push(v);
        if (r.length > max) r.splice(0, r.length - max);
      });
    } else if (e.type === 'alpha') {
      alpha = e;
      pushAlpha(e as never, frame as never, status.demo);
    }
    listeners.forEach((l) => l(e as { type: string }));
  },
  { spectrum: STEP, emg: 1 },
);

/** Subscribe to the engine's events; returns the unsubscribe */
export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function snapshot() {
  return {
    status,
    meta,
    frame,
    alpha,
    // data stopped arriving (Wi-Fi gone, device off) though the status still says streaming
    streaming: status.status === 'streaming' && Date.now() - lastData < 3500,
  };
}

/** The saved device: { address, rate } */
export const savedDevice = (): { address: string; rate: number } | null => {
  try {
    return JSON.parse(wx.getStorageSync(STORE_DEVICE) || 'null');
  } catch {
    return null;
  }
};

/** The device 信号工作台 connects to (添加脑机接口 found it at this address) */
export const rememberDevice = (address: string, rate = 250) =>
  wx.setStorageSync(STORE_DEVICE, JSON.stringify({ address, rate }));

export async function connect(kind: 'device' | 'demo', address = '', rate = 250) {
  const source: Source = kind === 'demo' ? new DemoDevice(rate) : new UdpShield(address, rate);
  if (kind === 'device') wx.setStorageSync(STORE_DEVICE, JSON.stringify({ address, rate }));
  await engine.connect(source);
}
export const disconnect = () => engine.disconnect();
/** Development only (the simulated device's states, as the desktop --demo) */
export const setDemoState = (i: number | null) => engine.setDemoState(i);

/**
 * The last `seconds` of one channel, filtered as OpenBCI GUI shows it, and its µVrms. The filter
 * runs over all kept samples, or over `seconds` + `warm` of them (less work on the phone; the
 * filter has settled after the first seconds).
 */
export function trace(channel: number, seconds: number, warm = Infinity) {
  const rate = meta?.rate ?? 250;
  const all = rows[channel] ?? [];
  if (all.length < rate) return { values: [] as number[], uvrms: null as number | null, rate };
  const raw = Number.isFinite(warm) ? all.slice(-Math.round(rate * (seconds + warm))) : all;
  const filtered = displayFilter(raw, rate);
  const values = filtered.slice(-Math.round(rate * seconds));
  return { values, uvrms: uvrms(filtered, rate), rate };
}

/**
 * Each channel's power per band (δ θ α β γ) relative to its 1–40 Hz total, from the 4 s spectrum
 * (the alpha event, as engine/spectral.py): rows of 5 for 16 channels, null where unavailable.
 */
export function bandShares(): (number[] | null)[] {
  const a = alpha as { frequencies?: number[]; psd?: number[][] } | null;
  if (!a?.frequencies || !a.psd) return Array(16).fill(null);
  return a.psd.map((p) => {
    const b = bandPowers(a.frequencies!, p);
    if (!b) return null;
    const total = b.reduce((x, y) => x + y, 0);
    return total > 0 ? b.map((v) => v / total) : null;
  });
}

/**
 * log(power / baseline) of one band per electrode (as the desktop's 主图), null where the
 * electrode is unusable or has no baseline yet; `ready` once most electrodes have one.
 */
export function bandRatios(band: number, at: number | null = null) {
  return ratiosOf(band, at);
}
/** log(power / baseline) of one band per electrode at a frame (null: the latest) */
function ratiosOf(band: number, at: number | null): { values: (number | null)[]; ready: boolean } {
  const f = brainHistory.frames;
  const now = f[at === null ? f.length - 1 : Math.min(at, f.length - 1)];
  if (!now || !now.r) return { values: Array(16).fill(null), ready: false };
  return { values: now.r[band].map((v) => (Number.isFinite(v) ? v : null)), ready: true };
}

/** Each band's whole-brain ratio to baseline at a frame (null: the latest), or null */
export const bandSummary = (at: number | null = null) => {
  const f = brainHistory.frames;
  const now = f[at === null ? f.length - 1 : Math.min(at, f.length - 1)];
  return bands.map((_, k) => (now?.r ? geoMean(now.r[k]) : null));
};
/**
 * The timeline (the desktop's BrainTimeline): every kept 0.5 s frame's time and one band's
 * whole-brain ratio to baseline; dropped (frames removed from the front so far) and epoch (new
 * stream) keep a replay position on its moment
 */
export const timelineOf = (band: number) => {
  const f = brainHistory.frames;
  return {
    step: STEP,
    t: f.map((x) => x.t),
    values: f.map((x) => (x.r ? geoMean(x.r[band]) : null)),
    dropped: brainHistory.dropped,
    epoch: brainHistory.epoch,
  };
};
/** Band power (µV²) per band × electrode, averaged over the last n frames (signalCheck.ts) */
export function recentPower(n: number) {
  const recent = brainHistory.frames.slice(-n);
  return bands.map((_, b) =>
    electrodes.map((_, c) => {
      const v = recent.map((f) => f.p[b]?.[c]).filter((x): x is number => Number.isFinite(x));
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
    }),
  );
}
/** Back-of-head α relative to rest now (首次打开's 点亮: O1 O2 P3 P4), or null */
export function backAlpha() {
  const f = brainHistory.frames[brainHistory.frames.length - 1];
  if (!f?.r) return null;
  const v = geoMean([6, 7, 14, 15].map((c) => f.r![2][c]));
  return v === null ? null : { t: f.t, v };
}
/** The timeline's ▼ marks (none here: there are no abilities that fire) */
export const fireMarks = (): number[] => [];
// 主图's display smoothing, the desktop's (src/home/displaySmooth.ts): live, the brain follows the
// 0.5 s frames gently, keeps an electrode's colour through an artefact, turns white only when
// held; stepped by the page that shows it
const smooth = new DisplaySmooth(16);
/** The brain as shown live, one band per electrode (null: not shown), after dt s more */
export function smoothRatios(band: number, dt: number) {
  const f = brainHistory.frames;
  smooth.push(f[f.length - 1]);
  smooth.step(dt);
  if (!smooth.ready) return Array(16).fill(null);
  return smooth.shown[band].map((v) => (Number.isFinite(v) ? v : null));
}
/** The kept frames from time t on (seconds, as the frames'), for the 脑电记录 card */
export const framesSince = (t: number) => brainHistory.frames.filter((x) => x.t > t && x.r);
export const lastFrameTime = () => {
  const f = brainHistory.frames;
  return f.length ? f[f.length - 1].t : 0;
};
/** One channel's 1–40 Hz spectrum (4 s) and α's share of it (%), from the latest alpha event */
export function spectrumOf(channel: number) {
  const a = alpha as { frequencies?: number[]; psd?: number[][]; relative?: number[] } | null;
  return {
    frequencies: a?.frequencies ?? [],
    psd: a?.psd?.[channel] ?? [],
    alphaShare: a?.relative?.[channel] ?? null,
  };
}

// ---- 录制脑电 (recorder.ts) ----
export function startRecording(kind?: string) {
  if (!snapshot().streaming) throw Error('设备未连接');
  recorder.start(
    meta?.rate ?? 250,
    electrodes.map((e) => e.name),
    kind,
  );
}
export const recordEvent = (label: string, name?: string) => recorder.event(label, name);
export const stopRecording = () => recorder.stop();
export const recording = () => recorder.active();
export const recordings = () => recorder.list();
export const removeRecording = (id: string) => recorder.remove(id);
export const exportRecording = (id: string) => recorder.exportBdf(id);

export const BANDS = bands.map((b) => ({ ...b }));
/** Electrode names, places and 2D head-map positions (320 × 320, nose up) */
export const ELECTRODES = electrodes.map((e) => ({ name: e.name, place: e.place, map: e.map }));
