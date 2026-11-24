// Checks content/glossary (see its README): entry fields, unique ids, chapter list, the ids the
// app's 「?」 marks use, images, cross-links, no brand names.  npm run check:glossary
const fs = require('fs'),
  path = require('path');
const root = path.resolve(__dirname, '..'),
  dir = path.join(root, 'content/glossary');
const BANNED = [
  'emotiv',
  'openbci',
  'muse',
  'neurosity',
  'neuralink',
  'neurosky',
  'neurotechx',
  'interaxon',
  'g.tec',
  'brainco',
  '强脑',
  '博睿康',
];
const LEVELS = ['入门', '进阶', '专业'];
const atlasRegions = JSON.parse(fs.readFileSync(path.join(dir, 'brain-regions.json'), 'utf8'));
const atlasIds = new Set(atlasRegions.map((r) => r.id));
const problems = [];
const bad = (file, msg) => problems.push(`${path.relative(root, file)}: ${msg}`);

const parse = (text) => {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const head = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { head, body: m[2] };
};

const entries = {};
for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!sub.isDirectory() || sub.name === 'images') continue;
  for (const f of fs.readdirSync(path.join(dir, sub.name))) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const file = path.join(dir, sub.name, f);
    const e = parse(fs.readFileSync(file, 'utf8'));
    if (!e) {
      bad(file, '开头缺少 --- 包起来的条目信息');
      continue;
    }
    const { head, body } = e;
    for (const line of body.split('\n').filter((line) => line.startsWith(':::brain-atlas'))) {
      const marker = line.trim().match(/^:::brain-atlas ([a-z-]+)$/);
      if (!marker || !atlasIds.has(marker[1])) bad(file, `脑区图标记无效：${line}`);
    }
    for (const k of ['id', 'title', 'short', 'level']) if (!head[k]) bad(file, `缺少 ${k}`);
    if (head.id && !/^[a-z][a-z0-9-]*$/.test(head.id))
      bad(file, `id「${head.id}」只能用小写英文、数字和连字符`);
    if (head.id && f !== `${head.id}.md`) bad(file, `文件名应为 ${head.id}.md`);
    if (head.short && [...head.short].length > 80)
      bad(file, `short 有 ${[...head.short].length} 个字，超过 80`);
    for (const k of ['see', 'tip'])
      if (head[k] && [...head[k]].length > 60)
        bad(file, `${k} 有 ${[...head[k]].length} 个字，超过 60`);
    if (head.level && !LEVELS.includes(head.level)) bad(file, `level 只能是 ${LEVELS.join(' / ')}`);
    if (entries[head.id]) bad(file, `id「${head.id}」与 ${entries[head.id].file} 重复`);
    entries[head.id] = { file: path.relative(root, file), head, body, chapter: sub.name };
    const text = (Object.values(head).join(' ') + ' ' + body).toLowerCase();
    for (const w of BANNED) if (text.includes(w.toLowerCase())) bad(file, `出现了品牌名「${w}」`);
    for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
      if (/^https:\/\//.test(m[1])) continue;
      if (!fs.existsSync(path.join(dir, 'images', m[1].split('/').pop())))
        bad(file, `图片不存在：${m[1]}`);
    }
    if (/<[a-z][\s\S]*?>/i.test(body.replace(/`[^`]*`/g, '')))
      bad(file, '正文里有 HTML 标签（不支持）');
  }
}
for (const e of Object.values(entries)) {
  for (const m of e.body.matchAll(/\[\[([\w-]+)/g))
    if (!entries[m[1]]) bad(path.join(root, e.file), `链接的条目不存在：[[${m[1]}]]`);
  for (const r of (e.head.related ?? '').split(/[,，\s]+/).filter(Boolean))
    if (!entries[r]) bad(path.join(root, e.file), `related 里的条目不存在：${r}`);
}
for (const r of atlasRegions) {
  if (!entries[`region-${r.id}`]) problems.push(`brain-regions.json: ${r.id} 缺少对应条目`);
}
// chapters.json
const chapters = JSON.parse(fs.readFileSync(path.join(dir, 'chapters.json'), 'utf8'));
const listed = new Set();
for (const c of chapters) {
  for (const id of c.entries) {
    if (!entries[id]) problems.push(`chapters.json: 章节「${c.title}」里的 ${id} 没有对应的文件`);
    else if (entries[id].chapter !== c.id)
      problems.push(
        `chapters.json: ${id} 在章节「${c.title}」里，但文件在 ${entries[id].chapter}/`,
      );
    listed.add(id);
  }
}
for (const id of Object.keys(entries))
  if (!listed.has(id))
    problems.push(`${entries[id].file}: 没有列在 chapters.json 里，目录中不会出现`);
// ids the app's 「?」 marks use
const used = new Set();
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f.name))
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/<Help\s+id="([\w-]+)"/g)) used.add(m[1]);
  }
};
walk(path.join(root, 'src'));
for (const id of used)
  if (!entries[id]) problems.push(`界面上的「?」用到了 ${id}，但手册里没有这个条目`);

if (problems.length) {
  console.log(
    `概念手册有 ${problems.length} 处需要修改：\n` + problems.map((p) => '  - ' + p).join('\n'),
  );
  process.exit(1);
}
console.log(
  `概念手册检查通过：${Object.keys(entries).length} 个条目，${chapters.length} 章，界面上的「?」用到 ${used.size} 个条目。`,
);
