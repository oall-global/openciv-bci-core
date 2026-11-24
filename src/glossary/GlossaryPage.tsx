// 概念手册: what a brain–computer interface is and every concept the app uses, one entry per
// page. The contents list every chapter and opens the current one (or the search results);
// the 「?」 popups, cross-links and related entries open an entry here (focus / brainlab:glossary).
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CHAPTERS, TERMS } from './terms';
import Markdown from './Markdown';

const ORDER = CHAPTERS.flatMap((c) => c.terms.map((t) => t.id));

export default function GlossaryPage({ focus }: { focus: string | null }) {
  const body = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(() => (focus && TERMS[focus] ? focus : (ORDER[0] ?? '')));
  const [lit, setLit] = useState<string | null>(focus);
  const [query, setQuery] = useState('');
  function open(id: string, highlight = false) {
    if (!TERMS[id]) return;
    setCurrent(id);
    setLit(highlight ? id : null);
    body.current?.scrollTo({ top: 0 });
  }
  // from a 「?」 popup elsewhere in the app
  useEffect(() => {
    if (focus) open(focus, true);
  }, [focus]);
  // cross-links inside entries (also sent when the same entry is asked for again)
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      if (id) open(id);
    };
    window.addEventListener('brainlab:glossary', on);
    return () => window.removeEventListener('brainlab:glossary', on);
  }, []);
  useEffect(() => {
    if (!lit) return;
    const id = setTimeout(() => setLit(null), 2200);
    return () => clearTimeout(id);
  }, [lit]);

  const q = query.trim().toLowerCase();
  const match = (t: { title: string; short: string; body: string; en: string }) =>
    !q || [t.title, t.short, t.body, t.en].some((s) => s.toLowerCase().includes(q));
  const results = q ? ORDER.filter((id) => match(TERMS[id])) : [];
  const term = TERMS[current];
  const chapter = CHAPTERS.find((c) => c.terms.some((t) => t.id === current));
  const index = ORDER.indexOf(current);
  const prev = TERMS[ORDER[index - 1]],
    next = TERMS[ORDER[index + 1]];
  return (
    <div className="glossary">
      <nav className="glossary-toc" aria-label="目录">
        <h1>概念手册</h1>
        <input
          placeholder="搜索概念"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) open(results[0]);
          }}
          aria-label="搜索概念"
        />
        {q && !results.length && <p className="glossary-none">没有找到相关条目</p>}
        {CHAPTERS.map((c) => {
          const terms = q ? c.terms.filter(match) : c === chapter ? c.terms : [];
          if (q && !terms.length) return null;
          return (
            <div key={c.id} className={c === chapter ? 'here' : ''}>
              <button
                className="glossary-chapter-link"
                aria-expanded={!!terms.length}
                onClick={() => open(c.terms[0].id)}
              >
                {c.title}
                <span>{c.terms.length}</span>
              </button>
              {terms.map((t) => (
                <a
                  key={t.id}
                  href={`#term-${t.id}`}
                  aria-current={t.id === current ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    open(t.id);
                  }}
                >
                  {t.title}
                </a>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="glossary-body" ref={body}>
        {term && (
          <>
            <p className="glossary-where">
              {chapter?.title} · 第 {(chapter?.terms.findIndex((t) => t.id === current) ?? 0) + 1} /{' '}
              {chapter?.terms.length} 篇
            </p>
            <article
              id={`term-${term.id}`}
              className={`glossary-term ${lit === term.id ? 'lit' : ''}`}
            >
              <h2>
                {term.title}
                {term.en && <small className="glossary-en">{term.en}</small>}
                {term.level && (
                  <span className={`glossary-level l-${term.level}`}>{term.level}</span>
                )}
              </h2>
              <p className="glossary-short">{term.short}</p>
              <Markdown text={term.body} />
              {term.related.length > 0 && (
                <p className="glossary-related">
                  相关：
                  {term.related
                    .filter((r) => TERMS[r])
                    .map((r) => (
                      <a
                        key={r}
                        href={`#term-${r}`}
                        onClick={(e) => {
                          e.preventDefault();
                          open(r);
                        }}
                      >
                        {TERMS[r].title}
                      </a>
                    ))}
                </p>
              )}
            </article>
            <div className="glossary-pager">
              {prev ? (
                <button className="secondary" onClick={() => open(prev.id)}>
                  <ChevronLeft size={15} />
                  <span>
                    <small>上一篇</small>
                    {prev.title}
                  </span>
                </button>
              ) : (
                <span />
              )}
              {next && (
                <button className="secondary next" onClick={() => open(next.id)}>
                  <span>
                    <small>下一篇</small>
                    {next.title}
                  </span>
                  <ChevronRight size={15} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
