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
    await p.getByRole('button', { name: '四宫格', exact: true }).click();
    await p.screenshot({ path: 'test-results/workspace-live-0.1.21.png' });
    console.log('panels', await p.locator('.wb-chart-cell').count());
  } finally {
    await b.close();
  }
})();
