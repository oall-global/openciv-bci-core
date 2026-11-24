// Task session storage: one directory per task run, readable without NeuroLink.
// See docs/session-format.md for the on-disk contract.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { electrodeNames, isDefault } = require('./montage.cjs');

const FORMAT = 'neurolink-session';
const VERSION = 2; // 2: timestamp = acquisition time, received column, clock summary
const MAX_SECONDS = 45 * 60;
const TASK_ID = /^[a-z0-9-]{1,32}$/;
const SESSION_ID = /^\d{8}-\d{6}-[a-z0-9-]{1,32}(-\d+)?$/;
const EVENT_LABEL = /^[\w.:-]{1,60}$/;
// Where an event's label comes from, so training and analysis can tell instructed periods
// from what someone observed or what a model recognised (predictions are never ground truth).
const EVENT_SOURCES = ['instruction', 'observed', 'manual', 'prediction', 'command', 'unknown'];
function sourceOf(label) {
  if (/^(cond|cue|baseline|stim|trial)\./.test(label)) return 'instruction';
  if (/^(control|select|detected)\./.test(label)) return 'prediction';
  if (label === 'marker') return 'manual';
  return 'unknown';
}
// Gaps in the acquisition time axis: samples lost in transport (the clock counts them, so
// the next timestamp jumps by lost + 1 periods) and discontinuities where the sample count
// restarted (time going back or jumping more than 10 s). Indices refer to eeg.csv rows.
function findGaps(timestamps, count, rate) {
  const gaps = [];
  for (let i = 1; i < count; i++) {
    const periods = (timestamps[i] - timestamps[i - 1]) * rate;
    if (periods > 1.5 && periods <= rate * 10)
      gaps.push({ sample: i, lost: Math.round(periods) - 1 });
    else if (periods <= 0 || periods > rate * 10) gaps.push({ sample: i, lost: null });
  }
  return gaps;
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(date) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}
// First sample acquired at or after host time t (acquisition times from the engine's
// AcquisitionClock); null when t is outside the data.
function sampleAt(timestamps, count, t) {
  if (!count || t < timestamps[0] - 1 || t > timestamps[count - 1] + 1) return null;
  let lo = 0,
    hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class SessionStore {
  constructor(root, appVersion) {
    this.root = root;
    this.appVersion = appVersion;
    this.active = null;
    this.error = '';
  }
  state() {
    const s = this.active;
    return {
      active: !!s,
      id: s?.id ?? null,
      task: s?.info.task.id ?? null,
      samples: s?.count ?? 0,
      seconds: s ? s.count / s.info.device.rate : 0,
      error: this.error,
    };
  }
  async start(request, metadata, source, participant) {
    if (this.active) throw Error('请先结束当前任务');
    const task = request?.task;
    if (!task || !TASK_ID.test(task.id) || typeof task.title !== 'string' || task.title.length > 60)
      throw Error('任务信息无效');
    if (!Number.isInteger(task.version) || task.version < 1) throw Error('任务版本无效');
    const channels = request.channels ?? [];
    if (!Array.isArray(channels) || !channels.every((c) => electrodeNames.includes(c)))
      throw Error('任务电极无效');
    if (jsonSize(request.params) > 16384 || jsonSize(request.fit) > 16384)
      throw Error('任务参数过大');
    if (!metadata || metadata.channels !== 16) throw Error('请先连接设备并等待数据');
    if (!participant?.code) throw Error('请先选择被试并确认数据说明');

    const created = new Date();
    let id = `${stamp(created)}-${task.id}`;
    for (let n = 2; fs.existsSync(path.join(this.root, id)); n++)
      id = `${stamp(created)}-${task.id}-${n}`;
    const dir = path.join(this.root, id);
    await fsp.mkdir(dir, { recursive: true });

    const info = {
      format: FORMAT,
      version: VERSION,
      id,
      status: 'recording',
      task: { id: task.id, version: task.version, title: task.title },
      createdAt: created.toISOString(),
      endedAt: null,
      app: { name: 'OpenCiv BCI-001', version: this.appVersion },
      source,
      participant: { code: participant.code, consent: participant.consent ?? null },
      device: {
        boardId: metadata.boardId,
        rate: metadata.rate,
        channels: 16,
        unit: metadata.unit,
        montage: isDefault() ? 'OpenBCI GUI default 16-channel' : 'custom (设置 → 电极位置)',
      },
      electrodes: [...electrodeNames],
      channelsUsed: channels,
      params: request.params ?? {},
      fit: request.fit ?? null,
      samples: 0,
      durationSeconds: 0,
      transport: null,
      results: null,
      abortReason: null,
      files: {
        eeg: 'eeg.csv',
        events: 'events.jsonl',
        quality: 'quality.jsonl',
        results: 'results.json',
      },
      clock: null,
      timing:
        'Event "sample" = first EEG row whose acquisition time is at or after the event host ' +
        'time. Acquisition times come from the device sample counter (engine/acqclock.py), so ' +
        'transport latency and Wi-Fi backlog do not shift events; the remaining error is the ' +
        'minimum transport latency plus the drift estimate (about 10 ms in simulation). Event ' +
        'times are taken when the stimulus frame is shown; not verified against a photodiode.',
    };
    const open = (name) => fs.createWriteStream(path.join(dir, name), { flags: 'wx' });
    const eeg = open('eeg.csv'),
      events = open('events.jsonl'),
      quality = open('quality.jsonl');
    for (const stream of [eeg, events, quality])
      stream.on('error', () => void this.abort('文件写入失败'));
    eeg.write(`sample,timestamp,package,${electrodeNames.join(',')},received\n`);
    this.active = {
      id,
      dir,
      info,
      eeg,
      events,
      quality,
      epoch: metadata.epoch,
      count: 0,
      timestamps: new Float64Array(metadata.rate * 60),
      eventRows: [],
      lastQuality: 0,
      railCounts: {
        seconds: 0,
        railed: Array(16).fill(0),
        near: Array(16).fill(0),
        flat: Array(16).fill(0),
      },
      transportStart: null,
      transportLast: null,
      clockStart: null,
      clockLast: null,
      latencyMax: 0,
    };
    this.error = '';
    await this.writeInfo(this.active);
    return { id, state: this.state() };
  }
  writeInfo(s) {
    return fsp.writeFile(path.join(s.dir, 'session.json'), JSON.stringify(s.info, null, 2));
  }
  ingest(event) {
    const s = this.active;
    if (!s) return;
    // A reconnect (new metadata) or leaving the streaming states ends the recording. "stale"
    // (no data for 3 s) does not: Wi-Fi often catches up without losing samples, and the
    // engine reconnects after 10 s if it does not.
    if (
      event.type === 'metadata' ||
      (event.type === 'status' && !['streaming', 'stale'].includes(event.status))
    ) {
      void this.abort('信号中断或设备重新连接');
      return;
    }
    if (event.type !== 'data' || event.epoch !== s.epoch) return;
    const n = event.timestamps.length;
    if (s.count + n > s.timestamps.length) {
      if (s.count + n > s.info.device.rate * MAX_SECONDS) {
        void this.abort('超过单次任务最长时长');
        return;
      }
      const grown = new Float64Array(s.timestamps.length * 2);
      grown.set(s.timestamps.subarray(0, s.count));
      s.timestamps = grown;
    }
    let rows = '';
    for (let i = 0; i < n; i++) {
      const values = event.samples.map((channel) => channel[i].toFixed(3)).join(',');
      rows += `${s.count + i},${event.timestamps[i].toFixed(6)},${event.sampleNumbers?.[i] ?? ''},${values},${event.received?.[i]?.toFixed(6) ?? ''}\n`;
      s.timestamps[s.count + i] = event.timestamps[i];
    }
    s.eeg.write(rows);
    s.count += n;
    s.lastTime = event.timestamps[n - 1];
    if (s.waiting && s.lastTime >= s.waiting.until) s.waiting.resolve();
    if (event.transport) {
      s.transportStart ??= event.transport;
      s.transportLast = event.transport;
    }
    if (event.clock) {
      s.clockStart ??= event.clock;
      s.clockLast = event.clock;
      s.latencyMax = Math.max(s.latencyMax, event.clock.latency ?? 0);
    }
    const t = event.timestamps[n - 1];
    if (t - s.lastQuality >= 1) {
      s.lastQuality = t;
      const states = event.rail?.states;
      if (states) {
        s.railCounts.seconds++;
        states.forEach((state, c) => {
          if (state in s.railCounts) s.railCounts[state][c]++;
        });
      }
      s.quality.write(
        JSON.stringify({
          t,
          sample: s.count - 1,
          rail: event.rail?.states ?? null,
          latency: event.clock?.latency ?? null,
        }) + '\n',
      );
    }
  }
  event(request) {
    const s = this.active;
    if (!s) throw Error('没有进行中的任务');
    if (typeof request?.label !== 'string' || !EVENT_LABEL.test(request.label))
      throw Error('事件名称无效');
    if (!Number.isFinite(request.t)) throw Error('事件时间无效');
    if (jsonSize(request.data) > 4096) throw Error('事件数据过大');
    if (request.source !== undefined && !EVENT_SOURCES.includes(request.source))
      throw Error('事件来源无效');
    const row = {
      t: request.t,
      label: request.label,
      source: request.source ?? sourceOf(request.label),
      data: request.data ?? null,
    };
    s.eventRows.push(row);
    s.events.write(JSON.stringify(row) + '\n');
    return true;
  }
  async close(status, patch) {
    const s = this.active;
    if (!s) return null;
    this.active = null;
    await Promise.all(
      [s.eeg, s.events, s.quality].map((stream) => new Promise((resolve) => stream.end(resolve))),
    );
    // Rewrite events with sample alignment now that all samples are known.
    const aligned = s.eventRows.map((row) => ({
      ...row,
      sample: sampleAt(s.timestamps, s.count, row.t),
    }));
    await fsp.writeFile(
      path.join(s.dir, 'events.jsonl'),
      aligned.map((row) => JSON.stringify(row)).join('\n') + (aligned.length ? '\n' : ''),
    );
    const a = s.transportStart,
      b = s.transportLast,
      c0 = s.clockStart,
      c1 = s.clockLast;
    const gaps = findGaps(s.timestamps, s.count, s.info.device.rate);
    const share = (n) => +(n / Math.max(1, s.railCounts.seconds)).toFixed(3);
    Object.assign(s.info, patch, {
      status,
      endedAt: new Date().toISOString(),
      samples: s.count,
      durationSeconds: +(s.count / s.info.device.rate).toFixed(3),
      transport:
        a && b
          ? {
              estimatedLost: b.estimatedLost - a.estimatedLost,
              duplicates: b.duplicates - a.duplicates,
              ambiguous: b.ambiguous - a.ambiguous,
            }
          : null,
      // Transport latency is how late data arrived; it no longer shifts event alignment but
      // matters for live feedback. restarts > 0 means the sample count was lost mid-session.
      clock:
        c0 && c1
          ? {
              driftPpm: c1.driftPpm,
              latencyMax: +s.latencyMax.toFixed(3),
              latencyEnd: c1.latency,
              lostSamples: c1.lost >= c0.lost ? c1.lost - c0.lost : c1.lost,
              restarts: c1.resets >= c0.resets ? c1.resets - c0.resets : 1,
            }
          : null,
      // Data quality for later selection: where samples are missing, and per channel the share
      // of seconds that were railed, near railed or flat (quality.jsonl has the timeline).
      gaps: gaps.slice(0, 1000),
      gapCount: gaps.length,
      quality: {
        seconds: s.railCounts.seconds,
        railed: s.railCounts.railed.map(share),
        near: s.railCounts.near.map(share),
        flat: s.railCounts.flat.map(share),
      },
    });
    await this.writeInfo(s);
    return { id: s.id, info: s.info, events: aligned };
  }
  // Data arrives after it is measured (transport latency, Wi-Fi backlog). Before closing, wait
  // until samples up to the finish time are in (at most maxMs), so the end of the recording
  // and the last events are not cut off.
  async catchUp(until, maxMs = 15000) {
    const s = this.active;
    if (!s || (s.lastTime ?? 0) >= until) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, maxMs);
      s.waiting = {
        until,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
    });
    s.waiting = null;
  }
  async finish(results, now = Date.now() / 1000) {
    const s = this.active;
    if (!s) throw Error('没有进行中的任务');
    if (jsonSize(results) > 256 * 1024) throw Error('任务结果过大');
    await this.catchUp(now);
    if (this.active !== s) throw Error('任务已中止');
    await fsp.writeFile(path.join(s.dir, 'results.json'), JSON.stringify(results ?? {}, null, 2));
    return this.close('completed', { results: results?.summary ?? null });
  }
  // Stop early but keep the condition segments that were completed (a segment that started
  // but did not end has no end event and is ignored by the analyses). Nothing complete: abort.
  async keepPartial(reason) {
    const s = this.active;
    if (!s) return null;
    const why = String(reason || '已停止').slice(0, 120);
    const kept = s.eventRows.filter((r) => /^cond\..+\.end$/.test(r.label)).length;
    const { id, params } = s.info;
    if (!kept) {
      await this.abort(why);
      return { kept: 0, id: null, params };
    }
    const summary = { headline: `已保存 ${kept} 段（${why}）`, partial: true, segments: kept };
    await fsp.writeFile(
      path.join(s.dir, 'results.json'),
      JSON.stringify({ summary, detail: { partial: true, reason: why } }, null, 2),
    );
    await this.close('completed', { results: summary });
    return { kept, id, params };
  }
  async abort(reason) {
    if (!this.active) return null;
    this.error = String(reason || '任务已中止').slice(0, 120);
    return this.close('aborted', { abortReason: this.error });
  }
  async list() {
    let names = [];
    try {
      names = await fsp.readdir(this.root);
    } catch {
      return [];
    }
    const rows = [];
    for (const name of names.filter((n) => SESSION_ID.test(n))) {
      try {
        const info = JSON.parse(
          await fsp.readFile(path.join(this.root, name, 'session.json'), 'utf8'),
        );
        if (info.format !== FORMAT) continue;
        rows.push({
          id: info.id,
          task: info.task,
          taskId: info.params?.taskId ?? null, // the 任务 it was recorded for
          status: info.status,
          source: info.source,
          participant: info.participant?.code ?? null,
          createdAt: info.createdAt,
          durationSeconds: info.durationSeconds,
          results: info.results,
          abortReason: info.abortReason,
        });
      } catch {
        continue;
      }
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  dirOf(id) {
    if (typeof id !== 'string' || !SESSION_ID.test(id)) throw Error('会话编号无效');
    if (this.active?.id === id) throw Error('任务仍在进行');
    return path.join(this.root, id);
  }
  async remove(id) {
    await fsp.rm(this.dirOf(id), { recursive: true, force: true });
    return true;
  }
  async removeParticipant(code) {
    if (this.active?.info.participant.code === code) throw Error('该被试的任务仍在进行');
    const ids = (await this.list()).filter((s) => s.participant === code).map((s) => s.id);
    for (const id of ids) await this.remove(id);
    return ids.length;
  }
}

module.exports = { SessionStore, sampleAt, sourceOf, findGaps, EVENT_SOURCES };
