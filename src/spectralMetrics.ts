export const bands = [
  { name: 'δ Delta', low: 1, high: 4 },
  { name: 'θ Theta', low: 4, high: 8 },
  { name: 'α Alpha', low: 8, high: 13 },
  { name: 'β Beta', low: 13, high: 30 },
  { name: 'γ Gamma', low: 30, high: 40 },
];
export function bandPowers(f: number[], p: number[]) {
  if (
    f.length < 2 ||
    f.length !== p.length ||
    f.some((v, i) => !Number.isFinite(v) || (i > 0 && v <= f[i - 1])) ||
    p.some((v) => !Number.isFinite(v) || v < 0) ||
    f[0] > 1 ||
    f.at(-1)! < 40
  )
    return null;
  return bands.map((b) => {
    let power = 0;
    for (let i = 1; i < f.length; i++) {
      const left = Math.max(b.low, f[i - 1]),
        right = Math.min(b.high, f[i]);
      if (right <= left) continue;
      const slope = (p[i] - p[i - 1]) / (f[i] - f[i - 1]);
      power +=
        ((p[i - 1] + slope * (left - f[i - 1]) + p[i - 1] + slope * (right - f[i - 1])) *
          (right - left)) /
        2;
    }
    return power;
  });
}
