// 脑电指标: what can be read from one recording of the 16-channel cap, each with how far it can
// be trusted — solid (可靠), moderate (一般), weak (参考性弱), none (无可靠依据: shown because
// people ask for it, marked so). All from the raw EEG on this computer; nothing is sent.
//
//   α 峰值频率        posterior (O1 O2 P3 P4) spectrum peak in 7–13 Hz          solid
//   闭眼 α 增强        posterior α eyes closed / eyes open (needs both segments) solid
//   频谱斜率          aperiodic exponent: log-log fit of 3–7 and 14–30 Hz         moderate
//   脑电年龄          from the α peak and the exponent against published trends   weak
//   眨眼频率          large positive deflections on Fp1/Fp2                      solid
//   专注度            β / (α + θ) (engagement index)                              moderate
//   放松度            (α + θ) / 1–30 Hz                                           moderate
//   疲劳度            (θ + α) / β                                                moderate
//   认知负荷          frontal θ / parietal α                                     moderate
//   额叶 α 不对称      ln α F4 − ln α F3                                          weak
//   情绪              valence from the asymmetry, arousal from frontal β / α      weak
//   压力              frontal β / α, more with right-frontal dominance            weak
//   性格              extraversion, 情绪稳定性 (11 − neuroticism) from posterior α, frontal β  none
//   左右脑同步        α coherence of F3–F4, C3–C4, P3–P4, O1–O2                  moderate
//   P300 反应时间      peak of the target − non-target difference (needs P300 events) solid

const WIN_S = 2;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k,
          q = p + len / 2;
        const vr = re[q] * cr - im[q] * ci,
          vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr;
        im[q] = im[p] - vi;
        re[p] += vr;
        im[p] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// second-order sections (RBJ): high-pass, low-pass, notch; run forward once (causal is enough
// for spectra and peak counts)
function biquad(type, f, rate, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f) / rate,
    c = Math.cos(w),
    a = Math.sin(w) / (2 * q);
  const b =
    type === 'lp'
      ? [(1 - c) / 2, 1 - c, (1 - c) / 2]
      : type === 'hp'
        ? [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        : [1, -2 * c, 1];
  const a0 = 1 + a;
  return { b: b.map((v) => v / a0), a: [(-2 * c) / a0, (1 - a) / a0] };
}
function filtered(x, sections) {
  const y = Float64Array.from(x);
  if (y.length) {
    const first = y[0];
    for (let i = 0; i < y.length; i++) y[i] -= first; // from rest, without the offset's step
  }
  for (const s of sections) {
    let z1 = 0,
      z2 = 0;
    const [b0, b1, b2] = s.b,
      [a1, a2] = s.a;
    for (let i = 0; i < y.length; i++) {
      const v = y[i],
        o = b0 * v + z1;
      z1 = b1 * v - a1 * o + z2;
      z2 = b2 * v - a2 * o;
      y[i] = o;
    }
  }
  return y;
}
// the EEG band (1–40 Hz, 50 and 60 Hz out) and, for blinks, 0.5–8 Hz
const eegBand = (rate) => [
  biquad('hp', 1, rate),
  biquad('hp', 1, rate),
  biquad('notch', 50, rate, 8),
  ...(rate > 125 ? [biquad('notch', 60, rate, 8)] : []),
  biquad('lp', 40, rate),
  biquad('lp', 40, rate),
];
const blinkBand = (rate) => [biquad('hp', 0.5, rate), biquad('lp', 8, rate), biquad('lp', 8, rate)];

const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : NaN;
};
const mean = (a) => {
  const v = a.filter(Number.isFinite);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
};
const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 2 s Hann windows, 1 s apart, within [from, to) samples; a window counts for a channel when
 *  neither flat nor out of range. Returns per channel the mean spectrum, plus the complex
 *  spectra for coherence. */
