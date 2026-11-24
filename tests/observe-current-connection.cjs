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
              let frames = 0,
                samples = 0,
                first = null,
                last = null;
              const off = window.neuro.subscribe((e) => {
                if (e.type === 'data') {
                  frames++;
                  samples += e.samples?.[0]?.length || 0;
                  first ??= e.at;
                  last = e.at;
                }
              });
              setTimeout(async () => {
                off();
                resolve({
                  frames,
                  samples,
                  spanSeconds: last - first,
                  snapshot: await window.neuro.snapshot(),
                });
              }, 10000);
            }),
        ),
      ),
    );
  } finally {
    await b.close();
  }
})();
