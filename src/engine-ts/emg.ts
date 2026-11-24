// Port of engine/workbench_metrics.emg_rms: 1 s Hann-window 20–min(90, 0.4·fs) Hz power,
// excluding 50 / 60 Hz ± 2 Hz, as an RMS per channel (µV).
import { hann, mean, power } from './dsp';

export function emgRms(samples: number[][], rate: number) {
  if (!samples.length || samples[0].length < rate) return null;
  const w = hann(rate);
  let ww = 0;
  for (const v of w) ww += v * v;
  const hi = Math.min(90, rate * 0.4),
    df = 1; // rfftfreq(rate, 1/rate)
  const maxBin = Math.floor(hi);
  return samples.map((full) => {
    const x = full.slice(-rate);
    if (!x.every(Number.isFinite)) return NaN;
    const m = mean(x);
    const p = power(
      x.map((v, i) => (v - m) * w[i]),
      maxBin,
    );
    let s = 0;
    for (let k = 20; k <= maxBin; k++) {
      if (Math.abs(k - 50) <= 2 || Math.abs(k - 60) <= 2) continue;
      s += ((k > 0 && k < rate / 2 ? 2 : 1) * p[k]) / (rate * ww);
    }
    return Math.sqrt(s * df);
  });
}
