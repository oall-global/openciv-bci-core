// The head of 三维头像 (src/lab/head3d, from neural-view) with the 主图's brain inside, on this
// app's live EEG: used by 三维头像 (HeadPage) and by 首次打开's 佩戴 step, where the electrodes
// show their contact.
//
// The head scene reads the local interface's messages (SignalStore): status, quality, per-
// channel checks and waves. They are made here from the engine's data: each channel filtered
// as the 主图 draws it (displayFilter, as OpenBCI GUI), its contact as the channel check.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Mesh, Object3D, ShaderMaterial } from 'three';
import type { Api } from '../types';
import { displayFilter } from '../displayFilter';
import { BrainScene } from '../home/brainScene';
import { brainHistory } from '../home/brainHistory';
import { electrodes, electrodeNames } from '../electrodes';
import { HeadScene } from './head3d/HeadScene.jsx';
import { SignalStore } from './head3d/signal.mjs';
import './head3d/head3d.css';

const WINDOW_S = 4;
const WEAR_FLOOR = [0.03, 0.1, 0.24]; // the filter runs over the last 4 s, as the 主图

// the brain inside the head, painted with each new 0.5 s frame (α, relative to the baseline);
// paintLatest false: its owner paints it (the 主图: the chosen band, the replayed frame);
// floor: the least colour of the cortex (linear RGB), none by default
export function useHeadBrain(paintLatest = true, floor?: number[]) {
  const [brain, setBrain] = useState<Object3D | null>(null);
  const [owner, setOwner] = useState<BrainScene | null>(null);
  useEffect(() => {
    let scene: BrainScene | null = null,
      gone = false;
    void BrainScene.create(
      electrodes.map((e) => e.xyz),
      { glass: true },
    )
      .then((created) => {
        if (gone) return created.dispose();
        scene = created;
        // under the head scene's bloom the 主图's brightness glares: a quieter cortex and a
        // fainter glass outline (its rim shader's strength)
        created.setGain(0.5);
        if (floor) created.setFloor(floor);
        created.paint(null);
        created.brainRoot?.traverse((o) => {
          const m = (o as Mesh).material as ShaderMaterial | undefined;
          if (m?.isShaderMaterial && m.fragmentShader.includes('rim * 0.55')) {
            m.fragmentShader = m.fragmentShader.replace('rim * 0.55', 'rim * 0.22');
            m.needsUpdate = true;
          }
        });
        setBrain(created.brainRoot);
        setOwner(created);
      })
      .catch(() => {}); // no brain model: the head alone
    const off = paintLatest
      ? brainHistory.subscribe(() => {
          const f = brainHistory.frames.at(-1);
          scene?.paint(f?.r?.[2] ?? null);
        })
      : () => {};
    return () => {
      gone = true;
      off();
      scene?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { brain, scene: owner };
}

type DataEvent = Extract<Parameters<Parameters<Api['subscribe']>[0]>[0], { type: 'data' }>;

// the head scene's messages from the engine's data events: feed() each one
export function useHeadStore(rate: number, demo: boolean, streaming: boolean) {
  const store = useMemo(() => new SignalStore(), []);
  const raw = useRef<number[][]>([]);
  const source = demo ? 'demo' : 'device';
  const send = (type: string, payload: unknown) =>
    store.ingest({ source, streamId: 'neurolink', type, payload, emittedAtMs: Date.now() });
  useEffect(() => {
    send('status', { status: streaming ? 'streaming' : 'stopped', valid: streaming });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, demo, streaming]);
  const feed = (e: DataEvent) => {
    {
      if (!e.samples.length || !e.timestamps.length) return;
      const n = e.timestamps.length;
      const keep = Math.round(WINDOW_S * rate);
      raw.current = e.samples.map((row, c) => [...(raw.current[c] ?? []), ...row].slice(-keep));
      const broadband = raw.current.map((x) => displayFilter(x, rate).slice(-n));
      send('status', { status: 'streaming', valid: true });
      send('quality', { valid: true });
      send('bands', {
        channels: e.samples.map((_, c) => ({
          channel: c + 1,
          valid: e.quality[c] !== 'bad' && e.contact?.states?.[c] !== 'off',
          bands: {},
        })),
      });
      send('waves', {
        channels: e.samples.map((_, c) => c + 1),
        broadband,
        timestamps: e.timestamps,
        settled: raw.current[0].length >= rate, // a second of filter warm-up
        unit: 'µV',
      });
    }
  };
  return { store, feed };
}

export function useHeadSignal(api: Api, rate: number, demo: boolean, streaming: boolean) {
  const { store, feed } = useHeadStore(rate, demo, streaming);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  useEffect(() => api.subscribe((e) => e.type === 'data' && feedRef.current(e)), [api]);
  return store;
}

// 佩戴: face to face first, then from above where every electrode shows; turned with the mouse.
// Each electrode a dot in its contact colour; the reference and ground marked.
// (from above, a little behind: the nose up, the left on the left, as an EEG map)
const OVERVIEW = [0, 1, -0.15];
// 佩戴引导: the head turned to one side (as HeadScene's views)
const VIEWS = {
  front: [0, 0.03, 1],
  left: [1, 0.03, 0.02],
  right: [-1, 0.03, 0.02],
  back: [0, 0.03, -1],
  top: [0, 1, 0.001],
};
export type HeadView = keyof typeof VIEWS;
export default function HeadModel({
  api,
  rate,
  demo,
  streaming,
  contact,
  anchorAlert = false,
  bare = false,
  view,
  brain: showBrain = true,
}: {
  api: Api;
  rate: number;
  demo: boolean;
  streaming: boolean;
  contact: string[]; // per electrode, in this app's order: ok / poor / off
  anchorAlert?: boolean; // the reference and ground marked as the likely cause
  bare?: boolean; // the head and the brain only, no electrodes (首次打开 after 佩戴)
  view?: HeadView; // seen from this side instead of from above
  brain?: boolean; // the brain inside (the 佩戴引导 drawings: the head alone)
}) {
  // 佩戴: the brain a soft blue like the head, not black, before and between its activity
  const { brain } = useHeadBrain(true, WEAR_FLOOR);
  const store = useHeadSignal(api, rate, demo, streaming);
  const faceRef = useRef(null);
  const byName = useMemo(
    () => Object.fromEntries(electrodeNames.map((name, c) => [name, contact[c] ?? 'none'])),
    [contact],
  );
  return (
    <div className="h3d head-model">
      <HeadScene
        selected={null}
        onSelect={() => {}}
        onClear={() => {}}
        signal={store}
        viewCommand={null}
        faceRef={faceRef}
        faceEnabled={false}
        visualStyle={bare ? 'off' : 'pulse'}
        visualMetric="rms"
        codeFlow={false}
        inner={showBrain ? brain : null}
        contact={byName}
        intro={view ? VIEWS[view] : OVERVIEW}
        anchorAlert={anchorAlert}
        plumeEach={!bare}
        marks={!bare}
        bare={bare}
        tooltips={false}
      />
    </div>
  );
}
