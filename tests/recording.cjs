const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { RecordingStore, readRecording, validateRecording } = require('../electron/recording.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuro-recording-')),
    file = path.join(dir, 'roundtrip.jsonl'),
    r = new RecordingStore();
  const metadata = { channels: 16, rate: 250, epoch: 1 };
  await r.start(file, metadata, 'demo');
  r.ingest({
    type: 'data',
    epoch: 1,
    timestamps: [1, 2],
    samples: Array.from({ length: 16 }, () => [3, 4]),
    rms: Array(16).fill(1),
    quality: Array(16).fill('unknown'),
  });
  r.ingest({ type: 'marker', label: 'eyes closed', id: 'test' });
  await r.stop();
  const value = await readRecording(file);
  assert.equal(value.samples, 2);
  assert.equal(value.events[1].event.label, 'eyes closed');
  assert.equal(r.state().recording, false);
  await assert.rejects(() => r.start(file, metadata, 'demo'));
  const raw = fs.readFileSync(file, 'utf8');
  assert.throws(() => validateRecording(raw.replace('"channels":16', '"channels":99')));
  assert.throws(() => validateRecording(raw.replace('"timestamps":[1,2]', '"timestamps":[1]')));
  assert.throws(() =>
    validateRecording(raw.replace('"epoch":1,"timestamps"', '"epoch":2,"timestamps"')),
  );
  fs.unlinkSync(file);
  fs.rmdirSync(dir);
  console.log(
    'PASS recording roundtrip, markers, stop/flush, existing-file protection, schema and epoch validation',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
