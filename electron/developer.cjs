const { WebSocketServer, WebSocket } = require('ws');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { bandMeasures, WaveFilter } = require('./dsp.cjs');
const TOPICS = [
  'status',
  'metadata',
  'eeg',
  'alpha',
  'bands', // δ θ α β γ power, α peak and dominant frequency per channel
  'waves', // cleaned 1–40 Hz, 8–13 Hz α waveform and its amplitude
  'ssvep',
  'quality',
  'marker',
];
function targetMetric(frequencies, psd, target) {
  const signal = [],
    noise = [];
  frequencies.forEach((f, i) => {
    const d = Math.abs(f - target);
    if (d <= 0.5) signal.push(psd[i]);
    else if (d >= 2 && d <= 4) noise.push(psd[i]);
  });
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  if (!signal.length || noise.length < 4 || mean(signal) <= 1e-12 || mean(noise) <= 1e-12)
    return null;
  return 10 * Math.log10(mean(signal) / mean(noise));
}
class DeveloperBridge {
  constructor() {
    this.server = null;
    this.starting = false;
    this.token = '';
    this.port = 8765;
    this.clients = new Set();
    this.status = { status: 'disconnected', demo: false };
    this.metadata = null;
    this.streamId = null;
    this.sequence = 0;
    this.sampleIndex = 0;
    this.lastData = 0;
    this.rail = null;
    this.recent = [];
    this.markers = [];
    this.error = '';
    this.timer = setInterval(() => {
      if (this.lastData && performance.now() - this.lastData > 1500) {
        this.lastData = 0;
        this.broadcast('quality', { valid: false, reason: 'data_timeout' });
      }
    }, 250);
    this.timer.unref();
  }
  state() {
    return {
      enabled: !!this.server?.address(),
      starting: this.starting,
      port: this.port,
      endpoint: `ws://127.0.0.1:${this.port}`,
      clients: [...this.clients]
        .filter((c) => c.auth)
        .map((c) => ({ name: c.name, topics: [...c.topics] })),
      source: this.status.demo ? 'demo' : 'device',
      streamId: this.streamId,
      fresh: this.fresh(),
      recent: this.recent,
      markers: this.markers,
      error: this.error,
    };
  }
  fresh() {
    return (
      this.status.status === 'streaming' &&
      this.lastData > 0 &&
      performance.now() - this.lastData < 1500
    );
  }
  async start(port = 8765) {
    if (this.server || this.starting) throw Error('接口已经开启或正在启动');
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw Error('端口应在 1024–65535 之间');
    this.starting = true;
    this.error = '';
    this.port = port;
    this.token = randomBytes(32).toString('hex');
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port,
      maxPayload: 8192,
      perMessageDeflate: false,
      // web pages may connect too (the user's own experiments); they still need the key
      verifyClient: () => this.clients.size < 8,
    });
    this.server = server;
    server.on('connection', (ws) => this.connection(ws));
    try {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    } catch {
      this.server = null;
      this.token = '';
      throw Error('本地接口无法启动，请检查端口是否被占用');
    } finally {
      this.starting = false;
    }
    server.on('error', () => {
      this.error = '本地接口出现错误，请关闭后重新开启';
      this.stop();
    });
    this.note('接口已开启');
    return this.state();
  }
  async stop() {
    const server = this.server;
    this.server = null;
    this.token = '';
    for (const c of this.clients) {
      clearTimeout(c.timeout);
      c.ws.terminate();
    }
    this.clients.clear();
    if (server) await new Promise((resolve) => server.close(resolve));
    this.note('接口已关闭');
    return this.state();
  }
  note(text) {
    this.recent.unshift({ at: Date.now(), text });
    this.recent.length = Math.min(this.recent.length, 15);
  }
  envelope(type, payload) {
    return {
      schema: 'neurolink.v1',
      type,
      sequence: ++this.sequence,
      streamId: this.streamId,
      source: this.status.demo ? 'demo' : 'device',
      emittedAtMs: Date.now(),
      payload,
    };
  }
  send(c, event) {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    if (c.ws.bufferedAmount > 1024 * 1024) {
      c.ws.close(1013, 'Consumer too slow');
      setTimeout(() => c.ws.terminate(), 1000).unref();
      return;
    }
    c.ws.send(JSON.stringify(event));
  }
  broadcast(type, payload) {
    const event = this.envelope(type, payload);
    for (const c of this.clients) if (c.auth && c.topics.has(type)) this.send(c, event);
  }
  connection(ws) {
    if (this.clients.size >= 8) {
      ws.close(1013);
      return;
    }
    const c = {
      ws,
      auth: false,
      name: '',
      topics: new Set(),
      channels: Array.from({ length: 16 }, (_, i) => i + 1),
      frequency: 30,
      count: 0,
      window: performance.now(),
    };
    this.clients.add(c);
    c.timeout = setTimeout(() => ws.terminate(), 5000);
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(c.timeout);
      this.clients.delete(c);
      if (c.auth) this.note('客户端已断开');
    });
    ws.on('message', (bytes, binary) => {
      let request;
      try {
        if (binary) throw Error('只接受 JSON 文本');
        if (performance.now() - c.window > 1000) {
          c.window = performance.now();
          c.count = 0;
        }
        if (++c.count > 30) {
          ws.close(1008, 'Rate limit');
          return;
        }
        request = JSON.parse(bytes.toString());
        if (!request || typeof request !== 'object' || Array.isArray(request))
          throw Error('请求格式无效');
        if (!c.auth) {
          const key = Buffer.from(typeof request.token === 'string' ? request.token : '');
          const expected = Buffer.from(this.token);
          if (
            request.type !== 'auth' ||
            !expected.length ||
            key.length !== expected.length ||
            !timingSafeEqual(key, expected)
          ) {
            ws.close(1008, 'Authentication failed');
            return;
          }
          c.auth = true;
          c.name =
            typeof request.clientName === 'string'
              ? request.clientName.slice(0, 60)
              : '未命名客户端';
          clearTimeout(c.timeout);
          this.note('客户端已接入');
          this.send(c, this.envelope('authenticated', { topics: TOPICS }));
          return;
        }
        if (request.type === 'subscribe') {
          if (!Array.isArray(request.topics) || request.topics.some((t) => !TOPICS.includes(t)))
            throw Error('订阅主题无效');
          const channels = request.channels ?? Array.from({ length: 16 }, (_, i) => i + 1);
          if (
            !Array.isArray(channels) ||
            !channels.length ||
            channels.length > 16 ||
            channels.some((n) => !Number.isInteger(n) || n < 1 || n > 16) ||
            new Set(channels).size !== channels.length
          )
            throw Error('通道必须是 1–16 中不重复的整数');
          const frequency = request.ssvepFrequencyHz ?? 30;
          if (!Number.isFinite(frequency) || frequency < 5 || frequency > 36)
            throw Error('目标频率应在 5–36 Hz 之间');
          c.channels = channels;
          c.frequency = frequency;
          c.topics = new Set(request.topics);
          this.send(
            c,
            this.envelope('subscribed', {
              topics: [...c.topics],
              channels,
              ssvepFrequencyHz: frequency,
            }),
          );
          if (c.topics.has('metadata') && this.metadata)
            this.send(c, this.envelope('metadata', this.metaPayload()));
          if (c.topics.has('status')) this.send(c, this.envelope('status', this.statusPayload()));
          if (c.topics.has('quality'))
            this.send(c, this.envelope('quality', { valid: false, reason: 'await_next_frame' }));
          return;
        }
        if (request.type === 'marker') {
          const marker = this.marker(request, c.name);
          this.send(c, this.envelope('marker_ack', marker));
          return;
        }
        if (request.type === 'ping') {
          this.send(
            c,
            this.envelope('pong', {
              requestId:
                typeof request.requestId === 'string' ? request.requestId.slice(0, 64) : null,
            }),
          );
          return;
        }
        throw Error('不支持的请求');
      } catch (error) {
        this.send(c, this.envelope('error', { message: error.message }));
      }
    });
  }
  // Filtered waveforms, computed once for all channels while anyone subscribes.
  waves(data) {
    const listeners = [...this.clients].filter((c) => c.auth && c.topics.has('waves'));
    if (!listeners.length) {
      this.filters = null;
      return;
    }
    this.filters ??= data.samples.map(() => new WaveFilter(this.metadata.rate));
    const settled = this.filters[0].settled;
    const out = data.samples.map((x, i) => this.filters[i].push(x));
    for (const c of listeners)
      for (let offset = 0; offset < data.timestamps.length; offset += 250) {
        const part = (key) => c.channels.map((n) => out[n - 1][key].slice(offset, offset + 250));
        this.send(
          c,
          this.envelope('waves', {
            channels: c.channels,
            broadband: part('broadband'),
            alpha: part('alpha'),
            alphaAmplitude: part('alphaAmplitude'),
            timestamps: data.timestamps.slice(offset, offset + 250),
            receivedSampleStart: this.sampleIndex + offset,
            settled,
            unit: 'µV',
            meaning: 'causal filters: broadband 1–40 Hz with 50 Hz notch; alpha 8–13 Hz',
          }),
        );
      }
  }
  statusPayload() {
    return {
      status: this.status.status,
      valid: this.fresh(),
      reason: this.fresh() ? null : 'not_receiving_fresh_data',
    };
  }
  metaPayload() {
    return {
      ...this.metadata,
      channelNumbers: Array.from({ length: this.metadata.channels }, (_, i) => i + 1),
      electrodePositions: null,
      timestampUnit: 'unix_seconds',
      timestampMeaning: 'BrainFlow host timestamp; not verified physical stimulus onset',
      sampleUnit: 'µV',
    };
  }
  marker(request, clientName = '工作台') {
    if (!this.fresh()) throw Error('请等待有效采集后再写入标记');
    if (typeof request.label !== 'string' || !request.label.trim() || request.label.length > 120)
      throw Error('标记名称应为 1–120 个字符');
    if (request.clientTimestampMs !== undefined && !Number.isFinite(request.clientTimestampMs))
      throw Error('客户端时间无效');
    const marker = {
      id: randomUUID(),
      label: request.label.trim(),
      clientName,
      receivedAtMs: Date.now(),
      clientTimestampMs: request.clientTimestampMs ?? null,
      timing: 'host_received_unaligned',
      lastReceivedSampleIndex: this.sampleIndex - 1,
      streamId: this.streamId,
    };
    this.markers.unshift(marker);
    this.markers.length = Math.min(this.markers.length, 30);
    this.broadcast('marker', marker);
    this.onMarker?.(marker);
    this.note('收到实验标记');
    return marker;
  }
  ingest(data) {
    if (data.type === 'status') {
      this.status = data;
      if (data.status !== 'streaming') {
        this.lastData = 0;
        this.rail = null;
        this.broadcast('quality', { valid: false, reason: data.status });
      }
      this.broadcast('status', this.statusPayload());
      return;
    }
    if (data.type === 'metadata') {
      this.metadata = data;
      this.streamId = randomUUID();
      this.sampleIndex = 0;
      this.lastData = 0;
      this.rail = null;
      this.markers = [];
      this.filters = null;
      this.broadcast('metadata', this.metaPayload());
      return;
    }
    if (!this.metadata || data.epoch !== this.metadata.epoch || this.status.status !== 'streaming')
      return;
    if (data.type === 'data') {
      this.lastData = performance.now();
      this.rail = data.rail;
      this.broadcast('quality', {
        valid: true,
        meaning: 'fresh numeric samples; not proof of good electrode contact',
        rail: data.rail ?? null,
      });
      for (const c of this.clients)
        if (c.auth && c.topics.has('eeg'))
          for (let offset = 0; offset < data.timestamps.length; offset += 250) {
            this.send(
              c,
              this.envelope('eeg', {
                channels: c.channels,
                samples: c.channels.map((n) => data.samples[n - 1].slice(offset, offset + 250)),
                timestamps: data.timestamps.slice(offset, offset + 250),
                sampleNumbers: data.sampleNumbers?.slice(offset, offset + 250) ?? null,
                receivedSampleStart: this.sampleIndex + offset,
                unit: 'µV',
              }),
            );
          }
      this.waves(data);
      this.sampleIndex += data.timestamps.length;
      return;
    }
    if (data.type === 'alpha' && this.fresh()) {
      for (const c of this.clients)
        if (c.auth) {
          const channels = c.channels.map((n) => {
            const rail = this.rail?.states[n - 1];
            const reason = data.flags[n - 1] || (rail !== 'normal' ? rail || 'unknown' : null);
            return {
              channel: n,
              valid: !reason,
              reason,
              absoluteUv2: reason ? null : data.absolute[n - 1],
              relativePercent: reason ? null : data.relative[n - 1],
            };
          });
          const common = { windowEndTimestamp: data.timestamp, windowSeconds: data.windowSeconds };
          if (c.topics.has('alpha'))
            this.send(c, this.envelope('alpha', { ...common, bandHz: [8, 13], channels }));
          if (c.topics.has('bands'))
            this.send(
              c,
              this.envelope('bands', {
                ...common,
                channels: channels.map((ch) => ({
                  channel: ch.channel,
                  valid: ch.valid,
                  reason: ch.reason,
                  ...(ch.valid
                    ? bandMeasures(data.frequencies, data.psd[ch.channel - 1])
                    : { bands: null, totalUv2: null, alphaPeakHz: null, dominantHz: null }),
                })),
              }),
            );
          if (c.topics.has('ssvep'))
            this.send(
              c,
              this.envelope('ssvep', {
                ...common,
                targetFrequencyHz: c.frequency,
                meaning: 'spectral ratio only; not target recognition',
                channels: channels.map((ch) => {
                  const snr = ch.valid
                    ? targetMetric(data.frequencies, data.psd[ch.channel - 1], c.frequency)
                    : null;
                  return {
                    channel: ch.channel,
                    valid: ch.valid && snr !== null,
                    reason: ch.reason || (snr === null ? 'insufficient_spectrum' : null),
                    snrDb: snr,
                  };
                }),
              }),
            );
        }
    }
  }
}
module.exports = { DeveloperBridge, targetMetric };
