// 脑图 in the details of a recording, as quantitative EEG reports draw it: relative power of nine
// bands on the brain seen from above (forehead up), eyes closed / eyes open when the recording
// marks them. Each map: 相对功率 · range, the band, the state; the brain (drawn at 340 px and
// scaled, so the cortex keeps its texture) in a stepped rainbow. All maps, both states, share one
// scale (the lowest to the highest share anywhere) and one bar under them, so a colour means the
// same share on every map and 闭眼 / 睁眼 compare directly. Figures: electron/metrics.cjs bandMap.
import { useEffect, useRef, useState } from 'react';
import type { Api } from '../types';
import { electrodes } from '../electrodes';
import { BrainScene } from '../home/brainScene';
import type { DataItem } from './cardMaker';

type Map = {
  bands: { name: string; lo: number; hi: number }[];
  states: { name: string; rel: (number | null)[][] }[];
};

const STOPS: [number, number[]][] = [
  [0, [38, 48, 140]],
  [0.15, [45, 90, 210]],
  [0.35, [60, 190, 230]],
  [0.5, [150, 220, 120]],
  [0.65, [240, 230, 70]],
  [0.8, [245, 150, 40]],
  [1, [215, 35, 40]],
];
export const STEPS = 12;
/** the stepped rainbow, 0..1 → rgb 0..255 */
export function rainbow(t: number) {
  const q = Math.min(STEPS - 1, Math.max(0, Math.floor(t * STEPS))) / (STEPS - 1);
  let k = 0;
  while (k < STOPS.length - 2 && q > STOPS[k + 1][0]) k++;
  const [a, ca] = STOPS[k],
    [b, cb] = STOPS[k + 1],
    s = (q - a) / (b - a);
  return ca.map((x, i) => Math.round(x + (cb[i] - x) * s));
}

const ENGLISH: Record<string, string> = {
  δ: 'Delta',
  θ: 'Theta',
  α: 'Alpha',
  α1: 'Alpha 1',
  α2: 'Alpha 2',
  '低 β': 'Low-Beta',
  '中 β': 'Mid-Beta',
  '高 β': 'High-Beta',
  γ: 'Gamma',
};

export function BrainMap({
  api,
  item,
  title = '脑图',
}: {
  api: Api;
  item: Pick<DataItem, 'kind' | 'id'>;
  title?: string; // 大脑频段图 in 你的大脑报告
}) {
  const [m, setM] = useState<Map | null | 'error'>(null);
  const [state, setState] = useState(0);
  const scene = useRef<BrainScene | null>(null);
  const [ready, setReady] = useState(false);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let gone = false;
    setM(null);
    setState(0);
    api
      .data('bandmap', { kind: item.kind, id: item.id })
      .then((r: Map) => !gone && setM(r))
      .catch(() => !gone && setM('error'));
    return () => {
      gone = true;
    };
  }, [api, item.kind, item.id]);

  useEffect(() => {
    let gone = false;
    void BrainScene.create(electrodes.map((e) => e.xyz)).then((s) => {
      if (gone) return s.dispose();
      s.markers(false);
      s.transparent();
      scene.current = s;
      setReady(true);
    });
    return () => {
      gone = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const st = m && m !== 'error' ? m.states[Math.min(state, m.states.length - 1)] : null;
  const all =
    m && m !== 'error'
      ? m.states.flatMap((s) => s.rel.flat()).filter((v): v is number => v != null)
      : [];
  const lo = all.length ? Math.min(...all) : 0,
    hi = all.length ? Math.max(...all) : 0;
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s || !st) return;
    st.rel.forEach((vals, b) => {
      const c = canvases.current[b];
      if (!c) return;
      s.colorBy(vals, (v) => rainbow((v - lo) / (hi - lo || 1)).map((x) => x / 255));
      const shot = document.createElement('canvas');
      shot.dataset.native = '';
      shot.style.cssText =
        'position:fixed;left:-9999px;top:0;width:340px;height:340px;max-width:none;max-height:none';
      document.body.append(shot);
      s.draw('top', shot, 1.05, true);
      c.width = shot.width;
      c.height = shot.height;
      const g = c.getContext('2d');
      g?.clearRect(0, 0, c.width, c.height);
      g?.drawImage(shot, 0, 0);
      shot.remove();
    });
  }, [ready, st, lo, hi]);

  return (
    <section>
      <h2>{title}</h2>
      {m === null ? (
        <p className="data-none">正在计算…</p>
      ) : m === 'error' || !st ? (
        <p className="data-none">这段录制画不出脑图</p>
      ) : (
        <>
          {m.states.length > 1 && (
            <div className="data-brainmap-states" role="tablist">
              {m.states.map((s, i) => (
                <button
                  key={s.name}
                  role="tab"
                  aria-selected={i === state}
                  className={i === state ? 'on' : ''}
                  onClick={() => setState(i)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className="data-brainmap">
            {m.bands.map((b, i) => (
              <figure key={b.name}>
                <figcaption>
                  <small>
                    相对功率 · {b.lo}–{b.hi} Hz
                  </small>
                  <b>
                    {b.name}
                    <span>{ENGLISH[b.name] ?? ''}</span>
                  </b>
                  <em>{st.name}</em>
                </figcaption>
                <canvas ref={(el) => void (canvases.current[i] = el)} data-native="" />
              </figure>
            ))}
          </div>
          <div
            className="data-brainmap-bar"
            aria-label={`颜色范围 ${lo.toFixed(1)}% 到 ${hi.toFixed(1)}%`}
          >
            <div>
              {Array.from({ length: STEPS }, (_, k) => (
                <i key={k} style={{ background: `rgb(${rainbow((k + 0.5) / STEPS).join(',')})` }} />
              ))}
            </div>
            <p>
              {Array.from({ length: 7 }, (_, k) => (
                <u key={k} />
              ))}
            </p>
            <span className="mono">
              <span>{all.length ? `${lo.toFixed(1)}%` : '—'}</span>
              <span>{all.length ? `${hi.toFixed(1)}%` : ''}</span>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
