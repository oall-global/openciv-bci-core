import { useEffect, useRef, useState } from 'react';
import type { AlphaFrame } from './types';
import { bands, bandPowers } from './spectralMetrics';
type Props = {
  data: AlphaFrame | null;
  active: boolean;
  channel: number;
  kind: 'bands' | 'spectrogram';
};
type Column = { time: number; frequencies: number[]; power: number[] };
export default function SpectralCharts({ data, active, channel, kind }: Props) {
  const [scale, setScale] = useState('relative');
  const canvas = useRef<HTMLCanvasElement>(null),
    history = useRef<Column[]>([]),
    draw = useRef(() => {});
  const valid = !!(
    active &&
    data &&
    Date.now() / 1000 - data.at < 1.5 &&
    !data.flags[channel] &&
    bandPowers(data.frequencies, data.psd[channel] || [])
  );
  const powers = valid ? bandPowers(data!.frequencies, data!.psd[channel]) : null,
    total = powers?.reduce((a, b) => a + b, 0) ?? 0;
  useEffect(() => {
    if (kind !== 'spectrogram') return;
    const el = canvas.current!;
    let width = 0,
      height = 0,
      visible = true;
    draw.current = () => {
      if (!visible || !width || !height) return;
      const ctx = el.getContext('2d')!;
      const dpr = Math.min(devicePixelRatio, 2);
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const left = 36,
        top = 10,
        w = Math.max(1, width - 48),
        h = Math.max(1, height - 40);
      ctx.fillStyle = '#102c3b';
      ctx.fillRect(left, top, w, h);
      const rows = history.current,
        end = rows.at(-1)?.time ?? 0;
      for (const row of rows) {
        const x = left + w * (1 - (end - row.time + 0.25) / 30);
        if (x < left) continue;
        const cellWidth = Math.min((w / 30) * 0.25, left + w - x);
        if (cellWidth <= 0) continue;
        for (let i = 0; i < row.frequencies.length - 1; i++) {
          const lo = Math.max(1, row.frequencies[i]),
            hi = Math.min(40, row.frequencies[i + 1]);
          if (hi <= lo) continue;
          const db = 10 * Math.log10(Math.max(row.power[i], 1e-12)),
            v = Math.min(1, Math.max(0, (db + 30) / 60));
          ctx.fillStyle = `hsl(${240 - v * 240} 80% ${22 + v * 36}%)`;
          ctx.fillRect(x, top + ((40 - hi) / 39) * h, cellWidth + 0.2, ((hi - lo) / 39) * h + 0.2);
        }
      }
      ctx.font = '10px Segoe UI';
      ctx.fillStyle = '#7b929e';
      ctx.textAlign = 'right';
      for (const f of [1, 8, 13, 20, 30, 40])
        ctx.fillText(String(f), left - 5, top + ((40 - f) / 39) * h + 3);
      ctx.textAlign = 'center';
      for (const t of [30, 20, 10, 0])
        ctx.fillText(t ? `−${t}s` : '现在', left + w * (1 - t / 30), height - 10);
      if (!rows.length) {
        ctx.fillStyle = '#bdd4de';
        ctx.fillText('等待连续有效数据', left + w / 2, top + h / 2);
      }
    };
    const resize = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      draw.current();
    });
    resize.observe(el);
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) draw.current();
    });
    observer.observe(el);
    return () => {
      resize.disconnect();
      observer.disconnect();
      draw.current = () => {};
    };
  }, [kind]);
  useEffect(() => {
    if (kind !== 'spectrogram') return;
    if (!valid || !data) {
      history.current = [];
      draw.current();
      return;
    }
    const last = history.current.at(-1);
    if (last && data.timestamp <= last.time) return;
    if (last && data.timestamp - last.time < 0.24) return;
    history.current = [
      ...history.current.filter((r) => data.timestamp - r.time < 30),
      { time: data.timestamp, frequencies: data.frequencies, power: data.psd[channel] },
    ].slice(-125);
    draw.current();
  }, [data, valid, channel, kind]);
  return (
    <section className="wb-extra-chart">
      <div className="wb-extra-toolbar">
        <span>
          CH {channel + 1} · {data?.windowSeconds ?? 4} 秒 Welch 窗口
        </span>
        {kind === 'bands' && (
          <select
            aria-label="频段功率显示单位"
            value={scale}
            onChange={(e) => setScale(e.target.value)}
          >
            <option value="relative">相对功率 %</option>
            <option value="absolute">绝对功率 µV²</option>
          </select>
        )}
      </div>
      {kind === 'bands' ? (
        <>
          <div className="wb-band-bars">
            {bands.map((b, i) => {
              const value = powers
                  ? scale === 'relative'
                    ? total > 0
                      ? (powers[i] / total) * 100
                      : 0
                    : powers[i]
                  : null,
                max = scale === 'relative' ? 100 : Math.max(1, ...(powers ?? []));
              return (
                <div key={b.name}>
                  <label>
                    {b.name}
                    <small>
                      {b.low}–{b.high} Hz
                    </small>
                  </label>
                  <div className="wb-band-track">
                    <span style={{ width: `${value === null ? 0 : (value / max) * 100}%` }} />
                  </div>
                  <b>
                    {value === null ? '—' : value.toFixed(2)} {scale === 'relative' ? '%' : 'µV²'}
                  </b>
                </div>
              );
            })}
          </div>
          <p>所选通道 · 1–40 Hz 内积分；Gamma 仅显示 30–40 Hz。频段强弱不直接代表心理状态。</p>
        </>
      ) : (
        <>
          <canvas
            ref={canvas}
            className="wb-spectrogram"
            role="img"
            aria-label={`CH ${channel + 1} 最近 30 秒时频图`}
          />
          <div className="wb-color-scale">
            <span>−30 dB</span>
            <i />
            <span>+30 dB</span>
          </div>
          <p>
            纵轴 Hz · 颜色为 PSD，参考 1 µV²/Hz。记录打开图表后的最近 30
            秒；每列是滑动窗口估计，非毫秒级事件响应。无效数据或换通道后重新积累。
          </p>
        </>
      )}
    </section>
  );
}
