// Export task sessions to BDF (24-bit, BDF+C annotations) and to a BIDS EEG dataset.
// See docs/session-format.md for the source format.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { findGaps, sourceOf } = require('./session.cjs');

// Full scale of the ADS1299 at the default gain 24 (4.5 V reference): ±187500 µV.
const FULL_SCALE_UV = 187500;
const DIG_MIN = -8388608,
  DIG_MAX = 8388607;

async function readSession(dir) {
  const info = JSON.parse(await fsp.readFile(path.join(dir, 'session.json'), 'utf8'));
  const lines = (await fsp.readFile(path.join(dir, 'eeg.csv'), 'utf8')).trim().split('\n');
  const header = lines.shift().split(',');
  const columns = info.electrodes.map((name) => header.indexOf(name));
  if (columns.some((c) => c < 0)) throw Error('会话数据列不完整');
  const n = lines.length;
  const data = info.electrodes.map(() => new Float64Array(n));
  const timestamps = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = lines[i].split(',');
    timestamps[i] = Number(row[1]);
    for (let c = 0; c < columns.length; c++) data[c][i] = Number(row[columns[c]]);
  }
  const jsonl = async (name) => {
    try {
      return (await fsp.readFile(path.join(dir, name), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  // sessions recorded before events carried a source: derived from the label
  const events = (await jsonl('events.jsonl')).map((e) => ({
    ...e,
    source: e.source ?? sourceOf(e.label),
  }));
  return { info, data, timestamps, events, quality: await jsonl('quality.jsonl') };
}

// The signal on a continuous time axis for export: samples lost in transport become zero
// placeholders marked BAD_gap, so everything after a gap keeps its time; a restarted sample
// count is marked BAD_discontinuity. index[i] = exported position of eeg.csv row i.
function continuous(data, timestamps, rate) {
  const n = timestamps.length,
    gaps = findGaps(timestamps, n, rate);
  const index = new Int32Array(n),
    marks = [];
  let added = 0,
    g = 0;
  for (let i = 0; i < n; i++) {
    for (; g < gaps.length && gaps[g].sample === i; g++) {
      const lost = gaps[g].lost;
      marks.push({
        onset: (i + added) / rate,
        duration: lost ? lost / rate : 0,
        text: lost ? 'BAD_gap' : 'BAD_discontinuity',
      });
      added += lost ?? 0;
    }
    index[i] = i + added;
  }
  const out = data.map((channel) => {
    const a = new Float64Array(n + added);
    for (let i = 0; i < n; i++) a[index[i]] = channel[i];
    return a;
  });
  return {
    data: out,
    index,
    marks,
    filled: added,
    discontinuities: marks.filter((m) => !m.duration).length,
  };
}

// Channels railed or flat for more than half of the recorded seconds are marked bad.
function channelStatus(quality, count) {
  const rows = quality.filter((q) => Array.isArray(q.rail));
  return Array.from({ length: count }, (_, c) => {
    const bad = rows.filter((q) => ['railed', 'flat'].includes(q.rail[c])).length;
    const share = rows.length ? bad / rows.length : 0;
    return share > 0.5
      ? ['bad', `railed or flat in ${Math.round(share * 100)}% of seconds`]
      : ['good', 'n/a'];
  });
}

const field = (value, width) => {
  const text = String(value).replace(/[^\x20-\x7e]/g, '_');
  if (text.length > width) throw Error(`BDF 头字段过长：${text}`);
  return text.padEnd(width, ' ');
};
const number = (value, width) => {
  let text = String(value);
  if (text.length > width) text = Number(value).toPrecision(width - 2);
  return field(text, width);
};
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const two = (n) => String(n).padStart(2, '0');

// TAL (time-stamped annotation list) bytes for one data record.
function talBytes(onset, notes) {
  const sign = (t) => (t >= 0 ? '+' : '') + t.toFixed(4).replace(/\.?0+$/, '');
  let text = `${sign(onset)}\x14\x14\x00`;
  for (const a of notes)
    text += `${sign(a.onset)}\x15${a.duration.toFixed(4).replace(/\.?0+$/, '') || '0'}\x14${a.text}\x14\x00`;
  return Buffer.from(text, 'latin1');
}

/**
 * Write a BDF+C file. data: channels x samples in µV. BDF holds whole 1 s records: a trailing
 * partial second is padded with zeros and marked BAD_padding, so no data or event is lost.
 */
function writeBdf(file, { rate, labels, data, start, patient, recording, annotations = [] }) {
  const n = data[0].length;
  if (n < 1) throw Error('没有数据，无法导出');
  const records = Math.ceil(n / rate);
  if (records * rate > n)
    annotations = [
      ...annotations,
      { onset: n / rate, duration: (records * rate - n) / rate, text: 'BAD_padding' },
    ];
  const kept = annotations
    .filter((a) => a.onset >= 0 && a.onset < records)
    .map((a) => ({ ...a, text: a.text.replace(/[^\x20-\x7e]/g, '_').slice(0, 60) }));
  const byRecord = Array.from({ length: records }, () => []);
  for (const a of kept) byRecord[Math.floor(a.onset)].push(a);
  const talSizes = byRecord.map((notes, r) => talBytes(r, notes).length);
  const annSamples = Math.max(16, Math.ceil(Math.max(...talSizes) / 3));

  const peak = Math.max(
    FULL_SCALE_UV,
    ...data.map((ch) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)),
  );
  const physMax = Math.ceil(peak),
    physMin = -physMax;
  const ns = labels.length + 1;
  const signals = [
    ...labels.map((label) => ({
      label,
      transducer: 'Passive dry electrode',
      dim: 'uV',
      pmin: physMin,
      pmax: physMax,
      prefilter: 'None',
      samples: rate,
    })),
    {
      label: 'BDF Annotations',
      transducer: '',
      dim: '',
      pmin: -1,
      pmax: 1,
      prefilter: '',
      samples: annSamples,
    },
  ];
  const date = `${two(start.getDate())}.${two(start.getMonth() + 1)}.${two(start.getFullYear() % 100)}`;
  const time = `${two(start.getHours())}.${two(start.getMinutes())}.${two(start.getSeconds())}`;
  const startdate = `${two(start.getDate())}-${MONTHS[start.getMonth()]}-${start.getFullYear()}`;
  let head =
    field(patient, 80) +
    field(`Startdate ${startdate} X X ${recording}`, 80) +
    date +
    time +
    number(256 * (ns + 1), 8) +
    field('BDF+C', 44) +
    number(records, 8) +
    number(1, 8) +
    number(ns, 4);
  const each = (fn, width) => signals.map((s) => field(fn(s), width)).join('');
  head +=
    each((s) => s.label, 16) +
    each((s) => s.transducer, 80) +
    each((s) => s.dim, 8) +
    signals.map((s) => number(s.pmin, 8)).join('') +
    signals.map((s) => number(s.pmax, 8)).join('') +
    signals.map(() => number(DIG_MIN, 8)).join('') +
    signals.map(() => number(DIG_MAX, 8)).join('') +
    each((s) => s.prefilter, 80) +
    signals.map((s) => number(s.samples, 8)).join('') +
    each(() => '', 32);
  const header = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from('BIOSEMI', 'latin1'),
    Buffer.from(head, 'latin1'),
  ]);
  if (header.length !== 256 * (ns + 1)) throw Error('BDF 头长度错误');

  const recordBytes = (labels.length * rate + annSamples) * 3;
  const body = Buffer.alloc(records * recordBytes);
  const scale = (DIG_MAX - DIG_MIN) / (physMax - physMin);
  let offset = 0;
  for (let r = 0; r < records; r++) {
    for (const channel of data) {
      for (let i = r * rate; i < (r + 1) * rate; i++) {
        const v = Math.round(((i < n ? channel[i] : 0) - physMin) * scale + DIG_MIN);
        body.writeIntLE(Math.min(DIG_MAX, Math.max(DIG_MIN, v)), offset, 3);
        offset += 3;
      }
    }
    talBytes(r, byRecord[r]).copy(body, offset);
    offset += annSamples * 3;
  }
  fs.writeFileSync(file, Buffer.concat([header, body]), { flag: 'wx' });
  return {
    records,
    seconds: records,
    paddedSamples: records * rate - n,
    annotations: kept.length,
  };
}

