type Props = { step: number; mode: 'direct' | 'router'; success?: boolean; usbConfig?: boolean };
export default function ConnectionIllustration({
  step,
  mode,
  success = false,
  usbConfig = false,
}: Props) {
  const labels = [
    '用 USB 线连接设备与笔记本',
    '选择设备热点直连，或经过路由器连接',
    '电脑先连接设备热点，配置无线网络',
    '电脑和设备建立无线通信',
    '验证持续收到 16 通道脑电数据',
    '连接完成，检查佩戴后开始实验',
  ];
  const laptop = (x: number, y: number) => (
    <g transform={`translate(${x} ${y})`}>
      <rect width="150" height="100" rx="10" fill="#fff" stroke="#405c6c" strokeWidth="3" />
      <rect x="10" y="10" width="130" height="74" rx="4" fill="#eaf3f5" />
      <path d="M-13 104H163L153 118H-3Z" fill="#d8e5ea" stroke="#405c6c" strokeWidth="2" />
      {step >= 4 ? (
        <path
          d="M17 52H35L43 32L51 70L59 44L67 52H85L93 28L101 66L110 52H133"
          fill="none"
          stroke="#299880"
          strokeWidth="3"
        />
      ) : (
        <>
          <rect x="26" y="26" width="98" height="10" rx="5" fill="#9bb8c5" />
          <rect x="26" y="47" width="68" height="6" rx="3" fill="#c1d4db" />
          <rect x="26" y="63" width="84" height="6" rx="3" fill="#c1d4db" />
        </>
      )}
      <text x="75" y="146" textAnchor="middle">
        笔记本电脑
      </text>
    </g>
  );
  const board = (x: number, y: number) => (
    <g transform={`translate(${x} ${y})`}>
      <title>带多点电极的脑机接口头戴设备示意</title>
      <path
        d="M32 104V118L15 126H105L87 118V104"
        fill="#dfeaec"
        stroke="#a5bdc5"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M15 49C15 15 33-5 60-5S105 15 105 49V75C105 96 84 113 60 116C36 113 15 96 15 75Z"
        fill="#edf4f5"
        stroke="#9bb5bf"
        strokeWidth="2"
      />
      <path
        d="M15 67C3 58 0 71 7 84L17 87M105 67C117 58 120 71 113 84L103 87"
        fill="#dce9ec"
        stroke="#9bb5bf"
        strokeWidth="2"
      />
      <path
        d="M11 57C8 18 31-13 60-13S112 18 109 57"
        fill="none"
        stroke="#234c50"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M14 51Q60 33 106 51M25 16Q60 5 95 16M60-10V47M37-5Q28 18 31 46M83-5Q92 18 89 46"
        fill="none"
        stroke="#438b7e"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M19 53L24 78M101 53L96 78"
        fill="none"
        stroke="#234c50"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {[
        [60, -10],
        [38, -4],
        [82, -4],
        [25, 16],
        [43, 11],
        [60, 9],
        [77, 11],
        [95, 16],
        [15, 38],
        [36, 35],
        [60, 32],
        [84, 35],
        [105, 38],
        [31, 48],
        [60, 44],
        [89, 48],
      ].map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="5" fill="#204a50" stroke="#c2dfd9" strokeWidth="1.2" />
          <circle cx={cx} cy={cy} r="1.8" fill="#95d9c4" />
        </g>
      ))}
      <path d="M21 54L14 70" stroke="#438b7e" strokeWidth="3" />
      <rect
        x="-4"
        y="67"
        width="25"
        height="33"
        rx="6"
        fill="#234c50"
        stroke="#76a99c"
        strokeWidth="1.5"
      />
      <path d="M3 81H7L10 75L13 87L16 81" fill="none" stroke="#9ee0c8" strokeWidth="1.5" />
      <rect x="-10" y="74" width="10" height="14" rx="2" fill="#a9c2ca" />
      <text x="60" y="146" textAnchor="middle">
        脑机接口
      </text>
    </g>
  );
  const router = (
    <g transform="translate(242 63)">
      <path d="M13 35V4M63 35V4" stroke="#405c6c" strokeWidth="3" strokeLinecap="round" />
      <rect y="32" width="78" height="34" rx="9" fill="#fff" stroke="#405c6c" strokeWidth="2" />
      <circle cx="17" cy="49" r="3" fill="#299880" />
      <circle cx="28" cy="49" r="3" fill="#299880" />
      <text x="39" y="88" textAnchor="middle">
        路由器
      </text>
    </g>
  );
  const wire = step === 0 || (step === 2 && usbConfig);
  const routed = mode === 'router' && step !== 2 && step > 0;
  return (
    <svg
      className="connection-illustration"
      viewBox="0 0 580 310"
      role="img"
      aria-label={step === 2 && usbConfig ? '通过 USB 设置 Wi-Fi 名称和密码' : labels[step]}
    >
      <title>{labels[step]}</title>
      <defs>
        <pattern
          id={`connection-grid-${step}`}
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill="#d8e5e8" />
        </pattern>
      </defs>
      <rect width="580" height="310" rx="18" fill="#f0f6f7" />
      <rect width="580" height="310" fill={`url(#connection-grid-${step})`} />
      <ellipse cx="300" cy="256" rx="230" ry="13" fill="#e1edef" />
      {laptop(42, 116)}
      {board(430, 116)}
      {wire ? (
        <g>
          <path
            d="M199 202H267Q285 202 285 222V232Q285 250 305 250H353Q371 250 371 230V216Q371 197 392 197H423"
            stroke="#399b89"
            strokeWidth="7"
            fill="none"
            strokeLinecap="round"
          />
          <rect x="194" y="195" width="17" height="14" rx="3" fill="#94b9b8" />
          <text x="293" y="193" textAnchor="middle">
            {step === 2 ? 'USB 配置' : 'USB 数据线'}
          </text>
          <text x="293" y="286" textAnchor="middle" className="illustration-note">
            接口示意 · 请以设备实际接口为准
          </text>
        </g>
      ) : routed ? (
        <>
          {router}
          <path
            d="M181 136L245 100M320 100L432 151"
            stroke="#399b89"
            strokeWidth="3"
            strokeDasharray="7 7"
            fill="none"
          />
          <text x="281" y="37" textAnchor="middle" className="illustration-note">
            共享网络 · 保留上网连接
          </text>
        </>
      ) : (
        <g>
          <path
            d="M212 163Q307 92 411 163M233 183Q308 133 391 183"
            stroke="#399b89"
            strokeWidth="3"
            fill="none"
            strokeDasharray="7 7"
          />
          <text x="306" y="91" textAnchor="middle">
            设备热点
          </text>
          <text x="306" y="221" textAnchor="middle" className="illustration-note">
            设备热点 · 无线连接
          </text>
        </g>
      )}
      {step >= 4 && (
        <g transform="translate(281 169)">
          <circle r="25" fill={success ? '#278c74' : '#fff'} stroke="#278c74" strokeWidth="2" />
          {success ? (
            <path d="M-11 0L-3 8L12-9" fill="none" stroke="white" strokeWidth="3" />
          ) : (
            <>
              <circle r="13" fill="none" stroke="#9ccbbb" strokeWidth="2" />
              <path d="M0-9V0L7 4" fill="none" stroke="#278c74" strokeWidth="2" />
            </>
          )}
        </g>
      )}
    </svg>
  );
}
