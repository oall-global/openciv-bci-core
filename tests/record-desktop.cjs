// 录制脑电 (主图): record a few seconds on the simulated device, name the moment, then the
// keepsake card with image / copy / video actions. Shots in test-results/moment-*.png.
const { _electron } = require('playwright'),
  path = require('path'),
  assert = require('assert/strict');
const { go } = require('./nav.cjs');
(async () => {
  const root = path.resolve(__dirname, '..'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      root,
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/rec-' + Date.now()),
    ],
    env,
  });
  try {
    const p = await app.firstWindow(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewportSize({ width: 1440, height: 900 });
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
    await p.getByRole('button', { name: '开源文明 BCI-001 首页' }).click();
    // baseline first (about 10 s on the simulated device)
    // the wear card shows the electrode map while waiting / building the baseline
    await p.locator('.wbf-notice.wear .cm-head').waitFor();
    await p.locator('.wbf-notice').waitFor({ state: 'detached', timeout: 40000 });
    // the timeline's hover preview stays inside at the right end (it used to scroll the page)
    const strip = await p.locator('.brain-tl canvas').first().boundingBox();
    await p.mouse.move(strip.x + strip.width - 2, strip.y + strip.height / 2);
    const tl = await p.locator('.brain-tl').first().boundingBox();
    const pv = await p.locator('.brain-preview').boundingBox();
    assert.ok(
      pv.x + pv.width <= tl.x + tl.width + 1,
      `preview past the edge: ${pv.x + pv.width} > ${tl.x + tl.width}`,
    );
    assert.ok(
      await p.evaluate(() =>
        [document.scrollingElement, ...document.querySelectorAll('.content')].every(
          (e) => e.scrollWidth <= e.clientWidth,
        ),
      ),
      'scrolls sideways',
    );
    await p.mouse.move(10, 10);
    // 佩戴检查 opens the same map at any time
    await p.getByRole('button', { name: '佩戴检查' }).click();
    await p.locator('.wbf-fitpanel .wbf-fit-count').waitFor();
    await p.getByRole('dialog', { name: '佩戴检查' }).getByRole('button', { name: '关闭' }).click();
    await p.getByRole('button', { name: '录制脑电' }).click();
    const stop = p.getByRole('button', { name: /停止录制/ });
    await stop.waitFor();
    assert.ok(await stop.isDisabled(), 'at least 5 s');
    // a recording frame round the window with a REC badge while recording
    await p.locator('.rec-frame .rec-badge', { hasText: '正在录制脑电' }).waitFor();
    await p.screenshot({ path: path.join(root, 'test-results/recording.png') });
    // 标记此刻 twice while recording
    await p.waitForTimeout(3000);
    await p.getByRole('button', { name: /标记此刻/ }).click();
    await p.waitForTimeout(4000);
    await p.getByRole('button', { name: /标记此刻/ }).click();
    await p.getByRole('button', { name: '标记此刻 · 2' }).waitFor();
    await p.waitForTimeout(4000);
    await stop.click();
    const card = p.getByRole('dialog', { name: '脑电记录' });
    // Name the moment, then the card.
    // a plain record: no occasions to choose
    assert.equal(await card.getByRole('radio').count(), 0);
    assert.equal(await card.getByLabel('标题').inputValue(), '脑电记录');
    await card.getByLabel('标记 1 的名称').fill('闭眼');
    await card.getByLabel('标记 2 的名称').fill('睁眼');
    await card.getByLabel('备注（可选）').fill('闭眼休息一分钟');
    await card.getByLabel('署名（可选）').fill('P001');
    await card.getByRole('button', { name: '生成卡片' }).click();
    await card.getByLabel('脑电卡片').waitFor();
    await card.getByRole('button', { name: '保存图片' }).waitFor();
    await card.getByRole('button', { name: '复制图片' }).waitFor();
    await card.getByRole('button', { name: '保存视频' }).waitFor();
    await p.waitForTimeout(3800); // time axis drawn, maps and strip shown
    await card
      .getByLabel('脑电卡片')
      .screenshot({ path: path.join(root, 'test-results/moment-love.png') });
    await card.getByRole('button', { name: '修改文字' }).click();
    await card.getByLabel('标题').fill('午后的闭眼休息');
    await card.getByLabel('备注（可选）').fill('');
    await card.getByRole('button', { name: '生成卡片' }).click();
    await p.waitForTimeout(3800);
    await card
      .getByLabel('脑电卡片')
      .screenshot({ path: path.join(root, 'test-results/moment-birthday.png') });
    // Kept with the complete EEG; replayed on the workbench.
    await card.getByText('已保存到「脑电数据库」，包括完整的脑电数据').waitFor({ timeout: 15000 });
    await card.getByRole('button', { name: '重放脑电' }).click();
    await card.waitFor({ state: 'detached' });
    // 片段播放: the moment as a clip, playing; seek, jump to the peak, close.
    const mp = p.getByRole('dialog', { name: '片段播放' });
    await mp.getByRole('heading', { name: '午后的闭眼休息' }).waitFor({ timeout: 15000 });
    await mp.getByRole('button', { name: '暂停' }).waitFor();
    await mp.getByRole('button', { name: '跳到变化最明显的一刻' }).click();
    await mp.getByRole('slider', { name: '播放位置' }).click({ position: { x: 20, y: 60 } });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(root, 'test-results/moment-player.png') });
    await mp.getByRole('button', { name: '关闭' }).click();
    await mp.waitFor({ state: 'detached' });
    // 数据 lists it as a card (made from the raw EEG); the card opens large, then the details
    // with the replay; deleted afterwards (through the API: 数据 has no delete).
    const capture = async (name) =>
      require('fs').writeFileSync(
        path.join(root, 'test-results', name),
        Buffer.from(
          await app.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
              .toPNG()
              .toString('base64'),
          ),
          'base64',
        ),
      );
    await go(p, '数据');
    const item = p.locator('.data-card', { hasText: '午后的闭眼休息' });
    await item.locator('img').waitFor({ timeout: 30000 });
    // 导出 BDF from the card and from the details (the save dialog answered with a test path)
    const out = path.join(root, 'test-results', `rec-export-${Date.now()}`);
    require('fs').mkdirSync(out, { recursive: true });
    const saveAs = (file) =>
      app.evaluate(({ dialog }, f) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
      }, file);
    const isBdf = (file) => {
      const h = require('fs').readFileSync(file).subarray(0, 8);
      return h[0] === 0xff && h.subarray(1).toString('latin1') === 'BIOSEMI';
    };
    await saveAs(path.join(out, 'card.bdf'));
    await p
      .locator('.data-card-wrap', { hasText: '午后的闭眼休息' })
      .getByRole('button', { name: /导出 BDF/ })
      .click();
    await p.locator('.data-notice', { hasText: '已导出 BDF' }).waitFor({ timeout: 15000 });
    assert.ok(isBdf(path.join(out, 'card.bdf')), 'BDF from the card');
    await item.click();
    const large = p.getByRole('dialog', { name: '数据卡片' });
    await large.getByRole('button', { name: '查看数据详情' }).click();
    await p.getByRole('heading', { name: '午后的闭眼休息' }).waitFor();
    await p.getByText('录制信息').waitFor();
    await p.getByText('数据质量').waitFor();
    await p.getByText('事件与结果').waitFor();
    // 脑电指标: the values only — no reliability labels, no 脑电年龄
    await p.getByRole('heading', { name: '脑电指标' }).waitFor();
    await p.locator('.data-metrics dd span').first().waitFor({ timeout: 30000 });
    assert.equal(await p.locator('.data-metrics > div').count(), 15);
    assert.equal(await p.locator('.data-metrics em').count(), 0);
    assert.equal(await p.locator('.data-metrics dt', { hasText: '脑电年龄' }).count(), 0);
    await capture('data-detail.png'); // page.screenshot waits for a frame a still page may not draw
    await saveAs(path.join(out, 'detail.bdf'));
    await p.getByRole('button', { name: '导出 BDF' }).click();
    await p.locator('.data-notice', { hasText: 'detail.bdf' }).waitFor({ timeout: 15000 });
    assert.ok(isBdf(path.join(out, 'detail.bdf')), 'BDF from the details');
    await p.getByRole('button', { name: '信号回放' }).click();
    await mp.getByRole('heading', { name: '午后的闭眼休息' }).waitFor({ timeout: 15000 });
    await p.keyboard.press('Escape');
    await mp.waitFor({ state: 'detached' });
    await p.getByRole('button', { name: '返回脑电数据库' }).click();
    await capture('data-page.png'); // page.screenshot waits for a frame a still page may not draw
    // 重命名 on the large card, then in the details; empty goes back to the default name
    await item.click();
    await large.getByRole('button', { name: '重命名' }).click();
    await large.getByLabel('名称').fill('窗边闭眼');
    await capture('data-rename.png');
    await large.getByLabel('名称').press('Enter');
    await large.getByRole('button', { name: '查看数据详情' }).click();
    await p.getByRole('heading', { name: '窗边闭眼' }).waitFor();
    await p.getByRole('button', { name: '重命名' }).click();
    await p.getByLabel('名称').fill('不会保存');
    await p.getByLabel('名称').press('Escape');
    await p.getByRole('heading', { name: '窗边闭眼' }).waitFor();
    await p.getByRole('button', { name: '信号回放' }).click();
    await mp.getByRole('heading', { name: '窗边闭眼' }).waitFor({ timeout: 15000 });
    await p.keyboard.press('Escape');
    await mp.waitFor({ state: 'detached' });
    await p.getByRole('button', { name: '重命名' }).click();
    await p.getByLabel('名称').fill('');
    await p.getByLabel('名称').press('Enter');
    await p.getByRole('heading', { name: '午后的闭眼休息' }).waitFor();
    await p.getByRole('button', { name: '返回脑电数据库' }).click();
    // 删除 from the card, after the confirmation; the recycle bin is stood in for (tests do not
    // fill the real one)
    const trashed = [];
    await app.evaluate(({ shell }) => {
      shell.trashItem = async (dir) => {
        globalThis.trashed = [...(globalThis.trashed ?? []), dir];
        process.getBuiltinModule('fs').rmSync(dir, { recursive: true, force: true });
      };
    });
    await p.evaluate(() => (window.confirm = (m) => (window.asked = m) && true));
    await p
      .locator('.data-card-wrap', { hasText: '午后的闭眼休息' })
      .getByRole('button', { name: /删除/ })
      .click();
    await p.locator('.data-notice', { hasText: '已删除「午后的闭眼休息」' }).waitFor();
    assert.match(await p.evaluate(() => window.asked), /会移到回收站/);
    trashed.push(...(await app.evaluate(() => globalThis.trashed)));
    assert.equal(trashed.length, 1);
    assert.equal(await p.locator('.data-card', { hasText: '午后的闭眼休息' }).count(), 0);
    assert.equal(
      (await p.evaluate(() => window.neuro.moment('list'))).filter(
        (x) => x.title === '午后的闭眼休息',
      ).length,
      0,
    );
    // 添加脑电数据 (no type filters any more): records on 信号工作台 straight away
    assert.equal(await p.getByRole('radiogroup', { name: '类型' }).count(), 0);
    await p.getByRole('button', { name: '添加脑电数据' }).click();
    await p.locator('.rec-frame .rec-badge', { hasText: '正在录制脑电' }).waitFor();
    await p.waitForTimeout(5500);
    await p.getByRole('button', { name: /停止录制/ }).click();
    await p.getByRole('dialog', { name: '脑电记录' }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'PASS record: 录制脑电 → 停止 → moment (plain record, REC frame) → card (image, copy, video), saved with the EEG, played as a clip from the card, 数据 card → large → details → replay, 导出 BDF from the card and the details, 重命名 on the large card and in the details, 删除 from the card',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
