// 数据: every recording kept on this computer as one list — 录制脑电 (electron/moments.cjs) and
// task sessions (electron/session.cjs). For each: the card picture (made by the page, kept next
// to the data as card3.png / thumb3.jpg / card3.json), the band power frames the card is drawn from (computed
// here from the raw EEG), the details (information, quality, events, results) and a replayable
// recording. Nothing is uploaded.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { readSession, continuous, writeBdf, exportBdf } = require('./export.cjs');
const montage = require('./montage.cjs');
const { computeMetrics, bandMap } = require('./metrics.cjs');
const { findGaps } = require('./session.cjs');
const { brainPrint } = require('./brainPrint.cjs');
const { bandFrames, waveEnvelope } = require('./bandFrames.cjs');

const MAX_IMAGE = 8 * 1024 * 1024;
const FREE = 'free-recording';
// sessions that are recordings, not an ability's: 自由录制 and 首次打开's 静息校准
const RECORDINGS = [FREE, 'resting'];
// the card files (version 11: that EEG fainter; version 10: the EEG itself drawn faint behind
// the lines of 多通道频段功率时序; version 9: those lines with each electrode's own detail —
// light smoothing, the change common to all electrodes taken out; version 8: in the middle α's
// share on the brain with its bar, as the grid picture; θ α β in their colours); the grid picture
// version 11: α's share on the brain in the stepped rainbow, recordArt.ts, and the brain in grey
// when the recording is too short for spectra (10 drew 神经光流 then)
const CARD = 'card11.png',
  THUMB = 'thumb11.jpg',
  NAME = 'name.json',
  INFO = 'card11.json',
  // card5: the raw waveforms, tried and taken back
  OLD = [
    'thumb6.jpg',
    'thumb7.jpg',
    'thumb8.jpg',
    'thumb9.jpg',
    'thumb10.jpg',
    'card6.png',
    'card6.json',
    'card7.png',
    'card7.json',
    'card8.png',
    'card8.json',
    'card9.png',
    'card9.json',
    'card10.png',
    'card10.json',
    'card2.png',
    'thumb.jpg',
    'card3.png',
    'thumb3.jpg',
    'card3.json',
    'card5.png',
    'thumb5.jpg',
    'card5.json',
    'card4.png',
    'thumb4.jpg',
    'card4.json',
  ];
function cardInfo(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, INFO), 'utf8'));
  } catch {
    return null;
  }
}

