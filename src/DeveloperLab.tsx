import { useEffect, useState } from 'react';
import type { AlphaFrame, Frame } from './types';
import './developer.css';
type BridgeState = {
  enabled: boolean;
  port: number;
  endpoint: string;
  clients: { name: string; topics: string[] }[];
  fresh: boolean;
  source: string;
  error: string;
  recent: { at: number; text: string }[];
  markers: { id: string; label: string; receivedAtMs: number; clientName: string }[];
};
export default function DeveloperLab({
  alpha,
  frame,
}: {
  alpha: AlphaFrame | null;
  frame: Frame | null;
}) {
  const [state, setState] = useState<BridgeState | null>(null),
    [port, setPort] = useState(8765),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [label, setLabel] = useState('trial_start'),
    [channel, setChannel] = useState(0);
  const api = window.neuro;
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api
        ?.developer('state')
        .then((s) => {
          if (alive) setState(s);
        })
        .catch(() => {
          if (alive) setMessage('无法读取接口状态');
        });
    refresh();
    const timer = setInterval(refresh, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);
  async function run(action: string, params?: unknown) {
    setBusy(true);
    setMessage('');
    try {
      await api?.developer(action, params);
      setState(await api!.developer('state'));
      if (action === 'copy-token') setMessage('密钥已复制。只提供给你信任的本机程序。');
      if (action === 'copy-agent-guide')
        setMessage(
          '接口说明已复制，粘贴给 AI 助手即可使用。其中包含接入密钥，只提供给本机运行的助手。',
        );
      if (action === 'marker') setMessage('标记已写入本次会话。');
    } catch (e) {
      setMessage(String(e).replace(/^.*Error: /, ''));
    } finally {
      setBusy(false);
    }
  }
  const valid =
    state?.fresh &&
    alpha &&
    !alpha.flags[channel] &&
    frame?.rail?.states[channel] === 'normal' &&
    Date.now() / 1000 - alpha.at < 1.5;
  return (
    <div className="developer-lab">
      <div className="page-heading">
        <h1>开发者工作台</h1>
      </div>
      <section className="card developer-connection">
        <div>
          <span className={`live-pill ${state?.enabled ? 'live' : ''}`}>
            {state?.enabled ? '接口已开启' : '接口已关闭'}
          </span>
          <h2>本机开发接口</h2>
          <p>
            开启后，持有密钥的本机程序可以读取脑电、订阅特征并写入标记。
            <br />
            每次开启生成新密钥；退出应用后关闭。接口本身不保存原始脑电。
          </p>
        </div>
        <div className="developer-controls">
          <label>
            接口端口
            <input
              aria-label="开发接口端口"
              type="number"
              min={1024}
              max={65535}
              disabled={state?.enabled || busy}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </label>
          <button
            className="primary"
            disabled={!api || busy}
            onClick={() => run(state?.enabled ? 'stop' : 'start', { port })}
          >
            {state?.enabled ? '关闭接口' : '开启本机接口'}
          </button>
        </div>
      </section>
      <div className="developer-address">
        <code>{state?.endpoint || `ws://127.0.0.1:${port}`}</code>
        <span>仅此电脑 · JSON / WebSocket</span>
        <button
          className="secondary"
          disabled={!state?.enabled || busy}
          onClick={() => run('copy-token')}
        >
          复制接入密钥
        </button>
        <button
          className="secondary"
          disabled={!api || busy}
          onClick={() => run('copy-agent-guide', { port })}
        >
          复制接口说明（给 AI 助手）
        </button>
      </div>
      {(message || state?.error) && (
        <p className="developer-message" role="status">
          {message || state?.error}
        </p>
      )}
      <div className="developer-grid">
        <section className="card developer-panel">
          <div className="section-title">
            <h3>信号预览</h3>
            <span className="pill neutral">
              {state?.fresh ? (state.source === 'demo' ? '模拟数据' : '设备数据') : '等待有效采集'}
            </span>
          </div>
          <label>
            预览通道
            <select value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  CH {i + 1}
                </option>
              ))}
            </select>
          </label>
          <div className="developer-values">
            <div>
              <small>Alpha 功率 · µV²</small>
              <strong>{valid ? alpha.absolute[channel].toFixed(2) : '—'}</strong>
            </div>
            <div>
              <small>Alpha 占比 · %</small>
              <strong>{valid ? alpha.relative[channel].toFixed(1) : '—'}</strong>
            </div>
          </div>
          <p>
            基于最近 4 秒数据；断流、饱和或明显异常时不提供有效特征。Alpha
            变化不直接代表专注或放松。
          </p>
          <div className="developer-topics">
            <span>eeg 原始脑电</span>
            <span>alpha 频段特征</span>
            <span>ssvep 目标频率 SNR</span>
            <span>quality 信号有效性</span>
            <span>status 连接状态</span>
            <span>marker 实验标记</span>
            <span>decoder 识别分数</span>
            <span>command 选择事件</span>
          </div>
        </section>
        <section className="card developer-panel">
          <div className="section-title">
            <h3>接入的程序</h3>
            <span className="pill neutral">{state?.clients.length || 0} / 8</span>
          </div>
          {!state?.clients.length ? (
            <div className="developer-empty">
              开启接口，复制密钥，运行接入示例。
              <small>Python 和 Node.js 程序都可以订阅同一份信号。</small>
            </div>
          ) : (
            state.clients.map((client, i) => (
              <div className="developer-client" key={i}>
                <b>{client.name}</b>
                <p>{client.topics.join(' · ') || '尚未订阅信号'}</p>
              </div>
            ))
          )}
          <p>外部程序只能订阅数据和写入标记，不能修改设备参数或启动闪烁刺激。</p>
        </section>
      </div>
      <section className="card developer-panel">
        <div className="section-title">
          <div>
            <h3>实验标记</h3>
            <p>
              例如闭眼开始、睁眼开始、按下按钮。标记记录电脑收到的时间；脑电样本的时间戳是设备采集时间（同一时钟），可以按时间对齐，精度约几十毫秒。
            </p>
          </div>
        </div>
        <div className="developer-marker">
          <input
            aria-label="实验标记名称"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如 eyes_closed"
          />
          <button
            className="secondary"
            disabled={!state?.fresh || busy || !label.trim()}
            onClick={() => run('marker', { label })}
          >
            写入标记
          </button>
        </div>
        <div className="developer-marker-list">
          {state?.markers.length ? (
            state.markers.map((m) => (
              <div key={m.id}>
                <time>{new Date(m.receivedAtMs).toLocaleTimeString()}</time>
                <b>{m.label}</b>
                <span>{m.clientName}</span>
              </div>
            ))
          ) : (
            <p className="muted">
              本次采集还没有标记。仅保留最近 30 条，重连后清空；实验程序应自行记录。
            </p>
          )}
        </div>
      </section>
      <section className="card developer-panel">
        <div className="section-title">
          <h3>接入顺序</h3>
          <button className="secondary" onClick={() => run('open-kit')}>
            打开协议与示例
          </button>
        </div>
        <ol>
          <li>从设备页连接设备。</li>
          <li>开启本机接口，复制密钥给你的 Python / Node.js 程序。</li>
          <li>先发送 auth，再发送 subscribe；监听 status 和 quality，在中断时暂停实验判断。</li>
        </ol>
        <pre>{`{"type":"auth","token":"你的密钥","clientName":"我的实验"}\n{"type":"subscribe","topics":["metadata","status","quality","bands","waves","marker","command"],"channels":[1],"ssvepFrequencyHz":30}\n{"type":"marker","label":"eyes_closed"}`}</pre>
        <p>
          完整协议与可运行示例随应用提供在 developer-kit 文件夹。SSVEP
          输出是目标频率相对邻近频率的能量比，尚不是“用户选择了哪个目标”的识别结果。
        </p>
      </section>
    </div>
  );
}
