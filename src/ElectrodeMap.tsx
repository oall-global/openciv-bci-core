import type { CheckEvent, Frame, Metadata } from './types';
import { electrodeNames } from './electrodeMetrics';
import { site } from './electrodes';
import { LINK_TEXT, LinkBars, linkDetail } from './shell/LinkQuality';
import { tc } from './theme';

// 二维头皮图 (design/fit-check): top view of the head, each electrode coloured by its live
// contact state (engine/contact.py), call-outs for the ones that need attention, and the
// connection details next to it.
export type Link = { transport: string; mode?: 'direct' | 'router'; address?: string };

const LINKS = [
  ['Fp1', 'Fp2'],
  ['Fp1', 'F3'],
  ['Fp2', 'F4'],
  ['Fp1', 'F7'],
  ['Fp2', 'F8'],
  ['F7', 'F3'],
  ['F4', 'F8'],
  ['F3', 'C3'],
  ['F4', 'C4'],
  ['F7', 'T7'],
  ['F8', 'T8'],
  ['T7', 'C3'],
  ['C4', 'T8'],
  ['C3', 'P3'],
  ['C4', 'P4'],
  ['T7', 'P7'],
  ['T8', 'P8'],
  ['P7', 'P3'],
  ['P4', 'P8'],
  ['P3', 'O1'],
  ['P4', 'O2'],
  ['P7', 'O1'],
  ['P8', 'O2'],
  ['O1', 'O2'],
  ['F3', 'F4'],
  ['C3', 'C4'],
  ['P3', 'P4'],
];
const POS = (name: string) => site(name).map;
const PLACE = (name: string) => site(name).place;
const STATE_TEXT = { ok: '正常', poor: '接触差', off: '未接触', unknown: '无信号' };