class DataStore {
  constructor(moments, sessions) {
    this.moments = moments;
    this.sessions = sessions;
  }
  dir(kind, id) {
    if (kind === 'moment') return this.moments.folder(id);
    if (kind === 'session') return this.sessions.dirOf(id);
    throw Error('数据类型无效');
  }
  // 重命名: the name the user gave, beside the recording (name.json), read by list()
  name(dir) {
    try {
      const n = JSON.parse(fs.readFileSync(path.join(dir, NAME), 'utf8')).name;
      return typeof n === 'string' && n ? n : null;
    } catch {
      return null;
    }
  }
  /** an empty name goes back to the default; the card is made again with the new name */
  async rename(kind, id, name) {
    const dir = this.dir(kind, id);
    const n = String(name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    if (n) await fsp.writeFile(path.join(dir, NAME), JSON.stringify({ name: n }));
    else await fsp.rm(path.join(dir, NAME), { force: true });
    for (const f of [CARD, THUMB, INFO]) await fsp.rm(path.join(dir, f), { force: true });
    return { name: n || null };
  }
  async list() {
    const out = [];
    for (const m of await this.moments.list())
      out.push({
        kind: 'moment',
        id: m.id,
        type: 'recording',
        title: m.title || '脑电记录',
        start: m.start || m.recordedAt,
        seconds: m.seconds,
        source: m.source,
        name: this.name(this.moments.folder(m.id)),
        // ready when both pictures are of this version (a card is remade when either is missing)
        thumb: [THUMB, CARD].every((f) => fs.existsSync(path.join(this.moments.folder(m.id), f))),
        info: cardInfo(this.moments.folder(m.id)),
      });
    for (const s of await this.sessions.list()) {
      let dir;
      try {
        dir = this.sessions.dirOf(s.id);
      } catch {
        continue; // still recording
      }
      out.push({
        kind: 'session',
        id: s.id,
        type: RECORDINGS.includes(s.task?.id) ? 'recording' : 'task',
        title: s.task?.id === FREE ? '自由录制' : s.task?.title || s.task?.id,
        start: s.createdAt,
        seconds: s.durationSeconds,
        status: s.status,
        source: s.source,
        participant: s.participant,
        task: s.task?.id ?? null,
        taskId: s.taskId ?? null,
        name: this.name(dir),
        thumb: [THUMB, CARD].every((f) => fs.existsSync(path.join(dir, f))),
        info: cardInfo(dir),
      });
    }
    return out.sort((a, b) => String(b.start).localeCompare(String(a.start)));
  }
  // raw EEG: { rate, start (s), channels: 16 × samples (µV), timestamps, source, names }
  async raw(kind, id) {
    if (kind === 'session') {
      const { info, data, timestamps } = await readSession(this.dir(kind, id));
      return {
        rate: info.device.rate,
        start: timestamps[0] ?? Date.parse(info.createdAt) / 1000,
        channels: data,
        timestamps,
        source: info.source,
        names: info.electrodes,
      };
    }
    const file = await this.moments.open(id);
    const m = file.header.metadata;
    const channels = Array.from({ length: 16 }, () => []),
      timestamps = [];
    for (const row of file.events) {
      if (row.event.type !== 'data') continue;
      row.event.samples.forEach((a, c) => channels[c].push(...a));
      timestamps.push(...row.event.timestamps);
    }
    return {
      rate: m.rate,
      start: timestamps[0] ?? 0,
      channels,
      timestamps,
      source: file.header.source,
    };
  }
  /** 导出: the recording as BDF (task sessions with their events, as in 我的记录; 录制脑电 with
   *  its marks); samples lost in transport are zero-filled and marked BAD_gap */
  async exportBdf(kind, id, file) {
    if (kind === 'session') return exportBdf(this.dir(kind, id), file);
    const r = await this.raw(kind, id);
    let marks = [];
    try {
      marks = JSON.parse(
        await fsp.readFile(path.join(this.dir(kind, id), 'meta.json'), 'utf8'),
      ).marks;
    } catch {
      // no marks
    }
    const signal = continuous(r.channels, r.timestamps, r.rate);
    return {
      ...writeBdf(file, {
        rate: r.rate,
        labels: [...montage.electrodeNames],
        data: signal.data,
        start: new Date(r.start * 1000),
        patient: 'X X X X',
        recording: 'OpenCiv_BCI_001_recording',
        annotations: [
          ...signal.marks,
          ...(marks ?? []).map((m) => ({ onset: m.t, duration: 0, text: 'MARK' })),
        ],
      }),
      filledSeconds: +(signal.filled / r.rate).toFixed(2),
    };
  }
  async frames(kind, id) {
    const r = await this.raw(kind, id);
    return {
      rate: r.rate,
      start: r.start,
      frames: bandFrames(r.channels, r.rate, r.start),
      // the card's 多通道频段功率时序: 1 s windows every 0.3 s (tuned with validation/card-lines),
      // t = the window's centre in seconds from the start
      lines: bandFrames(r.channels, r.rate, -0.5, false, 1, 0.3),
      // and the EEG itself behind those lines (per channel the lowest / highest in 1000 stretches)
      wave: waveEnvelope(r.channels, r.rate),
    };
  }
  /** 脑图 (metrics.cjs bandMap): relative band power per electrode, 闭眼 / 睁眼 when marked */
  async bandMap(kind, id) {
    const r = await this.raw(kind, id);
    const d = await this.detail(kind, id);
    return bandMap(
      { channels: r.channels, rate: r.rate },
      d.events.map((e) => ({ t: e.t, label: e.label, name: e.name })),
    );
  }
  /** the figures of the grid picture (brainPrint.cjs): spectrum shape per electrode, alpha peak */
  async print(kind, id) {
    const r = await this.raw(kind, id);
    return brainPrint(
      r.channels,
      r.rate,
      Array.isArray(r.names) ? r.names : [...montage.electrodeNames],
    );
  }
  /** 脑电指标 (metrics.cjs) of a recording, with its 闭眼 / 睁眼 and P300 events */
  async metrics(kind, id) {
    const r = await this.raw(kind, id);
    const d = await this.detail(kind, id);
    return computeMetrics(
      { channels: r.channels, rate: r.rate, names: r.names ?? [...montage.electrodeNames] },
      d.events.map((e) => ({ t: e.t, label: e.label, name: e.name })),
    );
  }
  async detail(kind, id) {
    const dir = this.dir(kind, id);
    const r = await this.raw(kind, id);
    const seconds = r.channels[0].length / r.rate;
    const gaps = findGaps(r.timestamps, r.timestamps.length, r.rate);
    const frames = bandFrames(r.channels, r.rate, r.start);
    const usable = r.channels.map((_, c) =>
      frames.length ? frames.filter((f) => f.ok[c]).length / frames.length : 0,
    );
    const common = {
      kind,
      id,
      rate: r.rate,
      channels: r.channels.length,
      samples: r.channels[0].length,
      seconds,
      source: r.source,
      lost: gaps.reduce((a, g) => a + (g.lost ?? 0), 0),
      restarts: gaps.filter((g) => g.lost === null).length,
      usable, // per channel: share of 2 s windows neither flat nor out of range
    };
    if (kind === 'moment') {
      const meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'));
      return {
        ...common,
        title: meta.title || '脑电记录',
        type: 'recording',
        start: meta.start || meta.recordedAt,
        note: meta.note || '',
        events: (meta.marks ?? []).map((m) => ({ t: m.t, label: m.label, source: 'manual' })),
        results: null,
      };
    }
    const { info, events, quality } = await readSession(dir);
    let results = null;
    try {
      results =
        JSON.parse(await fsp.readFile(path.join(dir, 'results.json'), 'utf8')).summary ?? null;
    } catch {
      results = info.results ?? null;
    }
    const railed = info.electrodes.map((_, c) => {
      const rows = quality.filter((q) => Array.isArray(q.rail));
      return rows.length
        ? rows.filter((q) => ['railed', 'flat'].includes(q.rail[c])).length / rows.length
        : NaN;
    });
    return {
      ...common,
      title: info.task.id === FREE ? '自由录制' : info.task.title,
      type: RECORDINGS.includes(info.task.id) ? 'recording' : 'task',
      start: info.createdAt,
      status: info.status,
      abortReason: info.abortReason,
      participant: info.participant?.code ?? null,
      names: info.electrodes,
      railed,
      clock: info.clock,
      events: events
        .filter((e) => Number.isInteger(e.sample))
        .map((e) => ({
          t: e.sample / r.rate,
          label: e.label,
          source: e.source,
          name: typeof e.data?.name === 'string' ? e.data.name : null, // the state's name
        })),
      results,
    };
  }
  // a recording the player can replay (moments as recorded; sessions from eeg.csv)
  async open(kind, id) {
    if (kind === 'moment') return this.moments.open(id);
    const r = await this.raw(kind, id);
    const chunk = Math.max(1, Math.round(r.rate / 10)),
      events = [],
      N = r.channels[0].length;
    for (let s = 0; s < N; s += chunk) {
      const e = Math.min(N, s + chunk);
      const samples = r.channels.map((ch) => ch.slice(s, e));
      events.push({
        ms: (s / r.rate) * 1000,
        event: {
          type: 'data',
          epoch: 1,
          samples,
          timestamps: r.timestamps.slice(s, e),
          rms: samples.map((a) => Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length)),
          quality: samples.map(() => 'ok'),
        },
      });
    }
    // spectra every 0.5 s, so the player can show the rhythms (sessions keep no spectra)
    for (const f of bandFrames(r.channels, r.rate, 0, true)) {
      const ms = (f.sample / r.rate) * 1000;
      events.push({
        ms,
        event: {
          type: 'alpha',
          epoch: 1,
          frequencies: f.frequencies,
          psd: f.psd,
          relative: f.p[2].map((v, c) => v / (f.p.reduce((a, row) => a + row[c], 0) || 1)),
          absolute: f.p[2],
          flags: f.ok.map((ok) => (ok ? '' : 'amplitude')),
        },
      });
    }
    events.sort((a, b) => a.ms - b.ms);
    return {
      header: {
        format: 'neurolink-recording',
        version: 1,
        metadata: { type: 'metadata', rate: r.rate, channels: 16, unit: 'µV', epoch: 1 },
        source: r.source,
      },
      events,
      duration: (N / r.rate) * 1000,
      samples: N,
      file: id,
    };
  }
  async image(kind, id, name) {
    if (![CARD, THUMB].includes(name)) throw Error('图片名称无效');
    const file = path.join(this.dir(kind, id), name);
    if (!fs.existsSync(file)) return null;
    const type = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${type};base64,${(await fsp.readFile(file)).toString('base64')}`;
  }
  async saveImages(kind, id, card, thumb, info) {
    const dir = this.dir(kind, id);
    for (const [name, url, prefix] of [
      [CARD, card, /^data:image\/png;base64,/],
      [THUMB, thumb, /^data:image\/jpeg;base64,/],
    ]) {
      if (typeof url !== 'string' || !prefix.test(url)) throw Error('图片格式无效');
      const buf = Buffer.from(url.replace(prefix, ''), 'base64');
      if (buf.length > MAX_IMAGE) throw Error('图片过大');
      await fsp.writeFile(path.join(dir, name), buf);
    }
    // what the grid shows next to the thumbnail: the share of usable signal
    const valid = Number(info?.valid);
    await fsp.writeFile(
      path.join(dir, INFO),
      JSON.stringify({ valid: Number.isFinite(valid) ? Math.max(0, Math.min(1, valid)) : null }),
    );
    for (const old of OLD) await fsp.rm(path.join(dir, old), { force: true });
    return true;
  }
}

module.exports = { DataStore, bandFrames };
