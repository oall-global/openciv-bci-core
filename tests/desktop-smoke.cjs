// Cross-platform development smoke test using an isolated app profile.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const output = path.join(root, 'test-results');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'smoke-profile-'));
  const app = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    env,
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.neuro);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = (await page.evaluate(() => window.neuro.snapshot())).ready;
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(ready, true, 'Python engine must become ready');
    await page.evaluate(async () => {
      window.smokeFrames = [];
      window.smokeUnsubscribe = window.neuro.subscribe((event) => {
        if (event.type === 'data') window.smokeFrames.push(event);
      });
      await window.neuro.command('connect', { transport: 'demo' });
    });
    await page.waitForFunction(() => window.smokeFrames.length >= 3);
    const frame = await page.evaluate(() => window.smokeFrames.at(-1));
    assert.equal(frame.samples.length, 16);
    assert(frame.timestamps.length > 0);
    assert.equal(frame.samples[0].length, frame.timestamps.length);
    await page.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    await require('./nav.cjs').go(page, '信号工作台');
    await page.getByRole('button', { name: '暂停波形', exact: true }).waitFor();
    await page.getByRole('button', { name: '四宫格', exact: true }).click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.wave-canvas');
      return canvas && canvas.width > 0 && canvas.height > 0;
    });
    await page.screenshot({ path: path.join(output, 'desktop-smoke.png') });
    await page.evaluate(async () => {
      window.smokeUnsubscribe();
      await window.neuro.command('disconnect');
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS desktop smoke: Electron, Python engine, 16-channel demo stream, UI status, disconnect',
    );
  } catch (error) {
    const page = app.windows()[0];
    if (page) console.error(await page.evaluate(() => window.neuro.diagnostics()));
    throw error;
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
