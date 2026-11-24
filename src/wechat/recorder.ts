// 录制脑电 in the mini program (design/wechat-app): the device's samples (µV, 16 channels) kept in
// the mini program's own files on the phone — nothing is uploaded — and exported as the desktop
// exports them: a BDF+C file (24 bit, 1 s records, electron/export.cjs writeBdf), which the user
// sends where they choose through WeChat (wx.shareFileMessage, e.g. to 文件传输助手).
//   eeg/<id>/samples.f32   float32, sample after sample, 16 channels each
//   eeg/<id>/meta.json     { id, start, seconds, rate, samples, labels, peak, good }
// A mini program has about 200 MB of its own files; recording stops before they are full.

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const CHANNELS = 16;
const LIMIT = 190 * 1024 * 1024; // bytes of the mini program's files in all
const FLUSH = 1000; // ms between writes

export type Meta = {
  id: string;
  start: number; // ms
  seconds: number;
  rate: number;
  samples: number;
  labels: string[];
  peak: number; // largest |µV|, for the BDF's physical range
  good: number | null; // electrodes in good contact, on average over the recording
  // the words on its card (moment/pages/card), once made
  words?: { title: string; note: string; sign: string; marks: { t: number; label: string }[] };
  marks?: { t: number; label: string }[]; // 标记此刻 while recording
  // events by time from the start (s), as the desktop's sessions: cond.s1.start … (静息校准)
  events?: { t: number; label: string; name?: string }[];
  kind?: string; // 'resting': 首次打开's 静息校准
};

const fs = () => wx.getFileSystemManager();
const root = () => `${wx.env.USER_DATA_PATH}/eeg`;
const dirOf = (id: string) => `${root()}/${id}`;
const two = (n: number) => String(n).padStart(2, '0');
const idOf = (t: Date) =>
  `${t.getFullYear()}${two(t.getMonth() + 1)}${two(t.getDate())}-${two(t.getHours())}${two(t.getMinutes())}${two(t.getSeconds())}`;

function exists(path: string) {
  try {
    fs().accessSync(path);
    return true;
  } catch {
    return false;
  }
}
/** Bytes of the mini program's own files (recordings and exports) */
function used(path = wx.env.USER_DATA_PATH): number {
  let total = 0;
  let names: string[] = [];
  try {
    names = fs().readdirSync(path);
  } catch {
    return 0;
  }
  for (const n of names) {
    const p = `${path}/${n}`;
    try {
      const st = fs().statSync(p);
      total += st.isDirectory() ? used(p) : st.size;
    } catch {
      /* gone meanwhile */
    }
  }
  return total;
}

let current: {
  meta: Meta;
  buffer: number[];
  bytes: number;
  limit: number;
  timer: ReturnType<typeof setInterval>;
  goodSum: number;
  goodCount: number;
} | null = null;

export function active() {
  return current
    ? { active: true, seconds: current.meta.samples / current.meta.rate }
    : { active: false, seconds: 0 };
}

export function start(rate: number, labels: string[], kind?: string) {
  if (current) return;
  const free = LIMIT - used();
  if (free < 5 * 1024 * 1024) throw Error('手机上的空间已满，请先导出并删除一些录制');
  const t = new Date();
  const meta: Meta = {
    id: idOf(t),
    start: t.getTime(),
    seconds: 0,
    rate,
    samples: 0,
    labels,
    peak: 0,
    good: null,
    ...(kind ? { kind } : {}),
  };
  if (!exists(root())) fs().mkdirSync(root(), true);
  fs().mkdirSync(dirOf(meta.id), true);
  fs().writeFileSync(`${dirOf(meta.id)}/samples.f32`, new ArrayBuffer(0));
  writeMeta(meta);
  current = {
    meta,
    buffer: [],
    bytes: 0,
    limit: free,
    timer: setInterval(flush, FLUSH),
    goodSum: 0,
    goodCount: 0,
  };
}

/** One batch of samples (channels × samples, µV) as the engine's data event brings them */
export function push(samples: number[][]) {
  if (!current) return;
  const n = samples[0]?.length ?? 0;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < CHANNELS; c++) {
      const v = samples[c]?.[i] ?? 0;
      current.buffer.push(v);
      if (Math.abs(v) > current.meta.peak) current.meta.peak = Math.abs(v);
    }
  current.meta.samples += n;
}
/** An event now (s from the start), as the desktop's session events */
export function event(label: string, name?: string) {
  if (!current) return;
  const m = current.meta;
  (m.events ??= []).push({ t: m.samples / m.rate, label, ...(name ? { name } : {}) });
}
/** The contact (electrodes good) once a second, for the recording's quality */
export function contact(good: number) {
  if (!current) return;
  current.goodSum += good;
  current.goodCount++;
}

