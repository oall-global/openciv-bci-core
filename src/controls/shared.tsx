import { useEffect, useRef, useState } from 'react';
import type { Api } from '../types';

export const actionText: Record<string, string> = {
  blink: '眨眼',
  'double-blink': '双眨眼',
  left: '向左看',
  right: '向右看',
  clench: '咬一下牙',
};
export const EYE_JAW_CHANNELS = ['Fp1', 'Fp2', 'F7', 'F8', 'T7', 'T8'];
export const now = () => Date.now() / 1000;

export type Calibration = {
  separable: Record<string, boolean>;
  threshold: { v: number | null; h: number | null; m: number | null };
  leftSign: 1 | -1;
  peaks: Record<string, number | null>;
};
export type MethodState = {
  status: 'none' | 'ready' | 'stale';
  staleReason?: 'age' | 'connection' | null;
  calibratedAt?: string;
  source?: 'demo' | 'device';
  calibration?: Calibration & { threshold: number; frequencies: number[] };
  validation?: { summary: string; at: string } | null;
};
export type ControlState = { participant: string; methods: Record<string, MethodState> };

export function cleanError(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
}

export function useLevels(api: Api) {
  const [levels, setLevels] = useState({ v: 0, h: 0, m: 0 });
  useEffect(
    () =>
      api.subscribe((event) => {
        const e = event as unknown as { type: string; v: number; h: number; m: number };
        if (e.type === 'control-levels') setLevels({ v: e.v, h: e.h, m: e.m });
      }),
    [api],
  );
  return levels;
}

// Live eye / jaw activity. With a calibration the midline marks the personal threshold.
export function Levels({ api, calibration }: { api: Api; calibration?: Calibration | null }) {
  const { v, h, m } = useLevels(api);
  const thr = calibration?.threshold;
  const ref = { v: thr?.v ?? 75, h: thr?.h ?? 40, m: thr?.m ?? 20 };
  const sign = calibration?.leftSign ?? 1;
  const bars: [string, string, number, boolean][] = [
    ['前额 · 眨眼', 'Fp1 · Fp2', v / ref.v, false],
    ['两侧 · 左右看', 'F7 − F8', (h * sign) / ref.h, true],
    ['太阳穴 · 咬牙', 'T7 · T8', m / ref.m, false],
  ];
  return (
    <div className="control-levels">
      {bars.map(([title, electrodes, value, bipolar]) => {
        const fill = Math.min(1, Math.abs(value) / 2);
        return (
          <div
            key={title}
            className={`control-level ${calibration && Math.abs(value) >= 1 ? 'over' : ''}`}
          >
            <div>
              <b>{title}</b>
              <span>{electrodes}</span>
            </div>
            <div className={`control-bar ${bipolar ? 'bipolar' : ''}`}>
              <i
                style={
                  bipolar
                    ? { width: `${fill * 50}%`, left: value >= 0 ? '50%' : `${50 - fill * 50}%` }
                    : { width: `${fill * 100}%` }
                }
              />
              {calibration &&
                (bipolar ? [25, 75] : [50]).map((x) => <em key={x} style={{ left: `${x}%` }} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A calibration or validation run recorded as a session with cue events.
export function useSessionRecorder(api: Api) {
  const active = useRef(false);
  useEffect(
    () => () => {
      if (active.current) api.session('abort', { reason: '离开了控制页面' }).catch(() => {});
    },
    [api],
  );
  return {
    async start(id: string, title: string, channels: string[], params: unknown) {
      await api.session('start', { task: { id, version: 1, title }, channels, params, fit: null });
      active.current = true;
    },
    mark(label: string, data?: unknown, t = now()) {
      if (active.current) api.session('event', { label, data, t }).catch(() => {});
    },
    async finish(headline: string, summary: Record<string, unknown>, detail: unknown) {
      if (!active.current) return;
      active.current = false;
      await api.session('finish', { summary: { headline, ...summary }, headline, detail });
    },
    abort(reason: string) {
      if (!active.current) return;
      active.current = false;
      api.session('abort', { reason }).catch(() => {});
    },
  };
}

// Acquisition time of the newest sample received. Engine events and data carry acquisition
// times; with transport latency, data for a moment arrives seconds after it. Flows that judge
// a time window first wait for the data covering it (at most 10 s).
export function useLatestData(api: Api) {
  const latest = useRef(0);
  useEffect(
    () =>
      api.subscribe((e) => {
        if (e.type === 'data' && e.timestamps.length)
          latest.current = e.timestamps[e.timestamps.length - 1];
      }),
    [api],
  );
  return async (until: number, sleep: (ms: number) => Promise<void>) => {
    for (let i = 0; i < 100 && latest.current < until; i++) await sleep(100);
  };
}

// Demo device only: perform the cued action shortly after the cue.
export function simulate(api: Api, action: string) {
  const inject = (a: string, delay: number) =>
    window.setTimeout(() => api.command('demo-artifact', { action: a }).catch(() => {}), delay);
  if (action === 'double-blink') {
    inject('blink', 300);
    inject('blink', 650);
  } else inject(action, 300);
}

// Runs an async script with cancellable sleeps; stops on Esc, signal loss or unmount.
export function useScript(streaming: boolean, onStop: (reason: string) => void) {
  const timers = useRef<number[]>([]);
  const alive = useRef(false);
  const stop = useRef(onStop);
  stop.current = onStop;
  const cancel = (reason: string) => {
    if (!alive.current) return;
    alive.current = false;
    timers.current.forEach(clearTimeout);
    stop.current(reason);
  };
  useEffect(() => {
    if (!streaming) cancel('信号中断，已停止。请检查连接后重试。');
  }, [streaming]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancel('你已停止。');
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      cancel('离开了控制页面');
    };
  }, []);
  return {
    get running() {
      return alive.current;
    },
    begin() {
      alive.current = true;
    },
    end() {
      alive.current = false;
    },
    cancel,
    sleep: (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (!alive.current) return reject(Error('stopped'));
        timers.current.push(
          window.setTimeout(() => (alive.current ? resolve() : reject(Error('stopped'))), ms),
        );
      }),
  };
}
