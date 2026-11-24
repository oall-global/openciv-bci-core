const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const regions = require('../content/glossary/brain-regions.json');
// Catch typos against the real bundled GLB, not a duplicated list of mesh names.
const glb = fs.readFileSync(path.join(root, 'src/assets/brain-atlas.glb'));
const document = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
const meshNames = new Set(document.meshes.map((m) => m.name));
assert.equal(new Set(regions.map((r) => r.id)).size, regions.length);
for (const r of regions)
  for (const m of r.meshes) assert.ok(meshNames.has(m), `${r.id}: missing mesh ${m}`);
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      root,
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/anatomy-' + Date.now()),
    ],
    env,
  });
  try {
    const p = await app.firstWindow();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewportSize({ width: 1440, height: 1050 });
    await p.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready) {
          await window.neuro.preferences({ onboarded: true });
          return window.neuro.command('connect', { transport: 'demo' });
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Engine not ready');
    });
    await p.getByRole('button', { name: '开源文明 BCI-001 首页' }).click();
    const open = async (id) => {
      await p.evaluate(
        (id) => window.dispatchEvent(new CustomEvent('brainlab:glossary', { detail: id })),
        id,
      );
      await p.locator('#term-' + id).waitFor();
    };
    await open('anatomy');
    await p.locator('.atlas-canvas canvas').waitFor();
    await p
      .getByText('正在加载大脑模型…', { exact: true })
      .waitFor({ state: 'hidden', timeout: 30000 });
    assert.equal(await p.locator('.atlas-status').count(), 0, 'model loaded without fallback');
    for (const r of regions) {
      await p
        .getByRole('group', { name: '选择脑区', exact: true })
        .getByRole('button', { name: r.title, exact: true })
        .click();
      await p.locator('.atlas-description').getByText(r.summary, { exact: false }).waitFor();
      assert.equal(await p.locator('.atlas-selected').textContent(), r.title);
      if (r.deep)
        assert.equal(
          await p.getByRole('button', { name: '内部', exact: true }).getAttribute('aria-pressed'),
          'true',
        );
    }
    await p
      .getByRole('group', { name: '选择脑区', exact: true })
      .getByRole('button', { name: '海马', exact: true })
      .click();
    await p.getByLabel('只看选区', { exact: true }).check();
    await p.getByRole('button', { name: '阅读「海马」完整条目 →', exact: true }).click();
    await p.locator('#term-region-hippocampus').waitFor();
    await p.getByText('正在加载大脑模型…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await p.locator('.atlas-selected').textContent(), '海马');
    assert.equal(
      await p.getByLabel('只看选区', { exact: true }).isChecked(),
      false,
      'new article resets isolation',
    );
    await p.locator('.anatomy-atlas').evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await p.screenshot({ path: path.join(root, 'test-results/anatomy-hippocampus.png') });
    await open('region-occipital');
    await p.getByText('正在加载大脑模型…', { exact: true }).waitFor({ state: 'hidden' });
    await p.getByRole('button', { name: '后侧', exact: true }).click();
    await p.locator('.anatomy-atlas').evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await p.screenshot({ path: path.join(root, 'test-results/anatomy-occipital.png') });
    const canvas = p.locator('.atlas-canvas canvas');
    const original = await canvas.evaluate((c) => c.toDataURL());
    const bounds = await canvas.boundingBox();
    await p.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await p.mouse.down();
    await p.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 20, {
      steps: 8,
    });
    await p.mouse.up();
    const rotated = await canvas.evaluate((c) => c.toDataURL());
    assert.notEqual(rotated, original, 'drag rotates the anatomical model');
    await p.getByRole('button', { name: '后侧', exact: true }).click();
    assert.notEqual(
      await canvas.evaluate((c) => c.toDataURL()),
      rotated,
      'clicking the current preset resets the rotated view',
    );
    // Unmount and remount the renderer to catch stale resources and late loader callbacks.
    await open('alpha');
    assert.equal(await p.locator('.atlas-canvas').count(), 0);
    await open('anatomy');
    await p.locator('.atlas-canvas canvas').waitFor();
    await p.getByText('正在加载大脑模型…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await p.locator('.atlas-status').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS anatomy: ${regions.length} mesh mappings, selection, internal views, article links, reset and remount`,
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
