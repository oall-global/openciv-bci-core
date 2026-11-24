const { chromium } = require('playwright'),
  fs = require('fs'),
  path = require('path');
(async () => {
  const port = fs
    .readFileSync(path.join(process.env.APPDATA, 'neurolink-desktop/DevToolsActivePort'), 'utf8')
    .split('\n')[0];
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  try {
    const p = b.contexts()[0].pages()[0];
    console.log(
      JSON.stringify(
        await p.evaluate(
          () =>
            new Promise((resolve) => {
              let frames = [],
                batches = [],
                lastFrame = performance.now(),
                lastBatch = null,
                id;
              const start = lastFrame;
              function tick(t) {
                frames.push(t - lastFrame);
                lastFrame = t;
                id = requestAnimationFrame(tick);
              }
              id = requestAnimationFrame(tick);
              const off = window.neuro.subscribe((e) => {
                if (e.type === 'data') {
                  const t = performance.now();
                  batches.push({
                    gap: lastBatch === null ? null : t - lastBatch,
                    count: e.samples[0].length,
                  });
                  lastBatch = t;
                }
              });
              setTimeout(async () => {
                off();
                cancelAnimationFrame(id);
                const stats = (a) => {
                  a.sort((x, y) => x - y);
                  return {
                    n: a.length,
                    median: a[Math.floor(a.length * 0.5)],
                    p95: a[Math.floor(a.length * 0.95)],
                    max: a.at(-1),
                  };
                };
                resolve({
                  status: (await window.neuro.snapshot()).status,
                  raf: stats(frames),
                  batches: stats(batches.map((x) => x.gap).filter((x) => x !== null)),
                  batchSamples: stats(batches.map((x) => x.count)),
                  totalSamples: batches.reduce((s, x) => s + x.count, 0),
                  seconds: (performance.now() - start) / 1000,
                });
              }, 8000);
            }),
        ),
      ),
    );
  } finally {
    await b.close();
  }
})();
