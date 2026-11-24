const { go } = require('./nav.cjs');
const { _electron } = require('playwright'),
  path = require('path'),
  assert = require('assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    packaged = process.argv.includes('--packaged'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: packaged
      ? path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe')
      : require('electron'),
    args: [
      ...(packaged ? [] : [root]),
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/workbench-' + Date.now()),
    ],
    env,
  });
  try {
    const p = await app.firstWindow(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    // WebGL shader compile errors only reach the console.
    p.on('console', (m) => /Shader Error|ERROR:/.test(m.text()) && errors.push(m.text()));
    // a user who has set up a device before (first run shows only 连接设备)
    await p.evaluate(async () => {
      for (let i = 0; i < 100 && !(await window.neuro.snapshot()).ready; i++)
        await new Promise((r) => setTimeout(r, 100));
      await window.neuro.preferences({ onboarded: true, firstWear: true });
    });
    // channel rows are on the 实时脑电波 tab (read when the workbench opens)
    await p.evaluate(() => localStorage.setItem('neurolink.sideTab', 'wave'));
    await p.reload();
    await go(p, '信号工作台');
    await p.getByRole('heading', { name: '信号工作台' }).waitFor();
    // Default layout 主图: the digital brain in the middle, 16 channels on the right.
    await p.getByRole('button', { name: '主图', pressed: true }).waitFor();
    await p.locator('.wbf-ch').nth(15).waitFor();
    assert.equal(await p.locator('.wbf-ch').count(), 16);
    // Not connected: the brain offers to connect a device.
    await p.getByRole('button', { name: '连接脑电设备' }).waitFor();
    await p.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready)
          return window.neuro.command('connect', { transport: 'demo' });
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Engine not ready');
    });
    await p.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    await p.waitForTimeout(5000);
    // The 主图 without its legend (神经元信号 / 脑区连接 / 皮层颜色).
    assert.equal(await p.locator('.wbf-legend').count(), 0);
    // The 主图 opens on the head and zooms into the brain (the head faint behind); scrolling out
    // past the brain brings the head back, scrolling in goes into the brain again.
    await p.locator('.wbf-head3d .head-stage canvas').first().waitFor({ timeout: 20000 });
    await p.waitForFunction(() => !document.querySelector('.wbf-brain.head-on'), null, {
      timeout: 20000,
    });
    const brainBox = await p.locator('.wbf-orbit').boundingBox();
    await p.mouse.move(brainBox.x + brainBox.width / 2, brainBox.y + brainBox.height / 2);
    for (let i = 0; i < 8; i++) await p.mouse.wheel(0, 120);
    await p.locator('.wbf-brain.head-on').waitFor();
    for (let i = 0; i < 8; i++) await p.mouse.wheel(0, -120);
    await p.waitForFunction(() => !document.querySelector('.wbf-brain.head-on'));
    // Double-click: from above, all 16 electrodes in view.
    await p.mouse.dblclick(brainBox.x + brainBox.width / 2, brainBox.y + brainBox.height / 2);
    await p.waitForFunction(
      () =>
        [...document.querySelectorAll('.wbf-label')].filter((e) => Number(e.style.opacity) > 0.5)
          .length === 16,
      null,
      { timeout: 5000 },
    );
    // Channel rows and band cards link with the brain.
    await p.getByRole('button', { name: '选中通道 7 O1' }).click();
    assert.equal(await p.getByLabel('工作台选中通道').count(), 0, 'no 选中通道 menu');
    // 开发者接口: the master switch on the 主图; on, it counts the programs and the enabled
    // abilities it carries, 接口说明 opens its card with the text and 复制文本 (not clicked: the
    // system clipboard is the user's); off again closes it
    await p.getByRole('switch', { name: '开发者接口', checked: false }).click();
    await p.locator('.wb-api small', { hasText: /0 个程序/ }).waitFor();
    await p.getByRole('button', { name: '接口说明' }).click();
    const guide = p.getByRole('dialog', { name: '接口说明' });
    await guide.getByText(/接入密钥/).waitFor({ timeout: 10000 });
    await guide.getByRole('button', { name: '复制文本' }).waitFor();
    await guide.getByRole('button', { name: '关闭' }).click();
    await guide.waitFor({ state: 'detached' });
    await p.getByRole('switch', { name: '开发者接口' }).click();
    await p.getByRole('switch', { name: '开发者接口', checked: false }).waitFor();
    await p.locator('.wbf-ch.on', { hasText: 'O1' }).waitFor();
    await p.getByRole('tab', { name: '脑电能量' }).click();
    await p.getByRole('radio', { name: /Beta/ }).click();
    await p.getByRole('radio', { name: /Beta/, checked: true }).waitFor();
    await p.getByRole('button', { name: '四宫格', exact: true }).click();
    await p.getByRole('button', { name: /^通道 10 / }).click();
    assert((await p.locator('.wb-analysis h2').textContent()).includes('CH 10'));
    // The checkbox list is still available as a chart.
    await p.getByLabel('面板 4 图表', { exact: true }).selectOption('channel-list');
    await p.getByLabel('显示通道 10', { exact: true }).uncheck();
    assert(!(await p.getByLabel('显示通道 10', { exact: true }).isChecked()));
    await p.getByRole('button', { name: '暂停波形', exact: true }).click();
    await p.getByRole('button', { name: '继续显示', exact: true }).waitFor();
    await p.getByRole('button', { name: '继续显示', exact: true }).click();
    assert.equal(await p.locator('.wb-chart-cell').count(), 4);
    await p.getByLabel('面板 2 图表', { exact: true }).selectOption('bands');
    await p.locator('.wb-band-bars').waitFor();
    assert.equal(await p.locator('.wb-band-bars>div').count(), 5);
    await p.getByLabel('频段功率显示单位').selectOption('absolute');
    await p.getByLabel('面板 2 图表', { exact: true }).selectOption('spectrogram');
    await p.locator('.wb-spectrogram').waitFor();
    await p.waitForTimeout(1500);
    assert(await p.locator('.wb-spectrogram').evaluate((el) => el.width > 0 && el.height > 0));
    await p.getByLabel('面板 2 图表', { exact: true }).selectOption('spectrum');
    await p.getByRole('button', { name: '左右', exact: true }).click();
    assert.equal(await p.locator('.wb-chart-cell').count(), 2);
    await p.getByRole('button', { name: '放大面板 2', exact: true }).click();
    assert.equal(await p.locator('.wb-chart-cell').count(), 1);
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.wb-chart-cell').count(), 2);
    await p.getByLabel('面板 2 图表', { exact: true }).selectOption('brain');
    await p.locator('.brain-sync-canvas canvas').first().waitFor();
    await p.getByLabel('面板 2 图表', { exact: true }).selectOption('spectrum');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 740));
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.getByRole('button', { name: '上下', exact: true }).click();
    await p.getByRole('button', { name: '单图', exact: true }).click();
    assert.equal(await p.locator('.wb-chart-cell').count(), 1);
    await p.getByLabel('面板 1 图表', { exact: true }).selectOption('spectrum');
    await go(p, '脑电数据库');
    await go(p, '信号工作台');
    assert.equal(await p.getByLabel('面板 1 图表', { exact: true }).inputValue(), 'spectrum');
    assert.equal(await p.locator('.wb-chart-cell').count(), 1);
    await p.getByRole('button', { name: '四宫格', exact: true }).click();
    assert.equal(await p.locator('.wb-chart-cell').count(), 4);
    // 数字大脑 is in the default four panels; views and bands switch.
    assert.equal(await p.getByLabel('面板 3 图表', { exact: true }).inputValue(), 'digital');
    await p.getByLabel('数字大脑', { exact: true }).waitFor();
    await p.getByRole('radio', { name: '左', exact: true }).click();
    await p.getByRole('radio', { name: '左', exact: true, checked: true }).waitFor();
    await p.getByRole('radio', { name: /β 13–30/ }).click();
    await p.evaluate(() => window.neuro.command('disconnect'));
    await p.locator('.conn-pill', { hasText: '未连接' }).waitFor();
    await p.locator('.wb-params', { hasText: '16 通道 · 未连接' }).waitFor({ state: 'attached' });
    assert((await p.locator('.wb-channel-detail').innerText()).includes('等待数据'));
    assert.deepEqual(errors, [], errors.join(' / ').slice(0, 3000));
    console.log(
      'PASS default workbench, demo, 16 channels, selection, visibility, pause, spectrum/3D, minimum layout, disconnect invalidation',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
