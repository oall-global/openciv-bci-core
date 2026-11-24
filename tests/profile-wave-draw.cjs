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
    await p.locator('.wave-canvas').first().scrollIntoViewIfNeeded();
    await p.bringToFront();
    const result = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const original = CanvasRenderingContext2D.prototype.clearRect;
          let draws = 0,
            batches = 0;
          const start = performance.now();
          CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (this.canvas.classList.contains('wave-canvas')) draws++;
            return original.apply(this, args);
          };
          const off = window.neuro.subscribe((e) => {
            if (e.type === 'data') batches++;
          });
          setTimeout(() => {
            CanvasRenderingContext2D.prototype.clearRect = original;
            off();
            resolve({
              draws,
              batches,
              seconds: (performance.now() - start) / 1000,
              waveCanvases: document.querySelectorAll('.wave-canvas').length,
            });
          }, 6000);
        }),
    );
    console.log(result);
    fs.writeFileSync(
      'test-results/wave-draw-' + (process.argv[2] || 'before') + '.json',
      JSON.stringify(result, null, 2),
    );
  } finally {
    await b.close();
  }
})();
