import { useEffect, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import type { Api, Frame, Status } from '../types';
import { LINK_TEXT, LinkBars, linkDetail } from './LinkQuality';

// The top bar is also the window's drag area (the window is frameless).
export default function TopBar({
  api,
  left,
  right,
  pill,
}: {
  api: Api | undefined;
  left: ReactNode;
  right?: ReactNode;
  pill: ReactNode;
}) {
  const [state, setState] = useState({ fullScreen: false, maximized: false });
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = api?.onWindowState?.((next) => {
      receivedEvent = true;
      if (active) setState(next);
    });
    api
      ?.windowState?.()
      .then((next) => {
        if (active && !receivedEvent) setState(next);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api]);
  const expanded = api?.platform === 'darwin' && state.fullScreen;
  const expandLabel =
    api?.platform === 'darwin' ? (expanded ? '退出全屏' : '进入全屏') : '最大化或还原';
  return (
    <header className="tb">
      <div className="tb-left">{left}</div>
      <span className="grow" />
      {pill}
      {right}
      <div className="tb-window">
        <button aria-label="最小化" title="最小化" onClick={() => api?.windowAction('minimize')}>
          <Minus size={15} />
        </button>
        <button
          aria-label={expandLabel}
          title={expandLabel}
          onClick={() => api?.windowAction('maximize')}
        >
          {api?.platform === 'darwin' ? (
            expanded ? (
              <Minimize2 size={14} />
            ) : (
              <Maximize2 size={14} />
            )
          ) : (
            <WinMaximize restore={state.maximized} />
          )}
        </button>
        <button aria-label="关闭窗口" title="关闭窗口" onClick={() => api?.windowAction('close')}>
          <X size={15} />
        </button>
      </div>
    </header>
  );
}

// Windows' own maximise (a square) and restore (two squares) glyphs, in the bar's line weight
function WinMaximize({ restore }: { restore: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      {restore ? (
        <>
          <rect x="1" y="3" width="8" height="8" />
          <path d="M3 3V1h8v8H9" />
        </>
      ) : (
        <rect x="1" y="1" width="10" height="10" />
      )}
    </svg>
  );
}

// Device state in one pill; clicking it opens the connection page.
export function ConnectionPill({
  status,
  streaming,
  ready,
  frame,
  transport,
  onClick,
}: {
  status: Status;
  streaming: boolean;
  ready: boolean;
  frame: Frame | null;
  transport: string;
  onClick: () => void;
}) {
  const quality = frame?.transport?.quality;
  let tone = 'off',
    text: ReactNode = '未连接',
    title = '设备连接';
  if (status.status === 'engine-error') {
    tone = 'bad';
    text = '引擎已停止';
  } else if (!ready) {
    tone = 'warn';
    text = '引擎未就绪';
  } else if (streaming && status.demo) {
    tone = 'demo';
    text = '模拟设备 · 模拟数据';
  } else if (streaming) {
    tone = quality?.level === 'poor' ? 'bad' : quality?.level === 'fair' ? 'warn' : 'ok';
    title = `信号质量 · ${linkDetail(quality)}`;
    text = (
      <>
        已连接 · {transport === 'serial' ? 'USB' : 'Wi-Fi'}
        <LinkBars quality={quality} />
        {quality && <span>信号{LINK_TEXT[quality.level]}</span>}
      </>
    );
  } else if (['connecting', 'reconnecting', 'checking'].includes(status.status)) {
    tone = 'warn';
    text = status.status === 'reconnecting' ? '正在重连' : '正在连接';
  } else if (status.status === 'stale') {
    tone = 'bad';
    text = '信号中断';
  } else if (status.status === 'error') {
    tone = 'bad';
    text = '连接失败';
  }
  // the battery in a pill of its own, when the board reports one (one thing per label)
  const battery = streaming && !status.demo ? frame?.battery : null;
  return (
    <>
      <button className={`conn-pill ${tone}`} onClick={onClick} title={title}>
        <i />
        {text}
      </button>
      {battery && (
        <span
          className={`conn-pill battery ${battery.low ? 'warn' : ''}`}
          title={`设备电量 ${battery.percent}%`}
          aria-label={`设备电量 ${battery.percent}%`}
        >
          <BatteryIcon percent={battery.percent} />
        </span>
      )}
    </>
  );
}

// The battery in five bars, 20% each (a bar lit from its first percent: 1–20% one bar)
function BatteryIcon({ percent }: { percent: number }) {
  const lit = Math.ceil(Math.min(100, Math.max(0, percent)) / 20);
  return (
    <svg className="battery-icon" width="27" height="12" viewBox="0 0 27 12" aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="11"
        rx="3"
        fill="none"
        stroke="currentColor"
        opacity="0.45"
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={2.5 + i * 4}
          y="2.5"
          width="3"
          height="7"
          rx="0.8"
          fill="currentColor"
          opacity={i < lit ? 1 : 0.15}
        />
      ))}
      <path d="M25 4 v4 a1.6 1.6 0 0 0 0 -4 z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}
