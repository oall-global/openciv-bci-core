const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const MAX_BYTES = 128 * 1024 * 1024;
class RecordingStore {
  constructor() {
    this.stream = null;
    this.file = null;
    this.bytes = 0;
    this.samples = 0;
    this.error = '';
    this.started = 0;
    this.closing = null;
  }
  state() {
    return {
      recording: !!this.stream,
      file: this.file,
      bytes: this.bytes,
      samples: this.samples,
      error: this.error,
      seconds: this.started ? (performance.now() - this.started) / 1000 : 0,
    };
  }
  async start(file, metadata, source) {
    if (this.stream || this.closing) throw Error('请先结束当前录制');
    this.file = file;
    this.error = '';
    this.bytes = 0;
    this.samples = 0;
    this.started = performance.now();
    const stream = fs.createWriteStream(file, { flags: 'wx' });
    await new Promise((resolve, reject) => {
      stream.once('open', resolve);
      stream.once('error', reject);
    });
    this.stream = stream;
    stream.on('error', () => {
      this.error = '文件写入失败，录制已停止';
      this.stream = null;
      stream.destroy();
    });
    this.write({
      format: 'neurolink-recording',
      version: 1,
      createdAt: new Date().toISOString(),
      metadata,
      source,
    });
    return this.state();
  }
  write(row) {
    if (!this.stream) return;
    const line = JSON.stringify(row) + '\n',
      size = Buffer.byteLength(line);
    if (this.bytes + size > MAX_BYTES || this.stream.writableLength > 8 * 1024 * 1024) {
      this.error = '达到单文件128 MB上限或磁盘写入过慢，录制已停止';
      void this.stop();
      return;
    }
    this.bytes += size;
    this.stream.write(line);
  }
  ingest(event) {
    if (!this.stream) return;
    if (event.type === 'metadata' || (event.type === 'status' && event.status !== 'streaming')) {
      this.write({ ms: performance.now() - this.started, event });
      void this.stop();
      return;
    }
    if (!['data', 'alpha', 'marker', 'transport'].includes(event.type)) return;
    this.write({ ms: performance.now() - this.started, event });
    if (event.type === 'data') this.samples += event.timestamps.length;
  }
  async stop() {
    if (this.closing) {
      await this.closing;
      return this.state();
    }
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      this.closing = new Promise((resolve) => {
        stream.once('close', resolve);
        stream.end();
      });
      await this.closing;
      this.closing = null;
      this.onStopped?.();
    }
    return this.state();
  }
}
function validateRecording(text) {
  const lines = text.trim().split('\n');
  const header = JSON.parse(lines.shift());
  const m = header.metadata;
  if (
    header.format !== 'neurolink-recording' ||
    header.version !== 1 ||
    !m ||
    m.channels !== 16 ||
    ![125, 250, 500, 1000].includes(m.rate) ||
    !Number.isInteger(m.epoch)
  )
    throw Error('不支持的录制格式');
  let last = -1,
    samples = 0;
  const events = [];
  const finiteArray = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  for (const line of lines) {
    const row = JSON.parse(line);
    if (!Number.isFinite(row.ms) || row.ms < last || row.ms > 24 * 3600000 || !row.event)
      throw Error('录制时间无效');
    last = row.ms;
    const e = row.event;
    if (e.type === 'data') {
      const n = e.timestamps?.length;
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        n > m.rate * 10 ||
        !finiteArray(e.timestamps, n) ||
        !Array.isArray(e.samples) ||
        e.samples.length !== 16 ||
        !e.samples.every((a) => finiteArray(a, n)) ||
        !finiteArray(e.rms, 16) ||
        !Array.isArray(e.quality) ||
        e.quality.length !== 16
      )
        throw Error('录制脑电数据损坏');
      samples += n;
    } else if (e.type === 'alpha') {
      if (
        !Array.isArray(e.frequencies) ||
        e.frequencies.length > 2048 ||
        !finiteArray(e.frequencies, e.frequencies.length) ||
        !Array.isArray(e.psd) ||
        e.psd.length !== 16 ||
        !e.psd.every((a) => finiteArray(a, e.frequencies.length)) ||
        !finiteArray(e.relative, 16) ||
        !finiteArray(e.absolute, 16) ||
        !Array.isArray(e.flags) ||
        e.flags.length !== 16
      )
        throw Error('录制频谱数据损坏');
    } else if (!['marker', 'status', 'transport'].includes(e.type)) continue;
    if (e.type === 'marker' && (typeof e.label !== 'string' || e.label.length > 120))
      throw Error('标记格式错误');
    if (['data', 'alpha'].includes(e.type) && e.epoch !== m.epoch)
      throw Error('文件包含不同采集会话');
    events.push(row);
  }
  if (!samples) throw Error('文件中没有脑电样本');
  return { header, events, duration: last, samples };
}
async function readRecording(file) {
  const stat = await fsp.stat(file);
  if (stat.size > MAX_BYTES) throw Error('文件超过128 MB，请分段录制');
  return validateRecording(await fsp.readFile(file, 'utf8'));
}
module.exports = { RecordingStore, readRecording, validateRecording };