function spectra(channels, rate, ranges) {
  const n = Math.round(WIN_S * rate),
    step = Math.round(rate);
  let nfft = 1;
  while (nfft < n) nfft <<= 1;
  const hann = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  );
  const freqs = Array.from({ length: nfft / 2 + 1 }, (_, k) => (k * rate) / nfft);
  const C = channels.length;
  const psd = Array.from({ length: C }, () => new Float64Array(nfft / 2 + 1));
  const count = new Array(C).fill(0);
  // per window, for coherence: only the α bins (the whole spectrum of every window of a long
  // recording would be hundreds of MB)
  const alphaBins = freqs.map((f, k) => (f >= 8 && f < 13 ? k : -1)).filter((k) => k >= 0);
  const windows = [];
  for (const [from, to] of ranges)
    for (let s = from; s + n <= to; s += step) {
      const w = { re: [], im: [], ok: [] };
      channels.forEach((ch, c) => {
        let m = 0;
        for (let i = 0; i < n; i++) m += ch[s + i];
        m /= n;
        let v = 0;
        const re = new Float64Array(nfft),
          im = new Float64Array(nfft);
        for (let i = 0; i < n; i++) {
          const x = ch[s + i] - m;
          v += x * x;
          re[i] = x * hann[i];
        }
        const sd = Math.sqrt(v / n);
        const ok = sd > 0.1 && sd < 200; // flat, or dominated by movement / out of range
        w.ok.push(ok);
        fft(re, im);
        w.re.push(Float64Array.from(alphaBins, (k) => re[k]));
        w.im.push(Float64Array.from(alphaBins, (k) => im[k]));
        if (!ok) return;
        for (let k = 0; k <= nfft / 2; k++)
          psd[c][k] += (re[k] * re[k] + im[k] * im[k]) / (n * rate);
        count[c]++;
      });
      windows.push(w);
    }
  psd.forEach((p, c) => {
    if (count[c]) for (let k = 0; k < p.length; k++) p[k] /= count[c];
    else p.fill(NaN);
  });
  return { freqs, psd, count, windows, nfft, alphaBins };
}

function band(spec, c, lo, hi) {
  let s = 0;
  const df = spec.freqs[1];
  spec.freqs.forEach((f, k) => {
    if (f >= lo && f < hi) s += spec.psd[c][k] * df;
  });
  return s;
}
const BANDS = { delta: [1, 4], theta: [4, 8], alpha: [8, 13], beta: [13, 30] };

/** segments of the recording named 闭眼 / 睁眼 (task conditions or 录制脑电 marks), in samples */
function segments(events, rate, N) {
  const out = { closed: [], open: [] };
  const kind = (s) => (/闭眼/.test(s) ? 'closed' : /睁眼/.test(s) ? 'open' : null);
  const starts = new Map();
  const sorted = [...events].sort((a, b) => a.t - b.t);
  sorted.forEach((e, i) => {
    const name = e.name || e.label || '';
    const k = kind(name);
    if (/\.start$/.test(e.label) && k) starts.set(e.label.replace(/\.start$/, ''), { k, t: e.t });
    else if (/\.end$/.test(e.label)) {
      const s = starts.get(e.label.replace(/\.end$/, ''));
      if (s) out[s.k].push([Math.round(s.t * rate), Math.round(e.t * rate)]);
    } else if (k && !/\./.test(e.label)) {
      // a mark: until the next mark
      const next = sorted[i + 1]?.t ?? N / rate;
      out[k].push([Math.round(e.t * rate), Math.round(next * rate)]);
    }
  });
  const fit = (r) =>
    r.map(([a, b]) => [clip(a, 0, N), clip(b, 0, N)]).filter(([a, b]) => b - a >= WIN_S * rate);
  return { closed: fit(out.closed), open: fit(out.open) };
}

