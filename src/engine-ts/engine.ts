// The TypeScript engine: the same events as engine/main.py (status, metadata, data, alpha) from
// a source of samples — the simulated device, or the Wi-Fi Shield on the phone.
import { AlphaStream } from './spectral';
import { checkRails } from './rail';
import { assess, demo as demoContact, unworn, Wear } from './contact';
import { emgRms } from './emg';
import { CHANNEL, WearProbe, type ProbeIO } from './wearprobe';
import { DemoSource } from './demo';

export type Emit = (event: Record<string, unknown>) => void;
export type OnSamples = (samples: number[][], indices: number[]) => void;
export interface Source {
  demo: boolean;
  rate: number;
  start(on: OnSamples): Promise<void>;
  stop(): Promise<void>;
  probe?: ProbeIO; // lead-off commands (real device only)
  setDemoState?(index: number | null): void;
}

// The simulated device, delivering 50 ms batches.
export class DemoDevice implements Source {
  demo = true;
  private gen: DemoSource;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(public rate = 250) {
    this.gen = new DemoSource(rate, 1);
  }
  async start(on: OnSamples) {
    let due = performance.now(),
      sent = 0;
    this.timer = setInterval(() => {
      const want = Math.floor(((performance.now() - due) / 1000) * this.rate) - sent;
      if (want <= 0) return;
      sent += want;
      const { samples, indices } = this.gen.next(want);
      on(samples, indices);
    }, 50);
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  setDemoState(index: number | null) {
    this.gen.setState(index);
  }
}

export class Engine {
  epoch = 0;
  status = {
    type: 'status',
    status: 'disconnected',
    detail: '连接设备，开始探索',
    demo: false,
    epoch: 0,
  };
  metadata: Record<string, unknown> | null = null;
  private source: Source | null = null;
  private rate = 250;
  private history: number[][] = [];
  private railHistory: number[][] = [];
  private alpha = new AlphaStream(250);
  private k = 0;
  private lastIndex: number | null = null;
  private t0 = 0;
  private contact: Record<string, unknown> | null = null;
  private contactAt = 0;
  private emg: number[] | null = null;
  private emgAt = 0;
  private wear = new Wear();
  private wornOnce = false; // the 30 s first confirmation is needed once per app run
  private probe: WearProbe | null = null;
  private received = false;
  // how often the spectrum and EMG are computed (s): the mini program on a phone without JIT
  // takes them less often (src/wechat/core.ts); the computation itself is the same
  constructor(
    private emit: Emit,
    private every = { spectrum: 0.25, emg: 0.25 },
  ) {
    this.alpha = new AlphaStream(250, every.spectrum);
  }

  private state(status: string, detail = '') {
    this.status = { type: 'status', status, detail, demo: !!this.source?.demo, epoch: this.epoch };
    this.emit(this.status);
  }

  async connect(source: Source) {
    await this.disconnect();
    this.epoch += 1;
    this.source = source;
    this.rate = source.rate;
    this.history = Array.from({ length: 16 }, () => []);
    this.railHistory = Array.from({ length: 16 }, () => []);
    this.alpha = new AlphaStream(this.rate, this.every.spectrum);
    this.k = 0;
    this.lastIndex = null;
    this.t0 = 0;
    this.contact = null;
    this.emg = null;
    this.received = false;
    this.wear = new Wear(this.wornOnce);
    this.probe = source.probe ? new WearProbe(source.probe, this.rate) : null;
    this.state('connecting', '正在建立连接并等待数据');
    this.metadata = {
      type: 'metadata',
      rate: this.rate,
      channels: 16,
      unit: 'µV',
      boardId: source.demo ? -1 : 6,
      epoch: this.epoch,
      accelChannels: 0,
    };
    this.emit(this.metadata);
    try {
      await source.start((s, i) => this.push(s, i));
    } catch (e) {
      this.source = null;
      this.state('error', (e as Error).message || '连接失败');
      throw e;
    }
  }

  async disconnect() {
    const s = this.source;
    this.source = null;
    if (s) {
      if (this.probe?.active) await this.probe.stop().catch(() => {});
      await s.stop().catch(() => {});
      this.state('disconnected', '已断开连接');
    }
  }

  setDemoState(index: number | null) {
    this.source?.setDemoState?.(index);
  }

  private push(samples: number[][], indices: number[]) {
    // the source for this whole update: a listener may disconnect while it is being handled
    const source = this.source;
    if (!source) return;
    const n = samples[0]?.length ?? 0;
    if (!n) return;
    const now = Date.now() / 1000;
    // acquisition time from the sample counter (lost samples counted from index jumps)
    const timestamps: number[] = [];
    for (const idx of indices) {
      if (this.lastIndex !== null) {
        const step = (idx - this.lastIndex + 256) % 256;
        this.k += step > 0 && step < 128 ? step : 1;
      }
      this.lastIndex = idx;
      if (!this.t0) this.t0 = now - n / this.rate;
      timestamps.push(this.t0 + this.k / this.rate);
    }
    if (!this.received) {
      this.received = true;
      this.state('streaming', source.demo ? '正在接收模拟数据' : '正在接收真实设备信号');
    }
    const keep = (rows: number[][], seconds: number) =>
      samples.forEach((s, c) => {
        rows[c].push(...s);
        const max = Math.round(this.rate * seconds);
        if (rows[c].length > max) rows[c].splice(0, rows[c].length - max);
      });
    keep(this.railHistory, 3);
    keep(this.history, 2);
    if (this.probe?.active) this.probe.feed(samples[CHANNEL]);

    const a = this.alpha.push(samples, timestamps, now);
    if (a) this.emit({ type: 'alpha', epoch: this.epoch, at: now, ...a });

    const rail = checkRails(this.railHistory, this.rate);
    if (now - this.contactAt >= 1) {
      this.contactAt = now;
      const c: Record<string, unknown> = assess(this.history, this.rate, rail.states);
      const probe = this.probe;
      this.wear.useProbe = !!probe?.usable() && !this.wornOnce;
      if (probe?.active && probe.measure()) void probe.stop().then(() => this.wear.probed());
      Object.assign(c, this.wear.update(rail.percentages), { probe: probe?.report() ?? null });
      unworn(c);
      if (
        this.wear.useProbe &&
        this.wear.state !== true &&
        !this.wear.probeOk &&
        probe &&
        !probe.active
      )
        void probe.start();
      this.wornOnce ||= this.wear.again;
      if (this.wornOnce && probe?.active) void probe.stop();
      this.contact = source.demo ? { ...c, ...demoContact(Array(16).fill('good')), worn: true } : c;
    }
    if (now - this.emgAt >= this.every.emg) {
      this.emgAt = now;
      const e = emgRms(this.history, this.rate);
      this.emg = e ? e.map((v) => Math.round(v * 1000) / 1000) : null;
    }
    const rms = this.history.map((r) => {
      const m = r.reduce((x, y) => x + y, 0) / Math.max(1, r.length);
      return (
        Math.round(
          Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, r.length)) * 1000,
        ) / 1000
      );
    });
    this.emit({
      type: 'data',
      epoch: this.epoch,
      samples,
      timestamps,
      received: timestamps.map(() => now),
      sampleNumbers: indices,
      rms,
      quality: Array(16).fill(source.demo ? 'good' : 'unknown'),
      contact: this.contact,
      rail,
      emg: this.emg,
      emgAt: this.emgAt,
      windowSeconds: 2,
      at: now,
    });
  }
}

export { DemoSource };
