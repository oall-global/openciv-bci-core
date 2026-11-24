import { useState } from 'react';
import type { Api } from './types';
import { CATALOG, DEFAULT_MONTAGE, REQUIRED, electrodeNames, site } from './electrodes';
import { cleanError } from './controls/shared';

// 设置 → 电极位置: which scalp position each channel (CH1..CH16) records. The default is the
// OpenBCI GUI 16-channel montage.
export default function MontageSettings({
  api,
  onChange,
}: {
  api: Api;
  onChange: (names: string[]) => void;
}) {
  const [names, setNames] = useState<string[]>([...electrodeNames]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const counts = names.reduce<Record<string, number>>(
    (c, n) => ({ ...c, [n]: (c[n] ?? 0) + 1 }),
    {},
  );
  const duplicate = Object.keys(counts).filter((n) => counts[n] > 1);
  const changed = names.some((n, i) => n !== electrodeNames[i]);
  const isDefault = names.every((n, i) => n === DEFAULT_MONTAGE[i]);
  const missing = REQUIRED.map(
    ([feature, need]) => [feature, need.filter((n) => !names.includes(n))] as const,
  ).filter(([, m]) => m.length);

  async function save(next: string[]) {
    setError('');
    setMessage('');
    try {
      const r = await api.montage(next);
      onChange(r.names);
      setMessage(
        '电极位置已保存，之后的记录和分析都按新的对应关系进行。已训练的模型建议重新训练。',
      );
    } catch (e) {
      setError(cleanError(e));
    }
  }

  return (
    <section className="card settings-card montage-settings">
      <h3>电极位置</h3>
      <div className="montage-grid">
        {names.map((n, i) => (
          <label key={i} className={duplicate.includes(n) ? 'dup' : ''}>
            <span className="mono">CH {i + 1}</span>
            <select
              aria-label={`CH ${i + 1} 电极位置`}
              value={n}
              onChange={(e) => setNames(names.map((x, k) => (k === i ? e.target.value : x)))}
            >
              {CATALOG.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} · {s.place}
                </option>
              ))}
            </select>
            {n !== DEFAULT_MONTAGE[i] && <em>默认 {DEFAULT_MONTAGE[i]}</em>}
          </label>
        ))}
      </div>
      {duplicate.length > 0 && (
        <p className="task-error">位置重复：{duplicate.join('、')}。每个位置只能对应一个通道。</p>
      )}
      {missing.length > 0 && (
        <p className="montage-note">
          {missing.map(([feature, m]) => `${feature}需要 ${m.join('、')}`).join('；')}
          ，缺少时这些功能无法使用或效果变差。
        </p>
      )}
      {error && <p className="task-error">{error}</p>}
      {message && <p className="montage-note ok">{message}</p>}
      <div className="montage-actions">
        <button
          className="primary"
          disabled={!changed || duplicate.length > 0}
          onClick={() => void save(names)}
        >
          保存电极位置
        </button>
        <button
          className="secondary"
          disabled={isDefault && !changed}
          onClick={() => {
            setNames([...DEFAULT_MONTAGE]);
            if (electrodeNames.some((n, i) => n !== DEFAULT_MONTAGE[i]))
              void save([...DEFAULT_MONTAGE]);
          }}
        >
          恢复默认布局
        </button>
        <span className="montage-current">
          当前：
          {electrodeNames.every((n, i) => n === DEFAULT_MONTAGE[i])
            ? 'OpenBCI 默认布局'
            : '自定义布局'}
          {' · '}
          {electrodeNames.map((n) => site(n).name).join(' ')}
        </span>
      </div>
    </section>
  );
}
