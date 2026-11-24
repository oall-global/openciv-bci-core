const { go } = require('./nav.cjs');
const { _electron } = require('playwright'),
  path = require('path'),
  fs = require('fs'),
  assert = require('assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    packaged = process.argv.includes('--packaged'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: packaged
      ? path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe')
      : require('electron'),
    args: [
      ...(packaged ? [] : [root]),
      '--background-test',
      '--user-data-dir=' + path.join(root, 'test-results/setup-profile-' + Date.now()),
    ],
    env,
  });
  let p;
  try {
    p = await app.firstWindow();
    p.setDefaultTimeout(15000);
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.getByRole('heading', { name: '连接你的脑电设备' }).waitFor();
    await p.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('engine');
    });
    // This test is about the wizard (首次打开 v1): 首次佩戴 (which would follow a first
    // connection) is done.
    await p.evaluate(() => window.neuro.preferences({ firstWear: true, onboardingFlow: 'v1' }));
    await p.reload();
    await p.getByRole('heading', { name: '连接你的脑电设备' }).waitFor();
    await assert.rejects(p.evaluate(() => window.neuro.setup('arbitrary-action')));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      global.setupFixture = {
        epoch: 0,
        metadata: null,
        failProbe: false,
        actions: [],
        sent: [],
        status: {
          type: 'status',
          status: 'disconnected',
          demo: false,
          detail: '测试夹具 · 未连接',
        },
      };
      const f = global.setupFixture,
        send = (e) => BrowserWindow.getAllWindows()[0].webContents.send('engine:event', e);
      ipcMain.removeHandler('setup:action');
      ipcMain.handle('setup:action', (_e, action, params) => {
        f.actions.push({ action, params });
        if (action === 'network') return [{ name: 'Wi-Fi', address: '192.168.0.23' }];
        return true;
      });
      ipcMain.removeHandler('engine:snapshot');
      ipcMain.handle('engine:snapshot', () => ({
        ready: true,
        metadata: f.metadata,
        status: f.status,
      }));
      ipcMain.removeHandler('engine:command');
      ipcMain.handle('engine:command', (_e, method, params) => {
        if (method === 'setup-usb')
          return {
            ports: [
              f.usbMode === 1
                ? {
                    port: 'COM3',
                    description: 'CH340 测试夹具',
                    verified: true,
                    mode: 1,
                    channels: 16,
                  }
                : {
                    port: 'COM3',
                    description: 'CH340 测试夹具',
                    verified: true,
                    mode: 2,
                    channels: 16,
                    address: '192.168.0.44',
                    networkName: 'Lab-WiFi',
                  },
            ],
            detail: '尚未接入此设备的 USB 配网协议，请使用设备热点完成网络配置。',
          };
        if (method === 'setup-configure') {
          f.sent.push(params);
          return { sent: true, confirmed: false };
        }
        if (method === 'discover') return [];
        if (method === 'setup-probe') {
          if (f.failProbe) throw Error('测试设备不可达');
          return {
            name: 'OpenBCI 测试夹具',
            address: params.address,
            transport: 'wifi',
            verified: true,
            boardType: 'cyton',
            detail: '测试夹具 · 非真实设备',
          };
        }
        if (method === 'connect') {
          f.epoch++;
          f.metadata = {
            type: 'metadata',
            epoch: f.epoch,
            channels: 16,
            rate: params.sampleRate,
            unit: 'µV',
            boardId: 6,
          };
          send(f.metadata);
          f.status = {
            type: 'status',
            status: 'connecting',
            demo: false,
            detail: '测试夹具 · 等待数据',
          };
          send(f.status);
          return true;
        }
        if (method === 'disconnect') {
          f.status = {
            type: 'status',
            status: 'disconnected',
            demo: false,
            detail: '测试夹具 · 已断开',
          };
          send(f.status);
          return true;
        }
        throw Error('Unexpected test command ' + method);
      });
    });
    await p.clock.install({ time: new Date() });
    await p.reload();
    await p.getByRole('heading', { name: '连接你的脑电设备' }).waitFor();
    const shot = async (name) => {
      await p.evaluate(() => window.scrollTo(0, 0));
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
          .toPNG()
          .toString('base64'),
      );
      fs.writeFileSync(
        path.join(root, 'test-results/setup-' + name + (packaged ? '-packaged' : '') + '.png'),
        Buffer.from(png, 'base64'),
      );
      assert.equal(await p.locator('.connection-illustration').count(), 1);
    };
    // Step 1: turn the device on (photos of the off and on switch positions).
    await p.getByRole('heading', { name: '打开设备电源', exact: true }).waitFor();
    assert.equal(await p.locator('.cw-power svg').count(), 2);
    fs.writeFileSync(
      path.join(root, 'test-results/setup-power.png'),
      await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG(),
      ),
    );
    await p.getByRole('button', { name: '已开机，下一步' }).click();
    await shot('usb');
    assert.equal(await p.locator('.cw-steps li').count(), 4);
    assert.equal(await p.locator('.cw-advanced').getAttribute('open'), null);
    await p.getByRole('button', { name: '识别设备', exact: true }).click();
    await p.getByRole('heading', { name: '选择连接方式', exact: true }).waitFor();
    assert.equal(await p.getByLabel('配置 Wi-Fi 密码', { exact: true }).count(), 0);
    await p.getByRole('button', { name: '连接设备', exact: true }).click();
    // No "connecting" page: straight back to the workbench, progress as a message.
    await p.getByRole('heading', { name: '信号工作台' }).waitFor();
    await p.locator('.toast', { hasText: '正在连接设备…' }).waitFor();
    await p.locator('.cw-progress').waitFor({ state: 'hidden' });
    // a margin for a busy machine: pausing at a time already past throws
    await p.clock.pauseAt(new Date(await p.evaluate(() => Date.now() + 5000)));
    async function feed(ms, { demo = false, old = false } = {}) {
      for (let t = 0; t < ms; t += 250) {
        const at = await p.evaluate(() => Date.now() / 1000);
        await app.evaluate(
          ({ BrowserWindow }, { at, demo, old }) => {
            const f = global.setupFixture,
              w = BrowserWindow.getAllWindows()[0].webContents;
            f.status = {
              type: 'status',
              status: 'streaming',
              demo,
              epoch: f.epoch,
              detail: '测试夹具 · 合成数据，非实机验收',
            };
            w.send('engine:event', f.status);
            w.send('engine:event', {
              type: 'data',
              epoch: old ? f.epoch - 1 : f.epoch,
              at,
              timestamps: [at],
              samples: Array.from({ length: 16 }, () => [1]),
              rms: Array(16).fill(1),
              quality: Array(16).fill('unknown'),
              windowSeconds: 2,
            });
          },
          { at, demo, old },
        );
        await p.clock.runFor(250);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    const connected = () => p.locator('.toast', { hasText: '设备已连接，正在接收' }).count();
    await feed(3750, { demo: true });
    assert.equal(await connected(), 0);
    await feed(3750, { old: true });
    assert.equal(await connected(), 0);
    await feed(1200);
    await p.clock.runFor(2000);
    assert.equal(await connected(), 0);
    await feed(5000);
    await p.locator('.toast', { hasText: '设备已连接，正在接收' }).waitFor();
    assert.equal((await p.evaluate(() => window.neuro.preferences())).connectionMode, 'router');
    await feed(500);
    await p.clock.resume();
    // The wizard still shows the finished state (and disconnect) when opened again.
    await go(p, '设备');
    await p.getByRole('button', { name: '进入信号工作台' }).waitFor();
    await shot('complete');
    await p.getByRole('button', { name: '断开连接', exact: true }).click();
    await p.getByRole('heading', { name: '连接 USB，开始配对', exact: true }).waitFor();
    assert.equal(await p.getByText('请拔掉 USB 数据线', { exact: true }).count(), 0);
    await p.getByRole('button', { name: '识别设备', exact: true }).click();
    await p.getByRole('button', { name: /直连电脑 连接设备热点/ }).click();
    await p.getByLabel('配置 Wi-Fi 名称', { exact: true }).fill('NeuroLink-Test');
    await p.getByLabel('配置 Wi-Fi 密码', { exact: true }).fill('1234567');
    assert(await p.getByRole('button', { name: '保存并连接', exact: true }).isDisabled());
    await p.getByLabel('配置 Wi-Fi 密码', { exact: true }).fill('12345678');
    await shot('config');
    await p.getByRole('button', { name: '保存并连接', exact: true }).click();
    await p.getByRole('button', { name: '已连接热点，继续', exact: true }).waitFor();
    await app.evaluate(() => (global.setupFixture.usbMode = 1));
    await p.getByRole('button', { name: '打开电脑 Wi-Fi 设置', exact: true }).click();
    await app.evaluate(() => (global.setupFixture.failProbe = true));
    await p.getByRole('button', { name: '已连接热点，继续', exact: true }).click();
    await p.getByRole('alert').filter({ hasText: '还没有找到设备' }).waitFor();
    assert.equal(await p.getByRole('button', { name: '进入信号工作台' }).count(), 0);
    await app.evaluate(() => (global.setupFixture.failProbe = false));
    await p.getByRole('button', { name: '已连接热点，继续', exact: true }).click();
    await p.locator('.cw-progress').waitFor({ state: 'hidden' });
    // a margin for a busy machine: pausing at a time already past throws
    await p.clock.pauseAt(new Date(await p.evaluate(() => Date.now() + 5000)));
    await feed(5000);
    await p.locator('.toast', { hasText: '设备已连接，正在接收' }).waitFor();
    assert.equal((await p.evaluate(() => window.neuro.preferences())).connectionMode, 'direct');
    await p.clock.resume();
    assert(
      !JSON.stringify(await p.evaluate(() => window.neuro.preferences())).includes('12345678'),
    );
    assert(
      await app.evaluate(
        () =>
          global.setupFixture.sent.length === 1 && global.setupFixture.sent[0].mode === 'direct',
      ),
    );
    await p.evaluate(() => window.neuro.command('disconnect'));
    await go(p, '设备');
    await p.getByRole('heading', { name: '连接 USB，开始配对', exact: true }).waitFor();
    await p.getByRole('button', { name: '识别设备', exact: true }).click();
    assert.equal(await p.getByLabel('配置 Wi-Fi 密码', { exact: true }).count(), 0);
    await shot('mode');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 740));
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(
      'PASS simplified 3-stage flow, saved network without credentials, config validation, AP instructions and retry, demo/old/stale rejection, automatic save, password not persisted, layout. Fixture data only.',
    );
  } catch (e) {
    if (p) {
      const png = await app
        .evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
            .toPNG()
            .toString('base64'),
        )
        .catch(() => null);
      if (png)
        fs.writeFileSync(
          path.join(root, 'test-results/setup-failure.png'),
          Buffer.from(png, 'base64'),
        );
    }
    throw e;
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