export default function ElectrodeMap({
  frame,
  meta,
  active,
  demo,
  link,
  checkResult,
  selected,
  onSelect,
  onCheck,
}: {
  frame: Frame | null;
  meta: Metadata | null;
  active: boolean;
  demo: boolean;
  link?: Link;
  checkResult: CheckEvent | null;
  selected: number;
  onSelect: (i: number) => void;
  onCheck?: (channel: number) => void;
}) {
  const contact = active ? frame?.contact : null;
  const states = electrodeNames.map((_, i) => contact?.states[i] ?? 'unknown');
  const kohm = (i: number) => checkResult?.contacts?.[i]?.kohm;
  const good = states.filter((s) => s === 'ok').length;
  const issues = electrodeNames
    .map((name, i) => ({ name, i, state: states[i] }))
    .filter((e) => e.state === 'poor' || e.state === 'off')
    .sort((a, b) => (a.state === 'off' ? -1 : 0) - (b.state === 'off' ? -1 : 0));
  const quality = active ? frame?.transport?.quality : null;

  // Call-outs: up to four, stacked on each side in the order of the electrodes' height so
  // the leader lines never cross.
  const shown = issues.slice(0, 4);
  const callouts = shown.map((e) => {
    const [x, y] = POS(e.name);
    const left = x < 160;
    const row = shown.filter((o) => POS(o.name)[0] < 160 === left && POS(o.name)[1] < y).length;
    const ty = (left ? 226 : 112) + row * 34;
    const edge = left ? x - 10 : x + 10;
    const mid = left ? -8 : 328;
    const end = left ? -56 : 376;
    const r = kohm(e.i);
    const value =
      r != null
        ? `${r >= 500 ? '>500' : Math.round(r)} kΩ`
        : contact?.reasons[e.i] || STATE_TEXT[e.state];
    return { ...e, edge, y, mid, ty, end, left, text: `${e.name} · ${value}` };
  });

  return (
    <section className="emap" aria-label="二维头皮图">
      <div className="emap-map">
        <div className="emap-head">
          <span className={`emap-live ${active ? 'on' : ''}`}>
            <i />
            {active ? '实时' : '等待数据'}
          </span>
        </div>
        <svg
          viewBox="-60 -30 440 393"
          role="img"
          aria-label={`头部俯视图：16 个电极中 ${good} 个良好`}
        >
          <defs>
            <radialGradient id="emapSkin" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor={tc('#ffffff')} />
              <stop offset="75%" stopColor={tc('#f3f7f3')} />
              <stop offset="100%" stopColor={tc('#e6eee7')} />
            </radialGradient>
            <linearGradient id="emapCortex" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tc('#e9f3ee')} />
              <stop offset="100%" stopColor={tc('#dcebe3')} />
            </linearGradient>
            <filter id="emapSoft" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow
                dx="0"
                dy="6"
                stdDeviation="8"
                floodColor={tc('#1c2e26')}
                floodOpacity=".10"
              />
            </filter>
          </defs>
          <g fill="none" stroke={tc('#2b6651')}>
            <ellipse
              cx="160"
              cy="170"
              rx="176"
              ry="184"
              strokeOpacity=".10"
              strokeDasharray="2 6"
            />
            <path d="M160 -10v6M160 332v8M-38 170h12M346 170h12" strokeOpacity=".35" />
          </g>
          <g className="emap-axis" textAnchor="middle">
            <text x="160" y="-16">
              鼻尖
            </text>
            <text x="160" y="356">
              枕部
            </text>
            <text x="-46" y="174">
              左
            </text>
            <text x="366" y="174">
              右
            </text>
          </g>
          <g filter="url(#emapSoft)">
            <path
              d="M29 142 C14 136 6 152 7 170 C8 190 14 206 30 202 Z"
              fill={tc('#eef4ef')}
              stroke={tc('#a9bcae')}
              strokeWidth="1.4"
            />
            <path
              d="M291 142 C306 136 314 152 313 170 C312 190 306 206 290 202 Z"
              fill={tc('#eef4ef')}
              stroke={tc('#a9bcae')}
              strokeWidth="1.4"
            />
            <path
              d="M140 26 C146 2 174 2 180 26 Z"
              fill={tc('#f3f7f3')}
              stroke={tc('#a9bcae')}
              strokeWidth="1.4"
            />
            <path
              d="M160 18 C238 18 292 82 293 168 C294 254 240 324 160 324 C80 324 26 254 27 168 C28 82 82 18 160 18 Z"
              fill="url(#emapSkin)"
              stroke={tc('#a9bcae')}
              strokeWidth="1.6"
            />
          </g>
          <path
            d="M157 40 C112 38 64 72 56 132 C50 180 56 236 86 272 C108 298 134 304 157 300 Z"
            fill="url(#emapCortex)"
            stroke={tc('#b9d3c5')}
            strokeWidth="1.2"
          />
          <path
            d="M163 40 C208 38 256 72 264 132 C270 180 264 236 234 272 C212 298 186 304 163 300 Z"
            fill="url(#emapCortex)"
            stroke={tc('#b9d3c5')}
            strokeWidth="1.2"
          />
          <g
            fill="none"
            stroke={tc('#a7c7b7')}
            strokeWidth="1.3"
            strokeLinecap="round"
            opacity=".85"
          >
            <path d="M154 134 C140 128 132 146 118 140 C104 134 96 150 82 146 C72 143 66 150 60 156" />
            <path d="M166 134 C180 128 188 146 202 140 C216 134 224 150 238 146 C248 143 254 150 260 156" />
            <path d="M150 70 C132 76 120 64 104 76 C92 86 80 82 72 96" />
            <path d="M170 70 C188 76 200 64 216 76 C228 86 240 82 248 96" />
            <path d="M148 100 C130 108 118 96 100 108" />
            <path d="M172 100 C190 108 202 96 220 108" />
            <path d="M150 186 C134 180 124 196 108 190 C94 186 84 198 70 200" />
            <path d="M170 186 C186 180 196 196 212 190 C226 186 236 198 250 200" />
            <path d="M148 232 C132 240 120 228 104 242 C96 250 90 256 88 262" />
            <path d="M172 232 C188 240 200 228 216 242 C224 250 230 256 232 262" />
          </g>
          <g fill="none" stroke={tc('#2b6651')} strokeOpacity=".22" strokeDasharray="3 4">
            <ellipse cx="160" cy="171" rx="116" ry="130" />
            <ellipse cx="160" cy="171" rx="62" ry="68" />
            <path d="M160 22 V320" />
            <path d="M28 170 C90 160 230 160 292 170" />
          </g>
          <path
            d={LINKS.map(([a, b]) => `M${POS(a)[0]} ${POS(a)[1]}L${POS(b)[0]} ${POS(b)[1]}`).join(
              '',
            )}
            stroke={tc('#2b6651')}
            strokeOpacity=".28"
          />
          {electrodeNames.map((name, i) => {
            const [x, y] = POS(name);
            const s = states[i];
            return (
              <g
                key={name}
                className={`emap-node ${s} ${selected === i ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${name} ${PLACE(name)} ${STATE_TEXT[s]}`}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(i)}
              >
                <circle cx={x} cy={y} r={s === 'off' ? 24 : 21} className="halo" />
                <circle cx={x} cy={y} r="14" className="dot" />
                <text x={x} y={y + 3.5} textAnchor="middle">
                  {name}
                </text>
              </g>
            );
          })}
          {callouts.map((c) => (
            <g key={c.name} className={`emap-callout ${c.state}`}>
              <path d={`M${c.edge} ${c.y} L${c.mid} ${c.ty} H${c.end}`} fill="none" />
              <circle cx={c.mid} cy={c.ty} r="2" />
              <text x={c.end} y={c.ty - 8} textAnchor={c.left ? 'start' : 'end'}>
                {c.text}
              </text>
            </g>
          ))}
        </svg>
        <div className="emap-legend">
          <span>
            <i className="ok" />
            正常
          </span>
          <span>
            <i className="poor" />
            接触差
          </span>
          <span>
            <i className="off" />
            未接触
          </span>
        </div>
      </div>

      <div className="emap-side">
        {contact?.reference && (
          <p className="emap-warn">
            大部分电极同时未接触：请检查头顶的参考电极（SRB2）和额头的接地电极（BIAS）是否贴紧。
          </p>
        )}
        <div className="emap-card">
          <div className="emap-quality">
            <div>
              <small>接触质量</small>
              <strong>
                {active ? good : '—'}
                <em>/16</em>
              </strong>
            </div>
            <span>{active ? `${Math.round((good / 16) * 100)}%` : ''}</span>
          </div>
          <div className="emap-cells" aria-hidden="true">
            {electrodeNames.map((name, i) => (
              <i key={name} className={states[i]} />
            ))}
          </div>
          <div className="emap-cell-names" aria-hidden="true">
            {electrodeNames.map((name, i) => (
              <span key={name} className={states[i]}>
                {name}
              </span>
            ))}
          </div>
        </div>
        <div className="emap-card emap-issues">
          {!active ? (
            <p>连接设备后显示每个电极的接触情况。</p>
          ) : issues.length === 0 ? (
            <p>全部电极接触良好。</p>
          ) : (
            issues.slice(0, 4).map((e) => (
              <button key={e.name} className={e.state} onClick={() => onSelect(e.i)}>
                <b>{e.name}</b>
                <span>
                  {PLACE(e.name)} · {STATE_TEXT[e.state]}
                  {contact?.reasons[e.i] && contact.reasons[e.i] !== STATE_TEXT[e.state]
                    ? `，${contact.reasons[e.i]}`
                    : ''}
                </span>
                <em>{kohm(e.i) != null ? `${Math.round(kohm(e.i)!)} kΩ` : ''}</em>
              </button>
            ))
          )}
          {active && onCheck && (
            <button className="emap-check" onClick={() => onCheck(selected + 1)}>
              测量 {electrodeNames[selected]} 的阻抗
            </button>
          )}
        </div>
        <p className="emap-line mono">
          {demo
            ? '模拟设备'
            : link?.transport === 'serial'
              ? 'USB 串口'
              : `Wi-Fi · ${link?.mode === 'direct' ? '设备热点' : '家中网络'}`}{' '}
          · 信号{quality ? LINK_TEXT[quality.level] : '—'} · {meta?.rate ?? '—'} Hz
        </p>
        <div className="emap-stats">
          <div className="emap-card">
            <small>连接</small>
            <b>
              {demo
                ? '模拟设备'
                : link?.transport === 'serial'
                  ? 'USB 串口'
                  : `Wi-Fi · ${link?.mode === 'direct' ? '设备热点' : '家中网络'}`}
            </b>
            <span className="mono">{demo ? '—' : link?.address || '自动发现'}</span>
          </div>
          <div className="emap-card" title={linkDetail(quality)}>
            <small>信号质量</small>
            <b className={`emap-link ${quality?.level ?? ''}`}>
              <LinkBars quality={quality} />
              {quality ? LINK_TEXT[quality.level] : '—'}
            </b>
            <span className="mono">
              {quality ? `丢包 ${quality.lossPercent.toFixed(1)}%` : '最近 10 秒'}
            </span>
          </div>
          <div className="emap-card">
            <small>采样率</small>
            <b className="mono">
              {meta?.rate ?? '—'}
              <em> Hz</em>
            </b>
            <span className="mono">{meta?.channels ?? 16} 通道 · Cyton + Daisy</span>
          </div>
        </div>
      </div>
    </section>
  );
}
