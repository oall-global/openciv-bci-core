import { useEffect, useRef, useState } from 'react';
import { electrodes } from './electrodes';
import { BrainScene, PALETTE_CSS, ratioPosition, type View } from './home/brainScene';
import { BANDS, BAND_ORDER, READY, STEP, brainHistory } from './home/brainHistory';

type Band = (typeof BANDS)[number][0];
const VIEWS: [View, string, number][] = [
  ['top', '上', 0.95],
  ['left', '左', 1.3],
  ['right', '右', 1.3],
  ['back', '后', 1.2],
];
const geoMean = (a: number[]) => {
  const ok = a.filter(Number.isFinite);
  return ok.length ? Math.exp(ok.reduce((x, y) => x + y, 0) / ok.length) : NaN;
};

// 数字大脑 as a workbench chart: the main view of 运行画面 (src/home/BrainView.tsx) without
// the task parts. Uses the band power history collected in the background.
export default function DigitalBrain({ streaming }: { streaming: boolean }) {
  const [scene, setScene] = useState<BrainScene | null>(null);
  const [error, setError] = useState('');
  const [band, setBand] = useState<Band>('alpha');
  const [view, setView] = useState<View>('top');
  const [tick, setTick] = useState(0);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let s: BrainScene | null = null,
      gone = false;
    BrainScene.create(electrodes.map((e) => e.xyz))
      .then((created) => {
        if (gone) created.dispose();
        else setScene((s = created));
      })
      .catch(() => setError('无法加载大脑模型'));
    return () => {
      gone = true;
      s?.dispose();
    };
  }, []);
  useEffect(() => brainHistory.subscribe(() => setTick((n) => n + 1)), []);
  // Redraw when the chart cell changes size (layout, 放大).
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = brainHistory.frames;
  const last = h[h.length - 1];
  const b = BANDS.findIndex(([id]) => id === band);
  const values = last?.r?.[b] ?? null;
  useEffect(() => {
    if (!scene || !canvas.current) return;
    scene.paint(values);
    scene.draw(view, canvas.current, VIEWS.find(([v]) => v === view)![2]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, tick, band, view]);

  return (
    <div className="dbrain">
      <canvas ref={canvas} aria-label="数字大脑" />
      <div className="dbrain-views" role="radiogroup" aria-label="视角">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            role="radio"
            aria-checked={view === v}
            className={view === v ? 'on' : ''}
            title={{ top: '上面观', left: '左侧面', right: '右侧面', back: '后面观' }[v]}
            onClick={() => setView(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dbrain-bands" role="radiogroup" aria-label="频段">
        {BAND_ORDER.map(([id, sym, lo, hi, k]) => {
          const r = last?.r ? geoMean(last.r[k]) : NaN;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={band === id}
              className={band === id ? 'on' : ''}
              onClick={() => setBand(id)}
            >
              <span>
                {sym} {lo}–{hi}
              </span>
              <b>{Number.isFinite(r) ? `${r.toFixed(1)}×` : '—'}</b>
            </button>
          );
        })}
      </div>
      <div className="dbrain-cbar">
        <div style={{ background: PALETTE_CSS }} />
        <div>
          {[3, 2, 1, 0.5].map((v) => (
            <span key={v} style={{ bottom: `${ratioPosition(v) * 100}%` }}>
              {v}×
            </span>
          ))}
        </div>
      </div>
      {(!streaming || !last?.r || error) && (
        <div className="dbrain-wait">
          {error ||
            (!streaming
              ? '连接设备后显示大脑活动'
              : `初始化中（正在建立基线，${Math.min(10, Math.round(Math.min(h.length, READY) * STEP))}/10 秒）`)}
        </div>
      )}
    </div>
  );
}
