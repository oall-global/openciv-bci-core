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
      'probe',
      await p.evaluate(() => window.neuro.command('setup-probe', { address: '192.158.0.140' })),
    );
    await p.getByRole('button', { name: '连接设备', exact: true }).click();
    await p.waitForTimeout(12000);
    console.log(
      JSON.stringify(
        await p.evaluate(async () => ({
          text: document.querySelector('.connection-wizard')?.innerText,
          status: await window.neuro.snapshot(),
        })),
      ),
    );
  } finally {
    await b.close();
  }
})();
