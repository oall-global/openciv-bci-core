const { go } = require('./nav.cjs');
const { _electron } = require('playwright'),
  path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const file = path.join(root, 'test-results', 'session-' + Date.now() + '.jsonl');
  const userData = path.join(root, 'test-results/extended-' + Date.now());
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [root, '--background-test', '--user-data-dir=' + userData],
    env,
  });
  try {
    const p = await app.firstWindow(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await go(p, '信号工作台');
    await p.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready)
          return window.neuro.command('connect', { transport: 'demo' });
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Not ready');
    });
    await p.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    await p.getByRole('button', { name: '单图', exact: true }).click();
    const choose = (kind) => p.getByLabel('面板 1 图表', { exact: true }).selectOption(kind);
    await choose('recording');
    await p.getByRole('button', { name: '开始录制', exact: true }).click();
    await p.getByRole('button', { name: '停止录制', exact: true }).waitFor();
    await choose('marker');
    await p.getByRole('button', { name: '闭眼开始', exact: true }).click();
    await p.locator('.marker-rows').getByText('闭眼开始', { exact: true }).waitFor();
    assert.equal(
      await p.evaluate(async () => (await window.neuro.developer('state')).enabled),
      false,
    );
    await p.waitForTimeout(5000);
    // 二维头皮图: contact states per electrode and the connection details.
    await choose('headplot');
    await p.locator('.emap').waitFor();
    assert.equal(await p.locator('.emap-node').count(), 16);
    await p.getByRole('button', { name: /^O1 / }).click();
    await p.locator('.emap-node.selected', { hasText: 'O1' }).waitFor();
    assert.match(await p.locator('.emap-quality strong').innerText(), /16/);
    for (const kind of [
      'topomap',
      'overlay',
      'transport',
      'accel',
      'emg',
      'joystick',
      'focus',
      'support',
      'network',
    ]) {
      await choose(kind);
      await p.locator('.wb-extra-chart').waitFor();
      if (kind === 'topomap') {
        await p.getByRole('button', { name: '头皮通道 7 O1', exact: true }).click();
      }
      if (kind === 'overlay') assert((await p.locator('.overlay-spectrum polyline').count()) > 0);
      if (kind === 'emg') assert.equal(await p.locator('.emg-bars meter').count(), 16);
      if (kind === 'focus')
        assert(!(await p.locator('.metric-grid strong').first().innerText()).includes('—'));
    }
    await choose('recording');
    await p.getByRole('button', { name: '停止录制', exact: true }).click();
    await p.getByRole('button', { name: '开始录制', exact: true }).waitFor();
    assert(fs.statSync(file).size > 1000);
    // The same recording is also a free-recording session with the marker aligned.
    await p.waitForTimeout(500);
    const sessionsDir = path.join(userData, 'sessions');
    const [sessionId] = fs.readdirSync(sessionsDir);
    const info = JSON.parse(
      fs.readFileSync(path.join(sessionsDir, sessionId, 'session.json'), 'utf8'),
    );
    assert.equal(info.task.id, 'free-recording');
    assert.equal(info.status, 'completed');
    assert.equal(info.participant.code, 'local');
    assert.equal(info.params.replayFile, path.basename(file));
    assert.ok(info.samples > 250 * 5);
    const markers = fs
      .readFileSync(path.join(sessionsDir, sessionId, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse)
      .filter((e) => e.label === 'marker');
    assert.equal(markers.length, 1);
    assert.equal(markers[0].data.text, '闭眼开始');
    assert.ok(Number.isInteger(markers[0].sample));
    const streamId = await p.evaluate(async () => (await window.neuro.developer('state')).streamId);
    await p.getByRole('button', { name: '打开录制文件', exact: true }).click();
    await p.locator('.replay-banner').waitFor();
    await p.getByRole('button', { name: '播放回放', exact: true }).click();
    await p.waitForTimeout(1300);
    await p.getByRole('button', { name: '暂停回放', exact: true }).click();
    assert(Number(await p.getByLabel('回放进度').inputValue()) > 500);
    await p.getByLabel('回放进度').fill('5000');
    await choose('overlay');
    assert((await p.locator('.overlay-spectrum polyline').count()) > 0);
    await choose('marker');
    assert(await p.getByRole('button', { name: '添加标记', exact: true }).isDisabled());
    assert.equal(
      await p.evaluate(async () => (await window.neuro.developer('state')).streamId),
      streamId,
    );
    await p.getByRole('button', { name: '返回实时采集', exact: true }).click();
    await choose('wave');
    await p.getByRole('button', { name: '左右', exact: true }).click();
    await p.getByLabel('面板 2 图表', { exact: true }).selectOption('headplot');
    await p.screenshot({ path: path.join(root, 'test-results/extended-workbench.png') });
    assert.deepEqual(errors, []);
    await p.evaluate(() => window.neuro.command('disconnect'));
    console.log(
      'PASS 17 menu choices, functional charts, head selection, live marker without server, disk recording, playback seek/pause, output isolation, layouts and no renderer errors',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
