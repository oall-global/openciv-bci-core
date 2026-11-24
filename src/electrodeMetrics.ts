import { electrodes } from './electrodes';
import type { Frame, AlphaFrame } from './types';
// The current montage's names (设置 → 电极位置), shared with electrodes.ts.
export { electrodeNames } from './electrodes';
import { electrodeNames } from './electrodes';
export type BrainMode = 'railed' | 'alpha' | 'rms';
export function electrodeMetric(
  mode: BrainMode,
  i: number,
  frame: Frame | null,
  alpha: AlphaFrame | null,
  active: boolean,
  now: number,
) {
  const unknown = { color: '#8796a5', text: '等待有效数据' };
  if (!active || !frame || now - frame.at * 1000 > 1500 || now - frame.at * 1000 < -1000)
    return unknown;
  if (mode === 'railed') {
    const state = frame.rail?.states[i],
      value = frame.rail?.percentages[i];
    if (!state || state === 'unknown' || value == null || !Number.isFinite(value)) return unknown;
    const colors: Record<string, string> = {
      normal: '#299b77',
      near: '#e6a13d',
      railed: '#e45d57',
      flat: '#e45d57',
    };
    const names: Record<string, string> = {
      normal: 'Not Railed',
      near: 'Near Railed',
      railed: 'Railed',
      flat: '信号不变',
    };
    return {
      color: colors[state] || unknown.color,
      text: `${names[state] || '未知'} · ${value.toFixed(2)}% 量程`,
    };
  }
  if (
    mode === 'alpha' &&
    (!alpha ||
      alpha.epoch !== frame.epoch ||
      now - alpha.at * 1000 > 1500 ||
      now - alpha.at * 1000 < -1000 ||
      alpha.flags[i])
  )
    return unknown;
  const value = mode === 'alpha' ? alpha!.relative[i] : frame.rms[i];
  if (!Number.isFinite(value) || value < 0) return unknown;
  const level = Math.min(1, value / (mode === 'alpha' ? 100 : 60));
  return {
    color: `hsl(${205 - level * 40} 65% ${35 + level * 25}%)`,
    text:
      mode === 'alpha'
        ? `Alpha ${value.toFixed(1)}% · ${alpha!.absolute[i].toFixed(2)} µV²`
        : `RMS ${value.toFixed(2)} µV`,
  };
}
