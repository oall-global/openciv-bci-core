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
  await go(page, '开发者工作台');
  await page.getByText('接口已关闭', { exact: true }).waitFor();
  console.log('Opened developer workbench; interface disabled; no automatic device connection');
  await new Promise((resolve) => app.on('close', resolve));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
