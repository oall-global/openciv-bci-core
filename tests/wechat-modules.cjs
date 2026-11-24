// Every `<module>.<function>(` a mini program page calls on a module it requires exists in that
// module's exports (a missing export only shows up on the phone otherwise). Loads each lib with a
// fake wx.
const fs = require('fs'),
  path = require('path');
const root = path.resolve(__dirname, '../wechat');
global.wx = new Proxy({}, { get: () => () => ({}) });

let fails = 0;
const pages = [];
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/pages[\\/].*\.js$/.test(p)) pages.push(p);
  });
walk(root);
for (const page of pages) {
  // without comments (a comment may mention `lib.js (…)`)
  const src = fs
    .readFileSync(page, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const [, name, rel] of src.matchAll(/const (\w+) = require\('([^']+)'\);/g)) {
    const mod = require(path.resolve(path.dirname(page), rel));
    for (const [, fn] of src.matchAll(new RegExp(`\\b${name}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g')))
      if (typeof mod[fn] !== 'function') {
        console.error(
          `FAIL wechat-modules: ${path.relative(root, page)} calls ${name}.${fn}, not exported by ${rel}`,
        );
        fails++;
      }
  }
}
// every style import resolves (the developer tool only reports it when uploading)
const styles = [];
const walkStyles = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkStyles(p);
    else if (p.endsWith('.wxss')) styles.push(p);
  });
walkStyles(root);
for (const file of styles)
  for (const [, rel] of fs.readFileSync(file, 'utf8').matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const target = rel.startsWith('/')
      ? path.join(root, rel)
      : path.resolve(path.dirname(file), rel);
    if (!fs.existsSync(target)) {
      console.error(
        `FAIL wechat-modules: ${path.relative(root, file)} imports ${rel}, which does not exist`,
      );
      fails++;
    }
  }
if (fails) process.exit(1);
console.log(
  `PASS wechat-modules: ${pages.length} pages call only exported functions of their libraries; ${styles.length} style files import only existing files`,
);
