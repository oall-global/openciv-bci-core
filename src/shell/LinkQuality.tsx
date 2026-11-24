import type { LinkQuality } from '../types';

// Wi-Fi / USB signal quality over the last 10 s (engine/workbench_metrics.py link_quality):
// lost packages, the longest pause in delivery, counter jumps.
export const LINK_TEXT = { good: '良好', fair: '一般', poor: '较差' };

export function linkDetail(q: LinkQuality | null | undefined) {
  if (!q) return '等待数据';
  return `最近 ${q.seconds} 秒：丢包 ${q.lossPercent.toFixed(1)}%，最长中断 ${(q.longestGapMs / 1000).toFixed(1)} 秒${
    q.breaks ? `，计数跳变 ${q.breaks} 次` : ''
  }`;
}

export function LinkBars({ quality }: { quality: LinkQuality | null | undefined }) {
  const bars = quality?.bars ?? 0;
  return (
    <svg
      className={`link-bars ${quality?.level ?? 'none'}`}
      width="16"
      height="12"
      viewBox="0 0 16 12"
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={i * 5.5}
          y={8 - i * 4}
          width="4"
          height={4 + i * 4}
          rx="1"
          className={i < bars ? 'on' : ''}
        />
      ))}
    </svg>
  );
}
