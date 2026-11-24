// Port of engine/rail.py: ADS1299 rail check, adapted from OpenBCI GUI DataStatus
// (MIT, Copyright (c) 2018 OpenBCI; public/licenses/OpenBCI-GUI-MIT.txt). Not impedance.
import { round } from './dsp';

export type RailState = 'railed' | 'flat' | 'near' | 'normal' | 'unknown';

export function checkRails(samples: number[][], rate: number, gain = 24, streaming = true) {
  // Processing computes 4.5/(2^23-1) in float before promoting to double.
  const adcScale = Math.fround(Math.fround(4.5) / Math.fround(2 ** 23 - 1));
  const fullScale = (adcScale / gain) * 1e6 * 2 ** 23;
  const states: RailState[] = [],
    percentages: (number | null)[] = [],
    peaks: (number | null)[] = [];
  for (const full of samples) {
    if (!full.length) {
      states.push('unknown');
      percentages.push(null);
      peaks.push(null);
      continue;
    }
    const row = full.slice(-rate * 3).map(Math.fround);
    if (!row.every(Number.isFinite)) {
      states.push('unknown');
      percentages.push(null);
      peaks.push(null);
      continue;
    }
    let peak = 0,
      changing = false;
    for (let i = 0; i < row.length; i++) {
      peak = Math.max(peak, Math.abs(row[i]));
      if (i && Math.abs(Math.fround(row[i] - row[i - 1])) > 1e-5 && Math.abs(row[i]) > 1e-5)
        changing = true;
    }
    const percent = (peak / fullScale) * 100;
    states.push(
      percent > 90 ? 'railed' : streaming && !changing ? 'flat' : percent > 75 ? 'near' : 'normal',
    );
    percentages.push(round(percent, 2));
    peaks.push(peak);
  }
  return {
    states,
    percentages,
    gain,
    peaks,
    fullScale,
    sampleCount: Math.min(samples[0]?.length ?? 0, rate * 3),
  };
}
