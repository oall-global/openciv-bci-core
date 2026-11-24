const assert = require('node:assert/strict'),
  net = require('node:net');
const { WebSocket } = require('ws');
const { DeveloperBridge, targetMetric } = require('../electron/developer.cjs');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function connect(address, options) {
  const ws = new WebSocket(address, options),
    events = [];
  ws.on('message', (b) => events.push(JSON.parse(b)));
  await new Promise((r, j) => {
    ws.once('open', r);
    ws.once('error', j);
  });
  return {
    ws,
    events,
    send: (o) => ws.send(JSON.stringify(o)),
    async wait(type) {
      for (let i = 0; i < 100; i++) {
        const at = events.findIndex((e) => e.type === type);
        if (at >= 0) return events.splice(at, 1)[0];
        await delay(10);
      }
      throw Error('Missing ' + type);
    },
  };
}
(async () => {
  const b = new DeveloperBridge(),
    p = await port();
  let c, bad;
  try {
    assert(!b.state().enabled);
    await b.start(p);
    assert.equal(b.server.address().address, '127.0.0.1');
    await assert.rejects(b.start(p));
    bad = await connect(b.state().endpoint);
    const closed = new Promise((r) => bad.ws.once('close', r));
    bad.send({ type: 'auth', token: 'bad' });
    assert.equal(await closed, 1008);
    // a web page connects, but without the key it is closed like any other client
    bad = await connect(b.state().endpoint, { origin: 'https://example.com' });
    const pageClosed = new Promise((r) => bad.ws.once('close', r));
    bad.send({ type: 'auth', token: 'bad' });
    assert.equal(await pageClosed, 1008);
    c = await connect(b.state().endpoint);
    c.send({ type: 'auth', token: b.token, clientName: 'test' });
    await c.wait('authenticated');
    c.send({ type: 'marker', label: 'before_data' });
    await c.wait('error');
    c.send({ type: 'subscribe', topics: ['eeg'], channels: [17] });
    await c.wait('error');
    c.send({
      type: 'subscribe',
      topics: ['metadata', 'status', 'quality', 'eeg', 'alpha', 'ssvep', 'marker'],
      channels: [2, 16],
      ssvepFrequencyHz: 30,
    });
    await c.wait('subscribed');
    await c.wait('status');
    await c.wait('quality');
    b.ingest({ type: 'metadata', rate: 250, channels: 16, epoch: 1, boardId: -1 });
    const meta = await c.wait('metadata');
    assert.equal(meta.payload.electrodePositions, null);
    b.ingest({ type: 'status', status: 'streaming', demo: true, epoch: 1 });
    await c.wait('status');
    const data = {
      type: 'data',
      epoch: 1,
      samples: Array.from({ length: 16 }, (_, i) => Array(300).fill(i)),
      timestamps: Array.from({ length: 300 }, (_, i) => 100 + i / 250),
      sampleNumbers: Array.from({ length: 300 }, (_, i) => i % 256),
      rail: { states: Array(16).fill('normal') },
    };
    b.ingest(data);
    await c.wait('quality');
    let eeg = await c.wait('eeg');
    assert.equal(eeg.source, 'demo');
    assert.deepEqual(eeg.payload.channels, [2, 16]);
    assert.equal(eeg.payload.samples[1][0], 15);
    assert.equal(eeg.payload.samples[0].length, 250);
    assert.equal(eeg.payload.receivedSampleStart, 0);
    eeg = await c.wait('eeg');
    assert.equal(eeg.payload.receivedSampleStart, 250);
    assert.equal(eeg.payload.timestamps.length, 50);
    const frequencies = Array.from({ length: 79 }, (_, i) => 1 + i * 0.5),
      psd = frequencies.map((f) => (Math.abs(f - 30) <= 0.5 ? 100 : 1));
    assert.equal(targetMetric(frequencies, psd, 30), 20);
    const alpha = {
      type: 'alpha',
      epoch: 1,
      timestamp: 101,
      windowSeconds: 4,
      absolute: Array(16).fill(10),
      relative: Array(16).fill(25),
      flags: Array(16).fill(''),
      frequencies,
      psd: Array.from({ length: 16 }, () => psd),
    };
    b.ingest(alpha);
    assert.equal((await c.wait('alpha')).payload.channels[0].absoluteUv2, 10);
    assert.equal((await c.wait('ssvep')).payload.channels[0].snrDb, 20);
    alpha.flags[1] = 'flat';
    b.ingest(alpha);
    assert.equal((await c.wait('alpha')).payload.channels[0].absoluteUv2, null);
    assert.equal((await c.wait('ssvep')).payload.channels[0].snrDb, null);
    // Recognition topics are delivered only to subscribers.
    const window = { type: 'decoder', epoch: 1, t: 101, scores: [0.2, 0.6], state: 'candidate' };
    const select = { type: 'command', epoch: 1, action: 'select', target: 1, label: '否', t: 101 };
    const before = c.events.length;
    b.ingest(window);
    b.ingest(select);
    await delay(30);
    assert.equal(c.events.length, before);
    c.send({
      type: 'subscribe',
      topics: [
        'metadata',
        'status',
        'quality',
        'eeg',
        'alpha',
        'ssvep',
        'marker',
        'decoder',
        'command',
      ],
      channels: [2, 16],
      ssvepFrequencyHz: 30,
    });
    await c.wait('subscribed');
    // Re-subscribing replays the current metadata, status and quality snapshot.
    await c.wait('metadata');
    await c.wait('status');
    await c.wait('quality');
    b.ingest(window);
    b.ingest({ type: 'decoder-calibration', epoch: 1, t: 102, threshold: 0.4, windows: 120 });
    b.ingest(select);
    const decoded = await c.wait('decoder');
    assert.deepEqual(decoded.payload.scores, [0.2, 0.6]);
    assert.equal(decoded.payload.kind, 'decoder');
    assert.equal((await c.wait('decoder')).payload.threshold, 0.4);
    const chosen = await c.wait('command');
    assert.equal(chosen.payload.label, '否');
    assert.equal(chosen.payload.epoch, undefined);
    b.ingest({ ...select, epoch: 99 });
    await delay(30);
    assert.equal(c.events.filter((e) => e.type === 'command').length, 0, 'other epoch dropped');
    c.send({ type: 'marker', label: 'eyes_closed' });
    const marker = await c.wait('marker');
    assert.equal(marker.payload.timing, 'host_received_unaligned');
    assert.equal(marker.payload.lastReceivedSampleIndex, 299);
    assert.equal((await c.wait('marker_ack')).payload.id, marker.payload.id);
    await delay(1800);
    assert.equal((await c.wait('quality')).payload.reason, 'data_timeout');
    assert(!b.fresh());
    b.ingest({ type: 'status', status: 'disconnected', demo: false, epoch: 1 });
    await c.wait('status');
    await c.wait('quality');
    const old = c.events.length;
    b.ingest(alpha);
    await delay(30);
    assert.equal(c.events.length, old);
    c.send({ type: 'marker', label: 'after_disconnect' });
    await c.wait('error');
    b.ingest({ type: 'metadata', epoch: 2, channels: 16, rate: 250 });
    assert.notEqual((await c.wait('metadata')).streamId, meta.streamId);
    assert.equal(b.markers.length, 0);
    const slow = {
      ws: {
        readyState: WebSocket.OPEN,
        bufferedAmount: 2 ** 21,
        close(code) {
          assert.equal(code, 1013);
          this.closed = true;
        },
        terminate() {},
      },
    };
    b.send(slow, {});
    assert(slow.ws.closed);
    const token = b.token;
    const end = new Promise((r) => c.ws.once('close', r));
    await b.stop();
    await end;
    assert(!b.state().enabled);
    await b.start(p);
    assert.notEqual(b.token, token);
    console.log(
      'PASS auth, Origin, loopback, filters, chunks, feature validity, SNR, marker, timeout, disconnect, epoch, backpressure, token rotation',
    );
  } finally {
    c?.ws.terminate();
    bad?.ws.terminate();
    await b.stop();
    clearInterval(b.timer);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
