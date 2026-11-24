const { chromium } = require('playwright'),
  fs = require('fs'),
  path = require('path');
(async () => {
  const port = fs
    .readFileSync(path.join(process.env.APPDATA, 'neurolink-desktop/DevToolsActivePort'), 'utf8')
    .split('\n')[0];
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  try {
    const p = b.contexts()[0].pages()[0],
      cdp = await p.context().newCDPSession(p);
    if (process.argv.includes('--brain')) {
      await p.locator('.brain-sync-canvas').first().scrollIntoViewIfNeeded();
      await p.waitForTimeout(500);
    }
    await cdp.send('Performance.enable');
    const before = await cdp.send('Performance.getMetrics');
    const sample = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const deltas = [];
          let previous = performance.now(),
            start = previous;
          function tick(now) {
            deltas.push(now - previous);
            previous = now;
            if (now - start < 8000) requestAnimationFrame(tick);
            else
              resolve({
                frames: deltas.length,
                elapsed: now - start,
                over50: deltas.filter((x) => x > 50).length,
                max: Math.max(...deltas),
                layout: document.querySelector('.wb-chart-grid')?.className,
                brains: document.querySelectorAll('.brain-sync-canvas canvas').length,
              });
          }
          requestAnimationFrame(tick);
        }),
    );
    const after = await cdp.send('Performance.getMetrics'),
      diff = {};
    for (const name of [
      'TaskDuration',
      'ScriptDuration',
      'LayoutDuration',
      'RecalcStyleDuration',
      'LayoutCount',
      'RecalcStyleCount',
    ])
      diff[name] =
        after.metrics.find((x) => x.name === name).value -
        before.metrics.find((x) => x.name === name).value;
    console.log(JSON.stringify({ sample, diff }));
    fs.writeFileSync(
      'test-results/workspace-performance-' + (process.argv[2] || 'before') + '.json',
      JSON.stringify({ sample, diff }, null, 2),
    );
  } finally {
    await b.close();
  }
})();
