const { chromium } = require('playwright'),
  fs = require('fs'),
  path = require('path');
(async () => {
  const port = fs
    .readFileSync(path.join(process.env.APPDATA, 'neurolink-desktop/DevToolsActivePort'), 'utf8')
    .split('\n')[0];
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const p = b.contexts()[0].pages()[0];
  await p.screenshot({ path: 'test-results/setup-live-0.1.19.png' });
  console.log(await p.getByRole('heading', { name: '连接你的脑电设备' }).isVisible());
  await b.close();
})();
