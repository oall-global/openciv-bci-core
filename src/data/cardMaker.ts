// The card of one recording in 数据, drawn as at the end of 录制脑电 (momentCard.ts) from frames
// computed out of the raw EEG (electron/dataStore.cjs), and kept next to the data: card11.png
// (full size; in the middle α's share on the brain with its bar, recordArt.ts),
// thumb11.jpg (the grid: α's share on the brain in the stepped rainbow; the page writes the
// rest) and the share of usable signal.
import type { Api } from '../types';
import type { Brain } from '../home/brainHistory';
import {
  CARD_H,
  CARD_W,
  SKY_OPEN,
  cardData,
  drawCard,
  type CardLines,
  type Wave,
  CARD_LINES,
} from '../home/momentCard';
import { skyArt } from '../home/momentArt';
import { RECORD } from '../home/BrainRecord';
import { cardHero, drawBrainAlpha, type Print } from './recordArt';

export type DataItem = {
  kind: 'moment' | 'session';
  id: string;
  type: 'recording' | 'task';
  title: string;
  start: string;
  seconds: number;
  status?: string;
  source?: string;
  participant?: string | null;
  task?: string | null;
  taskId?: string | null; // the 任务 a session was recorded for
  name?: string | null; // given in 数据 (重命名)
  thumb: boolean;
  info?: { valid: number | null } | null;
};

const p2 = (v: number) => String(v).padStart(2, '0');
const stamp = (s: string) => {
  const d = new Date(s);
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
// The names shown in 数据: a title from the 标题 field of 录制脑电 stays as it was saved, even the
// prefilled 脑电记录 (the date is on the line under it); untitled recordings (自由录制, none)
// become 录制 · date time; tasks are numbered per task. A name given in 数据 (重命名) comes first.
export function displayTitles(list: DataItem[]) {
  const defaults = new Set(['自由录制', '']);
  const count = new Map<string, number>();
  const out = new Map<string, string>();
  [...list]
    .sort((a, b) => a.start.localeCompare(b.start))
    .forEach((it) => {
      const k = `${it.kind}:${it.id}`;
      if (it.type === 'task') {
        const n = (count.get(it.task ?? it.title) ?? 0) + 1;
        count.set(it.task ?? it.title, n);
        out.set(k, it.name || `${it.title} · 第 ${n} 次`);
      } else
        out.set(k, it.name || (defaults.has(it.title) ? `录制 · ${stamp(it.start)}` : it.title));
    });
  return out;
}

function lines(): CardLines {
  try {
    return { ...CARD_LINES, ...JSON.parse(localStorage.getItem('neurolink.cardLines') ?? '{}') };
  } catch {
    return CARD_LINES;
  }
}

export async function makeCard(api: Api, item: DataItem, title: string) {
  const [{ rate, start, frames, lines: chart, wave }, detail, print] = await Promise.all([
    api.data('frames', { kind: item.kind, id: item.id }) as Promise<{
      rate: number;
      start: number;
      frames: Brain[];
      lines: Brain[];
      wave: Wave;
    }>,
    api.data('detail', { kind: item.kind, id: item.id }),
    api.data('print', { kind: item.kind, id: item.id }) as Promise<Print | null>,
  ]);
  const when = new Date(item.start);
  const input = {
    frames,
    lines: chart,
    wave,
    start: Number.isFinite(when.getTime()) ? when : new Date(start * 1000),
    seconds: detail.seconds,
    rate,
    // the marks of 录制脑电 (named by the user); task sessions keep their events in the details
    marks: item.kind === 'moment' ? detail.events.map((e: { t: number; label: string }) => e) : [],
    scene: RECORD,
    title,
    note: detail.note ?? '',
    sign: '',
  };
  const data = cardData(input);
  const art = {
    sky: skyArt(input.start, CARD_W, CARD_H, undefined, undefined, undefined, SKY_OPEN),
    brain: null,
    // α on the brain with its bar (recordArt.ts); without spectra the same brain in grey
    hero: await cardHero(print, CARD_W, 625),
  };
  const c = document.createElement('canvas');
  c.dataset.native = ''; // dark card colours as drawn (theme.ts maps the others)
  c.width = CARD_W;
  c.height = CARD_H;
  drawCard(c.getContext('2d')!, input, data, 1, 1, 1, art, lines());
  // the grid picture: α on the brain, no text (too short for spectra: the brain in grey)
  const TW = 480,
    TH = 360;
  const t = document.createElement('canvas');
  t.dataset.native = '';
  t.width = TW;
  t.height = TH;
  const g = t.getContext('2d')!;
  g.fillStyle = '#0a0d0c';
  g.fillRect(0, 0, TW, TH);
  await drawBrainAlpha(g, print, TW / 2, TH / 2, TH * 0.88);
  // usable signal: share of 2 s windows per electrode that are neither flat nor out of range
  const valid = frames.length
    ? frames.reduce((a, f) => a + f.ok.filter(Boolean).length / f.ok.length, 0) / frames.length
    : 0;
  const card = c.toDataURL('image/png'),
    thumb = t.toDataURL('image/jpeg', 0.85);
  await api.data('save-images', { kind: item.kind, id: item.id, card, thumb, info: { valid } });
  return { thumb, valid };
}
