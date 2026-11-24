import { useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Plug, SlidersHorizontal } from 'lucide-react';
import type { AlphaFrame, Frame, Metadata, CheckEvent } from './types';
import Waveform from './Waveform';
import type { WaveClock } from './wavePlayback';
import BrainSyncView from './BrainSyncView';
import SpectralCharts from './SpectralCharts';
import AdvancedCharts from './AdvancedCharts';
import SessionTools from './SessionTools';
import { useReplay } from './useReplay';
import './workbench-extra.css';
import { electrodeNames } from './electrodeMetrics';
import ElectrodeMap, { type Link } from './ElectrodeMap';
import { tc } from './theme';
import DigitalBrain from './DigitalBrain';
import WorkbenchFocus, { savedLook } from './WorkbenchFocus';
import Help from './glossary/Help';
import { contactSummary } from './ContactMap';
const chartOptions = [
  ['wave', '时间序列'],
  ['spectrum', '功率频谱'],
  ['overlay', '多通道频谱'],
  ['bands', '频段功率'],
  ['spectrogram', '时频图'],
  ['digital', '脑活动图谱'],
  ['headplot', '二维头皮图'],
  ['topomap', '头皮地形图'],
  ['brain', '脑电同步'],
  ['channels', '通道状态'],
  ['channel-list', '通道列表'],
  ['transport', '丢包与传输'],
  ['accel', '加速度'],
  ['focus', 'Focus 模型观察'],
  ['emg', '肌电幅度'],
  ['joystick', '肌电虚拟摇杆'],
  ['marker', '事件标记'],
  ['recording', '录制与回放'],
  ['network', '数据输出'],
  ['support', '更多功能 / 支持条件'],
];
type Props = {
  clock: MutableRefObject<WaveClock>;
  checkResult: CheckEvent | null;
  onCheck: (channel: number) => Promise<unknown>;
  onCancel: () => Promise<unknown>;
  buffer: MutableRefObject<number[][]>;
  frame: Frame | null;
  alpha: AlphaFrame | null;
  meta: Metadata | null;
  active: boolean;
  demo: boolean;
  busy: boolean;
  paused: boolean;
  setPaused: (v: boolean) => void;
  selected: number;
  select: (i: number) => void;
  enabled: boolean[];
  setEnabled: (v: boolean[]) => void;
  navigate: (p: string) => void;
  link?: Link;
};
const subtitles: Record<string, string> = {
  wave: '各电极的波形 · 5–50 Hz · 最近 5 秒',
  spectrum: '每个频率成分的强弱',
  brain: '脑区之间的节律是否一致',
  digital: '各电极频段能量在皮层上的分布 · 相对基线',
  'channel-list': '显示开关与量程占用',
};
const tileText: Record<string, string> = {
  ok: '正常',
  poor: '接触差',
  off: '未接触',
  unknown: '无信号',
};
// The rail check alone, when no contact assessment is available (e.g. a replayed file).
const fromRail: Record<string, string> = {
  normal: 'ok',
  near: 'ok',
  railed: 'off',
  flat: 'off',
};
const labels: Record<string, string> = {
  normal: 'Not Railed',
  near: 'Near Railed',
  railed: 'Railed',
  flat: '信号不变',
  unknown: '等待数据',
};
const colors: Record<string, string> = {
  normal: 'good',
  near: 'warn',
  railed: 'bad',
  flat: 'bad',
  unknown: 'unknown',
};
export default function Workbench(live: Props) {
  const replay = useReplay();
  const p: Props = replay.file
    ? {
        ...live,
        buffer: replay.buffer,
        clock: replay.clock,
        frame: replay.view.frame,
        alpha: replay.view.alpha,
        meta: { ...replay.file.header.metadata, epoch: replay.clock.current.epoch },
        active: replay.view.active,
        paused: !replay.playing,
        setPaused: (v) => replay.setPlaying(!v),
        demo: replay.file.header.source === 'demo',
      }
    : live;
  const [workspace, setWorkspace] = useState<{ layout: string; panels: string[] }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('neurolink-workspace') || 'null');
      if (
        saved &&
        ['focus', 'single', 'columns', 'rows', 'grid'].includes(saved.layout) &&
        Array.isArray(saved.panels) &&
        saved.panels.length === 4 &&
        saved.panels.every(
          (v: unknown) => typeof v === 'string' && chartOptions.some(([id]) => id === v),
        )
      ) {
        // 数字大脑 replaced 脑电同步 as the default (once; it can be changed back).
        if (!saved.v2 && !saved.panels.includes('digital'))
          saved.panels = saved.panels.map((v: string) => (v === 'brain' ? 'digital' : v));
        // 主图 became the default layout (once; the other layouts stay one click away).
        return { layout: saved.v3 ? saved.layout : 'focus', panels: saved.panels };
      }
    } catch {}
    return { layout: 'focus', panels: ['wave', 'spectrum', 'digital', 'channels'] };
  });
  const [focused, setFocused] = useState<number | null>(null);
  // 主图 look saved from 主图布局 (read when the workbench opens).
  const [mainLook] = useState(savedLook);
  const options = chartOptions;
  useEffect(() => {
    try {
      localStorage.setItem(
        'neurolink-workspace',
        JSON.stringify({ ...workspace, v2: true, v3: true }),
      );
    } catch {}
  }, [workspace]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocused(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // 时间序列: fixed µV per row (like the usual EEG viewers) or each row scaled to its signal
  const [waveScale, setWaveScale] = useState(
    // ±200 µV unless chosen otherwise, as OpenBCI GUI opens
    () => Number(localStorage.getItem('neurolink.waveScale') ?? 200) || 0,
  );
  function setPanel(index: number, value: string) {
    setWorkspace((w) => ({ ...w, panels: w.panels.map((p, i) => (i === index ? value : p)) }));
  }
  const rail = p.active ? p.frame?.rail : null;
  // near railed (poor) counts as worn, as in 首次打开: it records, only with less headroom
  const contactGood = contactSummary(
    (p.frame?.contact?.states ?? []).map((s) => (s === 'poor' ? 'ok' : s)),
  ).good;
  const fresh =
    p.active && p.alpha && Date.now() / 1000 - p.alpha.at < 1.5 && !p.alpha.flags[p.selected];
  const psd = fresh ? p.alpha!.psd[p.selected] : [],
    freq = p.alpha?.frequencies || [];
  const top = Math.max(0.01, ...psd),
    points = psd
      .map((v, i) => `${36 + ((freq[i] - 1) / 39) * 560},${158 - (v / top) * 132}`)
      .join(' ');
  function renderChart(kind: string, index: number) {
    if (kind === 'headplot')
      return (
        <ElectrodeMap
          frame={p.frame}
          meta={p.meta}
          active={p.active}
          demo={p.demo}
          link={replay.file ? undefined : p.link}
          checkResult={p.checkResult}
          selected={p.selected}
          onSelect={p.select}
          onCheck={replay.file ? undefined : (channel) => void p.onCheck(channel)}
        />
      );
    if (kind === 'topomap') return <AdvancedCharts {...p} kind="headplot" />;
    if (kind === 'digital') return <DigitalBrain streaming={p.active} />;
    if (['overlay', 'transport', 'focus', 'emg', 'joystick', 'accel', 'support'].includes(kind))
      return <AdvancedCharts {...p} kind={kind} />;
    if (['recording', 'marker', 'network'].includes(kind))
      return <SessionTools kind={kind} active={live.active} replay={replay} />;
    if (kind === 'bands' || kind === 'spectrogram')
      return (
        <SpectralCharts
          key={`${kind}-${p.selected}-${p.meta?.epoch}`}
          kind={kind}
          data={p.alpha}
          active={p.active}
          channel={p.selected}
        />
      );
    if (kind === 'wave')
      return (
        <section className="wb-panel wb-wave">
          <div className="wb-panel-head">
            <h2>
              <span>01</span>时间序列
            </h2>
            <span>{p.paused ? '画面暂停' : p.active ? '实时' : '等待数据'} · 5 秒 · 5–50 Hz</span>
          </div>
          <div className="wb-wave-stage">
            <Waveform
              key={p.clock.current.epoch}
              buffer={p.buffer}
              clock={p.clock}
              rate={p.meta?.rate || 250}
              selected={p.selected}
              paused={p.paused}
              enabled={p.enabled}
              active={p.active}
              scale={waveScale}
              rail={p.active ? p.frame?.rail : undefined}
            />
            {!p.active && !p.frame && (
              <div className="wb-empty">
                <button className="primary wb-connect" onClick={() => p.navigate('devices')}>
                  <Plug size={18} />
                  接入脑电设备
                </button>
              </div>
            )}
          </div>
          <div className="wb-axis">
            <span>−8 s</span>
            <span>−6 s</span>
            <span>−4 s</span>
            <span>−2 s</span>
            <span>显示时刻</span>
          </div>
        </section>
      );
    if (kind === 'channels')
      return (
        <section className="wb-tiles" aria-label="通道状态">
          {electrodeNames.map((name, i) => {
            const state = p.active
              ? (p.frame?.contact?.states[i] ?? fromRail[rail?.states[i] ?? ''] ?? 'unknown')
              : 'unknown';
            return (
              <button
                key={name}
                className={`wb-tile ${state} ${p.selected === i ? 'selected' : ''}`}
                aria-pressed={p.selected === i}
                aria-label={`通道 ${i + 1} ${name}`}
                onClick={() => p.select(i)}
              >
                <b>{name}</b>
                <span>{tileText[state] ?? '待判断'}</span>
                <small>
                  {p.active && p.frame?.rms?.[i] != null ? `${p.frame.rms[i].toFixed(1)} µV` : '—'}
                </small>
              </button>
            );
          })}
        </section>
      );
    if (kind === 'channel-list')
      return (
        <section className="wb-panel wb-channels">
          <div className="wb-panel-head">
            <h2>
              <span>02</span>通道检查
            </h2>
            <button onClick={() => p.navigate('fit')} title="打开完整连接检测">
              <SlidersHorizontal size={15} />
            </button>
          </div>
          <div className="wb-channel-head">
            <span>显示 / 通道</span>
            <span>量程占用</span>
            <span>状态</span>
          </div>
          <div className="wb-channel-rows">
            {p.enabled.map((enabled, i) => {
              const state = rail?.states[i] || 'unknown';
              return (
                <div key={i} className={`wb-channel-row ${p.selected === i ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`显示通道 ${i + 1}`}
                    checked={enabled}
                    onChange={(e) =>
                      p.setEnabled(p.enabled.map((v, j) => (i === j ? e.target.checked : v)))
                    }
                  />
                  <button
                    aria-label={`检查通道 ${i + 1}`}
                    aria-pressed={p.selected === i}
                    onClick={() => p.select(i)}
                  >
                    <b>CH {String(i + 1).padStart(2, '0')}</b>
                    <span>
                      {rail?.percentages[i]?.toFixed(2) ?? '—'}
                      {rail?.percentages[i] != null ? '%' : ''}
                    </span>
                    <small>
                      <i className={`dot ${colors[state] || 'unknown'}`} />
                      {labels[state] || '待判断'}
                    </small>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="wb-channel-detail">
            <b>
              CH {p.selected + 1} · {labels[rail?.states[p.selected] || 'unknown']}
            </b>
            <p>
              峰值 {rail?.peaks?.[p.selected]?.toFixed(2) ?? '—'} µV
              <br />
              最近 {rail?.sampleCount ?? '—'} 个样本 · 原版 Railed 判定
            </p>
          </div>
        </section>
      );
    if (kind === 'spectrum')
      return (
        <section className="wb-analysis">
          <div className="wb-panel-head">
            <h2>
              功率频谱 <small>CH {p.selected + 1}</small>
            </h2>
          </div>
          <div className="wb-spectrum">
            <div className="wb-spectrum-chart">
              <small>PSD · µV²/Hz · 最近 4 秒</small>
              <svg viewBox="0 0 620 184" role="img" aria-label="当前所选通道的功率谱">
                <rect
                  x={36 + (7 / 39) * 560}
                  y="20"
                  width={(5 / 39) * 560}
                  height="138"
                  fill={tc('#e6f4f0')}
                />
                {[0, 0.5, 1].map((n) => (
                  <g key={n}>
                    <line
                      x1="36"
                      x2="596"
                      y1={158 - n * 132}
                      y2={158 - n * 132}
                      stroke={tc('#e4e9ee')}
                    />
                    <text x="30" y={162 - n * 132} textAnchor="end">
                      {(top * n).toFixed(top < 1 ? 3 : 1)}
                    </text>
                  </g>
                ))}
                {[1, 8, 13, 20, 30, 40].map((n) => (
                  <text key={n} x={36 + ((n - 1) / 39) * 560} y="177" textAnchor="middle">
                    {n} Hz
                  </text>
                ))}
                <polyline points={points} fill="none" stroke={tc('#249681')} strokeWidth="2" />
                {!fresh && (
                  <text x="300" y="100" textAnchor="middle">
                    等待连续有效数据
                  </text>
                )}
              </svg>
            </div>
            <div className="wb-alpha">
              <small>α / 8–13 Hz</small>
              <strong>
                {fresh ? p.alpha!.relative[p.selected].toFixed(1) : '—'}
                <em>%</em>
              </strong>
              <p>Alpha 占 1–40 Hz 能量</p>
              <b>{fresh ? p.alpha!.absolute[p.selected].toFixed(2) : '—'} µV²</b>
            </div>
          </div>
        </section>
      );
    return (
      <section className="wb-analysis">
        <BrainSyncView
          alpha={p.alpha}
          checkResult={p.checkResult}
          onCheck={replay.file ? undefined : p.onCheck}
          onCancel={replay.file ? undefined : p.onCancel}
          onSpectrum={() => setPanel(index, 'spectrum')}
          frame={p.frame}
          active={p.active}
          paused={p.paused}
          selected={p.selected}
          onSelect={p.select}
          reset={0}
          demo={p.demo}
        />
      </section>
    );
  }
  return (
    <div className="workbench">
      {replay.file && (
        <div className="replay-banner">
          <b>历史回放 · {replay.file.file}</b>
          <button className="secondary" onClick={() => replay.setPlaying(!replay.playing)}>
            {replay.playing ? '暂停' : '播放'}
          </button>
          <input
            type="range"
            aria-label="回放位置"
            min={0}
            max={replay.file.duration}
            step={100}
            value={replay.position}
            onChange={(e) => replay.seek(Number(e.target.value))}
          />
          <span>
            {(replay.position / 1000).toFixed(1)} / {(replay.file.duration / 1000).toFixed(1)} 秒
          </span>
          <button className="secondary" onClick={replay.close}>
            返回实时采集
          </button>
        </div>
      )}
      <div className="wb-layout-bar">
        <h1>信号工作台</h1>
        <span className="wb-params">
          {replay.file
            ? '录制回放'
            : // rate, gain and units are in the 「?」; 模拟数据 is in the connection pill
              `${p.meta?.channels ?? 16} 通道${p.active ? '' : ' · 未连接'}`}
          <Help id="sampling" />
        </span>
        {p.active && !replay.file && (
          <button
            className="wb-fit"
            title="佩戴检查：每个电极的接触情况"
            aria-label={`佩戴检查，接触良好 ${contactGood} / 16`}
            onClick={() => {
              if (workspace.layout !== 'focus') {
                setWorkspace((w) => ({ ...w, layout: 'focus' }));
                setFocused(null);
              }
              // after the 主图 has mounted
              setTimeout(() => window.dispatchEvent(new Event('brainlab:fit-check')));
            }}
          >
            <i className={fitLevel(contactGood)} />
            佩戴 {contactGood}/16
          </button>
        )}
        {workspace.layout === 'focus' && !replay.file && <ApiSwitch />}
        <span className="grow" />
        <div role="group" aria-label="图表布局" className="wb-seg">
          {[
            ['focus', '主图'],
            ['single', '单图'],
            ['columns', '左右'],
            ['rows', '上下'],
            ['grid', '四宫格'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={workspace.layout === id}
              className={workspace.layout === id ? 'selected' : ''}
              onClick={() => {
                setWorkspace((w) => ({ ...w, layout: id }));
                setFocused(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="wb-bar-button"
          disabled={!p.active && !p.paused}
          onClick={() => p.setPaused(!p.paused)}
        >
          {p.paused ? '继续显示' : '暂停波形'}
        </button>
      </div>
      {workspace.layout === 'focus' && (
        <WorkbenchFocus
          buffer={p.buffer}
          clock={p.clock}
          frame={p.frame}
          alpha={p.alpha}
          meta={p.meta}
          active={p.active}
          paused={p.paused}
          selected={p.selected}
          select={p.select}
          enabled={p.enabled}
          navigate={p.navigate}
          connecting={p.busy}
          look={mainLook}
        />
      )}
      <div
        hidden={workspace.layout === 'focus'}
        className={`wb-chart-grid layout-${focused === null ? workspace.layout : 'single'}`}
      >
        {workspace.panels
          .slice(
            0,
            workspace.layout === 'focus'
              ? 0
              : workspace.layout === 'single'
                ? 1
                : workspace.layout === 'grid'
                  ? 4
                  : 2,
          )
          .map((kind, index) =>
            focused !== null && focused !== index ? null : (
              <section
                className={`wb-chart-cell chart-${kind}`}
                key={index}
                aria-label={`图表面板 ${index + 1}`}
              >
                <div className="wb-chart-controls">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <b>{options.find(([id]) => id === kind)?.[1]}</b>
                  <small>
                    {kind === 'channels'
                      ? p.active && p.frame?.contact
                        ? `正常 ${p.frame.contact.states.filter((x) => x === 'ok').length} / 16${
                            p.frame.contact.reference ? ' · 请检查参考电极' : ''
                          }`
                        : p.active && rail
                          ? `正常 ${rail.states.filter((x) => x === 'normal').length} / 16`
                          : '未连接'
                      : (subtitles[kind] ?? `CH ${p.selected + 1} · ${electrodeNames[p.selected]}`)}
                  </small>
                  <span className="grow" />
                  {kind === 'wave' && (
                    <label className="wb-change">
                      纵向刻度
                      <select
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
                    </label>
                  )}
                  <label className="wb-change">
                    更换图表
                    <select
                      aria-label={`面板 ${index + 1} 图表`}
                      value={kind}
                      onChange={(e) => setPanel(index, e.target.value)}
                    >
                      {options.map(([id, title]) => (
                        <option key={id} value={id}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="text-button"
                    aria-label={focused === index ? '还原面板' : `放大面板 ${index + 1}`}
                    onClick={() => setFocused(focused === index ? null : index)}
                  >
                    {focused === index ? '还原布局' : '放大'}
                  </button>
                </div>
                <div className="wb-chart-content">{renderChart(kind, index)}</div>
              </section>
            ),
          )}
      </div>
    </div>
  );
}
const fitLevel = (good: number) => (good >= 12 ? 'ok' : good >= 6 ? 'poor' : 'off');

// 主图: the master switch of the local developer interface (electron/developer.cjs): while it
// is on, programs on this computer receive the raw EEG and band power; how many listen, and 接口说明.
function ApiSwitch() {
  const api = window.neuro;
  const [st, setSt] = useState<{ enabled: boolean; clients: unknown[] } | null>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(''),
    // 接口说明: the text an AI agent or a program needs (electron/agentguide.cjs), with the key
    [guide, setGuide] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        ?.developer('state')
        .then((s) => alive && setSt(s))
        .catch(() => {});
    read();
    const t = setInterval(read, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api]);
  if (!api) return null;
  const on = !!st?.enabled;
  const act = async (action: string) => {
    setBusy(true);
    setNote('');
    try {
      if (action === 'agent-guide') setGuide(await api.developer(action));
      else await api.developer(action, { port: 8765 });
      if (action === 'copy-agent-guide') setNote('已复制');
      if (action === 'stop') setGuide(null);
      setSt(await api.developer('state'));
    } catch (e) {
      setNote(String(e).replace(/^.*Error: /, ''));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="wb-api">
      <button
        role="switch"
        aria-checked={on}
        aria-label="开发者接口"
        className={`switch ${on ? 'on' : ''}`}
        disabled={busy}
        onClick={() => act(on ? 'stop' : 'start')}
      >
        <i />
      </button>
      开发者接口
      {on && <small>{st!.clients.length} 个程序</small>}
      {on && (
        <button
          className="text-button"
          aria-expanded={guide !== null}
          disabled={busy}
          onClick={() => (guide === null ? act('agent-guide') : setGuide(null))}
        >
          接口说明
        </button>
      )}
      {note && <small role="status">{note}</small>}
      <Help note="api" />
      {on && guide !== null && (
        <div className="wb-api-guide" role="dialog" aria-label="接口说明">
          <div className="wb-api-guide-bar">
            <b>接口说明</b>
            <button className="text-button" disabled={busy} onClick={() => act('copy-agent-guide')}>
              复制文本
            </button>
            <button className="text-button" aria-label="关闭" onClick={() => setGuide(null)}>
              ×
            </button>
          </div>
          <pre className="wb-api-guide-text">{guide}</pre>
        </div>
      )}
    </span>
  );
}