// blinks per minute on the better front electrode (Fp1, Fp2): one out of contact (a swing of
// hundreds of µV all the time) would bury the other's blinks if averaged
function blinksOn(x, rate) {
  const N = x.length;
  const sm = filtered(x, blinkBand(rate));
  const skip = Math.round(2 * rate); // the filter settling
  if (N - skip < 10 * rate) return null;
  const sample = Array.from(sm.subarray(skip).filter((_, i) => i % 4 === 0));
  const mid = median(sample);
  const spread = median(sample.map((v) => Math.abs(v - mid))) * 1.4826;
  if (!(spread < 60)) return null; // not in contact
  // a blink: well above the usual swing (at least 40 µV), not a saturation (under 800 µV)
  const th = Math.max(40, mid + 6 * spread);
  let n = 0,
    last = -Infinity;
  for (let i = skip + 1; i < N - 1; i++)
    if (
      sm[i] > th &&
      sm[i] >= sm[i - 1] &&
      sm[i] > sm[i + 1] &&
      sm[i] < 800 &&
      i - last > 0.3 * rate
    ) {
      n++;
      last = i;
    }
  return { rate: (n / ((N - skip) / rate)) * 60, spread };
}
function blinks(channels, idx, rate) {
  const each = idx
    .filter((i) => i >= 0)
    .map((c) => blinksOn(channels[c], rate))
    .filter(Boolean)
    .sort((a, b) => a.spread - b.spread);
  return each.length ? each[0].rate : NaN;
}

function p300(channels, idx, rate, events) {
  const tgt = events.filter((e) => e.label === 'p300.target').map((e) => e.t);
  const non = events.filter((e) => e.label === 'p300.nontarget').map((e) => e.t);
  if (tgt.length < 10 || non.length < 10) return { few: tgt.length };
  const use = idx.filter((i) => i >= 0);
  const pre = Math.round(0.2 * rate),
    post = Math.round(0.8 * rate),
    sm = Math.max(1, Math.round(0.04 * rate));
  const N = channels[use[0]].length;
  const average = (times) => {
    const sum = new Float64Array(pre + post);
    let k = 0;
    for (const t of times) {
      const s = Math.round(t * rate);
      if (s - pre < 0 || s + post > N) continue;
      let swing = 0;
      const ep = new Float64Array(pre + post);
      for (const c of use)
        for (let i = 0; i < pre + post; i++) ep[i] += channels[c][s - pre + i] / use.length;
      const base = ep.slice(0, pre).reduce((a, b) => a + b, 0) / pre;
      for (let i = 0; i < ep.length; i++) {
        ep[i] -= base;
        swing = Math.max(swing, Math.abs(ep[i]));
      }
      if (swing > 150) continue; // a blink or movement
      for (let i = 0; i < ep.length; i++) sum[i] += ep[i];
      k++;
    }
    return k ? sum.map((v) => v / k) : null;
  };
  const a = average(tgt),
    b = average(non);
  if (!a || !b) return { noisy: true }; // every epoch had a blink or movement
  // the difference smoothed over 40 ms; its peak between 250 and 600 ms
  let best = -Infinity,
    at = null;
  for (let i = pre + Math.round(0.25 * rate); i < pre + Math.round(0.6 * rate); i++) {
    let s = 0;
    for (let j = i - sm; j <= i + sm; j++) s += a[j] - b[j];
    if (s > best) {
      best = s;
      at = i;
    }
  }
  return at === null || best <= 0 ? { none: true } : ((at - pre) / rate) * 1000;
}

const LEVEL = { solid: '可靠', moderate: '一般', weak: '参考性弱', none: '无可靠依据' };
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/**
 * @param r { channels: number[16][N] µV, rate, names: string[16] }
 * @param events [{ t (s), label, name? }]
 */
