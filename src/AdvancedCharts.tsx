import { useEffect, useRef, useState } from 'react';
import type { AlphaFrame, Frame, Metadata } from './types';
import { electrodes } from './electrodes';
import { LINK_TEXT, linkDetail } from './shell/LinkQuality';
import { tc } from './theme';
const palette = [
  '#208875',
  '#437ed1',
  '#c68e32',
  '#ac64b4',
  '#d16868',
  '#5b949c',
  '#768b35',
  '#966d46',
];
type Props = {
  kind: string;
  frame: Frame | null;
  alpha: AlphaFrame | null;
  meta: Metadata | null;
  active: boolean;
  selected: number;
  select: (n: number) => void;
  enabled: boolean[];
};
function Trend({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <svg className="extra-trend" viewBox="0 0 600 130" role="img" aria-label={label}>
      <line x1="0" x2="600" y1="115" y2="115" stroke={tc('#dce6e2')} />
      <polyline
        points={values
          .map((v, i) => `${(i / Math.max(1, values.length - 1)) * 600},${115 - (v / max) * 100}`)
          .join(' ')}
        fill="none"
        stroke={tc('#238974')}
        strokeWidth="2"
      />
      <text x="5" y="12">
        {max.toFixed(1)}
      </text>
    </svg>
  );
}
// Near the input limit is still usable data; saturated or unchanging is not.
const usable = (state?: string) => state === 'normal' || state === 'near';

