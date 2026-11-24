// 脑电时刻: moments the user recorded from 主图 (a birthday wish, a confession…). Each moment is a
// folder in userData/moments: the complete EEG as a standard recording (eeg.neuro.jsonl, all 16
// channels, every sample, spectra; replayable like any recording), meta.json (occasion, title,
// note, signature, when, how long) and card.png (the keepsake card). Nothing is uploaded.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { RecordingStore, readRecording } = require('./recording.cjs');

const ID = /^m\d{13}$/;
const MAX_CARD = 8 * 1024 * 1024;
const text = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
// demo / device from the recording's first line (its header), for moments saved before meta.json
// carried it: 脑电数据库 marks the simulated ones 模拟数据
async function headerSource(file) {
  let fh;
  try {
    fh = await fsp.open(file);
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(65536), 0, 65536, 0);
    const first = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
    return JSON.parse(first).source ?? null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

class MomentStore {
  constructor(dir) {
    this.dir = dir;
    this.recorder = new RecordingStore();
    this.current = null;
  }
  folder(id) {
    if (!ID.test(String(id))) throw Error('时刻编号无效');
    return path.join(this.dir, id);
  }
  ingest(event) {
    this.recorder.ingest(event);
  }
  async start(metadata, source) {
    if (this.current) throw Error('正在录制');
    const id = `m${Date.now()}`;
    const dir = this.folder(id);
    await fsp.mkdir(dir, { recursive: true });
    await this.recorder.start(path.join(dir, 'eeg.neuro.jsonl'), metadata, source);
    this.current = id;
    this.source = source;
    return { id };
  }
  async stop(id) {
    if (id !== this.current) throw Error('没有这段录制');
    const state = await this.recorder.stop();
    this.current = null;
    const meta = {
      id,
      recordedAt: new Date().toISOString(),
      seconds: state.seconds,
      samples: state.samples,
      source: this.source ?? null,
    };
    await fsp.writeFile(path.join(this.folder(id), 'meta.json'), JSON.stringify(meta, null, 2));
    return { ...meta, error: state.error };
  }
  async save(id, input) {
    const dir = this.folder(id);
    const meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'));
    Object.assign(meta, {
      scene: text(input?.scene, 20),
      sceneName: text(input?.sceneName, 20),
      title: text(input?.title, 40),
      note: text(input?.note, 80),
      sign: text(input?.sign, 32),
      start: text(input?.start, 40),
      marks: (Array.isArray(input?.marks) ? input.marks : [])
        .filter((m) => Number.isFinite(m?.t) && m.t >= 0)
        .slice(0, 8)
        .map((m) => ({ t: Math.round(m.t * 100) / 100, label: text(m.label, 16) })),
    });
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    const png =
      typeof input?.card === 'string' ? input.card.replace(/^data:image\/png;base64,/, '') : '';
    if (png) {
      const buf = Buffer.from(png, 'base64');
      if (buf.length > MAX_CARD) throw Error('卡片图片过大');
      await fsp.writeFile(path.join(dir, 'card.png'), buf);
    }
    return meta;
  }
  async list() {
    if (!fs.existsSync(this.dir)) return [];
    const out = [];
    for (const id of await fsp.readdir(this.dir)) {
      if (!ID.test(id) || id === this.current) continue;
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(this.dir, id, 'meta.json'), 'utf8'));
        if (!meta.source)
          meta.source = await headerSource(path.join(this.dir, id, 'eeg.neuro.jsonl'));
        out.push({ ...meta, id, card: fs.existsSync(path.join(this.dir, id, 'card.png')) });
      } catch {
        // an interrupted recording without meta: skipped
      }
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }
  async card(id) {
    const file = path.join(this.folder(id), 'card.png');
    return fs.existsSync(file)
      ? `data:image/png;base64,${(await fsp.readFile(file)).toString('base64')}`
      : null;
  }
  async open(id) {
    const file = path.join(this.folder(id), 'eeg.neuro.jsonl');
    const meta = JSON.parse(await fsp.readFile(path.join(this.folder(id), 'meta.json'), 'utf8'));
    return { ...(await readRecording(file)), file: meta.title || '脑电时刻' };
  }
  async remove(id) {
    if (id === this.current) throw Error('正在录制');
    await fsp.rm(this.folder(id), { recursive: true, force: true });
    return { removed: id };
  }
}

module.exports = { MomentStore };
