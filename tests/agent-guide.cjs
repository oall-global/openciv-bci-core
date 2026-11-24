// The interface description for AI agents: the messages it documents work against the bridge.
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { DeveloperBridge } = require('../electron/developer.cjs');
const { agentGuide } = require('../electron/agentguide.cjs');
(async () => {
  const bridge = new DeveloperBridge();
  await bridge.start(18766);
  const text = agentGuide({ endpoint: bridge.state().endpoint, token: bridge.token });
  assert.match(text, /ws:\/\/127\.0\.0\.1:18766/);
  assert.doesNotMatch(text, /task|任务|能力/);
  const blocks = [...text.matchAll(/```json\n(.+)\n```/g)].map((m) => JSON.parse(m[1]));
  const auth = blocks.find((b) => b.type === 'auth'),
    sub = blocks.find((b) => b.type === 'subscribe');
  const ws = new WebSocket(bridge.state().endpoint),
    got = [];
  ws.on('message', (b) => got.push(JSON.parse(b)));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify(auth));
  ws.send(JSON.stringify(sub));
  for (let i = 0; i < 100 && !got.some((e) => e.type === 'subscribed'); i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got.map((e) => e.type).slice(0, 2), ['authenticated', 'subscribed']);
  // All signals on the same interface: band measures and filtered waveforms.
  ws.send(JSON.stringify({ type: 'subscribe', topics: ['bands', 'waves'], channels: [15, 16] }));
  for (let i = 0; i < 100 && got.filter((e) => e.type === 'subscribed').length < 2; i++)
    await new Promise((r) => setTimeout(r, 20));
  bridge.ingest({ type: 'status', status: 'streaming', demo: true });
  bridge.ingest({ type: 'metadata', epoch: 1, rate: 250, channels: 16 });
  const ts = Array.from({ length: 250 }, (_, i) => 1000 + i / 250);
  bridge.ingest({
    type: 'data',
    epoch: 1,
    timestamps: ts,
    samples: Array.from({ length: 16 }, () => ts.map((t) => 20 * Math.sin(2 * Math.PI * 10 * t))),
    rail: { states: Array(16).fill('normal') },
  });
  const f = Array.from({ length: 79 }, (_, i) => 1 + i / 2);
  bridge.ingest({
    type: 'alpha',
    epoch: 1,
    timestamp: ts.at(-1),
    windowSeconds: 4,
    flags: Array(16).fill(''),
    absolute: Array(16).fill(1),
    relative: Array(16).fill(50),
    frequencies: f,
    psd: Array.from({ length: 16 }, () => f.map((x) => 1 / x + 5 * Math.exp(-((x - 10) ** 2)))),
  });
  for (
    let i = 0;
    i < 100 && !(got.some((e) => e.type === 'bands') && got.some((e) => e.type === 'waves'));
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  const bands = got.find((e) => e.type === 'bands').payload,
    waves = got.find((e) => e.type === 'waves').payload;
  assert.deepEqual(
    bands.channels.map((c) => c.channel),
    [15, 16],
  );
  assert.equal(bands.channels[0].alphaPeakHz, 10);
  assert.ok(bands.channels[0].bands.alpha.relativePercent > 50);
  assert.deepEqual(waves.channels, [15, 16]);
  assert.equal(waves.alpha[0].length, 250);
  assert.equal(waves.settled, false);
  assert.match(text, /\| bands \|/);
  assert.match(text, /\| waves \|/);
  ws.close();
  await bridge.stop();
  console.log('PASS agent guide: documented auth and subscribe work, bands and waves');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
