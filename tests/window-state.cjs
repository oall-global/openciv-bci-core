if (process.platform !== 'darwin') {
  console.log('SKIP macOS-only UI regression');
  process.exit(0);
}
const { _electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brainlab-window-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: require('../scripts/start-macos.cjs').desktopExecutable(),
    args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    const enter = process.platform === 'darwin' ? '进入全屏' : '最大化窗口';
    const leave = process.platform === 'darwin' ? '退出全屏' : '还原窗口';
    const verify = async (name, icon) => {
      const button = page.getByRole('button', { name, exact: true });
      await button.waitFor();
      assert.equal(await button.getAttribute('title'), name);
      assert.equal(await button.locator(`svg.lucide-${icon}`).count(), 1);
    };
    await verify(enter, 'maximize2');
    await page.getByRole('button', { name: enter, exact: true }).click();
    await verify(leave, 'minimize2');
    await page.getByRole('button', { name: leave, exact: true }).click();
    await verify(enter, 'maximize2');
    // OS/menu-driven changes must update the UI without clicking its button.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      process.platform === 'darwin' ? win.setFullScreen(true) : win.maximize();
    });
    await verify(leave, 'minimize2');
    await page.reload();
    await verify(leave, 'minimize2');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      process.platform === 'darwin' ? win.setFullScreen(false) : win.unmaximize();
    });
    await verify(enter, 'maximize2');
    console.log(
      'PASS window state: icon, tooltip, button, native events and reload while expanded',
    );
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
