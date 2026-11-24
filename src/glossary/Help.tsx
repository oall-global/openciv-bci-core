// 「?」 next to a concept: a small popup — what it is, what you see on screen, what to do — and
// links to the full entry in 概念手册 (src/glossary/GlossaryPage.tsx).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, Lightbulb, LifeBuoy, X } from 'lucide-react';
import { TERMS } from './terms';
import { NOTES } from '../onboarding/stepNotes';

export const openGlossary = (id?: string) =>
  window.dispatchEvent(new CustomEvent('brainlab:glossary', { detail: id ?? null }));

const W = 340;

// `note`: a step's own 「?」 in the guided flows (src/onboarding/stepNotes.ts) — 为什么, 怎么做好,
// 遇到问题 — instead of a 概念手册 entry; 了解更多 still opens the entry it names.
export default function Help({ id, label, note }: { id?: string; label?: string; note?: string }) {
  const step = note ? NOTES[note] : undefined;
  const term = TERMS[step ? (step.more ?? '') : (id ?? '')];
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{
    x: number;
    y: number;
    caret: number;
    above: boolean;
  } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  // placed under the 「?」 (above when there is no room), the arrow pointing at it
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = pop.current?.offsetHeight ?? 240;
    const x = Math.max(12, Math.min(window.innerWidth - W - 12, r.left + r.width / 2 - W / 2));
    const above = r.bottom + 12 + h > window.innerHeight - 8 && r.top - 12 - h > 8;
    setPlace({
      x,
      y: above ? r.top - 12 - h : r.bottom + 12,
      caret: r.left + r.width / 2 - x,
      above,
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const away = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open]);
  if (!term && !step) return null;
  const related = step ? [] : term!.related.filter((r) => TERMS[r]).slice(0, 3);
  const title = step?.title ?? term!.title;
  const go = (to: string) => {
    setOpen(false);
    openGlossary(to);
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`help-q ${open ? 'on' : ''}`}
        aria-label={step ? (label ?? title) : `什么是${label ?? title}`}
        aria-expanded={open}
        title={label ?? title}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setPlace(null);
          setOpen(!open);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className={`help-pop ${place?.above ? 'above' : ''} ${place ? 'in' : ''}`}
            role="dialog"
            aria-label={title}
            style={{ left: place?.x ?? -9999, top: place?.y ?? 0, width: W }}
          >
            <i className="help-caret" style={{ left: place?.caret ?? W / 2 }} />
            {step ? (
              <>
                <div className="help-top">
                  <b className="help-title">{step.title}</b>
                  <button
                    type="button"
                    className="help-x"
                    aria-label="关闭说明"
                    onClick={() => setOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                {step.why && <p className="help-short">{step.why}</p>}
                {(step.how || step.trouble) && (
                  <dl className="help-rows">
                    {step.how && (
                      <div>
                        <dt>
                          <Lightbulb size={13} />
                          怎么做好
                        </dt>
                        <dd>
                          {step.how.map((line) => (
                            <span key={line}>{line}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                    {step.trouble && (
                      <div>
                        <dt>
                          <LifeBuoy size={13} />
                          遇到问题
                        </dt>
                        <dd>
                          {step.trouble.map((line) => (
                            <span key={line}>{line}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </>
            ) : (
              <>
                <div className="help-top">
                  <small>
                    {term.chapter}
                    {term.level && <em className={`l-${term.level}`}>{term.level}</em>}
                  </small>
                  <button
                    type="button"
                    className="help-x"
                    aria-label="关闭说明"
                    onClick={() => setOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <b className="help-title">{term.title}</b>
                {term.en && <span className="help-en">{term.en}</span>}
                <p className="help-short">{term.short}</p>
                {(term.see || term.tip) && (
                  <dl className="help-rows">
                    {term.see && (
                      <div>
                        <dt>
                          <Eye size={13} />
                          界面上
                        </dt>
                        <dd>{term.see}</dd>
                      </div>
                    )}
                    {term.tip && (
                      <div>
                        <dt>
                          <Lightbulb size={13} />
                          怎么做
                        </dt>
                        <dd>{term.tip}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </>
            )}
            <div className="help-foot">
              {term && (
                <button type="button" className="help-more" onClick={() => go(term.id)}>
                  {step ? '了解更多 →' : '查看详细说明 →'}
                </button>
              )}
              {related.length > 0 && (
                <span>
                  相关
                  {related.map((r) => (
                    <button key={r} type="button" onClick={() => go(r)}>
                      {TERMS[r].title.replace(/（.*?）/g, '')}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
