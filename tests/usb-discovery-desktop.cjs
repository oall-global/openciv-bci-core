// Enumerates the user's connected USB port. Does not open it or send commands.
const { _electron: e } = require('playwright'),
  path = require('path'),
  assert = require('assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await e.launch({
    executablePath: path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe'),
    args: [
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/usb-discovery-' + Date.now()),
    ],
    env,
  });
  try {
    const p = await app.firstWindow();
    await p.getByRole('button', { name: '搜索附近设备', exact: true }).click();
    await p.getByText('USB 串口候选 · COM3', { exact: true }).waitFor({ timeout: 15000 });
    assert(
      (await p.locator('.device-result').filter({ hasText: 'COM3' }).innerText()).includes(
        'CH340K',
      ),
    );
    const snapshot = await p.evaluate(() => window.neuro.snapshot());
    assert.equal(snapshot.status.status, 'disconnected');
    console.log(
      'PASS: packaged scan lists actual CH340K COM3 with candidate label, no connection initiated',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
