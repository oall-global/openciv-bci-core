export type Quality = 'good' | 'warn' | 'bad' | 'unknown';
export type Status = {
  type: 'status';
  status: string;
  detail: string;
  demo: boolean;
  epoch?: number;
};
export type Metadata = {
  accelChannels?: number;
  rate: number;
  channels: number;
  unit: string;
  boardId: number;
  epoch: number;
};
export type Rail = {
  peaks?: (number | null)[];
  fullScale?: number;
  sampleCount?: number;
  states: string[];
  percentages: (number | null)[];
  gain: number;
};
export type LinkQuality = {
  level: 'good' | 'fair' | 'poor';
  bars: number;
  lossPercent: number;
  longestGapMs: number;
  breaks: number;
  seconds: number;
};
export type Transport = {
  quality?: LinkQuality | null;
  received: number;
  estimatedLost: number;
  duplicates: number;
  ambiguous: number;
  lossPercent: number;
  batchMs: number | null;
  elapsed: number;
};
// Live electrode contact (engine/contact.py): 正常 / 接触差 / 未接触.
export type Contact = {
  states: ('ok' | 'poor' | 'off' | 'unknown')[];
  reasons: string[];
  band?: number[];
  mains?: number[];
  share?: number[];
  reference?: boolean;
  floor?: number | null; // whole cap: median high-band noise (µV)
  corr?: number | null; // whole cap: mean |correlation| between channels
  spread?: number | null; // whole cap: spread of log 1–40 Hz power across channels
  hf?: number[]; // per channel high-band noise (µV)
  worn?: boolean | null; // whole cap worn (null = not decided yet)
  wornVotes?: boolean[]; // most electrodes not railed
  wornHold?: number; // seconds of wearing evidence so far
  wornNeed?: number; // seconds needed
  wornAgain?: boolean; // worn before in this app run: short confirmation, baseline kept
  // Wear probe (engine/wearprobe.py): Fp1's impedance while the cap is not worn
  probe?: {
    channel: number;
    active: boolean;
    failed: boolean;
    kohm: number | null;
    quality: string | null;
  };
};
export type Frame = {
  transport?: Transport;
  battery?: { percent: number; low: boolean } | null; // the board's own report (Wi-Fi, newer firmware)
  emg?: number[] | null;
  emgAt?: number; // when the EMG values were last computed (s); a repeat is not new data
  accel?: number[] | null;
  sampleNumbers?: number[];
  rail?: Rail;
  type: 'data';
  epoch: number;
  samples: number[][];
  timestamps: number[]; // acquisition times (host clock), see engine/acqclock.py
  received?: number[]; // host receive times
  clock?: { driftPpm: number; lost: number; resets: number; latency: number | null };
  rms: number[];
  quality: Quality[];
  contact?: Contact | null;
  windowSeconds: number;
  at: number;
};
export type AlphaFrame = {
  focus?: {
    mindfulness: number;
    restfulness: number;
    channels: number[];
    bands: number[];
    model: string;
  } | null;
  type: 'alpha';
  epoch: number;
  at: number;
  timestamp: number;
  windowSeconds: number;
  absolute: number[];
  relative: number[];
  flags: string[];
  frequencies: number[];
  psd: number[][];
};
export type Device = {
  name: string;
  address: string;
  transport: 'wifi' | 'serial';
  verified: boolean;
  detail: string;
};
export type Prefs = {
  connectionMode?: 'direct' | 'router';
  onboarded: boolean;
  firstWear?: boolean; // 首次佩戴引导 finished (src/onboarding)
  onboardingFlow?: 'v1' | 'v2'; // 首次打开: v2 FirstRun.tsx; v1 the earlier wizard + 首次佩戴
  address: string;
  transport: 'wifi' | 'serial';
  model: string;
  localPort: number;
  sampleRate: number;
};
export type CheckResult = {
  quality: Quality;
  reason: string;
  kohm?: number | null;
  mainsPercent?: number;
};
export type CheckEvent = {
  type: 'connection-check';
  epoch: number;
  phase: string;
  active: boolean;
  scope?: 'single' | 'all';
  targetChannel?: number | null;
  demo?: boolean;
  channel?: number;
  contacts?: (CheckResult | null)[];
  signals?: (CheckResult | null)[];
  connection?: Quality;
  overall?: Quality;
  detail?: string;
  at?: number;
  observedRate?: number;
  discontinuities?: number;
};
export type EngineEvent =
  | Status
  | Frame
  | AlphaFrame
  | CheckEvent
  | ({ type: 'metadata' } & Metadata)
  | { type: 'ready'; version: string };
export type Api = {
  recording: (action: string) => Promise<any>;
  moment: (action: string, params?: unknown) => Promise<any>; // 录制脑电 (electron/moments.cjs)
  data: (action: string, params?: unknown) => Promise<any>; // 数据 (electron/dataStore.cjs)
  session: (action: string, params?: unknown) => Promise<any>;
  version: () => Promise<string>;
  setup: (action: string, params?: unknown) => Promise<any>;
  developer: (action: string, params?: unknown) => Promise<any>;
  command: (method: string, params?: unknown) => Promise<any>;
  subscribe: (cb: (event: EngineEvent) => void) => () => void;
  snapshot: () => Promise<{
    status: Status;
    metadata: Metadata | null;
    ready: boolean;
    connectionCheck?: CheckEvent | null;
  }>;
  preferences: (patch?: Partial<Prefs>) => Promise<Prefs>;
  montage: (
    names?: string[],
  ) => Promise<{ names: string[]; default: string[]; positions: string[] }>;
  diagnostics: () => Promise<unknown>;
  exportDiagnostics: () => Promise<boolean>;
  clearData: () => Promise<Prefs>;
  windowAction: (action: string) => Promise<void>;
  windowState?: () => Promise<{ fullScreen: boolean; maximized: boolean }>;
  onWindowState?: (
    callback: (state: { fullScreen: boolean; maximized: boolean }) => void,
  ) => () => void;
  platform?: string;
};
declare global {
  interface Window {
    neuro?: Api;
  }
}
export { electrodeNames as positions } from './electrodeMetrics';
export const qualityText: Record<Quality, string> = {
  good: '状态良好',
  warn: '建议调整',
  bad: '需要检查',
  unknown: '待判断',
};