function computeMetrics(r, events = []) {
  const { rate } = r;
  const raw = r.channels;
  const channels = raw.map((ch) => filtered(ch, eegBand(rate)));
  const names = r.names ?? [];
  const N = channels[0]?.length ?? 0;
  const at = (...ns) => ns.map((n) => names.indexOf(n));
  const pick = (idx) => idx.filter((i) => i >= 0);
  const seg = segments(events, rate, N);
  const all = spectra(channels, rate, [[0, N]]);
  const restRanges = seg.closed.length ? seg.closed : [[0, N]];
  const rest = seg.closed.length ? spectra(channels, rate, restRanges) : all;
  const BACK = pick(at('O1', 'O2', 'P3', 'P4')),
    FRONT = pick(at('F3', 'F4', 'F7', 'F8')),
    PAR = pick(at('P3', 'P4', 'P7', 'P8')),
    EVERY = channels.map((_, c) => c).filter((c) => all.count[c] > 0);
  const avg = (spec, idx, b) => mean(idx.map((c) => band(spec, c, ...BANDS[b])));

  // α 峰值频率: the posterior spectrum (eyes closed when marked), its peak in 7–13 Hz
  let iaf = NaN;
  {
    const k0 = rest.freqs.findIndex((f) => f >= 7),
      k1 = rest.freqs.findIndex((f) => f > 13);
    const p = rest.freqs.map((_, k) => mean(BACK.map((c) => rest.psd[c][k])));
    let best = k0;
    for (let k = k0; k < k1; k++) if (p[k] > p[best]) best = k;
    const around = mean(p.slice(k0, k1));
    // a peak, not a slope: clearly above the band's mean; refined between the neighbours
    if (p[best] > 1.3 * around && best > k0 && best < k1 - 1) {
      const [l, c, rr] = [p[best - 1], p[best], p[best + 1]];
      const d = (0.5 * (l - rr)) / (l - 2 * c + rr || 1);
      iaf = rest.freqs[best] + d * rest.freqs[1];
    }
  }
  // 闭眼 α 增强
  let reactivity = NaN;
  if (seg.closed.length && seg.open.length) {
    const open = spectra(channels, rate, seg.open);
    reactivity = avg(rest, BACK, 'alpha') / avg(open, BACK, 'alpha');
  }
  // 频谱斜率 (aperiodic exponent): log10 power against log10 frequency, outside α and mains
  let exponent = NaN;
  {
    const xs = [],
      ys = [];
    all.freqs.forEach((f, k) => {
      if ((f >= 3 && f <= 7) || (f >= 14 && f <= 30)) {
        const v = mean(EVERY.map((c) => all.psd[c][k]));
        if (v > 0) {
          xs.push(Math.log10(f));
          ys.push(Math.log10(v));
        }
      }
    });
    if (xs.length > 5) {
      const mx = mean(xs),
        my = mean(ys);
      let sxy = 0,
        sxx = 0;
      xs.forEach((x, i) => {
        sxy += (x - mx) * (ys[i] - my);
        sxx += (x - mx) ** 2;
      });
      exponent = -sxy / sxx;
    }
  }
  // 脑电年龄: the α peak falls about 0.02 Hz a year from 10.5 Hz at 20; the exponent about
  // 0.012 a year from 1.6 — group trends only, so a wide range
  const ages = [];
  if (Number.isFinite(iaf)) ages.push(20 + (10.5 - iaf) / 0.02);
  if (Number.isFinite(exponent)) ages.push(20 + (1.6 - exponent) / 0.012);
  // outside what EEG gives: noise, not a measurement
  const exponentOk = Number.isFinite(exponent) && exponent > 0.3 && exponent < 4;
  if (!exponentOk) exponent = NaN;
  // the α peak carries the estimate (the better-established trend); the exponent, whose
  // values depend more on the cap and the fit, moves it by a third of its own
  const ageIaf = Number.isFinite(iaf) ? 20 + (10.5 - iaf) / 0.02 : NaN,
    ageExp = Number.isFinite(exponent) ? 20 + (1.6 - exponent) / 0.012 : NaN;
  ages.splice(
    0,
    ages.length,
    ...(Number.isFinite(ageIaf) && Number.isFinite(ageExp)
      ? [ageIaf + (clip(ageExp, 12, 85) - ageIaf) / 3]
      : // the exponent alone says too little: no α peak, no age
        [ageIaf].filter(Number.isFinite)),
  );
  const age = ages.length ? clip(mean(ages), 12, 85) : NaN;
  if (reactivity > 50) reactivity = NaN; // a contact change between the segments, not α

  const blinkRate = blinks(raw, at('Fp1', 'Fp2'), rate);
  const th = avg(all, EVERY, 'theta'),
    al = avg(all, EVERY, 'alpha'),
    be = avg(all, EVERY, 'beta'),
    de = avg(all, EVERY, 'delta');
  const engagement = be / (al + th);
  const relaxation = (al + th) / (de + th + al + be);
  const fatigue = (th + al) / be;
  const load = avg(all, FRONT, 'theta') / avg(all, PAR, 'alpha');
  const [f3, f4] = at('F3', 'F4');
  const faa =
    f3 >= 0 && f4 >= 0 && all.count[f3] && all.count[f4]
      ? Math.log(band(all, f4, ...BANDS.alpha)) - Math.log(band(all, f3, ...BANDS.alpha))
      : NaN;
  const arousal = avg(all, FRONT, 'beta') / avg(all, FRONT, 'alpha');
  const stress = arousal * (faa < 0 ? 1.2 : 1);
  const relBackAlpha =
    mean(BACK.map((c) => band(all, c, ...BANDS.alpha))) /
    mean(BACK.map((c) => band(all, c, 1, 30)));
  const relFrontBeta =
    mean(FRONT.map((c) => band(all, c, ...BANDS.beta))) /
    mean(FRONT.map((c) => band(all, c, 1, 30)));
  const extraversion = clip(10 - relBackAlpha * 25, 1, 10);
  const neuroticism = clip(relFrontBeta * 30, 1, 10);
  const stability = 11 - neuroticism; // 情绪稳定性: the other end of neuroticism, higher = steadier

  // 左右脑同步: α magnitude-squared coherence of homologous pairs, over the usable windows
  const pairs = [
    ['F3', 'F4'],
    ['C3', 'C4'],
    ['P3', 'P4'],
    ['O1', 'O2'],
  ]
    .map(([a, b]) => at(a, b))
    .filter(([a, b]) => a >= 0 && b >= 0);
  const kA = all.alphaBins;
  const coh = mean(
    pairs.map(([a, b]) => {
      const sxy = kA.map(() => [0, 0]),
        sxx = kA.map(() => 0),
        syy = kA.map(() => 0);
      let n = 0;
      for (const w of all.windows) {
        if (!w.ok[a] || !w.ok[b]) continue;
        n++;
        kA.forEach((_, j) => {
          const [ar, ai, br, bi] = [w.re[a][j], w.im[a][j], w.re[b][j], w.im[b][j]];
          sxy[j][0] += ar * br + ai * bi;
          sxy[j][1] += ai * br - ar * bi;
          sxx[j] += ar * ar + ai * ai;
          syy[j] += br * br + bi * bi;
        });
      }
      if (n < 5) return NaN;
      return mean(kA.map((_, j) => (sxy[j][0] ** 2 + sxy[j][1] ** 2) / (sxx[j] * syy[j])));
    }),
  );
  const p3 = p300(channels, at('P3', 'P4', 'C3', 'C4'), rate, events);
  const latency = typeof p3 === 'number' ? p3 : NaN,
    fewTargets = p3 && typeof p3 === 'object' && p3.few !== undefined ? p3.few : null,
    noP300 = !!(p3 && typeof p3 === 'object' && p3.none),
    noisyP300 = !!(p3 && typeof p3 === 'object' && p3.noisy);

  const item = (id, name, value, display, reliability, note) => ({
    id,
    name,
    value: Number.isFinite(value) ? value : null,
    display: Number.isFinite(value) ? display : '—',
    reliability,
    level: LEVEL[reliability],
    note,
  });
  const valenceText = !Number.isFinite(faa)
    ? '—'
    : faa > 0.05
      ? '偏积极'
      : faa < -0.05
        ? '偏消极'
        : '平稳';
  const arousalText = !Number.isFinite(arousal) ? '' : arousal > 1 ? '、较兴奋' : '、较平静';
  return {
    seconds: N / rate,
    segments: { closed: seg.closed.length, open: seg.open.length },
    // the numbers behind the words of 你的大脑报告 (src/report/BrainReport.tsx)
    raw: {
      ageLo: Number.isFinite(age) ? Math.max(10, Math.round(age - 12)) : null,
      ageHi: Number.isFinite(age) ? Math.round(age + 12) : null,
      valence: Number.isFinite(faa) ? faa : null,
      arousal: Number.isFinite(arousal) ? arousal : null,
      fatigue: Number.isFinite(fatigue) ? fatigue : null,
      stress: Number.isFinite(stress) ? stress : null,
    },
    items: [
      item(
        'iaf',
        'α 峰值频率',
        iaf,
        `${fmt(iaf, 1)} Hz`,
        'solid',
        Number.isFinite(iaf)
          ? `后脑（O1 O2 P3 P4）${seg.closed.length ? '闭眼时' : ''}α 节律的峰值频率；成年人一般在 8–12 Hz，个人很稳定`
          : '这段录制里后脑没有明显的 α 峰；闭眼放松的一段录制更容易测到',
      ),
      item(
        'reactivity',
        '闭眼 α 增强',
        reactivity,
        `${fmt(reactivity, 1)} 倍`,
        'solid',
        Number.isFinite(reactivity)
          ? '闭眼和睁眼时后脑 α 功率的比值'
          : seg.closed.length && seg.open.length
            ? '两段的差别大得不像 α 变化，多半是中途电极接触变了'
            : '需要录制里标出「闭眼」和「睁眼」两段',
      ),
      item(
        'exponent',
        '频谱斜率',
        exponent,
        fmt(exponent, 2),
        'moderate',
        exponentOk
          ? '脑电功率随频率下降的快慢（1/f 指数），和年龄、兴奋与抑制的平衡有关'
          : '这段录制的频谱不像脑电（噪声或肌电太多），算不出',
      ),
      item(
        'age',
        '脑电年龄',
        age,
        `${Math.max(10, Math.round(age - 12))}–${Math.round(age + 12)} 岁`,
        'weak',
        Number.isFinite(age)
          ? '主要由 α 峰值频率、其次由频谱斜率，对照文献中的人群年龄趋势估算；个人误差很大，只给区间，不是健康评估'
          : '需要测到 α 峰值频率；闭眼放松的一段录制更容易测到',
      ),
      item(
        'blinks',
        '眨眼频率',
        blinkRate,
        `${fmt(blinkRate, 0)} 次/分钟`,
        'solid',
        Number.isFinite(blinkRate)
          ? '前额 Fp1 或 Fp2（取接触更好的一个）上的眨眼波形计数'
          : '前额电极 Fp1 Fp2 都没贴好，数不出眨眼',
      ),
      item(
        'engagement',
        '专注度',
        engagement,
        fmt(engagement, 2),
        'moderate',
        'β ÷ (α + θ)，越高越投入；只适合和你自己的其他录制比较',
      ),
      item(
        'relaxation',
        '放松度',
        relaxation,
        `${Math.round(relaxation * 100)}%`,
        'moderate',
        'α 和 θ 在 1–30 Hz 中所占的比例；只适合和你自己比较',
      ),
      item(
        'fatigue',
        '疲劳度',
        fatigue,
        fmt(fatigue, 2),
        'moderate',
        '(θ + α) ÷ β，越高越困倦；只适合和你自己比较',
      ),
      item(
        'load',
        '认知负荷',
        load,
        fmt(load, 2),
        'moderate',
        '额叶 θ ÷ 顶叶 α，做费脑的事时升高；只适合和你自己比较',
      ),
      item(
        'faa',
        '额叶 α 不对称',
        faa,
        fmt(faa, 2),
        'weak',
        'ln(F4 的 α) − ln(F3 的 α)；群体研究中和「趋近 / 回避」倾向有关，对个人不可靠',
      ),
      item(
        'emotion',
        '情绪',
        faa,
        `${valenceText}${arousalText}`,
        'weak',
        '由额叶不对称和额叶 β/α 推测；脑电判断情绪对个人基本不可靠',
      ),
      item(
        'stress',
        '压力',
        stress,
        fmt(stress, 2),
        'weak',
        '额叶 β/α，右侧额叶占优时加重；受肌肉紧张影响大，参考性弱',
      ),
      item(
        'extraversion',
        '外向性',
        extraversion,
        `${fmt(extraversion, 1)} / 10`,
        'none',
        '由后脑 α 比例推算；脑电预测性格的研究复现不了，没有可靠依据，仅供娱乐',
      ),
      item(
        'neuroticism',
        '情绪稳定性',
        stability,
        `${fmt(stability, 1)} / 10`,
        'none',
        '神经质的反面，越高越稳定；由额叶 β 比例推算，没有可靠依据，仅供娱乐',
      ),
      item(
        'sync',
        '左右脑同步',
        coh,
        fmt(coh, 2),
        'moderate',
        '左右对应电极 α 节律的相干性（0–1）',
      ),
      item(
        'p300',
        'P300 反应时间',
        latency,
        `${fmt(latency, 0)} 毫秒`,
        'solid',
        Number.isFinite(latency)
          ? '看到目标后，大脑 P300 反应达到峰值的时间'
          : fewTargets !== null
            ? `目标只出现了 ${fewTargets} 次，至少要 10 次`
            : noP300
              ? '这段 P300 测试里，目标和非目标的反应看不出差别'
              : noisyP300
                ? '这段 P300 测试里每一段都有眨眼或动作，没有干净的片段'
                : '需要一段 P300 测试的录制',
      ),
    ],
  };
}

