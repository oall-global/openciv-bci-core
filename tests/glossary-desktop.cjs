// 概念手册 and the 「?」 next to concepts: popup with the short explanation, link to the entry,
// the manual from 工具与设置 with search.
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
      '--user-data-dir=' + path.join(root, 'test-results/gl-' + Date.now()),
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
    // 「?」 next to 频段能量: the short explanation, then the entry in the manual.
    await p.getByRole('button', { name: '什么是频段（δ θ α β γ）' }).click();
    const pop = p.getByRole('dialog', { name: '频段（δ θ α β γ）' });
    await pop.getByText(/α 8–13 Hz/).waitFor();
    await p.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });
    await p.getByRole('button', { name: '什么是脑活动图谱（大脑颜色）' }).click();
    const bp = p.getByRole('dialog', { name: '脑活动图谱（大脑颜色）' });
    await bp.getByText('界面上').waitFor();
    await bp.getByText('怎么做').waitFor();
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(root, 'test-results/help-popup.png') });
    await bp.getByRole('button', { name: /查看详细说明/ }).click();
    await p.getByRole('heading', { name: '概念手册' }).waitFor();
    await p.locator('#term-brainmap.lit').waitFor();
    assert.equal(await p.locator('.glossary-term').count(), 1, 'one entry per page');
    // From the menu: the contents open one chapter; search lists matches without leaving the page.
    await go(p, '概念手册');
    await p.getByRole('heading', { name: '概念手册' }).waitFor();
    assert.equal(
      await p.locator('.glossary-toc > div').count(),
      require('../content/glossary/chapters.json').length,
    );
    await p.getByLabel('搜索概念').fill('SSVEP');
    await p.locator('.glossary-toc a[href="#term-paradigms"]').click();
    await p.locator('#term-paradigms').waitFor();
    assert.equal(await p.locator('.glossary-toc a[href="#term-baseline"]').count(), 0);
    assert.equal(await p.locator('.glossary-term').count(), 1);
    // Related entries and cross-links open their page, whatever the search shows.
    await p.getByLabel('搜索概念').fill('傅里叶变换与频谱');
    await p.getByLabel('搜索概念').press('Enter');
    await p.locator('#term-spectrum-analysis .glossary-related a[href="#term-power"]').click();
    await p.locator('#term-power').waitFor();
    await p.getByLabel('搜索概念').fill('');
    await p.locator('.glossary-toc .glossary-chapter-link').first().click();
    await p.locator('#term-bci').waitFor();
    await p.locator('.glossary-where', { hasText: '脑机接口是什么 · 第 1 / 3 篇' }).waitFor();
    await p.locator('#term-bci .glossary-related a[href="#term-limits"]').click();
    await p.locator('#term-limits').waitFor();
    const open = (id) =>
      p.evaluate(
        (id) => window.dispatchEvent(new CustomEvent('brainlab:glossary', { detail: id })),
        id,
      );
    await open('eeg');
    await p.locator('#term-eeg a.glossary-xref[href="#term-reference"]').click();
    await p.locator('#term-reference.lit').waitFor();
    // 上一篇 / 下一篇 follow the order of chapters.json.
    const chapters = require('../content/glossary/chapters.json');
    const order = chapters.flatMap((c) => c.entries);
    const at = order.indexOf('reference');
    await p.getByRole('button', { name: /下一篇/ }).click();
    await p.locator(`#term-${order[at + 1]}`).waitFor();
    await p.getByRole('button', { name: /上一篇/ }).click();
    await p.locator('#term-reference').waitFor();
    // Every figure loads, on its entry's page.
    const fs = require('fs');
    const files = [];
    const walk = (d) =>
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name.endsWith('.md') && !e.name.startsWith('_') && e.name !== 'README.md')
          files.push(f);
      });
    walk(path.join(root, 'content/glossary'));
    const withFigures = files
      .map((f) => fs.readFileSync(f, 'utf8'))
      .filter((t) => /!\[[^\]]*\]\(images\//.test(t))
      .map((t) => /^id:\s*(\S+)/m.exec(t)[1]);
    assert.ok(withFigures.length > 0);
    for (const id of withFigures) {
      await open(id);
      await p.locator(`#term-${id}`).waitFor();
      const ok = await p.locator('.glossary-fig img').evaluateAll(async (imgs) => {
        await Promise.all(imgs.map((img) => img.decode()));
        return imgs.length > 0 && imgs.every((img) => img.naturalWidth > 0);
      });
      assert.ok(ok, `figures of ${id} load`);
    }
    await open('alpha');
    await p.locator('#term-alpha').waitFor();
    await p.screenshot({ path: path.join(root, 'test-results/glossary-alpha.png') });
    await open('rail');
    await p.locator('#term-rail').waitFor();
    await p.screenshot({ path: path.join(root, 'test-results/glossary-rail.png') });
    assert.deepEqual(errors, []);
    console.log(
      'PASS glossary: 「?」 popup, link to the entry (highlighted), one entry per page, contents, search, related, cross-links, previous / next, figures',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
