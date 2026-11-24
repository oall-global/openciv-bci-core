// Electrode positions and the montage (which position each channel CH1..CH16 records).
// The default is the OpenBCI GUI 16-channel montage (W_HeadPlot.pde); the user can change it
// in 设置 → 电极位置 (electron/montage.cjs, engine/decoding.py hold the same default).
// Modern aliases: T3/T4=T7/T8, T5/T6=P7/P8. Coordinates are schematic, not individually
// digitized scalp measurements or cortical source locations.
//   xyz  x right, y up, z towards the nose (unit head sphere), used by the 3D views
//   map  position in the 2D head map (ElectrodeMap), nose up
export type Site = { name: string; xyz: number[]; map: [number, number]; place: string };

const KNOWN: Site[] = [
  { name: 'Fp1', xyz: [-0.31, 0.32, 0.9], map: [121, 45], place: '左前额' },
  { name: 'Fp2', xyz: [0.31, 0.32, 0.9], map: [199, 45], place: '右前额' },
  { name: 'C3', xyz: [-0.59, 0.81, 0], map: [98, 170], place: '左侧头顶' },
  { name: 'C4', xyz: [0.59, 0.81, 0], map: [222, 170], place: '右侧头顶' },
  { name: 'P7', xyz: [-0.81, 0.3, -0.53], map: [66, 243], place: '左后外侧' },
  { name: 'P8', xyz: [0.81, 0.3, -0.53], map: [254, 243], place: '右后外侧' },
  { name: 'O1', xyz: [-0.31, 0.32, -0.9], map: [121, 284], place: '左后脑' },
  { name: 'O2', xyz: [0.31, 0.32, -0.9], map: [199, 284], place: '右后脑' },
  { name: 'F7', xyz: [-0.81, 0.3, 0.53], map: [66, 97], place: '左额外侧' },
  { name: 'F8', xyz: [0.81, 0.3, 0.53], map: [254, 97], place: '右额外侧' },
  { name: 'F3', xyz: [-0.46, 0.74, 0.49], map: [111, 107], place: '左额' },
  { name: 'F4', xyz: [0.46, 0.74, 0.49], map: [209, 107], place: '右额' },
  { name: 'T7', xyz: [-0.98, 0.2, 0], map: [44, 170], place: '左耳上方' },
  { name: 'T8', xyz: [0.98, 0.2, 0], map: [276, 170], place: '右耳上方' },
  { name: 'P3', xyz: [-0.46, 0.74, -0.49], map: [111, 233], place: '左顶' },
  { name: 'P4', xyz: [0.46, 0.74, -0.49], map: [209, 233], place: '右顶' },
];
// Further 10-20 / 10-10 positions: angle from the vertex (Cz) and azimuth from the nose
// (clockwise, degrees).
const EXTRA: [string, number, number, string][] = [
  ['Fpz', 72, 0, '前额正中'],
  ['AFz', 54, 0, '前额上方正中'],
  ['AF3', 60, -25, '左前额上方'],
  ['AF4', 60, 25, '右前额上方'],
  ['Fz', 36, 0, '额部正中'],
  ['FCz', 18, 0, '额中央正中'],
  ['FC1', 26, -45, '左额中央'],
  ['FC2', 26, 45, '右额中央'],
  ['FC5', 64, -68, '左额颞'],
  ['FC6', 64, 68, '右额颞'],
  ['Cz', 0, 0, '头顶正中'],
  ['CPz', 18, 180, '中央顶正中'],
  ['CP1', 26, -135, '左中央顶'],
  ['CP2', 26, 135, '右中央顶'],
  ['CP5', 64, -112, '左颞顶'],
  ['CP6', 64, 112, '右颞顶'],
  ['Pz', 36, 180, '顶部正中'],
  ['POz', 54, 180, '顶枕正中'],
  ['PO3', 60, -155, '左顶枕'],
  ['PO4', 60, 155, '右顶枕'],
  ['PO7', 72, -144, '左顶枕外侧'],
  ['PO8', 72, 144, '右顶枕外侧'],
  ['Oz', 72, 180, '后脑正中'],
  ['TP9', 100, -108, '左耳后'],
  ['TP10', 100, 108, '右耳后'],
];
const rad = Math.PI / 180;
export const CATALOG: Site[] = [
  ...KNOWN,
  ...EXTRA.map(([name, phi, theta, place]): Site => {
    const r = Math.min(phi, 92) / 90;
    return {
      name,
      xyz: [
        +(Math.sin(phi * rad) * Math.sin(theta * rad)).toFixed(3),
        +Math.cos(phi * rad).toFixed(3),
        +(Math.sin(phi * rad) * Math.cos(theta * rad)).toFixed(3),
      ],
      map: [
        Math.round(160 + r * Math.sin(theta * rad) * 134),
        Math.round(171 - r * Math.cos(theta * rad) * 151),
      ],
      place,
    };
  }),
];
export const site = (name: string): Site =>
  CATALOG.find((s) => s.name === name) ?? { name, xyz: [0, 1, 0], map: [160, 171], place: name };

export const DEFAULT_MONTAGE = KNOWN.map((s) => s.name);
// The current montage. Changed in place by applyMontage, so modules holding these arrays see
// the change (the app remounts its views afterwards).
export const electrodes: Site[] = KNOWN.map((s) => ({ ...s }));
export const electrodeNames: string[] = [...DEFAULT_MONTAGE];
export function applyMontage(names: string[]) {
  electrodes.splice(0, electrodes.length, ...names.map(site));
  electrodeNames.splice(0, electrodeNames.length, ...names);
}

// Positions some features rely on (shown when a custom montage lacks them).
export const REQUIRED: [string, string[]][] = [
  ['闭眼 Alpha、注视闪烁（SSVEP）、专注度', ['O1', 'O2', 'P3', 'P4']],
  ['运动想象、运动区反应', ['C3', 'C4']],
  ['眨眼、眼动与咬牙控制', ['Fp1', 'Fp2', 'F7', 'F8', 'T7', 'T8']],
];
