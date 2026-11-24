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
        await p.evaluate(async () => ({
          text: document.querySelector('.connection-wizard')?.innerText,
          diagnostics: await window.neuro.diagnostics(),
          prefs: await window.neuro.preferences(),
        })),
      ),
    );
    console.log(
      'USB',
      JSON.stringify(await p.evaluate(() => window.neuro.command('setup-usb', { ending: 'none' }))),
    );
  } finally {
    await b.close();
  }
})();
