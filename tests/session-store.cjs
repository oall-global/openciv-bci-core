const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionStore, sampleAt } = require('../electron/session.cjs');

const meta = { channels: 16, rate: 250, unit: 'µV', boardId: -1, epoch: 3 };
const task = {
  task: { id: 'blink', version: 1, title: '认识眨眼和咬牙' },
  channels: ['Fp1', 'T7'],
};
function batch(start, n, t0, epoch = 3) {
  return {
    type: 'data',
    epoch,
    timestamps: Array.from({ length: n }, (_, i) => t0 + (start + i) / 250),
    sampleNumbers: Array.from({ length: n }, (_, i) => (start + i) % 256),
    samples: Array.from({ length: 16 }, (_, c) => Array.from({ length: n }, (_, i) => c + i / 10)),
    rail: { states: Array(16).fill('normal') },
    transport: { estimatedLost: 2, duplicates: 0, ambiguous: 0 },
    // Acquisition times above; data arrives 2 s later (a Wi-Fi backlog).
    received: Array.from({ length: n }, (_, i) => t0 + 2 + (start + i) / 250),
    clock: { driftPpm: 12, lost: 1, resets: 0, latency: 2 },
  };
}
const who = { code: 'P001', consent: { version: 'data-notice-1', acceptedAt: 'x' } };
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

(async () => {
  // Alignment helper.
  const ts = new Float64Array([10, 10.004, 10.008, 10.012]);
  assert.equal(sampleAt(ts, 4, 10.005), 2);
  assert.equal(sampleAt(ts, 4, 9.5), 0);
  assert.equal(sampleAt(ts, 4, 8), null);
  assert.equal(sampleAt(ts, 0, 10), null);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neurolink-sessions-'));
  const store = new SessionStore(root, '0.1.29');

  // Validation.
  await assert.rejects(
    store.start({ task: { id: 'Bad Id', version: 1, title: 'x' } }, meta, 'demo', who),
  );
  await assert.rejects(store.start({ ...task, channels: ['Cz'] }, meta, 'demo', who));
  await assert.rejects(store.start(task, null, 'demo', who));
  await assert.rejects(store.start(task, meta, 'demo', null), /被试/);

  // Completed session.
  const t0 = 1_700_000_000;
  const { id } = await store.start(task, meta, 'demo', who);
  await assert.rejects(store.start(task, meta, 'demo', who), /当前任务/);
  store.ingest(batch(0, 250, t0));
  store.ingest(batch(0, 10, t0, 99)); // other epoch ignored
  store.event({ label: 'cue.blink', t: t0 + 0.5, data: { round: 1 } });
  assert.throws(() => store.event({ label: 'bad label!', t: t0 }), /事件名称/);
  assert.throws(() => store.event({ label: 'x', t: t0, source: 'guess' }), /事件来源/);
  store.ingest(batch(250, 250, t0));
  const done = await store.finish({ summary: { detected: 3 }, detail: [1, 2, 3] }, t0 + 1.9);
  const dir = path.join(root, id);
  const info = JSON.parse(read(dir, 'session.json'));
  assert.equal(info.status, 'completed');
  assert.equal(info.samples, 500);
  assert.equal(info.durationSeconds, 2);
  assert.deepEqual(info.results, { detected: 3 });
  assert.deepEqual(info.channelsUsed, ['Fp1', 'T7']);
  assert.equal(info.electrodes[6], 'O1');
  assert.equal(info.participant.code, 'P001');
  assert.deepEqual(info.transport, { estimatedLost: 0, duplicates: 0, ambiguous: 0 });
  assert.equal(info.version, 2);
  assert.deepEqual(info.clock, {
    driftPpm: 12,
    latencyMax: 2,
    latencyEnd: 2,
    lostSamples: 0,
    restarts: 0,
  });
  const csv = read(dir, 'eeg.csv').trim().split('\n');
  assert.equal(csv.length, 501);
  assert.ok(csv[0].startsWith('sample,timestamp,package,Fp1,Fp2,C3'));
  assert.ok(csv[0].endsWith(',P4,received'));
  assert.ok(csv[1].startsWith('0,1700000000.000000,0,0.000,1.000'));
  assert.ok(csv[1].endsWith(',15.000,1700000002.000000'));
  const events = read(dir, 'events.jsonl').trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 1);
  assert.equal(events[0].sample, 125);
  assert.equal(events[0].source, 'instruction');
  assert.deepEqual(info.gaps, []);
  assert.equal(info.quality.seconds > 0, true);
  assert.equal(done.events[0].sample, 125);
  assert.ok(read(dir, 'quality.jsonl').includes('"rail"'));
  assert.deepEqual(JSON.parse(read(dir, 'results.json')).detail, [1, 2, 3]);

  // Finishing waits for data still in transit, so the last events and samples are kept.
  const late = await store.start(task, meta, 'device', who);
  store.ingest(batch(0, 250, t0 + 20));
  store.event({ label: 'cue.last', t: t0 + 21.5 });
  const finishing = store.finish({ summary: {} }, t0 + 21.8);
  setTimeout(() => store.ingest(batch(250, 250, t0 + 20)), 100);
  const lateDone = await finishing;
  assert.equal(lateDone.info.samples, 500);
  assert.equal(lateDone.events[0].sample, 375);
  await store.remove(late.id);

  // Signal loss aborts, keeps raw data, marks status.
  const second = await store.start(task, meta, 'device', who);
  store.ingest(batch(0, 100, t0 + 10));
  store.ingest({ type: 'status', status: 'stale' }); // a delivery stall does not end it
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.state().active, true);
  store.ingest({ type: 'status', status: 'reconnecting' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.state().active, false);
  const aborted = JSON.parse(read(path.join(root, second.id), 'session.json'));
  assert.equal(aborted.status, 'aborted');
  assert.match(aborted.abortReason, /信号中断/);
  assert.equal(aborted.samples, 100);

  // Listing and deletion.
  const list = await store.list();
  assert.equal(list.length, 2);
  assert.ok(list.some((s) => s.status === 'aborted' && s.source === 'device'));
  assert.throws(() => store.dirOf('../etc'), /会话编号/);
  assert.ok(list.every((s) => s.participant === 'P001'));
  await store.remove(id);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.removeParticipant('P001'), 1);
  assert.equal((await store.list()).length, 0);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    'PASS session store: validation, csv rows, sample alignment, abort on signal loss, list/delete',
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
