// 数据: every recording on this computer — 录制脑电 and task recordings — as cards, newest first.
// A card opens large; the large card opens the details: information and quality, events and
// results, the 脑图 (relative band power on the brain) and the replay. The cards are made from the raw EEG the first time they are shown.
// Every recording exports as BDF, from its card and from the details, can be renamed on the
// large card and in the details, and deleted (to the recycle bin) from its card and the details.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import type { Api } from '../types';
import { electrodeNames } from '../electrodes';
import { displayTitles, makeCard, type DataItem } from './cardMaker';
import { BrainMap } from './BrainMap';

type Detail = {
  kind: 'moment' | 'session';
  id: string;
  title: string;
  type: 'recording' | 'task';
  start: string;
  seconds: number;
  rate: number;
  channels: number;
  samples: number;
  source?: string;
  status?: string;
  abortReason?: string | null;
  participant?: string | null;
  note?: string;
  lost: number;
  restarts: number;
  usable: number[];
  railed?: number[];
  names?: string[];
  clock?: { latencyMax?: number; driftPpm?: number } | null;
  events: { t: number; label: string; source?: string; name?: string | null }[];
  results: { headline?: string } | null;
};
const SOURCES: Record<string, string> = {
  instruction: '提示',
  observed: '观察',
  manual: '标记',
  prediction: '识别',
  command: '指令',
  unknown: '—',
};
// cond.<key>.start / .end as the state's name, e.g. 执行 · 开始
function eventName(e: { label: string; name?: string | null }) {
  const m = /^cond\.(.+)\.(start|end)$/.exec(e.label);
  return m ? `${e.name || m[1]} · ${m[2] === 'start' ? '开始' : '结束'}` : e.label;
}
// rounded as the recording's card rounds it, so 15.6 s reads 00:16 on both
const mmss = (t: number) => {
  const s = Math.round(t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const when = (s: string) =>
  new Date(s).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const key = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;
const clockOf = (s: string) =>
  new Date(s).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
// 今天 / 昨天 / 10月22日 (with the year when not this year)
function day(s: string) {
  const d = new Date(s),
    now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return d.toLocaleDateString('zh-CN', {
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    month: 'long',
    day: 'numeric',
  });
}

export default function DataPage({
  api,
  onReplay,
  onAdd,
}: {
  api: Api;
  onReplay: (kind: 'moment' | 'session', id: string, title: string) => void;
  onAdd: () => void; // 添加脑电数据: record on 信号工作台
}) {
  const [list, setList] = useState<DataItem[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [valid, setValid] = useState<Record<string, number | null>>({});
  const titles = useMemo(() => displayTitles(list ?? []), [list]);
  const title = (it: DataItem) => titles.get(key(it)) ?? it.title;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [large, setLarge] = useState<{ item: DataItem; card: string | null } | null>(null);
  const [detail, setDetail] = useState<{
    item: DataItem;
    data: Detail | null;
    card: string | null;
  } | null>(null);
  const making = useRef(false);
  const [version, setVersion] = useState(0); // a rename lists again and remakes that card

  useEffect(() => {
    let gone = false;
    api
      .data('list')
      .then(async (l: DataItem[]) => {
        if (gone) return;
        setList(l);
        setValid(Object.fromEntries(l.map((it) => [key(it), it.info?.valid ?? null])));
        const names = displayTitles(l);
        // saved thumbnails first, then make the missing cards one by one (newest first)
        for (const it of l.filter((i) => i.thumb)) {
          const url = await api.data('image', { kind: it.kind, id: it.id, name: 'thumb11.jpg' });
          if (gone) return;
          if (url) setThumbs((t) => ({ ...t, [key(it)]: url }));
        }
        if (making.current) return;
        making.current = true;
        for (const it of l.filter((i) => !i.thumb)) {
          if (gone) break;
          try {
            const made = await makeCard(api, it, names.get(key(it)) ?? it.title);
            if (gone) break;
            setThumbs((t) => ({ ...t, [key(it)]: made.thumb }));
            setValid((v) => ({ ...v, [key(it)]: made.valid }));
          } catch {
            if (!gone) setThumbs((t) => ({ ...t, [key(it)]: '' })); // no usable EEG
          }
        }
        making.current = false;
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      gone = true;
    };
  }, [api, version]);

  async function rename(item: DataItem, name: string) {
    setError('');
    try {
      await api.data('rename', { kind: item.kind, id: item.id, name });
      setThumbs((t) => {
        const { [key(item)]: _, ...rest } = t;
        return rest;
      });
      setLarge((l) => (l && key(l.item) === key(item) ? { ...l, card: null } : l));
      setDetail((d) => (d && key(d.item) === key(item) ? { ...d, card: null } : d));
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function enlarge(item: DataItem) {
    setLarge({ item, card: null });
    const card = await api.data('image', { kind: item.kind, id: item.id, name: 'card11.png' });
    setLarge((l) => (l && key(l.item) === key(item) ? { item, card } : l));
  }
  async function open(item: DataItem, card: string | null) {
    setLarge(null);
    setDetail({ item, data: null, card });
    try {
      const data = await api.data('detail', { kind: item.kind, id: item.id });
      setDetail((d) => (d && key(d.item) === key(item) ? { ...d, data } : d));
    } catch (e) {
      setError((e as Error).message);
      setDetail(null);
    }
  }

  async function exportBdf(item: DataItem) {
    setError('');
    setNotice('');
    try {
      const r = await api.data('export', { kind: item.kind, id: item.id });
      if (r)
        setNotice(
          `已导出 BDF，共 ${r.seconds} 秒${r.filledSeconds ? `，其中 ${r.filledSeconds} 秒为传输丢失，已标记为无效` : ''}：${r.file}`,
        );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // all finished experiment runs as one BIDS dataset (it was under 「探索 · 我的记录」)
  async function exportBids() {
    setError('');
    setNotice('');
    try {
      const r = await api.session('export-bids');
      if (r) setNotice(`已导出 ${r.sessions} 个会话、${r.participants} 位被试到 ${r.root}`);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    }
  }
  async function remove(item: DataItem) {
    setError('');
    setNotice('');
    try {
      const used: string[] = await api.data('used-by', { kind: item.kind, id: item.id });
      const ask =
        `删除「${title(item)}」？会移到回收站。` +
        (used.length ? `\n能力「${used.join('」「')}」的训练数据会少这一段。` : '');
      if (!window.confirm(ask)) return;
      await api.data('delete', { kind: item.kind, id: item.id });
      setDetail((d) => (d && key(d.item) === key(item) ? null : d));
      setLarge((l) => (l && key(l.item) === key(item) ? null : l));
      setList((l) => l?.filter((x) => key(x) !== key(item)) ?? l);
      setNotice(`已删除「${title(item)}」，可以在回收站里找回`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const messages = (
    <>
      {error && <p className="task-error">{error}</p>}
      {notice && <p className="data-notice">{notice}</p>}
    </>
  );

  if (detail)
    return (
      <DetailView
        messages={messages}
        onRename={(name) => void rename(detail.item, name)}
        onExport={() => void exportBdf(detail.item)}
        onDelete={() => void remove(detail.item)}
        item={{ ...detail.item, title: title(detail.item) }}
        data={detail.data}
        card={detail.card ?? undefined} // the card only: the 4:3 grid picture would stretch
        api={api}
        onBack={() => setDetail(null)}
        onReplay={() => onReplay(detail.item.kind, detail.item.id, title(detail.item))}
      />
    );

  const shown = list ?? [];
  // grouped by day, newest first
  const groups: [string, DataItem[]][] = [];
  for (const it of shown) {
    const d = day(it.start);
    if (groups.at(-1)?.[0] !== d) groups.push([d, []]);
    groups.at(-1)![1].push(it);
  }
  return (
    <div className="data-page">
      <div className="page-heading compact">
        <div>
          <h1>脑电数据库</h1>
        </div>
        {/* nothing to export from an empty library */}
        {shown.length > 0 && (
          <button className="secondary data-bids" onClick={() => void exportBids()}>
            导出 BIDS 数据集
          </button>
        )}
        <button className="primary data-add" onClick={onAdd}>
          <Plus size={16} strokeWidth={2.4} />
          添加脑电数据
        </button>
      </div>
      {messages}
      {list && shown.length === 0 && (
        <div className="data-empty moments-empty">
          <b>还没有脑电记录</b>
          <p>在信号工作台点「录制脑电」，记录会出现在这里。</p>
        </div>
      )}
      {groups.map(([d, items]) => (
        <section key={d} className="data-day">
          <h2>{d}</h2>
          <div className="data-grid">
            {items.map((it) => {
              const url = thumbs[key(it)],
                v = valid[key(it)];
              return (
                <div key={key(it)} className="data-card-wrap">
                  <button
                    className="data-card"
                    aria-label={`${title(it)} ${when(it.start)}`}
                    onClick={() => void enlarge(it)}
                  >
                    <span className="data-thumb">
                      {url ? (
                        <img src={url} alt="" />
                      ) : (
                        <span className="data-noimg">
                          {url === '' ? '没有可用的脑电' : '正在生成…'}
                        </span>
                      )}
                      <em className={`data-type ${it.type}`}>
                        {it.type === 'task' ? '会话' : '录制脑电'}
                      </em>
                      <span className="data-badges">
                        <i className="mono">{mmss(it.seconds)}</i>
                        {v !== null && v !== undefined && (
                          <i className={`mono ${v < 0.8 ? 'low' : ''}`}>
                            有效 {Math.round(v * 100)}%
                          </i>
                        )}
                      </span>
                    </span>
                    <span className="data-meta">
                      <b>{title(it)}</b>
                      <small>
                        {/* the time once: default titles already carry it */}
                        {title(it).startsWith('录制 · ') ? '' : clockOf(it.start)}
                        {it.participant ? ` · ${it.participant}` : ''}
                        {it.source === 'demo' ? ' · 模拟数据' : ''}
                        {it.status === 'aborted' ? ' · 已中止' : ''}
                      </small>
                    </span>
                  </button>
                  <button
                    className="data-export"
                    aria-label={`导出 BDF：${title(it)}`}
                    title="导出 BDF"
                    onClick={() => void exportBdf(it)}
                  >
                    <Download size={15} />
                  </button>
                  <button
                    className="data-delete"
                    aria-label={`删除：${title(it)}`}
                    title="删除"
                    onClick={() => void remove(it)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {large && (
        <div
          className="data-large"
          role="dialog"
          aria-label="数据卡片"
          onClick={() => setLarge(null)}
        >
          <button className="share-close" aria-label="关闭" onClick={() => setLarge(null)}>
            <X size={18} />
          </button>
          <div className="data-large-body">
            {/* the title drawn on the card: a text cursor over it, a click edits it there */}
            <div className="data-card-title" onClick={(e) => e.stopPropagation()}>
              <Rename
                overlay
                value={title(large.item)}
                onSave={(n) => void rename(large.item, n)}
              />
            </div>
            <button
              className="data-large-card"
              aria-label="查看数据详情"
              onClick={(e) => {
                e.stopPropagation();
                void open(large.item, large.card);
              }}
            >
              {/* only the card itself: the grid picture is 4:3 and would stretch here */}
              {large.card ? (
                <img src={large.card} alt={title(large.item)} />
              ) : (
                <div className="data-noimg">正在生成…</div>
              )}
              <span>查看数据详情</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** a name with 重命名: Enter or leaving the field saves, Escape cancels; empty = the default */
function Rename({
  value,
  onSave,
  overlay = false,
}: {
  value: string;
  onSave: (name: string) => void;
  overlay?: boolean; // over the title drawn on a card: no text or pencil, only the cursor
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const closed = useRef(false); // Enter / Escape already ended it (the blur that follows is not)
  const done = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    setEditing(false);
    if (save && text.trim() !== value) onSave(text.trim());
  };
  const start = () => {
    setText(value);
    closed.current = false;
    setEditing(true);
  };
  if (!editing && overlay)
    return <button className="data-title-hit" aria-label="重命名" title="重命名" onClick={start} />;
  if (!editing)
    return (
      <span className="data-name">
        <span>{value}</span>
        <button className="text-button" aria-label="重命名" title="重命名" onClick={start}>
          <Pencil size={15} />
        </button>
      </span>
    );
  return (
    <input
      className="data-rename"
      aria-label="名称"
      autoFocus
      maxLength={40}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      }}
      onBlur={() => done(true)}
    />
  );
}

function DetailView({
  item,
  data,
  card,
  api,
  messages,
  onBack,
  onReplay,
  onExport,
  onRename,
  onDelete,
}: {
  item: DataItem;
  data: Detail | null;
  card?: string;
  api: Api;
  messages: ReactNode;
  onBack: () => void;
  onReplay: () => void;
  onExport: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const valid = data ? data.usable.reduce((a, v) => a + v, 0) / Math.max(1, data.usable.length) : 0;
  const rows: [string, string][] = data
    ? [
        ['类型', data.type === 'task' ? `会话 · ${data.title}` : '录制脑电'],
        ['开始', when(data.start)],
        ['时长', `${mmss(data.seconds)}（${data.seconds.toFixed(1)} 秒）`],
        ['被试', data.participant ?? '—'],
        ['数据来源', data.source === 'demo' ? '模拟数据' : '设备'],
        ['通道 · 采样率', `${data.channels} 通道 · ${data.rate} Hz`],
        ['样本数', `${data.samples.toLocaleString()} × ${data.channels}`],
        ...(data.status === 'aborted'
          ? ([['状态', `已中止${data.abortReason ? `：${data.abortReason}` : ''}`]] as [
              string,
              string,
            ][])
          : []),
      ]
    : [];
  return (
    <div className="data-detail">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={15} /> 返回脑电数据库
      </button>
      {messages}
      <div className="data-detail-body">
        <aside>{card ? <img src={card} alt={item.title} /> : <div className="data-noimg" />}</aside>
        <div className="data-detail-info">
          <h1>
            <Rename value={item.title} onSave={onRename} />
          </h1>
          {!data ? (
            <p>正在读取…</p>
          ) : (
            <>
              <div className="data-detail-actions">
                <button className="primary" onClick={onReplay}>
                  <Play size={15} /> 信号回放
                </button>
                <button className="secondary" onClick={onExport}>
                  <Download size={15} /> 导出 BDF
                </button>
                <button className="secondary danger" onClick={onDelete}>
                  <Trash2 size={15} /> 删除
                </button>
              </div>
              {/* 脑图 first in the right column */}
              <BrainMap api={api} item={item} />
              <section>
                <h2>录制信息</h2>
                <dl>
                  {rows.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section>
                <h2>数据质量</h2>
                <dl>
                  <div>
                    <dt>有效数据</dt>
                    <dd>{Math.round(valid * 100)}%</dd>
                  </div>
                  <div>
                    <dt>传输丢失</dt>
                    <dd>
                      {data.lost
                        ? `${data.lost} 个样本（${(data.lost / data.rate).toFixed(2)} 秒）`
                        : '无'}
                      {data.restarts ? `；计数中断 ${data.restarts} 次` : ''}
                    </dd>
                  </div>
                  {data.clock?.latencyMax !== undefined && (
                    <div>
                      <dt>最大传输延迟</dt>
                      <dd>{data.clock.latencyMax.toFixed(2)} 秒</dd>
                    </div>
                  )}
                </dl>
                <div className="data-channels" aria-label="各电极有效数据">
                  {data.usable.map((v, c) => (
                    <span key={c} title={`${Math.round(v * 100)}%`}>
                      <i style={{ height: `${Math.round(v * 100)}%` }} />
                      <small>{data.names?.[c] ?? electrodeNames[c] ?? c + 1}</small>
                    </span>
                  ))}
                </div>
              </section>
              <Metrics api={api} item={item} />
              <section>
                <h2>事件与结果</h2>
                {data.results?.headline && <p className="data-result">{data.results.headline}</p>}
                {data.events.length ? (
                  <table className="data-events">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>事件</th>
                        <th>来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.slice(0, 200).map((e, i) => (
                        <tr key={i}>
                          <td className="mono">{mmss(e.t)}</td>
                          <td>{eventName(e)}</td>
                          <td>{SOURCES[e.source ?? 'unknown'] ?? e.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="data-none">没有事件</p>
                )}
                {data.events.length > 200 && (
                  <p className="data-none">只显示前 200 个，共 {data.events.length} 个</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 脑电指标 (electron/metrics.cjs): the values, what each is on hover; 脑电年龄 left out
type Metric = {
  id: string;
  name: string;
  display: string;
  reliability: 'solid' | 'moderate' | 'weak' | 'none';
  level: string;
  note: string;
};
function Metrics({ api, item }: { api: Api; item: DataItem }) {
  const [m, setM] = useState<{ items: Metric[] } | null | 'error'>(null);
  useEffect(() => {
    let gone = false;
    setM(null);
    api
      .data('metrics', { kind: item.kind, id: item.id })
      .then((r: { items: Metric[] }) => !gone && setM(r))
      .catch(() => !gone && setM('error'));
    return () => {
      gone = true;
    };
  }, [api, item.kind, item.id]);
  return (
    <section>
      <h2>脑电指标</h2>
      {m === null ? (
        <p className="data-none">正在计算…</p>
      ) : m === 'error' ? (
        <p className="data-none">这段录制算不出指标</p>
      ) : (
        <>
          <dl className="data-metrics">
            {m.items
              .filter((it) => it.id !== 'age') // 脑电年龄 is not shown here
              .map((it) => (
                <div key={it.id} title={it.note}>
                  <dt>{it.name}</dt>
                  <dd>
                    <span>{it.display}</span>
                  </dd>
                </div>
              ))}
          </dl>
        </>
      )}
    </section>
  );
}
