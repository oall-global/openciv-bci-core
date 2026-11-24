const { go } = require('./nav.cjs');
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
    await go(p, '信号工作台');
    await p.getByRole('button', { name: '左右', exact: true }).click();
    await p.getByLabel('面板 1 图表', { exact: true }).selectOption('wave');
    if (process.argv.includes('--low-dpr'))
      await p.evaluate(() => {
        window.__originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
        Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
      });
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Performance.enable');
    const result = [];
    for (const zoom of [false, true]) {
      if (zoom) await p.getByRole('button', { name: '放大面板 1' }).click();
      await p.locator('.wave-canvas').first().scrollIntoViewIfNeeded();
      await p.bringToFront();
      const pre = await cdp.send('Performance.getMetrics');
      const sample = await p.evaluate(
        () =>
          new Promise((resolve) => {
            const proto = CanvasRenderingContext2D.prototype,
              original = proto.clearRect;
            let frames = [],
              batches = [],
              last = null,
              lastBatch = null;
            proto.clearRect = function (...args) {
              if (this.canvas.classList.contains('wave-canvas')) {
                const t = performance.now();
                if (last !== null) frames.push(t - last);
                last = t;
              }
              return original.apply(this, args);
            };
            const off = window.neuro.subscribe((e) => {
              if (e.type === 'data') {
                const t = performance.now();
                if (lastBatch !== null) batches.push(t - lastBatch);
                lastBatch = t;
              }
            });
            setTimeout(() => {
              proto.clearRect = original;
              off();
              const stats = (a) => {
                a.sort((a, b) => a - b);
                return {
                  n: a.length,
                  p50: a[Math.floor(a.length * 0.5)],
                  p95: a[Math.floor(a.length * 0.95)],
                  max: a.at(-1),
                };
              };
              const c = document.querySelector('.wave-canvas');
              resolve({
                frames: stats(frames),
                batches: stats(batches),
                canvas: [c.width, c.height],
                css: [c.clientWidth, c.clientHeight],
                dpr: devicePixelRatio,
              });
            }, 6000);
          }),
      );
      const post = await cdp.send('Performance.getMetrics'),
        diff = {};
      for (const key of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'LayoutCount'])
        diff[key] =
          post.metrics.find((x) => x.name === key).value -
          pre.metrics.find((x) => x.name === key).value;
      result.push({ zoom, sample, diff });
    }
    fs.writeFileSync(
      'test-results/wave-zoom-' + (process.argv[2] || 'before') + '.json',
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    if (process.argv.includes('--low-dpr'))
      await p.evaluate(() => {
        if (window.__originalDpr)
          Object.defineProperty(window, 'devicePixelRatio', window.__originalDpr);
        else delete window.devicePixelRatio;
        delete window.__originalDpr;
      });
  } finally {
    await b.close();
  }
})();
