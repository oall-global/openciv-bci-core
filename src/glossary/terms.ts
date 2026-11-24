/// <reference types="vite/client" />
// 概念手册 content lives in content/glossary (one Markdown file per entry, figures in images/,
// chapter order in chapters.json; see content/glossary/README.md). This reads it at build time.
import chapters from '../../content/glossary/chapters.json';

export type Term = {
  id: string;
  title: string;
  short: string; // shown by the 「?」 next to a term
  see: string; // popup: what it is on screen
  tip: string; // popup: what to do
  level: string; // 入门 / 进阶 / 专业
  en: string; // English term
  related: string[]; // other entry ids
  body: string; // Markdown
};
export type Chapter = { id: string; title: string; terms: Term[] };

const files = import.meta.glob('../../content/glossary/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
export const IMAGES = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../content/glossary/images/*', {
      query: '?url',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([path, url]) => [path.split('/').pop()!, url]),
);

// "---\nkey: value\n---\nbody"
export function parseEntry(text: string): Term {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const head: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    id: head.id ?? '',
    title: head.title ?? '',
    short: head.short ?? '',
    see: head.see ?? '',
    tip: head.tip ?? '',
    level: head.level ?? '',
    en: head.en ?? '',
    related: (head.related ?? '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    body: (m?.[2] ?? text).trim(),
  };
}

const byId: Record<string, Term> = {};
for (const [path, text] of Object.entries(files)) {
  const t = parseEntry(text);
  if (t.id && !path.includes('/_')) byId[t.id] = t;
}

export const CHAPTERS: Chapter[] = (
  chapters as { id: string; title: string; entries: string[] }[]
).map((c) => ({
  id: c.id,
  title: c.title,
  terms: c.entries.map((id) => byId[id]).filter(Boolean),
}));

export const TERMS: Record<string, Term & { chapter: string }> = Object.fromEntries(
  CHAPTERS.flatMap((c) => c.terms.map((t) => [t.id, { ...t, chapter: c.title }])),
);
