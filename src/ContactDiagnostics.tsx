import { useEffect, useRef, useState } from 'react';
import type { Frame } from './types';
import { electrodeNames } from './electrodes';
import Help from './glossary/Help';

// 接触诊断 (主图布局): the live quantities behind the contact state, to choose a loose
// "worn / not worn" threshold. Per channel, from the last 2 s (engine/contact.py, rail.py):
//   1–40 Hz  RMS of the band (µV)
//   工频     RMS of 48–52 + 58–62 Hz (µV)
//   工频占比 mains power / (band + mains power)
//   量程     peak of the last 3 s as % of the amplifier's full scale
//   高频底噪 RMS of 65–95 Hz (no EEG, no mains)
// Whole cap (is it worn at all): 整体底噪 (median 高频底噪), 通道相关性, 通道差异度.
// Min / max are kept since the table opened (or 清零); rows can be exported for analysis.
type Row = { band: number; mains: number; share: number; rail: number; hf: number };
type Span = { min: Row; max: Row };
const KEYS: (keyof Row)[] = ['band', 'mains', 'share', 'rail', 'hf'];

const probeText = (k: Frame['contact']) =>
  !k?.probe || k.probe.failed
    ? k?.probe?.failed
      ? '阻抗检测不可用（设备未确认指令）'
      : ''
    : k.probe.active
      ? `Fp1 阻抗 ${k.probe.kohm != null ? `${Math.round(k.probe.kohm)} kΩ` : '测量中'}`
      : '';
const wornText = (k: Frame['contact']) =>
  k?.worn === true
    ? '已佩戴'
    : k?.wornHold
      ? `确认中 ${k.wornHold}/${k.wornNeed ?? 30} 秒${k.wornAgain ? '（再次佩戴）' : ''}`
      : k?.worn === false
        ? '未佩戴'
        : '判断中';

