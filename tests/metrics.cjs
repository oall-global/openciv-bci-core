// 脑电指标 (electron/metrics.cjs) on synthetic recordings whose answers are known: a 10.2 Hz
// posterior α 4× stronger in the 闭眼 segments than in 睁眼; 1/f noise; 20 blinks a minute on
// Fp1/Fp2; F4 α weaker than F3 (negative asymmetry); P300 targets with a positive bump at
// 350 ms. Every metric carries a reliability level.
const assert = require('assert/strict');
const { computeMetrics } = require('../electron/metrics.cjs');

const NAMES = [
  'Fp1',
  'Fp2',
  'C3',
  'C4',
  'P7',
  'P8',
  'O1',
  'O2',
  'F7',
  'F8',
  'F3',
  'F4',
  'T7',
  'T8',
  'P3',
  'P4',
];
const rate = 250,
  seconds = 120,
  N = rate * seconds;
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// pink-ish noise per channel (integrated white noise, leaky), µV
const channels = NAMES.map(() => {
  const x = new Float64Array(N);
  let a = 0,
    b = 0;
  for (let i = 0; i < N; i++) {
    a = 0.97 * a + gauss();
    b = 0.6 * b + gauss();
    x[i] = 1.5 * a + 2 * b;
  }
  return x;
});
const closedAt = (t) => Math.floor(t / 20) % 2 === 0; // 闭眼 0–20 s, 睁眼 20–40 s, …
const ix = (n) => NAMES.indexOf(n);
for (let i = 0; i < N; i++) {
  const t = i / rate,
    amp = closedAt(t) ? 24 : 6;
  for (const n of ['O1', 'O2', 'P3', 'P4'])
    channels[ix(n)][i] += amp * Math.sin(2 * Math.PI * 10.2 * t);
  channels[ix('F3')][i] += 8 * Math.sin(2 * Math.PI * 10.2 * t);
  channels[ix('F4')][i] += 3 * Math.sin(2 * Math.PI * 10.2 * t + 0.4);
}
// blinks: every 3 s, 150 µV, 0.25 s wide, on Fp1 and Fp2
let blinkCount = 0;
for (let t = 1.5; t < seconds - 1; t += 3) {
  blinkCount++;
  for (let i = -30; i <= 30; i++) {
    const v = 150 * Math.exp(-((i / 12) ** 2));
    channels[ix('Fp1')][Math.round(t * rate) + i] += v;
    channels[ix('Fp2')][Math.round(t * rate) + i] += v;
  }
}
// P300: 30 targets with a 12 µV bump at 350 ms on P3 P4 C3 C4, 120 non-targets without
const events = [];
for (let s = 0; s < seconds / 20; s++) {
  const name = s % 2 === 0 ? '闭眼' : '睁眼',
    key = s % 2 === 0 ? 's1' : 's2';
  events.push(
    { t: s * 20, label: `cond.${key}.start`, name },
    { t: s * 20 + 20, label: `cond.${key}.end`, name },
  );
}
let tt = 1;
for (let k = 0; k < 150; k++, tt += 0.75) {
  const target = k % 5 === 0;
  events.push({ t: tt, label: target ? 'p300.target' : 'p300.nontarget' });
  if (target)
    for (const n of ['P3', 'P4', 'C3', 'C4'])
      for (let i = 0; i < 0.5 * rate; i++) {
        const dt = i / rate;
        channels[ix(n)][Math.round(tt * rate) + i] += 12 * Math.exp(-(((dt - 0.35) / 0.07) ** 2));
      }
}

const m = computeMetrics(
  { channels: channels.map((c) => Array.from(c)), rate, names: NAMES },
  events,
);
const get = (id) => m.items.find((i) => i.id === id);
for (const it of m.items) {
  assert.ok(['solid', 'moderate', 'weak', 'none'].includes(it.reliability), it.id);
  assert.ok(it.level && it.note, it.id);
}
assert.equal(m.segments.closed, 3);
assert.equal(m.segments.open, 3);
assert.ok(Math.abs(get('iaf').value - 10.2) < 0.3, `α peak ${get('iaf').value}`);
assert.ok(get('reactivity').value > 3, `reactivity ${get('reactivity').value}`);
const rate_ = get('blinks').value;
assert.ok(Math.abs(rate_ - (blinkCount / seconds) * 60) < 2, `blinks ${rate_}`);
assert.ok(get('faa').value < -0.5, `asymmetry ${get('faa').value}`);
assert.equal(get('emotion').display.startsWith('偏消极'), true, get('emotion').display);
assert.ok(Math.abs(get('p300').value - 350) <= 40, `P300 ${get('p300').value}`);
assert.ok(get('exponent').value > 0.5, `exponent ${get('exponent').value}`);
assert.ok(get('age').display.includes('岁'));
assert.equal(get('extraversion').reliability, 'none');
assert.ok(get('sync').value >= 0 && get('sync').value <= 1);

// without 闭眼/睁眼 or P300 events: those say what they need instead of a number
const bare = computeMetrics(
  { channels: channels.map((c) => Array.from(c)), rate, names: NAMES },
  [],
);
assert.equal(bare.items.find((i) => i.id === 'reactivity').value, null);
assert.match(bare.items.find((i) => i.id === 'reactivity').note, /闭眼/);
assert.equal(bare.items.find((i) => i.id === 'p300').value, null);

console.log(
  'PASS metrics: ' + m.items.map((i) => `${i.name} ${i.display} [${i.level}]`).join('; '),
);