// BIDS labels must be alphanumeric.
const label = (text) => String(text).replace(/[^A-Za-z0-9]/g, '');

// Events at their exported position (index from continuous()), plus the gap marks.
function annotationsOf(events, rate, signal) {
  return [
    ...events
      .filter((e) => Number.isInteger(e.sample) && e.sample < signal.index.length)
      .map((e) => ({ onset: signal.index[e.sample] / rate, duration: 0, text: e.label })),
    ...signal.marks,
  ].sort((a, b) => a.onset - b.onset);
}

async function exportBdf(sessionDir, file) {
  const { info, data, timestamps, events } = await readSession(sessionDir);
  const rate = info.device.rate;
  const signal = continuous(data, timestamps, rate);
  return {
    ...writeBdf(file, {
      rate,
      labels: info.electrodes,
      data: signal.data,
      start: new Date(timestamps[0] * 1000),
      patient: `${info.participant?.code ?? 'X'} X X X`,
      recording: `OpenCiv_BCI_001_${label(info.task.id)}`,
      annotations: annotationsOf(events, rate, signal),
    }),
    filledSamples: signal.filled,
    filledSeconds: +(signal.filled / rate).toFixed(2),
  };
}

const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n') + '\n';

const EVENTS_SIDECAR = {
  sample: { Description: 'Sample index in the exported (gap-filled) EEG file' },
  trial_type: { Description: 'Event label as recorded by OpenCiv BCI-001' },
  source: {
    Description: 'Where the label comes from',
    Levels: {
      instruction: 'The software instructed the participant (cue or condition period)',
      observed: 'An action observed independently',
      manual: 'Marked by hand',
      prediction: 'Recognised by a model or detector; not ground truth',
      command: 'A command sent to a device',
      unknown: 'Not recorded',
      data_quality: 'BAD_gap / BAD_discontinuity / BAD_padding: no valid EEG',
    },
  },
};