/** 脑图 in the details: relative power per band and electrode (% of 1–40 Hz), eyes closed and
 *  eyes open when the recording marks them, else the whole recording; null where an electrode
 *  had no usable window. Same filters and windows as the metrics. */
const MAP_BANDS = [
  ['δ', 1, 4],
  ['θ', 4, 8],
  ['α', 8, 12],
  ['α1', 8, 10],
  ['α2', 10, 12],
  ['低 β', 12, 15],
  ['中 β', 15, 20],
  ['高 β', 20, 35],
  ['γ', 35, 40],
];
function bandMap(r, events = []) {
  const { rate } = r;
  const channels = r.channels.map((ch) => filtered(ch, eegBand(rate)));
  const N = channels[0]?.length ?? 0;
  const seg = segments(events, rate, N);
  const parts =
    seg.closed.length && seg.open.length
      ? [
          ['闭眼', seg.closed],
          ['睁眼', seg.open],
        ]
      : [['整段', [[0, N]]]];
  return {
    bands: MAP_BANDS.map(([name, lo, hi]) => ({ name, lo, hi })),
    states: parts.map(([name, ranges]) => {
      const spec = spectra(channels, rate, ranges);
      return {
        name,
        rel: MAP_BANDS.map(([, lo, hi]) =>
          channels.map((_, c) => {
            if (!spec.count[c]) return null;
            const v = (100 * band(spec, c, lo, hi)) / band(spec, c, 1, 40);
            return Number.isFinite(v) ? +v.toFixed(3) : null;
          }),
        ),
      };
    }),
  };
}

module.exports = { computeMetrics, bandMap, segments, LEVEL };
