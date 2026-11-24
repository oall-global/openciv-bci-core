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
    await p.getByLabel('面板 3 图表', { exact: true }).selectOption('bands');
    await p.getByLabel('面板 4 图表', { exact: true }).selectOption('spectrogram');
    await p.locator('.wb-extra-chart').last().scrollIntoViewIfNeeded();
    await p.screenshot({ path: 'test-results/spectral-charts-live.png' });
    console.log(await p.getByLabel('面板 1 图表', { exact: true }).innerText());
  } finally {
    await b.close();
  }
})();
