const ts = require('typescript'),
  fs = require('fs'),
  assert = require('assert/strict');
require.extensions['.ts'] = (m, p) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(p, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    p,
  );
const { advanceHead } = require('../src/wavePlayback.ts');
let head = null,
  count = 0,
  previous = 0,
  moved = 0;
for (let i = 0; i < 600; i++) {
  if (i % 3 === 0) count += i % 6 === 0 ? 12 : 13;
  head = advanceHead(head, count, 250, 1 / 60);
  assert(head <= count);
  assert(head >= previous);
  if (head > previous) moved++;
  previous = head;
}
assert(moved > 550);
for (let i = 0; i < 300; i++) head = advanceHead(head, count, 250, 1 / 60);
assert.equal(head, count);
assert.equal(advanceHead(head, 0, 250, 0.016), 0);
assert.equal(advanceHead(null, 100, 250, 0.016), 70);
console.log(
  'PASS smooth playback of burst delivery, monotonic display, no fabricated future samples, gap stop and reset',
);
