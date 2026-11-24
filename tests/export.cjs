const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionStore } = require('../electron/session.cjs');
const { exportBdf, exportBids } = require('../electron/export.cjs');

const rate = 250;
const meta = { channels: 16, rate, unit: 'µV', boardId: -1, epoch: 1 };
const who = { code: 'P001', consent: { version: 'data-notice-1', acceptedAt: 'x' } };
const value = (c, i) => 1000 * (c - 8) + 50 * Math.sin((2 * Math.PI * 10 * i) / rate) + 0.123;

function parseBdf(file) {
  const b = fs.readFileSync(file);
  const text = (from, len) => b.toString('latin1', from, from + len).trim();
  const ns = Number(text(252, 4));
  const at = (k, width, offset) => 256 + offset * ns + k * width;
  const signals = Array.from({ length: ns }, (_, k) => ({
    label: text(at(k, 16, 0), 16),
    pmin: Number(text(256 + ns * (16 + 80 + 8) + k * 8, 8)),
    pmax: Number(text(256 + ns * (16 + 80 + 16) + k * 8, 8)),
    samples: Number(text(256 + ns * (16 + 80 + 8 * 5 + 80) + k * 8, 8)),
  }));
  return {
    b,
    version: b.subarray(0, 8),
    reserved: text(192, 44),
    records: Number(text(236, 8)),
    duration: Number(text(244, 8)),
    headerBytes: Number(text(184, 8)),
    patient: text(8, 80),
    ns,
    signals,
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neurolink-export-'));
  const store = new SessionStore(path.join(tmp, 'sessions'), '0.1.29');
  const t0 = 1_790_000_000;
  const { id } = await store.start(
    { task: { id: 'alpha-eyes', version: 1, title: '看见我的脑波' }, channels: ['O1'] },
    meta,
    'demo',
    who,
  );
  // 3.5 s of data in batches; the trailing half second is padded to a whole record.
  for (let start = 0; start < rate * 3.5; start += 25) {
    store.ingest({
      type: 'data',
      epoch: 1,
      timestamps: Array.from({ length: 25 }, (_, i) => t0 + (start + i) / rate),
      sampleNumbers: Array.from({ length: 25 }, (_, i) => (start + i) % 256),
      samples: Array.from({ length: 16 }, (_, c) =>
        Array.from({ length: 25 }, (_, i) => value(c, start + i)),
      ),
      rail: { states: Array(16).fill('normal') },
    });
  }
  store.event({ label: 'segment.open', t: t0 + 0.5 });
  store.event({ label: 'segment.closed', t: t0 + 2.004 });
  store.event({ label: 'late', t: t0 + 3.2 });
  await store.finish({ summary: { headline: 'x' } });
  const sessionDir = path.join(tmp, 'sessions', id);

  // BDF
  const file = path.join(tmp, 'one.bdf');
  const out = await exportBdf(sessionDir, file);
  assert.deepEqual(out, {
    records: 4,
    seconds: 4,
    paddedSamples: 125,
    annotations: 4,
    filledSamples: 0,
    filledSeconds: 0,
  });
  await assert.rejects(exportBdf(sessionDir, file), /EEXIST/);
  const bdf = parseBdf(file);
  assert.equal(bdf.version[0], 0xff);
  assert.equal(bdf.version.toString('latin1', 1), 'BIOSEMI');
  assert.equal(bdf.reserved, 'BDF+C');
  assert.equal(bdf.patient, 'P001 X X X');
  assert.equal(bdf.records, 4);
  assert.equal(bdf.duration, 1);
  assert.equal(bdf.ns, 17);
  assert.equal(bdf.headerBytes, 256 * 18);
  assert.equal(bdf.signals[0].label, 'Fp1');
  assert.equal(bdf.signals[15].label, 'P4');
  assert.equal(bdf.signals[16].label, 'BDF Annotations');
  assert.equal(bdf.signals[0].pmax, 187500);
  const ann = bdf.signals[16].samples;
  const recordBytes = (16 * rate + ann) * 3;
  assert.equal(bdf.b.length, bdf.headerBytes + 4 * recordBytes);
  // Decode channel 3 (C4), record 1, sample 17 and compare with the source value.
  const resolution = (2 * 187500) / (8388607 + 8388608);
  const offset = bdf.headerBytes + recordBytes + (3 * rate + 17) * 3;
  const digital = bdf.b.readIntLE(offset, 3);
  const physical = (digital + 8388608) * resolution - 187500;
  assert.ok(Math.abs(physical - value(3, rate + 17)) <= resolution, `${physical}`);
  const annText = bdf.b.toString('latin1', bdf.headerBytes, bdf.b.length);
  assert.ok(annText.includes('+0\x14\x14\x00+0.5\x150\x14segment.open\x14\x00'));
  assert.ok(annText.includes('+2.004\x150\x14segment.closed'));
  assert.ok(annText.includes('late'), 'event in the last partial second is kept');
  assert.ok(annText.includes('+3.5\x150.5\x14BAD_padding'));

  // BIDS
  const bids = path.join(tmp, 'bids');
  const result = await exportBids([sessionDir], bids, '0.1.29');
  assert.equal(result.sessions, 1);
  assert.equal(result.participants, 1);
  const base = path.join(bids, 'sub-P001', `ses-${id.slice(0, 15).replace('-', '')}`, 'eeg');
  const prefix = `sub-P001_ses-${id.slice(0, 15).replace('-', '')}_task-alphaeyes`;
  for (const suffix of ['_eeg.bdf', '_eeg.json', '_channels.tsv', '_events.tsv', '_events.json'])
    assert.ok(fs.existsSync(path.join(base, prefix + suffix)), prefix + suffix);
  const sidecar = JSON.parse(fs.readFileSync(path.join(base, `${prefix}_eeg.json`), 'utf8'));
  assert.equal(sidecar.SamplingFrequency, 250);
  assert.equal(sidecar.EEGChannelCount, 16);
  const eventsTsv = fs
    .readFileSync(path.join(base, `${prefix}_events.tsv`), 'utf8')
    .trim()
    .split('\n');
  assert.equal(eventsTsv[0], 'onset\tduration\tsample\ttrial_type\tsource');
  assert.equal(eventsTsv.length, 5);
  assert.equal(eventsTsv[1], '0.5000\t0\t125\tsegment.open\tunknown');
  assert.equal(eventsTsv[4], '3.5000\t0.5000\t875\tBAD_padding\tdata_quality');
  assert.ok(
    fs
      .readFileSync(path.join(base, `${prefix}_channels.tsv`), 'utf8')
      .includes('Fp1\tEEG\tµV\tn/a\tn/a\tgood\tn/a'),
  );
  assert.equal(sidecar.EEGReference, 'SRB2, reference electrode on the top of the head');
  const sourcedata = path.join(
    bids,
    'sourcedata',
    'sub-P001',
    `ses-${id.slice(0, 15).replace('-', '')}`,
  );
  assert.ok(fs.existsSync(path.join(sourcedata, 'eeg.csv')), 'original session kept in sourcedata');
  assert.ok(fs.readFileSync(path.join(bids, 'participants.tsv'), 'utf8').includes('sub-P001'));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(bids, 'dataset_description.json'), 'utf8')).BIDSVersion,
    '1.9.0',
  );
  await assert.rejects(exportBids([sessionDir], bids, '0.1.29'), /已存在/);

  // Lost samples: 50 samples missing after 1 s (the acquisition clock skips their times).
  // The export fills them with zeros marked BAD_gap, so later samples and events keep their
  // time; channel O2 railed throughout is marked bad.
  const { id: gapId } = await store.start(
    { task: { id: 'gap', version: 1, title: 'gap' }, channels: [] },
    meta,
    'demo',
    who,
  );
  const kept = [...Array(rate * 3).keys()].filter((k) => k < rate || k >= rate + 50);
  for (let b = 0; b < kept.length; b += 25) {
    const ks = kept.slice(b, b + 25);
    store.ingest({
      type: 'data',
      epoch: 1,
      timestamps: ks.map((k) => t0 + 100 + k / rate),
      sampleNumbers: ks.map((k) => k % 256),
      samples: Array.from({ length: 16 }, (_, c) => ks.map((k) => value(c, k))),
      rail: { states: Array.from({ length: 16 }, (_, c) => (c === 7 ? 'railed' : 'normal')) },
    });
  }
  store.event({ label: 'cue.after', t: t0 + 100 + 2 });
  const gapDone = await store.finish({ summary: { headline: 'x' } });
  assert.deepEqual(gapDone.info.gaps, [{ sample: rate, lost: 50 }]);
  assert.equal(gapDone.info.quality.railed[7], 1);
  const gapBids = path.join(tmp, 'bids-gap');
  await exportBids([path.join(tmp, 'sessions', gapId)], gapBids, '0.1.29');
  const gapBase = path.join(
    gapBids,
    'sub-P001',
    `ses-${gapId.slice(0, 15).replace('-', '')}`,
    'eeg',
  );
  const gapPrefix = `sub-P001_ses-${gapId.slice(0, 15).replace('-', '')}_task-gap`;
  const gapEvents = fs.readFileSync(path.join(gapBase, `${gapPrefix}_events.tsv`), 'utf8');
  assert.ok(gapEvents.includes('1.0000\t0.2000\t250\tBAD_gap\tdata_quality'), gapEvents);
  assert.ok(gapEvents.includes('2.0000\t0\t500\tcue.after\tinstruction'), gapEvents);
  const gapSidecar = JSON.parse(
    fs.readFileSync(path.join(gapBase, `${gapPrefix}_eeg.json`), 'utf8'),
  );
  assert.equal(gapSidecar.openciv_bci_filled_samples, 50);
  assert.ok(
    fs
      .readFileSync(path.join(gapBase, `${gapPrefix}_channels.tsv`), 'utf8')
      .includes('O2\tEEG\tµV\tn/a\tn/a\tbad\trailed or flat in 100% of seconds'),
  );

  if (process.argv.includes('--keep')) console.log('kept', tmp);
  else fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    'PASS export: BDF+C header, 24-bit values, annotations, tail padding, BIDS layout, event sources, lost samples filled (BAD_gap), bad channels, sourcedata',
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
