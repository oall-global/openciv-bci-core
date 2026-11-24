import { useEffect, useState } from 'react';
import type { Replay } from './useReplay';
export default function SessionTools({
  kind,
  active,
  replay,
}: {
  kind: string;
  active: boolean;
  replay: Replay;
}) {
  const [state, setState] = useState<any>(null),
    [bridge, setBridge] = useState<any>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [label, setLabel] = useState('闭眼开始');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [a, b] = await Promise.all([
          window.neuro?.recording('state'),
          window.neuro?.developer('state'),
        ]);
        if (alive) {
          setState(a);
          setBridge(b);
        }
      } catch {
        if (alive) setMessage('状态读取失败');
      }
    };
    void refresh();
    const t = setInterval(refresh, 750);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setState(await window.neuro?.recording('state'));
      setBridge(await window.neuro?.developer('state'));
    } catch (e) {
      setMessage(String(e).replace(/^.*Error: /, ''));
    } finally {
      setBusy(false);
    }
  }
  const markers = replay.file
    ? replay.file.events
        .filter((r) => r.event.type === 'marker')
        .slice(-30)
        .reverse()
        .map((r) => ({ ...r.event, ms: r.ms }))
    : (bridge?.markers ?? []);
  return (
    <section className="wb-extra-chart">
      <div className="wb-extra-toolbar">
        <b>
          {kind === 'recording'
            ? '录制与回放'
            : kind === 'marker'
              ? '实验事件标记'
              : '本机数据输出'}
        </b>
        <span>{replay.file ? '正在查看历史数据' : active ? '实时会话' : '等待采集'}</span>
      </div>
      {kind === 'recording' ? (
        <>
          <div className="session-actions">
            <button
              className="primary"
              disabled={busy || (!state?.recording && (!active || !!replay.file))}
              onClick={() =>
                run(() => window.neuro!.recording(state?.recording ? 'stop' : 'start'))
              }
            >
              {state?.recording ? '停止录制' : '开始录制'}
            </button>
            <button
              className="secondary"
              disabled={busy || state?.recording}
              onClick={() =>
                run(async () => {
                  const file = await window.neuro!.recording('open');
                  if (file) replay.load(file);
                })
              }
            >
              打开录制文件
            </button>
          </div>
          <p>
            {state?.recording
              ? `正在写入 ${state.samples} 个样本 · ${(state.bytes / 1024 / 1024).toFixed(1)} MB`
              : '手动开始后才保存原始脑电、频谱及实验标记。断流、检测或重连会结束当前录制，请另开新文件。单文件上限128 MB。'}
            {state?.error && <strong role="alert">{state.error}</strong>}
          </p>
          {state?.file && <p className="record-path">文件：{state.file}</p>}
          {replay.file && (
            <>
              <b>{replay.file.file}</b>
              <p>
                {replay.file.header.source === 'demo' ? '模拟录制' : '设备录制'} ·{' '}
                {replay.file.header.metadata.rate} Hz · {replay.file.samples} 个样本
              </p>
              <div className="session-actions">
                <button
                  className="primary"
                  onClick={() => {
                    if (replay.position >= replay.file!.duration) replay.seek(0);
                    replay.setPlaying(!replay.playing);
                  }}
                >
                  {replay.playing ? '暂停回放' : '播放回放'}
                </button>
                <select
                  aria-label="回放速度"
                  value={replay.speed}
                  onChange={(e) => replay.setSpeed(Number(e.target.value))}
                >
                  {[0.5, 1, 2, 4].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
                <button className="secondary" onClick={replay.close}>
                  退出回放
                </button>
              </div>
              <input
                aria-label="回放进度"
                type="range"
                min={0}
                max={replay.file.duration}
                value={replay.position}
                onChange={(e) => replay.seek(Number(e.target.value))}
              />
              <p>
                {(replay.position / 1000).toFixed(1)} / {(replay.file.duration / 1000).toFixed(1)}{' '}
                秒
              </p>
              <p>
                所有工作台图表联动到录制数据。回放仅用于查看，不向开发接口或设备控制输出历史信号；实时采集如仍连接，会在后台继续。
              </p>
            </>
          )}
        </>
      ) : kind === 'marker' ? (
        <>
          <div className="session-actions">
            <input
              aria-label="工作台标记名称"
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy || !active || !!replay.file || !label.trim()}
              onClick={() => run(() => window.neuro!.developer('marker', { label }))}
            >
              添加标记
            </button>
          </div>
          <div className="session-actions">
            {['闭眼开始', '睁眼开始', '动作开始', '动作结束'].map((v) => (
              <button
                className="secondary"
                key={v}
                disabled={busy || !active || !!replay.file}
                onClick={() => run(() => window.neuro!.developer('marker', { label: v }))}
              >
                {v}
              </button>
            ))}
          </div>
          <p>
            记录电脑收到事件的时间和最近收到的样本位置，非硬件同步时间。录制时会写入文件；未录制时只保留最近30条。无需开启网络接口。
          </p>
          <div className="marker-rows">
            {markers.map((m: any) => (
              <button key={m.id} disabled={!replay.file} onClick={() => replay.seek(m.ms)}>
                <time>
                  {m.ms !== undefined
                    ? `${(m.ms / 1000).toFixed(2)}s`
                    : new Date(m.receivedAtMs).toLocaleTimeString()}
                </time>
                <b>{m.label}</b>
              </button>
            ))}
            {!markers.length && <p>暂无事件标记</p>}
          </div>
        </>
      ) : (
        <>
          <code>{bridge?.endpoint ?? 'ws://127.0.0.1:8765'}</code>
          <p>
            {bridge?.enabled ? '接口已开启' : '接口已关闭'} · {bridge?.clients?.length ?? 0}{' '}
            个已认证客户端
          </p>
          <div className="session-actions">
            <button
              className="primary"
              disabled={busy || !!replay.file}
              onClick={() => run(() => window.neuro!.developer(bridge?.enabled ? 'stop' : 'start'))}
            >
              {bridge?.enabled ? '关闭接口' : '开启接口'}
            </button>
            <button
              className="secondary"
              disabled={busy || !bridge?.enabled}
              onClick={() =>
                run(async () => {
                  await window.neuro!.developer('copy-token');
                  setMessage('密钥已复制');
                })
              }
            >
              复制密钥
            </button>
            <button
              className="secondary"
              onClick={() => run(() => window.neuro!.developer('open-kit'))}
            >
              协议与示例
            </button>
          </div>
          <p>
            支持原始 EEG、Alpha、SSVEP频谱比值、质量和标记。仅本机认证
            WebSocket；不声称与原版所有输出协议兼容。回放不会作为实时信号广播。
          </p>
          {bridge?.clients?.map((c: any, i: number) => (
            <p key={i}>
              {c.name} · {c.topics.join(' / ')}
            </p>
          ))}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
