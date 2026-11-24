// Restore the user's verified Wi-Fi connection; leave the visible app open.
const { go } = require('./nav.cjs');
const { _electron: e } = require('playwright'),
  path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await e.launch({
    executablePath: path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe'),
    args: [],
    env,
  });
  const p = await app.firstWindow();
  await go(p, '设置');
  await p.getByLabel('连接方式').selectOption('wifi');
  await p.getByLabel('设备 IP 地址（可留空自动发现）', { exact: true }).fill('192.167.1.13');
  await p.getByLabel('采样率（与官方 GUI 一致）').selectOption('250');
  await p.getByRole('button', { name: '保存设置', exact: true }).click();
  await p.getByText('连接偏好已保存在本机', { exact: true }).waitFor();
  await go(p, '设备');
  await p.getByRole('button', { name: '手动连接', exact: false }).click();
  await p.getByRole('button', { name: '连接设备', exact: true }).click();
  await p.getByText('数据正在接收', { exact: true }).waitFor({ timeout: 25000 });
  const statistics = await p.evaluate(
    () =>
      new Promise((resolve) => {
        let samples = 0,
          alphaEvents = 0,
          statuses = [];
        const off = window.neuro.subscribe((event) => {
          if (event.type === 'data') samples += event.timestamps.length;
          if (event.type === 'alpha') alphaEvents++;
          if (event.type === 'status') statuses.push(event.status);
        });
        setTimeout(() => {
          off();
          resolve({ samples, alphaEvents, statuses });
        }, 8000);
      }),
  );
  console.log('VISIBLE_APP_CONNECTED', JSON.stringify(statistics));
  // Keep the automation connection alive until the user closes their app.
  await new Promise((resolve) => app.on('close', resolve));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
