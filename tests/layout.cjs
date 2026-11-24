const { _electron: electron } = require('playwright');
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const profile = path.join(root, 'test-results/layout-profile');
  fs.mkdirSync(profile, { recursive: true });
  const app = await electron.launch({
    executablePath: process.argv.includes('--dev')
      ? require('electron')
      : path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe'),
    args: [...(process.argv.includes('--dev') ? [root] : []), `--user-data-dir=${profile}`],
    env,
    timeout: 60000,
  });
  const errors = [],
    checks = [];
  app
    .process()
    .once('exit', (code, signal) =>
      console.log('Electron exited', JSON.stringify({ code, signal })),
    );
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(12000);
    await page.getByRole('heading', { name: '从一次连接，开始探索。' }).waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setSize(1060, 740);
      w.showInactive();
    });
    await page.waitForFunction(async () => (await window.neuro.snapshot()).ready);
    const layout = () =>
      page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        height: innerHeight,
      }));
    assert(
      (await layout()).scroll <= (await layout()).width,
      'Device page must not overflow horizontally at minimum window size',
    );
    checks.push('minimum-size device page');
    await page.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready)
          return window.neuro.command('connect', { transport: 'demo' });
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Engine not ready');
    });
    await page.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    assert(
      (await layout()).scroll <= (await layout()).width,
      'Signal page must not overflow horizontally',
    );
    await page.getByRole('button', { name: '佩戴质量', exact: true }).click();
    const head = page.locator('.head-canvas');
    await head.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const label = page.locator('.electrode-label').filter({ hasText: /^07$/ });
    const initial = await label.boundingBox();
    assert(initial);
    const opacity = await label.evaluate((e) => getComputedStyle(e).opacity);
    assert.equal(opacity, '1');
    await page.mouse.click(initial.x + initial.width / 2, initial.y + initial.height / 2);
    await page.getByText('通道 7 · 状态良好', { exact: true }).waitFor();
    checks.push('3D electrode click selects corresponding channel');
    const area = await head.boundingBox();
    const before = await label.boundingBox();
    await page.mouse.move(area.x + area.width * 0.5, area.y + area.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.7, area.y + area.height * 0.56, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    const rotated = await label.boundingBox();
    assert(Math.abs(rotated.x - before.x) > 5, 'Drag must rotate model');
    checks.push('3D drag rotation');
    await page.getByRole('button', { name: '重置头部视角', exact: true }).click();
    await page.waitForTimeout(700);
    await head.screenshot();
    const reset = await label.boundingBox();
    console.log('Camera label bounds', JSON.stringify({ initial, before, rotated, reset }));
    assert(
      Math.abs(reset.x + reset.width / 2 - (before.x + before.width / 2)) < 3,
      'Reset restores camera',
    );
    checks.push('camera reset');
    await head.scrollIntoViewIfNeeded();
    const zoomBefore = await label.boundingBox();
    const currentArea = await head.boundingBox();
    await page.mouse.move(
      currentArea.x + currentArea.width / 2,
      currentArea.y + currentArea.height / 2,
    );
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(700);
    const zoomed = await label.boundingBox();
    assert(
      Math.abs(zoomed.x - zoomBefore.x) + Math.abs(zoomed.y - zoomBefore.y) > 2,
      'Wheel must zoom camera',
    );
    checks.push('3D wheel zoom');
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const status = await page.locator('.statusbar').boundingBox();
    assert(status.y >= 45 && status.y <= 55, 'Status stays visible after scroll');
    checks.push('sticky connection status');
    await page.screenshot({
      path: path.join(root, 'test-results/minimum-window.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: '使用指南', exact: true }).click();
    await page.keyboard.press('Shift+Tab');
    assert(
      await page.evaluate(() =>
        document.querySelector('[role="dialog"]').contains(document.activeElement),
      ),
      'Focus stays inside dialog',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    checks.push('guide focus trap and Escape');
    assert.equal(errors.length, 0, errors.join('\n'));
    fs.writeFileSync(
      path.join(root, 'test-results/layout.json'),
      JSON.stringify({ passed: true, layout: await layout(), checks, errors }, null, 2),
    );
    console.log('PASS layout and 3D interaction', checks);
  } catch (e) {
    console.error('Failed after checks:', checks);
    const page = app.windows()[0];
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(root, 'test-results/layout-failure.png'), timeout: 5000 })
        .catch(() => {});
    throw e;
  } finally {
    if (app.process().exitCode === null) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
