const { _electron: e } = require('playwright'),
  path = require('path'),
  fs = require('fs'),
  assert = require('assert/strict');
(async () => {
  const address = process.argv[2];
  if (!address) throw new Error('Specify device address explicitly');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await e.launch({
    executablePath: path.resolve('release/win-unpacked/OpenCiv-BCI-001.exe'),
    args: ['--user-data-dir=' + path.resolve('test-results/hardware-profile')],
    env,
  });
  try {
    const p = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await p.waitForFunction(async () => (await window.neuro.snapshot()).ready);
    await p.getByRole('button', { name: '手动连接', exact: true }).click();
    await p.getByLabel('设备 IP 地址（可留空自动发现）').fill(address);
    await p.getByLabel('采样率（与官方 GUI 一致）').selectOption('250');
    await p.getByRole('button', { name: '连接设备', exact: true }).click();
    await p.getByText('数据正在接收', { exact: true }).waitFor({ timeout: 20000 });
    await p.waitForTimeout(2000);
    const state = await p.evaluate(() => window.neuro.snapshot());
    assert.equal(state.status.status, 'streaming');
    assert.equal(state.status.demo, false);
    assert.equal(state.metadata.rate, 250);
    assert.equal(state.metadata.channels, 16);
    await p.getByRole('button', { name: '应用 实验', exact: true }).click();
    await p.waitForFunction(
      () => {
        const s = document.querySelector('.alpha-status')?.textContent || '';
        return s.includes('持续更新') || s.includes('信号过平') || s.includes('幅度异常');
      },
      null,
      { timeout: 15000 },
    );
    assert(await p.getByText('真实设备数据', { exact: true }).isVisible());
    const info = await app.evaluate(({ app }) => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
    }));
    fs.writeFileSync(
      'test-results/hardware-desktop.json',
      JSON.stringify(
        {
          passed: true,
          ...info,
          rate: 250,
          channels: 16,
          demo: false,
          checks: [
            'manual connection form',
            'device acknowledgement',
            'real streaming status',
            '16-channel metadata',
            'Alpha analysis reached renderer',
            'real data label',
          ],
        },
        null,
        2,
      ),
    );
    console.log('PASS real device desktop', info);
    await p.evaluate(() => window.neuro.command('disconnect'));
  } finally {
    await app.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
