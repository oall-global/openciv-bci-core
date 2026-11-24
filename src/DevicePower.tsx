// Line drawing of the device for 打开设备: the side switch (down = off, pushed up = on) and
// the indicator light. Left-face items are drawn in face coordinates (skewed with the face).
const LEFT = 'matrix(1 0.4375 0 1 0 0)';
const RIGHT = 'matrix(1 -0.3 0 1 0 0)';
const WIRES = [
  'M126 84 C120 50 96 36 84 4',
  'M134 81 C132 48 116 30 112 4',
  'M142 78 C144 46 136 26 138 4',
  'M150 76 C156 44 158 24 164 4',
  'M158 73 C168 44 180 26 192 4',
  'M166 71 C180 46 204 30 220 6',
];

export default function DevicePower({ on }: { on: boolean }) {
  const line = '#9aa9a2';
  return (
    <svg
      className="device-power"
      viewBox="30 0 240 290"
      role="img"
      aria-label={on ? '开机：开关推到上方，指示灯亮绿色' : '关闭：开关在下方，指示灯不亮'}
    >
      <g fill="none" stroke={line} strokeWidth="1.4" strokeLinecap="round" opacity=".55">
        {WIRES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g stroke={line} strokeWidth="2" strokeLinejoin="round">
        <polygon points="60,90 160,60 240,95 140,125" fill="#26302c" />
        <polygon points="60,90 140,125 140,270 60,235" fill="#1c2421" />
        <polygon points="140,125 240,95 240,240 140,270" fill="#161d1a" />
        {/* electrode connector on top */}
        <polygon points="120,94 138,102 138,86 120,78" fill="#111715" strokeWidth="1.5" />
        <polygon points="138,102 183,88 183,72 138,86" fill="#111715" strokeWidth="1.5" />
        <polygon points="120,78 165,65 183,72 138,86" fill="#1f2825" strokeWidth="1.5" />
      </g>
      <g transform={LEFT}>
        {/* switch slot and knob */}
        <rect
          x="92"
          y="76"
          width="9"
          height="56"
          rx="1.5"
          fill="#0b0f0e"
          stroke={line}
          strokeWidth="1.6"
        />
        <rect
          x="93.5"
          y={on ? 79 : 115}
          width="6"
          height="14"
          rx="1"
          fill={on ? '#e6eeea' : '#6f7d77'}
        />
        <rect
          x="85"
          y="70"
          width="23"
          height="68"
          rx="5"
          fill="none"
          stroke="#f0aa3c"
          strokeWidth="2.2"
          strokeDasharray={on ? undefined : '5 4'}
        />
        {/* USB-C port and holes */}
        <rect
          x="111"
          y="128"
          width="10"
          height="28"
          rx="5"
          fill="#0b0f0e"
          stroke={line}
          strokeWidth="1.6"
        />
        <circle cx="126" cy="168" r="2" fill="#0b0f0e" stroke={line} strokeWidth="1.2" />
        <circle cx="104" cy="186" r="4" fill="#0b0f0e" stroke={line} strokeWidth="1.4" />
      </g>
      <g transform={RIGHT}>
        {on && <circle cx="222" cy="200" r="14" fill="#5fd3a4" opacity=".22" />}
        <circle
          cx="222"
          cy="200"
          r="4"
          fill={on ? '#5fd3a4' : '#0b0f0e'}
          stroke={on ? '#5fd3a4' : line}
          strokeWidth="1.4"
        />
        {on && <circle cx="222" cy="200" r="10" fill="none" stroke="#5fd3a4" strokeWidth="2" />}
      </g>
    </svg>
  );
}
