// End-to-end: 设置 → 电极位置. Change CH1 to Fz, see the workbench and the engine follow, and
// restore the default.
const { go } = require('./nav.cjs');
const { _electron } = require('playwright'),
  path = require('path'),
  assert = require('assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      root,
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/montage-' + Date.now()),
    ],
    env,
  });
  try {
    const p = await app.firstWindow(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewportSize({ width: 1360, height: 900 });
    await p.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready) {
          await window.neuro.preferences({ onboarded: true, firstWear: true });
          return window.neuro.command('connect', { transport: 'demo' });
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Engine not ready');
    });
    assert.equal((await p.evaluate(() => window.neuro.montage())).names[0], 'Fp1');
    await go(p, '设置');
    // 外观: dark by default; light and back, applied at once and kept.
    const theme = () => p.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(await theme(), 'dark');
    await p.getByRole('radio', { name: '浅色' }).click();
    assert.equal(await theme(), 'light');
    assert.equal(await p.evaluate(() => localStorage.getItem('neurolink.theme')), 'light');
    await p.getByRole('radio', { name: '深色' }).click();
    assert.equal(await theme(), 'dark');
    await p.getByLabel('CH 1 电极位置').selectOption('Fz');
    await p.getByText('默认 Fp1').waitFor();
    // Duplicates are refused before saving.
    await p.getByLabel('CH 2 电极位置').selectOption('Fz');
    await p.getByText(/位置重复：Fz/).waitFor();
    assert(await p.getByRole('button', { name: '保存电极位置' }).isDisabled());
    await p.getByLabel('CH 2 电极位置').selectOption('Fp2');
    await p.getByText(/眨眼、眼动与咬牙控制需要 Fp1/).waitFor();
    await p.getByRole('button', { name: '保存电极位置' }).click();
    await p
      .getByText(/电极位置已保存/)
      .first()
      .waitFor();
    const saved = await p.evaluate(() => window.neuro.montage());
    assert.equal(saved.names[0], 'Fz');
    assert.equal((await p.evaluate(() => window.neuro.preferences())).montage[0], 'Fz');
    // The workbench shows the new position.
    // channel rows are on the 实时脑电波 tab
    await p.evaluate(() => localStorage.setItem('neurolink.sideTab', 'wave'));
    await go(p, '信号工作台');
    await p.locator('.wbf-ch', { hasText: 'Fz' }).first().waitFor();
    assert.equal(await p.locator('.wbf-ch', { hasText: 'Fp1' }).count(), 0);
    // Restore the default.
    await go(p, '设置');
    await p.getByRole('button', { name: '恢复默认布局' }).click();
    await p.waitForFunction(async () => (await window.neuro.montage()).names[0] === 'Fp1');
    assert.deepEqual(errors, []);
    console.log(
      'PASS montage desktop: edit, duplicate check, missing-position note, save, workbench follows, restore',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
