const { go } = require('./nav.cjs');
const { _electron } = require('playwright'),
  path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe'),
    args: [],
    env,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  await go(page, '信号工作台');
  await page.getByRole('heading', { name: '信号工作台' }).waitFor();
  if (process.argv.includes('--brain')) {
    await page.getByRole('button', { name: '单图', exact: true }).click();
    await page.getByLabel('面板 1 图表', { exact: true }).selectOption('brain');
    await page.locator('.brain-sync-canvas[data-loaded=true]').waitFor();
    await page.locator('.wb-analysis').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -90));
  }
  console.log('Opened modern acquisition workbench; no automatic device connection');
  await new Promise((resolve) => app.on('close', resolve));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
