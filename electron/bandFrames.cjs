// The 0.5 s brain frames of a recording from its raw EEG (as brainHistory keeps them live), for
// 数据 and the 脑电记录 card (electron/dataStore.cjs); no Node dependencies, so the WeChat mini
// program's card (src/wechat/card.ts) uses this same code.
const BANDS = [
  [1, 4],
  [4, 8],
  [8, 13],
  [13, 30],
  [30, 40],
];

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
        const ur = re[i + k],
          ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : NaN;
};

/**
 * 0.5 s frames as the app keeps them live (brainHistory): band power of the last 2 s per band ×
 * channel, and r = ln(power / baseline), the baseline being the median over this recording's
 * usable windows. A channel is unusable in a window when flat or out of range (railed).
 */
function bandFrames(channels, rate, startSeconds, spectra = false, win = 2, hop = 0.5) {
  const n = Math.round(win * rate),
    step = Math.max(1, Math.round(hop * rate)),
    N = channels[0]?.length ?? 0;
  let nfft = 1;
  while (nfft < n) nfft <<= 1;
  const hann = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  );
  const bins = BANDS.map(([lo, hi]) => [
    Math.ceil((lo * nfft) / rate),
    Math.floor((hi * nfft) / rate),
  ]);
  // spectra (for the player's rhythm bars): 1–40 Hz in the FFT's own bins
  const k0 = Math.ceil(nfft / rate),
    k1 = Math.floor((40 * nfft) / rate);
  const frequencies = [];
  for (let k = k0; k <= k1; k++) frequencies.push((k * rate) / nfft);
  const raw = [];
  for (let s = 0; s + n <= N; s += step) {
    const p = BANDS.map(() => new Array(channels.length).fill(NaN));
    const ok = [],
      psd = [];
    channels.forEach((ch, c) => {
      let mean = 0;
      for (let i = 0; i < n; i++) mean += ch[s + i];
      mean /= n;
      let v = 0;
      const re = new Float64Array(nfft),
        im = new Float64Array(nfft);
      for (let i = 0; i < n; i++) {
        const x = ch[s + i] - mean;
        v += x * x;
        re[i] = x * hann[i];
      }
      const sd = Math.sqrt(v / n);
      ok[c] = sd > 0.1 && sd < 5000;
      fft(re, im);
      bins.forEach(([a, b], k) => {
        let sum = 0;
        for (let i = a; i <= b; i++) sum += re[i] * re[i] + im[i] * im[i];
        p[k][c] = sum;
      });
      if (spectra) {
        const row = [];
        for (let k = k0; k <= k1; k++) row.push((re[k] * re[k] + im[k] * im[k]) / (n * rate));
        psd.push(row);
      }
    });
    raw.push({ t: startSeconds + (s + n) / rate, p, ok, psd, s: s + n });
  }
  const base = BANDS.map((_, k) =>
    channels.map((_, c) => median(raw.filter((f) => f.ok[c]).map((f) => f.p[k][c]))),
  );
  return raw.map((f) => ({
    t: f.t,
    ok: f.ok,
    p: f.p,
    ...(spectra ? { psd: f.psd, frequencies, sample: f.s } : {}),
    rec: {},
    r: f.p.map((row, k) =>
      row.map((v, c) => (f.ok[c] && v > 0 && base[k][c] > 0 ? Math.log(v / base[k][c]) : NaN)),
    ),
  }));
}

// The EEG itself, compressed in time for the card's 多通道频段功率时序 (drawn faint behind the
// band power lines): per channel the drift taken out (1 s moving mean), mains and the fastest
// wiggles smoothed away (a box of 1/50 s: zero at 50 Hz and its multiples), then the lowest and
// highest value in each of `cols` equal stretches of the recording. Values in µV, 1 decimal.
function waveEnvelope(channels, rate, cols = 1000) {
  const N = channels[0]?.length ?? 0;
  const n = Math.min(cols, N);
  const hp = Math.max(1, Math.round(rate)),
    lp = Math.max(1, Math.round(rate / 50));
  const r1 = (v) => Math.round(v * 10) / 10;
  const out = { seconds: N / rate, min: [], max: [] };
  for (const x of channels) {
    const cs = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) cs[i + 1] = cs[i] + (Number.isFinite(x[i]) ? x[i] : 0);
    const mean = (a, b) => {
      a = Math.max(0, a);
      b = Math.min(N, b);
      return b > a ? (cs[b] - cs[a]) / (b - a) : 0;
    };
    const mn = new Array(n).fill(0),
      mx = new Array(n).fill(0);
    for (let k = 0; k < n; k++) {
      const a = Math.floor((k * N) / n),
        b = Math.max(a + 1, Math.floor(((k + 1) * N) / n));
      let lo = Infinity,
        hi = -Infinity;
      for (let i = a; i < b; i++) {
        const y = mean(i - (lp >> 1), i - (lp >> 1) + lp) - mean(i - (hp >> 1), i - (hp >> 1) + hp);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      mn[k] = r1(lo);
      mx[k] = r1(hi);
    }
    out.min.push(mn);
    out.max.push(mx);
  }
  return out;
}

module.exports = { bandFrames, waveEnvelope };
