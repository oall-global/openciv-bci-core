// Smoke test of the packaged app (release/win-unpacked): new pages and one engine-backed flow.
const { go } = require('./nav.cjs');
const { _electron } = require('playwright'),
  path = require('path'),
  assert = require('assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe'),
    args: [
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/packaged-' + Date.now()),
    ],
    env,
  });
  try {
    const p = await app.firstWindow(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const version = await p.evaluate(async () => {
      for (let i = 0; i < 150; i++) {
        const s = await window.neuro.snapshot();
        if (s.ready) {
          const who = await window.neuro.participant('create');
          await window.neuro.participant('consent', { code: who.current });
          await window.neuro.command('connect', { transport: 'demo' });
          return (await window.neuro.diagnostics()).version;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Engine not ready');
    });
    assert.equal(version, require('../package.json').version);
    await p.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    await go(p, '实验');
    assert.equal(await p.locator('.ex-card').count(), 18);
    await go(p, '模型训练');
    await p.getByText('已训练的模型').waitFor();
    await go(p, '控制');
    await p.getByRole('heading', { name: '我的控制方式' }).waitFor();
    // One engine-backed flow end to end: eye/jaw calibration with simulated actions.
    await p
      .locator('.control-card')
      .filter({ hasText: '眼动与咬牙' })
      .getByRole('button', { name: '开始校准' })
      .click();
    await p.getByRole('button', { name: '开始校准' }).click({ timeout: 15000 });
    await p.getByRole('heading', { name: '校准完成' }).waitFor({ timeout: 90000 });
    assert.equal(await p.getByText('可以使用').count(), 4);
    assert.deepEqual(errors, []);
    console.log(`PASS packaged ${version}: pages, eye/jaw calibration through the packaged engine`);
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