export default function ContactDiagnostics({ frame }: { frame: Frame | null }) {
  const [, setTick] = useState(0);
  const spans = useRef<(Span | null)[]>([]);
  const cap = useRef<Record<string, [number, number]>>({});
  const log = useRef<string[]>([]);
  const last = useRef(0);
  const now = (c: number): Row | null => {
    const k = frame?.contact;
    if (!k?.band) return null;
    return {
      band: k.band[c],
      mains: k.mains?.[c] ?? NaN,
      share: k.share?.[c] ?? NaN,
      rail: frame?.rail?.percentages?.[c] ?? NaN,
      hf: k.hf?.[c] ?? NaN,
    };
  };
  useEffect(() => {
    const k = frame?.contact;
    if (!k?.band || Date.now() - last.current < 900) return;
    last.current = Date.now();
    const t = new Date().toISOString();
    electrodeNames.forEach((name, c) => {
      const r = now(c);
      if (!r) return;
      const s = spans.current[c];
      spans.current[c] = s
        ? {
            min: Object.fromEntries(KEYS.map((key) => [key, Math.min(s.min[key], r[key])])) as Row,
            max: Object.fromEntries(KEYS.map((key) => [key, Math.max(s.max[key], r[key])])) as Row,
          }
        : { min: { ...r }, max: { ...r } };
      log.current.push(
        [
          t,
          name,
          r.band,
          r.mains,
          r.share,
          r.rail,
          r.hf,
          k.states[c],
          k.floor,
          k.corr,
          k.spread,
          wornText(k),
          k.probe?.active ? (k.probe.kohm ?? '') : '',
        ].join(','),
      );
    });
    for (const key of ['floor', 'corr', 'spread'] as const) {
      const v = k[key];
      if (v == null) continue;
      const m = cap.current[key];
      cap.current[key] = m ? [Math.min(m[0], v), Math.max(m[1], v)] : [v, v];
    }
    if (log.current.length > 16 * 3600) log.current.splice(0, log.current.length - 16 * 3600);
    setTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const exportCsv = () => {
    const text =
      '时间,电极,1-40Hz_uV,工频_uV,工频占比,量程_%,高频底噪_uV,状态,整体底噪_uV,通道相关性,通道差异度,佩戴判断,Fp1阻抗_kΩ\n' +
      log.current.join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
    a.download = `接触诊断-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`;
    a.click();
  };
  const fmt = (v: number | undefined, d = 1) =>
    v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d);
  const STATE: Record<string, string> = { ok: '正常', poor: '接触差', off: '未接触', unknown: '—' };

  return (
    <section className="cdiag">
      <div className="cdiag-head">
        <b>接触诊断</b>
        <span>每秒更新 · 最近 2 秒 · 括号内为打开以来的最小–最大值</span>
        <span className="grow" />
        <button
          className="secondary"
          onClick={() => {
            spans.current = [];
            cap.current = {};
            log.current = [];
            setTick((n) => n + 1);
          }}
        >
          清零
        </button>
        <button className="secondary" onClick={exportCsv} disabled={!log.current.length}>
          导出 CSV（{Math.round(log.current.length / 16)} 秒）
        </button>
      </div>
      {!frame?.contact?.band ? (
        <p className="cdiag-empty">连接设备后显示。</p>
      ) : (
        <>
          <div className="cdiag-cap">
            {(
              [
                [
                  'floor',
                  '整体底噪',
                  'µV',
                  2,
                  '16 通道高频段（无脑电、无工频）RMS 的中位数；悬空时偏大',
                ],
                [
                  'corr',
                  '通道相关性',
                  '',
                  3,
                  '通道间平均相关系数绝对值；悬空时各通道拾取同样的干扰，接近 1',
                ],
                [
                  'spread',
                  '通道差异度',
                  '',
                  3,
                  '各通道 1–40 Hz 能量（对数）的标准差；戴上后通道各不相同，变大',
                ],
              ] as [keyof typeof cap.current & string, string, string, number, string][]
            ).map(([key, label, unit, d, hint]) => {
              const v = frame.contact![key as 'floor' | 'corr' | 'spread'];
              const m = cap.current[key];
              return (
                <div key={key} title={hint}>
                  <small>{label}</small>
                  <b>
                    {fmt(v ?? undefined, d)}
                    {unit && <em> {unit}</em>}
                  </b>
                  <span>{m ? `${fmt(m[0], d)}–${fmt(m[1], d)}` : ''}</span>
                </div>
              );
            })}
            <div title="打开 app 后第一次：Fp1 阻抗连续 3 秒低于 2500 kΩ 后，再连续 30 秒量程正常（最多 6 秒例外），判为已佩戴；之后不再测阻抗。量程中位数 ≥ 90% 持续 4 秒，判为未佩戴">
              <small>
                佩戴判断
                <Help id="worn" />
              </small>
              <b className="cdiag-worn">{wornText(frame.contact)}</b>
              <span>
                {['量程'].map((label, i) => (
                  <i key={label} className={frame.contact?.wornVotes?.[i] ? 'yes' : 'no'}>
                    {label}
                    {frame.contact?.wornVotes?.[i] ? '✓' : '✗'}{' '}
                  </i>
                ))}
              </span>
              <span>{probeText(frame.contact)}</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>电极</th>
                <th>1–40 Hz（µV）</th>
                <th>
                  工频（µV）
                  <Help id="mains" />
                </th>
                <th>工频占比</th>
                <th>
                  量程（%）
                  <Help id="rail" />
                </th>
                <th>高频底噪（µV）</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {electrodeNames.map((name, c) => {
                const r = now(c),
                  s = spans.current[c];
                const cell = (key: keyof Row, d = 1) => (
                  <td>
                    <b>{fmt(r?.[key], d)}</b>
                    <small>{s ? ` (${fmt(s.min[key], d)}–${fmt(s.max[key], d)})` : ''}</small>
                  </td>
                );
                return (
                  <tr key={c}>
                    <td className="mono">
                      {String(c + 1).padStart(2, '0')} {name}
                    </td>
                    {cell('band')}
                    {cell('mains')}
                    {cell('share', 2)}
                    {cell('rail')}
                    {cell('hf', 2)}
                    <td>{STATE[frame.contact!.states[c]] ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
