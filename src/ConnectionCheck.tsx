import { useState } from 'react';
import { Activity, Check, CircleAlert, Headphones, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { CheckEvent, Quality } from './types';

const labels: Record<Quality, string> = {
  good: '通过',
  warn: '建议调整',
  bad: '需要检查',
  unknown: '待判断',
};
export default function ConnectionCheck({
  result,
  connected,
  demo,
  selected,
  onSelect,
  onStart,
  onCancel,
}: {
  result: CheckEvent | null;
  connected: boolean;
  demo: boolean;
  selected: number;
  onSelect: (n: number) => void;
  onStart: () => Promise<unknown>;
  onCancel: () => Promise<unknown>;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = !!result?.active;
  const valid = connected || active;
  const phase = result?.phase || 'idle';
  const completed = phase === 'complete' && valid && result?.scope !== 'single';
  const worst = (items: Quality[]): Quality =>
    items.includes('bad')
      ? 'bad'
      : items.includes('unknown')
        ? 'unknown'
        : items.includes('warn')
          ? 'warn'
          : 'good';
  const contact = valid ? result?.contacts?.[selected] : null;
  const signal = valid ? result?.signals?.[selected] : null;
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          '',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card connection-check" aria-label="连接与佩戴检测">
      <div className="section-title">
        <div>
          <div className="eyebrow">CONNECTION CHECK</div>
          <h2>连接与佩戴检测</h2>
          <p>被动干电极 · 16 通道 · 一次约 2 分钟</p>
        </div>
        <span className={`check-outcome ${completed ? result?.overall : 'unknown'}`}>
          {demo ? '模拟检测 · ' : ''}
          {completed
            ? labels[result?.overall || 'unknown']
            : active
              ? '检测中'
              : result?.scope === 'single'
                ? '单电极记录 · 非整体验证'
                : '等待检测'}
        </span>
      </div>
      <div className="check-steps">
        {[
          ['connection', '连接稳定性', Activity],
          ['impedance', '电极接触', Headphones],
          ['signal', '信号稳定性', ShieldCheck],
        ].map(([id, label, Icon]) => {
          const Glyph = Icon as typeof Activity;
          const index = ['connection', 'impedance', 'signal'].indexOf(String(id));
          const current = ['connection', 'impedance', 'signal'].indexOf(phase);
          const done = completed || (result?.scope !== 'single' && current > index);
          const grade =
            id === 'connection'
              ? result?.connection || 'unknown'
              : worst(
                  (id === 'impedance' ? result?.contacts : result?.signals)?.map(
                    (r) => r?.quality || 'unknown',
                  ) || ['unknown'],
                );
          return (
            <div
              key={String(id)}
              className={phase === id ? 'current' : done ? `done ${grade}` : ''}
            >
              <Glyph size={20} />
              <span>{String(label)}</span>
              {done ? (
                grade === 'good' ? (
                  <Check size={16} />
                ) : (
                  <CircleAlert size={16} />
                )
              ) : phase === id ? (
                <LoaderCircle size={16} className="spin" />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="check-instruction">
        <b>
          {active
            ? result?.detail
            : completed
              ? result?.detail
              : !connected
                ? '请先连接设备，收到信号后开始检测。'
                : phase === 'cancelled' || phase === 'error'
                  ? result?.detail
                  : '保持静止，让电极贴紧头皮，检查头顶的参考电极与额头的接地电极（BIAS）接触。'}
        </b>
        <p>
          检测会暂时中断波形和 Alpha 分析；正在进行的 Alpha
          实验会结束。检测完成后自动恢复采集，重新积累分析数据。
        </p>
      </div>
      {!active && (
        <label className="checkbox-label check-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我使用普通被动干电极：信号接 N 端，参考接 SRB2，BIAS 已按设备说明连接。
        </label>
      )}
      <div className="check-actions">
        {active ? (
          <button className="secondary" disabled={busy} onClick={() => act(onCancel)}>
            取消检测并恢复采集
          </button>
        ) : (
          <button
            className="primary"
            disabled={!connected || (!confirmed && !demo) || busy}
            onClick={() => act(onStart)}
          >
            {busy ? '正在处理…' : completed ? '重新检测' : '开始连接检测'}
          </button>
        )}
        <span className="muted small">
          {active && phase === 'impedance'
            ? `CH ${String((result?.channel ?? 0) + 1).padStart(2, '0')} / 16`
            : '调整佩戴后，请重新检测；结果仅代表本次观察。'}
        </span>
      </div>
      {error && (
        <p role="alert" className="check-error">
          {error}
        </p>
      )}
      {result && phase !== 'idle' && (
        <>
          <div className="check-summary">
            <span>
              <i className={`dot ${valid ? result.connection || 'unknown' : 'unknown'}`} />
              连接：{valid ? labels[result.connection || 'unknown'] : '待判断'}
            </span>
            {result.observedRate !== undefined && valid && (
              <span>
                观察接收速率 {result.observedRate} 样本/秒 · 序号不连续 {result.discontinuities} 次
              </span>
            )}
            <span>参考电极 / BIAS：需手动核对</span>
          </div>
          <div className="check-grid">
            {Array.from({ length: 16 }, (_, i) => {
              const r = valid ? result.contacts?.[i] : null;
              return (
                <button
                  key={i}
                  className={`check-channel ${selected === i ? 'selected' : ''} ${active && phase === 'impedance' && result.channel === i ? 'measuring' : ''}`}
                  onClick={() => onSelect(i)}
                  aria-label={`查看接触检测通道 ${i + 1}`}
                  aria-pressed={selected === i}
                >
                  <span>
                    <i className={`dot ${r?.quality || 'unknown'}`} />
                    CH {String(i + 1).padStart(2, '0')}
                  </span>
                  <b>{r?.kohm != null ? `${r.kohm.toLocaleString()} kΩ` : '—'}</b>
                  <small>
                    {active && phase === 'impedance' && result.channel === i
                      ? '正在测量…'
                      : labels[r?.quality || 'unknown']}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="check-detail">
            <b>CH {String(selected + 1).padStart(2, '0')}</b>
            <span>接触：{contact?.reason || '尚未完成有效检测'}</span>
            <span>
              信号：{signal?.reason || '尚未完成稳定性观察'}
              {signal?.mainsPercent != null ? ` · 工频占比 ${signal.mainsPercent}%` : ''}
            </span>
          </div>
          {completed && (
            <p className="micro">
              本次检测完成于 {new Date((result.at || 0) * 1000).toLocaleTimeString()}
              。多个通道异常时，先核对头顶的参考电极、额头的接地电极（BIAS）和整体佩戴，再逐个调整。
            </p>
          )}
        </>
      )}
      <details className="check-method">
        <summary>查看判定依据与适用范围</summary>
        <p>
          接触检测使用 Cyton 的引导脱落测试，逐通道切换为 1 倍增益；测量后恢复本应用默认的 24
          倍增益、正常输入、BIAS 纳入、SRB2 连接、SRB1 断开。
        </p>
        <p>
          阻抗换算采用 OpenBCI GUI 的 6 nA 测试电流、减去 2.2 kΩ 串联电阻；使用默认 5–50 Hz 滤波与
          50/60 Hz 工频抑制。分档采用 GUI 默认值：低于 750 kΩ 为绿色，750–2500 kΩ 为橙色，高于 2500
          kΩ 为红色。无可靠测试响应保持灰色。不同滤波设置或固件会影响与原版 GUI 的数值对比。
        </p>
        <p>
          信号检查包含原版
          Railed，以及近乎不变、工频占比和突跳提示。后面三项是本应用的初步辅助规则（标准差低于 0.2
          µV、工频占比超过 50%、相邻样本变化超过 500
          µV），不是原版佩戴判定标准。通过代表本次检查未发现明显异常，无法证明电极位置正确或单独确认参考电极
          / BIAS 接触。
        </p>
      </details>
    </section>
  );
}
