// The Markdown of 概念手册 entries (content/glossary/README.md lists what is supported), rendered
// as React elements — no raw HTML.
import { lazy, Suspense, type ReactNode } from 'react';
import { IMAGES, TERMS } from './terms';
const BrainAtlas = lazy(() => import('./BrainAtlas'));

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  // [[id]] or [[id|text]] · [text](url) · **bold** · `code`
  const re = /\[\[([\w-]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0,
    m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[1]) {
      const id = m[1];
      const t = TERMS[id];
      out.push(
        <a key={k} href={`#term-${id}`} className="glossary-xref" onClick={(e) => jump(e, id)}>
          {m[2] ?? t?.title ?? m[1]}
        </a>,
      );
    } else if (m[3]) {
      const url = m[4];
      out.push(
        /^https:\/\//.test(url) ? (
          <a key={k} href={url} target="_blank" rel="noreferrer">
            {m[3]}
          </a>
        ) : (
          <a key={k} href={url} onClick={(e) => url.startsWith('#term-') && jump(e, url.slice(6))}>
            {m[3]}
          </a>
        ),
      );
    } else if (m[5]) out.push(<b key={k}>{m[5]}</b>);
    else if (m[6]) out.push(<code key={k}>{m[6]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function jump(e: { preventDefault: () => void }, id: string) {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('brainlab:glossary', { detail: id }));
}
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = blocks.length;
    if (!line.trim()) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^:::brain-atlas\s+([a-z-]+)\s*$/))) {
      blocks.push(
        <Suspense key={k} fallback={<p>正在加载脑区图…</p>}>
          <BrainAtlas initial={m[1]} />
        </Suspense>,
      );
      i++;
    } else if ((m = line.match(/^(#{2,4})\s+(.*)/))) {
      const level = m[1].length;
      blocks.push(level === 2 ? <h4 key={k}>{inline(m[2])}</h4> : <h5 key={k}>{inline(m[2])}</h5>);
      i++;
    } else if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/))) {
      const name = m[2].split('/').pop()!;
      const src = IMAGES[name] ?? (/^https:\/\//.test(m[2]) ? m[2] : undefined);
      blocks.push(
        <figure key={k} className="glossary-fig">
          {src ? (
            <img src={src} alt={m[1]} />
          ) : (
            <div className="glossary-fig-missing">缺少图片：{m[2]}</div>
          )}
          {(m[3] || m[1]) && <figcaption>{m[3] || m[1]}</figcaption>}
        </figure>,
      );
      i++;
    } else if (line.trim().startsWith('|') && lines[i + 1]?.match(/^\s*\|?\s*:?-{2,}/)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      blocks.push(
        <table key={k} className="glossary-table">
          <thead>
            <tr>
              {head.map((h, j) => (
                <th key={j}>{inline(h, j)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, a) => (
              <tr key={a}>
                {r.map((c, j) => (
                  <td key={j}>{inline(c, j)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={k}>
          {items.map((t, j) => (
            <li key={j}>{inline(t, j)}</li>
          ))}
        </List>,
      );
    } else if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>'))
        quote.push(lines[i++].replace(/^>\s?/, ''));
      const [first, ...rest] = quote;
      const kind = first.match(/^\[!(提示|注意|误区)\]\s*(.*)/);
      blocks.push(
        <aside key={k} className={`glossary-note ${kind ? kind[1] : ''}`}>
          {kind && <b>{kind[1]}</b>}
          {[kind ? kind[2] : first, ...rest].filter(Boolean).map((t, j) => (
            <p key={j}>{inline(t, j)}</p>
          ))}
        </aside>,
      );
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(:::brain-atlas\s+[a-z-]+\s*$|#{2,4}\s|!\[|\s*\||\s*([-*]|\d+\.)\s|>)/.test(lines[i])
      )
        para.push(lines[i++]);
      blocks.push(<p key={k}>{inline(para.join(''))}</p>);
    }
  }
  return <>{blocks}</>;
}
