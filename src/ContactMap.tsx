// Electrode contact on a top view of the head (佩戴校准 · 佩戴检查 · 主图 wear card): one
// coloured dot per electrode from the live contact states, and the electrodes to adjust.
import { electrodes } from './electrodes';
import './contact-map.css';

export const CONTACT_COLORS: Record<string, string> = {
  ok: '#5fd3a4',
  poor: '#e7ae55',
  off: '#ef7e66',
};
const NONE = '#3a4843';

export function contactSummary(states: string[]) {
  return {
    good: states.filter((s) => s === 'ok').length,
    bad: electrodes
      .map((e, c) => ({ name: e.name, place: e.place, s: states[c] }))
      .filter((e) => e.s === 'off' || e.s === 'poor'),
  };
}

export function ContactHead({ states, live = true }: { states: string[]; live?: boolean }) {
  return (
    <svg className="cm-head" viewBox="-52 -62 424 456" aria-label="电极接触（俯视，鼻子朝上）">
      {/* top view, nose up: the wearer's left is on the left */}
      <path d="M138 10 L160 -20 L182 10" className="cm-skull cm-nose" />
      <ellipse cx="8" cy="165" rx="12" ry="30" className="cm-skull" />
      <ellipse cx="312" cy="165" rx="12" ry="30" className="cm-skull" />
      <ellipse cx="160" cy="165" rx="150" ry="158" className="cm-skull" />
      <text x="160" y="-34" className="cm-dir">
        前 · 额头
      </text>
      <text x="160" y="372" className="cm-dir">
        后 · 后脑
      </text>
      <text x="-32" y="173" className="cm-side">
        左
      </text>
      <text x="352" y="173" className="cm-side">
        右
      </text>
      {electrodes.map((e, c) => (
        <g key={e.name}>
          <circle
            cx={e.map[0]}
            cy={e.map[1]}
            r="13"
            fill={live ? (CONTACT_COLORS[states[c]] ?? NONE) : '#2a3531'}
          />
          <text x={e.map[0]} y={e.map[1] + 4} className={live ? 'on' : ''}>
            {e.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ContactLegend() {
  return (
    <div className="cm-legend">
      {(
        [
          ['良好', CONTACT_COLORS.ok],
          ['一般', CONTACT_COLORS.poor],
          ['需调整', CONTACT_COLORS.off],
          ['未接触', NONE],
        ] as const
      ).map(([label, c]) => (
        <span key={label}>
          <i style={{ background: c }} />
          {label}
        </span>
      ))}
    </div>
  );
}