function flush() {
  if (!current || !current.buffer.length) return;
  const data = new Float32Array(current.buffer);
  current.buffer = [];
  try {
    fs().appendFileSync(`${dirOf(current.meta.id)}/samples.f32`, data.buffer);
  } catch (e) {
    // the phone's storage for mini programs is full: the recording ends with what was written
    current.meta.samples -= data.length / CHANNELS;
    stop();
    return;
  }
  current.bytes += data.byteLength;
  current.meta.seconds = current.meta.samples / current.meta.rate;
  if (current.bytes > current.limit - 4 * 1024 * 1024) stop(); // room for the export
}

export function stop(): Meta | null {
  if (!current) return null;
  flush();
  const c = current;
  current = null;
  clearInterval(c.timer);
  c.meta.seconds = c.meta.samples / c.meta.rate;
  c.meta.good = c.goodCount ? c.goodSum / c.goodCount : null;
  if (c.meta.samples < c.meta.rate) {
    remove(c.meta.id); // under a second: nothing worth keeping
    return null;
  }
  writeMeta(c.meta);
  return c.meta;
}

function writeMeta(meta: Meta) {
  fs().writeFileSync(`${dirOf(meta.id)}/meta.json`, JSON.stringify(meta), 'utf8');
}

/** The recordings, newest first */
export function list(): Meta[] {
  if (!exists(root())) return [];
  const out: Meta[] = [];
  for (const id of fs().readdirSync(root())) {
    if (current && current.meta.id === id) continue;
    try {
      const meta: Meta = JSON.parse(fs().readFileSync(`${dirOf(id)}/meta.json`, 'utf8'));
      // cut short (the mini program closed while recording): its length from the samples file
      const size = fs().statSync(`${dirOf(id)}/samples.f32`).size;
      const samples = Math.floor(size / (CHANNELS * 4));
      if (samples !== meta.samples) {
        if (samples < meta.rate) {
          remove(id);
          continue;
        }
        meta.samples = samples;
        meta.seconds = samples / meta.rate;
        writeMeta(meta);
      }
      out.push(meta);
    } catch {
      /* not a recording */
    }
  }
  return out.sort((a, b) => b.start - a.start);
}

export function remove(id: string) {
  if (!/^[\w-]+$/.test(id)) return;
  try {
    fs().rmdirSync(dirOf(id), true);
  } catch {
    /* already gone */
  }
}

/** The words of a recording's card, kept with it */
export function saveWords(id: string, words: NonNullable<Meta['words']>) {
  const meta: Meta = JSON.parse(fs().readFileSync(`${dirOf(id)}/meta.json`, 'utf8'));
  meta.words = words;
  writeMeta(meta);
}
/** A recording's metadata (null: gone) */
export function metaOf(id: string): Meta | null {
  try {
    return JSON.parse(fs().readFileSync(`${dirOf(id)}/meta.json`, 'utf8'));
  } catch {
    return null;
  }
}
/** A recording's samples as 16 channels (µV), for its card (src/wechat/card.ts) */
export function readChannels(id: string): { channels: Float32Array[]; rate: number; meta: Meta } {
  const meta: Meta = JSON.parse(fs().readFileSync(`${dirOf(id)}/meta.json`, 'utf8'));
  const raw = new Float32Array(fs().readFileSync(`${dirOf(id)}/samples.f32`) as ArrayBuffer);
  const n = Math.floor(raw.length / CHANNELS);
  const channels = Array.from({ length: CHANNELS }, (_, c) => {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = raw[i * CHANNELS + c];
    return ch;
  });
  return { channels, rate: meta.rate, meta };
}

// ---- BDF+C (as electron/export.cjs) -----------------------------------------------------------
const FULL_SCALE_UV = 187500; // the ADS1299 at gain 24 (4.5 V reference)
const DIG_MIN = -8388608,
  DIG_MAX = 8388607;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const field = (value: unknown, width: number) => {
  const text = String(value).replace(/[^\x20-\x7e]/g, '_');
  if (text.length > width) throw Error(`BDF 头字段过长：${text}`);
  return text.padEnd(width, ' ');
};
const number = (value: number, width: number) => {
  let text = String(value);
  if (text.length > width) text = Number(value).toPrecision(width - 2);
  return field(text, width);
};
const latin1 = (text: string) => {
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i) & 0xff;
  return b;
};
function tal(onset: number, notes: { onset: number; duration: number; text: string }[]) {
  const sign = (t: number) => (t >= 0 ? '+' : '') + t.toFixed(4).replace(/\.?0+$/, '');
  let text = `${sign(onset)}\x14\x14\x00`;
  for (const a of notes)
    text += `${sign(a.onset)}\x15${a.duration.toFixed(4).replace(/\.?0+$/, '') || '0'}\x14${a.text}\x14\x00`;
  return latin1(text);
}

/**
 * The recording as a BDF+C file in the mini program's files (the previous export is removed
 * first); its path, to send. A trailing partial second is padded with zeros and marked
 * BAD_padding, as the desktop does.
 */