async function exportBids(sessionDirs, root, appVersion) {
  if (fs.existsSync(root)) throw Error('目标文件夹已存在');
  await fsp.mkdir(root, { recursive: true });
  const participants = new Set();
  const written = [];
  for (const dir of sessionDirs) {
    const { info, data, timestamps, events, quality } = await readSession(dir);
    if (info.status !== 'completed') continue;
    const sub = label(info.participant?.code ?? 'unknown') || 'unknown';
    const ses = label(info.id.slice(0, 15));
    const task = label(info.task.id);
    const rate = info.device.rate;
    const base = `sub-${sub}_ses-${ses}_task-${task}`;
    const eegDir = path.join(root, `sub-${sub}`, `ses-${ses}`, 'eeg');
    await fsp.mkdir(eegDir, { recursive: true });
    const signal = continuous(data, timestamps, rate);
    const bdf = writeBdf(path.join(eegDir, `${base}_eeg.bdf`), {
      rate,
      labels: info.electrodes,
      data: signal.data,
      start: new Date(timestamps[0] * 1000),
      patient: `${sub} X X X`,
      recording: `OpenCiv_BCI_001_${task}`,
      annotations: annotationsOf(events, rate, signal),
    });
    await fsp.writeFile(
      path.join(eegDir, `${base}_eeg.json`),
      JSON.stringify(
        {
          TaskName: task,
          TaskDescription: info.task.title,
          SamplingFrequency: rate,
          PowerLineFrequency: 50,
          EEGReference: 'SRB2, reference electrode on the top of the head',
          EEGGround: 'BIAS, mid-forehead',
          EEGPlacementScheme: '10-20 subset, OpenBCI GUI default 16-channel montage',
          SoftwareFilters: 'n/a',
          EEGChannelCount: info.electrodes.length,
          RecordingDuration: bdf.seconds,
          RecordingType: 'continuous',
          Manufacturer: 'OpenBCI-compatible (Cyton + Daisy)',
          SoftwareVersions: `OpenCiv BCI-001 ${info.app?.version ?? appVersion}`,
          openciv_bci_session: info.id,
          openciv_bci_source: info.source,
          openciv_bci_event_timing: info.timing,
          // zeros standing in for samples lost in transport (BAD_gap in events.tsv) and the
          // zero padding of the last 1 s record (BAD_padding)
          openciv_bci_filled_samples: signal.filled,
          openciv_bci_discontinuities: signal.discontinuities,
          openciv_bci_padded_samples: bdf.paddedSamples,
        },
        null,
        2,
      ),
    );
    await fsp.writeFile(
      path.join(eegDir, `${base}_channels.tsv`),
      tsv([
        ['name', 'type', 'units', 'low_cutoff', 'high_cutoff', 'status', 'status_description'],
        ...channelStatus(quality, info.electrodes.length).map(([status, why], c) => [
          info.electrodes[c],
          'EEG',
          'µV',
          'n/a',
          'n/a',
          status,
          why,
        ]),
      ]),
    );
    // Events with where their label comes from; gap and padding marks as data quality rows.
    const end = bdf.records * rate - bdf.paddedSamples;
    const marks = [...signal.marks];
    if (bdf.paddedSamples)
      marks.push({ onset: end / rate, duration: bdf.paddedSamples / rate, text: 'BAD_padding' });
    const rows = [
      ...events
        .filter((e) => Number.isInteger(e.sample) && e.sample < signal.index.length)
        .map((e) => {
          const at = signal.index[e.sample];
          return [at / rate, 0, at, e.label, e.source];
        }),
      ...marks.map((m) => [
        m.onset,
        m.duration,
        Math.round(m.onset * rate),
        m.text,
        'data_quality',
      ]),
    ].sort((a, b) => a[0] - b[0]);
    await fsp.writeFile(
      path.join(eegDir, `${base}_events.tsv`),
      tsv([
        ['onset', 'duration', 'sample', 'trial_type', 'source'],
        ...rows.map(([onset, duration, sample, type, source]) => [
          onset.toFixed(4),
          duration ? duration.toFixed(4) : '0',
          String(sample),
          type,
          source,
        ]),
      ]),
    );
    await fsp.writeFile(
      path.join(eegDir, `${base}_events.json`),
      JSON.stringify(EVENTS_SIDECAR, null, 2),
    );
    // the original session files, with receive times and device sample counters
    await fsp.cp(dir, path.join(root, 'sourcedata', `sub-${sub}`, `ses-${ses}`), {
      recursive: true,
    });
    participants.add(sub);
    written.push({
      session: info.id,
      file: path.relative(root, path.join(eegDir, `${base}_eeg.bdf`)),
    });
  }
  if (!written.length) {
    await fsp.rm(root, { recursive: true, force: true });
    throw Error('没有已完成的会话可以导出');
  }
  await fsp.writeFile(
    path.join(root, 'dataset_description.json'),
    JSON.stringify(
      {
        Name: 'OpenCiv BCI-001 export',
        BIDSVersion: '1.9.0',
        DatasetType: 'raw',
        GeneratedBy: [{ Name: 'OpenCiv BCI-001', Version: appVersion }],
      },
      null,
      2,
    ),
  );
  await fsp.writeFile(
    path.join(root, 'participants.tsv'),
    tsv([['participant_id'], ...[...participants].sort().map((p) => [`sub-${p}`])]),
  );
  await fsp.writeFile(
    path.join(root, 'README'),
    'Exported by OpenCiv BCI-001. Participants are pseudonymous codes. Sample times are the\n' +
      'estimated acquisition times from the device sample counter (see *_eeg.json\n' +
      'openciv_bci_event_timing). Samples lost in transport are zeros marked BAD_gap in events.tsv,\n' +
      'the last partial second is zero padding marked BAD_padding. The events.tsv column\n' +
      '"source" says where each label comes from (*_events.json). sourcedata/ holds the\n' +
      'original session files, including receive times and device sample counters.\n',
  );
  return { root, sessions: written.length, participants: participants.size, files: written };
}

module.exports = { readSession, continuous, writeBdf, exportBdf, exportBids, FULL_SCALE_UV };
