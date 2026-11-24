const { _electron: e } = require('playwright'),
  { go } = require('./nav.cjs'),
  path = require('path'),
  assert = require('assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    packaged = process.argv.includes('--packaged'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await e.launch({
    executablePath: packaged
      ? path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe')
      : require('electron'),
    args: [
      ...(packaged ? [] : [root]),
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/check-profile-' + Date.now()),
    ],
    env,
  });
  try {
    const p = await app.firstWindow(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready) {
          // set up already: the check leaves 'streaming', which would reopen the first run
          await window.neuro.preferences({ onboarded: true, firstWear: true });
          return window.neuro.command('connect', { transport: 'demo' });
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Engine not ready');
    });
    await p.reload(); // the renderer reads the preferences when it loads
    await p.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    // 设置 › 接触诊断 (development builds): the on-demand impedance check
    await go(p, '设置');
    await p.getByRole('tab', { name: '接触诊断' }).click();
    await p.getByRole('button', { name: '开始连接检测', exact: true }).click();
    await p.getByRole('button', { name: '取消检测并恢复采集' }).click();
    await p.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    if (!process.argv.includes('--smoke')) {
      await p.getByRole('button', { name: '开始连接检测', exact: true }).click();
      await p
        .locator('.check-instruction b')
        .filter({ hasText: '检测完成' })
        .waitFor({ timeout: 140000 });
      await p.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
      assert.equal(await p.locator('.check-channel').count(), 16);
      const snapshot = await p.evaluate(() => window.neuro.snapshot());
      assert.equal(snapshot.connectionCheck.contacts.filter(Boolean).length, 16);
      assert.equal(snapshot.connectionCheck.signals.filter(Boolean).length, 16);
      assert.equal(await p.locator('.check-channel .dot.good').count(), 10);
      assert.equal(await p.locator('.check-channel .dot.warn').count(), 3);
      assert.equal(await p.locator('.check-channel .dot.bad').count(), 3);
      await p.getByRole('button', { name: '查看接触检测通道 4', exact: true }).click();
      await p.screenshot({
        path: path.join(root, 'test-results/connection-check.png'),
        fullPage: true,
      });
      await p.evaluate(() => window.neuro.command('disconnect'));
      await p.waitForFunction(
        () => document.querySelectorAll('.check-channel .dot.good').length === 0,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: check page, cancel, navigation, resume' +
        (process.argv.includes('--smoke')
          ? ''
          : ', full 16-channel simulated flow, colors, results, disconnect invalidation'),
    );
  } catch (err) {
    console.log('FAIL', err.message);
    const p = await app.firstWindow();
    console.log('FAIL SNAPSHOT', JSON.stringify(await p.evaluate(() => window.neuro.snapshot())));
    console.log('BODY', (await p.locator('body').innerText()).slice(0, 2000));
    await p.screenshot({ path: path.join(root, 'test-results/check-failure.png'), fullPage: true });
    throw err;
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