export function exportBdf(id: string): { path: string; name: string } {
  const meta: Meta = JSON.parse(fs().readFileSync(`${dirOf(id)}/meta.json`, 'utf8'));
  const { rate, labels } = meta;
  const n = meta.samples;
  if (n < 1) throw Error('没有数据，无法导出');
  const records = Math.ceil(n / rate);
  const byRecord: { onset: number; duration: number; text: string }[][] = Array.from(
    { length: records },
    () => [],
  );
  if (records * rate > n)
    byRecord[Math.floor(n / rate)].push({
      onset: n / rate,
      duration: (records * rate - n) / rate,
      text: 'BAD_padding',
    });
  const annSamples = Math.max(
    16,
    Math.ceil(Math.max(...byRecord.map((a, r) => tal(r, a).length)) / 3),
  );

  const physMax = Math.ceil(Math.max(FULL_SCALE_UV, meta.peak)),
    physMin = -physMax;
  const signals = [
    ...labels.map((label) => ({
      label,
      transducer: 'Passive dry electrode',
      dim: 'uV',
      pmin: physMin,
      pmax: physMax,
      prefilter: 'None',
      samples: rate,
    })),
    {
      label: 'BDF Annotations',
      transducer: '',
      dim: '',
      pmin: -1,
      pmax: 1,
      prefilter: '',
      samples: annSamples,
    },
  ];
  const ns = signals.length;
  const start = new Date(meta.start);
  const date = `${two(start.getDate())}.${two(start.getMonth() + 1)}.${two(start.getFullYear() % 100)}`;
  const time = `${two(start.getHours())}.${two(start.getMinutes())}.${two(start.getSeconds())}`;
  const startdate = `${two(start.getDate())}-${MONTHS[start.getMonth()]}-${start.getFullYear()}`;
  const each = (fn: (s: (typeof signals)[number]) => string, width: number) =>
    signals.map((s) => field(fn(s), width)).join('');
  const head =
    '\xffBIOSEMI' +
    field('X X X X', 80) +
    field(`Startdate ${startdate} X X OpenCiv_BCI_001_recording`, 80) +
    date +
    time +
    number(256 * (ns + 1), 8) +
    field('BDF+C', 44) +
    number(records, 8) +
    number(1, 8) +
    number(ns, 4) +
    each((s) => s.label, 16) +
    each((s) => s.transducer, 80) +
    each((s) => s.dim, 8) +
    signals.map((s) => number(s.pmin, 8)).join('') +
    signals.map((s) => number(s.pmax, 8)).join('') +
    signals.map(() => number(DIG_MIN, 8)).join('') +
    signals.map(() => number(DIG_MAX, 8)).join('') +
    each((s) => s.prefilter, 80) +
    signals.map((s) => number(s.samples, 8)).join('') +
    each(() => '', 32);
  if (head.length !== 256 * (ns + 1)) throw Error('BDF 头长度错误');

  // the folder for exports holds one file at a time
  const outDir = `${wx.env.USER_DATA_PATH}/export`;
  if (exists(outDir)) fs().rmdirSync(outDir, true);
  fs().mkdirSync(outDir, true);
  const name = `OpenCiv-BCI-001-${id}.bdf`;
  const out = `${outDir}/${name}`;
  fs().writeFileSync(out, latin1(head).buffer);

  // a minute of records at a time: read the samples, write 24-bit records
  const src = fs().openSync({ filePath: `${dirOf(id)}/samples.f32`, flag: 'r' });
  const scale = (DIG_MAX - DIG_MIN) / (physMax - physMin);
  const recordBytes = (labels.length * rate + annSamples) * 3;
  try {
    for (let r0 = 0; r0 < records; r0 += 60) {
      const r1 = Math.min(records, r0 + 60);
      const first = r0 * rate,
        count = Math.min(n, r1 * rate) - first;
      const raw = new ArrayBuffer(count * CHANNELS * 4);
      if (count > 0)
        fs().readSync({
          fd: src,
          arrayBuffer: raw,
          offset: 0,
          length: raw.byteLength,
          position: first * CHANNELS * 4,
        });
      const x = new Float32Array(raw);
      const body = new Uint8Array((r1 - r0) * recordBytes);
      let o = 0;
      for (let r = r0; r < r1; r++) {
        for (let c = 0; c < labels.length; c++)
          for (let i = r * rate; i < (r + 1) * rate; i++) {
            const k = i - first;
            const uv = i < n && k < count ? x[k * CHANNELS + c] : 0;
            let v = Math.round((uv - physMin) * scale + DIG_MIN);
            v = Math.min(DIG_MAX, Math.max(DIG_MIN, v));
            body[o] = v & 0xff;
            body[o + 1] = (v >> 8) & 0xff;
            body[o + 2] = (v >> 16) & 0xff;
            o += 3;
          }
        body.set(tal(r, byRecord[r]), o);
        o += annSamples * 3;
      }
      fs().appendFileSync(out, body.buffer);
    }
  } finally {
    fs().closeSync({ fd: src });
  }
  return { path: out, name };
}
