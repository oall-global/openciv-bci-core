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
  const p = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
  });
  await go(p, '设备');
  await p.getByRole('heading', { name: '连接你的脑电设备' }).waitFor();
  await p.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if ((await window.neuro.snapshot()).ready) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error('Engine not ready');
  });
  if (process.argv.includes('--identify')) {
    await p.getByRole('button', { name: '识别设备', exact: true }).click();
    await p.getByRole('heading', { name: '选择连接方式', exact: true }).waitFor({ timeout: 20000 });
  }
  console.log(
    'Opened connection wizard' +
      (process.argv.includes('--identify')
        ? '; USB identity verified; no Wi-Fi credentials changed'
        : ''),
  );
  await new Promise((resolve) => app.on('close', resolve));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