export default function AdvancedCharts(p: Props) {
  const [mode, setMode] = useState('rms'),
    [log, setLog] = useState(true),
    [range, setRange] = useState(100),
    [axes, setAxes] = useState([0, 1, 2, 3]);
  const [history, setHistory] = useState<number[]>([]),
    [fps, setFps] = useState('—');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setHistory([]);
  }, [p.meta?.epoch, p.kind, p.selected]);
  useEffect(() => {
    if (!p.active || !p.frame) {
      setHistory([]);
      return;
    }
    const value =
      p.kind === 'transport'
        ? p.frame.transport?.batchMs
        : p.kind === 'emg'
          ? p.frame.emg?.[p.selected]
          : p.frame.accel?.[0];
    if (value != null) setHistory((h) => [...h, value].slice(-160));
  }, [p.frame, p.active, p.kind, p.selected]);
  useEffect(() => {
    if (p.kind !== 'transport') return;
    const timer = setInterval(
      () => setFps(document.querySelector<HTMLCanvasElement>('.wave-canvas')?.dataset.fps || '—'),
      1000,
    );
    return () => clearInterval(timer);
  }, [p.kind]);
  const alphaValid = p.active && p.alpha && Date.now() / 1000 - p.alpha.at < 1.5;
  const vals = electrodes.map((_, i) =>
    !p.active
      ? null
      : mode === 'alpha'
        ? alphaValid && !p.alpha!.flags[i] && usable(p.frame?.rail?.states[i])
          ? p.alpha!.relative[i]
          : null
        : p.frame?.rail?.states[i] === 'normal'
          ? (p.frame?.rms[i] ?? null)
          : null,
  );
  useEffect(() => {
    if (p.kind !== 'headplot' || !canvas.current) return;
    const ctx = canvas.current.getContext('2d')!,
      image = ctx.createImageData(200, 200);
    const max =
      mode === 'alpha' ? 100 : Math.max(1, ...vals.filter((v): v is number => v !== null));
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        const nx = (x - 100) / 94,
          ny = (y - 100) / 94;
        let sum = 0,
          weight = 0;
        electrodes.forEach((e, i) => {
          if (vals[i] === null) return;
          const d = (nx - e.xyz[0]) ** 2 + (ny + e.xyz[2]) ** 2,
            w = 1 / Math.max(0.006, d * d);
          sum += vals[i]! * w;
          weight += w;
        });
        const v = weight ? Math.min(1, sum / weight / max) : 0,
          j = (y * 200 + x) * 4;
        image.data[j] = weight ? Math.round(30 + 225 * v) : 220;
        image.data[j + 1] = weight ? Math.round(110 + 60 * (1 - v)) : 227;
        image.data[j + 2] = weight ? Math.round(180 - 130 * v) : 225;
        image.data[j + 3] = 255;
      }
    ctx.putImageData(image, 0, 0);
  }, [p.kind, p.frame, p.alpha, p.active, mode]);
  if (p.kind === 'headplot')
    return (
      <section className="wb-extra-chart">
        <div className="wb-extra-toolbar">
          <b>二维头皮地形图</b>
          <select aria-label="头皮图指标" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="rms">去均值 RMS · µV</option>
            <option value="alpha">Alpha 占比 · %</option>
          </select>
        </div>
        <div className="scalp-map">
          <canvas ref={canvas} width={200} height={200} />
          <svg viewBox="0 0 240 240" aria-label="标准16通道头皮分布">
            <path
              d="M110 19 L120 3 L130 19 M19 94 Q0 120 19 146 M221 94 Q240 120 221 146"
              fill="none"
              stroke={tc('#718b84')}
              strokeWidth="2"
            />
            <circle cx="120" cy="120" r="101" fill="none" stroke={tc('#718b84')} />
            {electrodes.map((e, i) => (
              <g
                key={i}
                role="button"
                tabIndex={0}
                aria-label={`头皮通道 ${i + 1} ${e.name}`}
                onClick={() => p.select(i)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') p.select(i);
                }}
              >
                <circle
                  cx={120 + e.xyz[0] * 94}
                  cy={120 - e.xyz[2] * 94}
                  r={p.selected === i ? 10 : 7}
                  fill={vals[i] === null ? tc('#bdc7c3') : tc('#fff')}
                  stroke={p.selected === i ? tc('#172e29') : tc('#6a8179')}
                  strokeWidth={2}
                />
                <text x={120 + e.xyz[0] * 94} y={137 - e.xyz[2] * 94} textAnchor="middle">
                  {e.name}
                </text>
                <title>
                  CH {i + 1} {e.name}: {vals[i]?.toFixed(2) ?? '无效'}
                </title>
              </g>
            ))}
          </svg>
        </div>
        <p>
          <b>
            CH{p.selected + 1} {electrodes[p.selected].name} · {vals[p.selected]?.toFixed(2) ?? '—'}{' '}
            {mode === 'alpha' ? '%' : 'µV'}
          </b>{' '}
          · 色标 0–
          {mode === 'alpha'
            ? 100
            : Math.max(1, ...vals.filter((v): v is number => v !== null)).toFixed(1)}
        </p>
        <p>
          鼻尖朝上 · 点击电极切换选中通道 · 蓝低、黄高。
          {mode === 'alpha' ? '固定 0–100%' : '当前有效电极范围自动归一化'}
          。缺失电极为灰色，背景仅由有效电极插值；无有效电极时为灰色。示意位置、反距离插值，不是脑内源定位，也不是原版插值算法的数值复刻。
        </p>
      </section>
    );
  if (p.kind === 'overlay') {
    const shown = p.enabled.flatMap((v, i) => (v ? [i] : []));
    const why = (i: number) =>
      !alphaValid
        ? '等待数据'
        : p.alpha!.flags[i] === 'flat'
          ? '信号不变'
          : p.alpha!.flags[i] === 'amplitude'
            ? '幅度过大'
            : !usable(p.frame?.rail?.states[i])
              ? '饱和'
              : '';
    const ids = shown.filter((i) => !why(i));
    const excluded = alphaValid ? shown.filter((i) => why(i)) : [];
    const frequencies = p.alpha?.frequencies ?? [];
    const transform = (v: number) => (log ? 10 * Math.log10(Math.max(1e-12, v)) : v);
    const all = ids.flatMap((i) => p.alpha!.psd[i].map(transform));
    const lo = log ? Math.min(-30, ...all) : 0,
      hi = Math.max(lo + 1, ...all);
    return (
      <section className="wb-extra-chart">
        <div className="wb-extra-toolbar">
          <b>多通道功率频谱</b>
          <select
            aria-label="频谱纵轴"
            value={log ? 'db' : 'linear'}
            onChange={(e) => setLog(e.target.value === 'db')}
          >
            <option value="db">对数 dB</option>
            <option value="linear">线性 µV²/Hz</option>
          </select>
        </div>
        <svg
          className="overlay-spectrum"
          viewBox="0 0 620 260"
          role="img"
          aria-label="多通道频谱叠加"
        >
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1="55" x2="600" y1={225 - v * 200} y2={225 - v * 200} stroke={tc('#e1e9e5')} />
              <text x="48" y={230 - v * 200} textAnchor="end">
                {(lo + v * (hi - lo)).toFixed(1)}
              </text>
            </g>
          ))}
          {[1, 8, 13, 20, 30, 40].map((f) => (
            <text key={f} x={55 + ((f - 1) / 39) * 545} y="248">
              {f}
            </text>
          ))}
          {ids.map((i) => (
            <polyline
              key={i}
              points={p
                .alpha!.psd[i].map(
                  (v, k) =>
                    `${55 + ((frequencies[k] - 1) / 39) * 545},${225 - ((transform(v) - lo) / (hi - lo)) * 200}`,
                )
                .join(' ')}
              fill="none"
              stroke={palette[i % 8]}
              strokeDasharray={i >= 8 ? '5 3' : undefined}
              strokeWidth={i === p.selected ? 2.5 : 1.2}
              opacity={i === p.selected ? 1 : 0.65}
            />
          ))}
          {excluded.length > 0 && (
            <text x="600" y="14" textAnchor="end" className="overlay-excluded">
              未显示：
              {excluded.map((i) => `${electrodes[i].name}（${why(i)}）`).join('、')}
            </text>
          )}
          {!ids.length && (
            <text x="200" y="120">
              等待连续有效频谱
            </text>
          )}
        </svg>
        <div className="channel-legend">
          {p.enabled.map(
            (on, i) =>
              on && (
                <button key={i} onClick={() => p.select(i)} style={{ color: palette[i % 8] }}>
                  {i >= 8 ? '┄' : '━'} CH{i + 1}
                  {ids.includes(i) ? '' : ' · 无效'}
                </button>
              ),
          )}
        </div>
        <p>
          最近4秒 Welch · 1–40 Hz · 使用通道面板勾选参与叠加的通道。dB 参考 1
          µV²/Hz；饱和及幅度异常通道不绘制。
        </p>
      </section>
    );
  }
  if (p.kind === 'transport') {
    const t = p.frame?.transport;
    return (
      <section className="wb-extra-chart">
        <div className="wb-extra-toolbar">
          <b>丢包与传输状态</b>
          <span>{p.active ? '正在接收' : '无新数据'}</span>
        </div>
        <div className="metric-grid">
          {[
            ['估计丢包', t ? `${t.lossPercent.toFixed(2)}%` : '—'],
            ['接收样本', t?.received ?? '—'],
            ['估计缺失', t?.estimatedLost ?? '—'],
            ['重复序号', t?.duplicates ?? '—'],
            ['不确定跳变', t?.ambiguous ?? '—'],
            [
              '信号质量',
              p.frame?.transport?.quality
                ? `${LINK_TEXT[p.frame.transport.quality.level]} · ${linkDetail(p.frame.transport.quality)}`
                : '—',
            ],
            ['设备时钟偏差', p.frame?.clock ? `${p.frame.clock.driftPpm} ppm` : '—'],
            ['波形绘制 FPS', fps],
          ].map(([k, v]) => (
            <div key={k}>
              <small>{k}</small>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        <Trend values={history} label="数据批次间隔趋势" />
        <p>
          最近到包间隔 {p.active ? (t?.batchMs?.toFixed(1) ?? '—') : '—'}{' '}
          ms；趋势按界面更新抽样，累计计数逐包统计。序号循环推算缺失，不确定跳变单列；整圈缺失无法仅由8位序号检测。不是网卡层丢包率。未显示波形时
          FPS 为 —。
        </p>
      </section>
    );
  }
  if (p.kind === 'emg' || p.kind === 'joystick') {
    const value = (i: number) =>
      p.active && p.frame?.rail?.states[i] === 'normal' ? (p.frame.emg?.[i] ?? null) : null;
    const x =
      value(axes[1]) !== null && value(axes[0]) !== null
        ? Math.max(-1, Math.min(1, (value(axes[1])! - value(axes[0])!) / range))
        : null;
    const y =
      value(axes[3]) !== null && value(axes[2]) !== null
        ? Math.max(-1, Math.min(1, (value(axes[3])! - value(axes[2])!) / range))
        : null;
    return (
      <section className="wb-extra-chart">
        <div className="wb-extra-toolbar">
          <b>{p.kind === 'emg' ? '肌电频段幅度' : '肌电虚拟摇杆'}</b>
          <label>
            满量程 µV{' '}
            <input
              aria-label="肌电满量程"
              type="number"
              min={1}
              max={1000}
              value={range}
              onChange={(e) => setRange(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
        {p.kind === 'emg' ? (
          <div className="emg-bars">
            {electrodes.map((e, i) => (
              <button key={i} onClick={() => p.select(i)}>
                <span>
                  CH{i + 1} {e.name}
                </span>
                <meter min={0} max={range} value={value(i) ?? 0} />
                <b>{value(i)?.toFixed(1) ?? '—'}</b>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="axis-config">
              {['左', '右', '上', '下'].map((label, k) => (
                <label key={label}>
                  {label}
                  <select
                    aria-label={`摇杆${label}通道`}
                    value={axes[k]}
                    onChange={(e) =>
                      setAxes((a) => a.map((v, i) => (i === k ? Number(e.target.value) : v)))
                    }
                  >
                    {electrodes.map((e, i) => (
                      <option value={i} key={i}>
                        CH{i + 1} {e.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <svg className="joystick-map" viewBox="0 0 240 240">
              <circle cx="120" cy="120" r="100" fill={tc('#edf5f1')} stroke={tc('#9ebaae')} />
              <path d="M20 120H220 M120 20V220" stroke={tc('#bdd2c7')} />
              {x !== null && y !== null && (
                <circle cx={120 + x * 90} cy={120 + y * 90} r="10" fill={tc('#208875')} />
              )}
            </svg>
            <p>
              X {x?.toFixed(2) ?? '—'} · Y {y?.toFixed(2) ?? '—'} ·
              仅屏幕预览，不发送机械臂或键鼠指令。
            </p>
          </>
        )}
        <p>
          最近1秒 20–{Math.min(90, (p.meta?.rate ?? 250) * 0.4)} Hz 频段 RMS，排除 50/60 Hz ±2
          Hz。不是原版自适应 EMG
          算法；头皮信号可能混有肌肉、电极移动与电噪声，不自动证明肌肉动作。建议按实验需要正确布置肌电电极。
        </p>
      </section>
    );
  }
  if (p.kind === 'focus') {
    const f = alphaValid ? p.alpha?.focus : null;
    return (
      <section className="wb-extra-chart">
        <b>Focus · BrainFlow 模型观察</b>
        <div className="metric-grid">
          {[
            ['Mindfulness', f?.mindfulness],
            ['Restfulness', f?.restfulness],
          ].map(([label, v]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{typeof v === 'number' ? v.toFixed(3) : '—'}</strong>
            </div>
          ))}
        </div>
        <p>
          使用最近4秒、当前有效通道的 BrainFlow
          平均频段特征，默认分类器每秒估计一次，输出范围0–1。当前参与：
          {f?.channels.map((i) => `CH${i + 1}`).join('、') || '等待连续有效数据'}。
        </p>
        <p>
          参考原版 Focus
          的处理流程；模型版本、窗口与通道配置可能与原版不同。它是通用模型的实验性输出，未经个人校准，不是准确率、真实专注度或医疗结论。两项输出可能互补，不能当作独立证据。
        </p>
      </section>
    );
  }
  if (p.kind === 'accel')
    return (
      <section className="wb-extra-chart">
        <b>加速度 / 辅助通道</b>
        <div className="metric-grid">
          {['X', 'Y', 'Z'].map((a, i) => (
            <div key={a}>
              <small>{a} · g</small>
              <strong>{p.active ? (p.frame?.accel?.[i]?.toFixed(4) ?? '—') : '—'}</strong>
            </div>
          ))}
        </div>
        <Trend values={history} label="X轴加速度趋势" />
        <p>
          显示 BrainFlow 解码的辅助通道批次平均值。
          {p.meta?.accelChannels === 3 ? '板型定义包含三轴加速度。' : '当前未声明三轴通道。'}{' '}
          是否为有效加速度，取决于硬件与当前辅助模式；持续为零不能证明设备静止。若固件复用为其他输入，请先确认模式，不据此推断运动。
        </p>
      </section>
    );
  return (
    <section className="wb-extra-chart">
      <b>硬件与算法支持条件</b>
      <table className="support-table">
        <tbody>
          {[
            [
              'Pulse Sensor 脉搏',
              '需外接脉搏传感器、确认模拟输入与量程，当前没有已确认的脉搏数据。',
            ],
            ['Analog / Digital 输入', '需确认固件辅助模式和引脚协议；当前不自动切换板卡模式。'],
            ['Ganglion 阻抗', '当前适配标准16通道 Cyton + Daisy，不支持 Ganglion 硬件。'],
            [
              'Networking 其他协议',
              '本机 WebSocket 接口可用；尚未实现原版 LSL、OSC、UDP 等全部协议。',
            ],
          ].map(([a, b]) => (
            <tr key={a}>
              <th>{a}</th>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
