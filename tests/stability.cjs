const { _electron: electron } = require('playwright');
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const profile = path.join(root, 'test-results/stability-profile');
  fs.mkdirSync(profile, { recursive: true });
  const app = await electron.launch({
    executablePath: path.join(root, 'release/win-unpacked/OpenCiv-BCI-001.exe'),
    args: [`--user-data-dir=${profile}`],
    env,
    timeout: 60000,
  });
  const build = JSON.parse(
    fs.readFileSync(path.join(root, 'release/build-info.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  const start = Date.now(),
    samples = [],
    errors = [],
    lifecycle = [];
  app.process().once('exit', (code, signal) => {
    lifecycle.push({ event: 'process-exit', code, signal, at: Date.now() });
    console.log('Electron exited', code, signal);
  });
  app.on('console', (msg) => {
    if (msg.text().startsWith('STABILITY:')) {
      lifecycle.push({ event: msg.text(), at: Date.now() });
      console.log(msg.text());
    }
  });
  fs.writeFileSync(
    path.join(root, 'test-results/stability-progress.json'),
    JSON.stringify({
      build,
      complete: false,
      startedAt: new Date(start).toISOString(),
      samples,
      errors,
    }),
  );
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await app.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.hide();
      window.on('close', () => console.log('STABILITY: window close requested'));
      window.webContents.on('render-process-gone', (_event, details) =>
        console.log('STABILITY: renderer gone ' + JSON.stringify(details)),
      );
      app.on('before-quit', () => console.log('STABILITY: before quit'));
    });
    await page.waitForFunction(async () => (await window.neuro.snapshot()).ready);
    await page.evaluate(() => {
      window.__soak = { frames: 0, points: 0, maxBatch: 0, lastTimestamp: 0, timestampErrors: 0 };
      window.neuro.subscribe((e) => {
        if (e.type !== 'data') return;
        const s = window.__soak;
        s.frames++;
        s.points += e.samples[0].length;
        s.maxBatch = Math.max(s.maxBatch, e.samples[0].length);
        for (const t of e.timestamps) {
          if (t <= s.lastTimestamp) s.timestampErrors++;
          s.lastTimestamp = t;
        }
      });
    });
    await page.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        if ((await window.neuro.snapshot()).ready)
          return window.neuro.command('connect', { transport: 'demo' });
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Engine not ready');
    });
    await page.getByText('模拟设备 · 模拟数据', { exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(15000);
      const renderer = await page.evaluate(() => ({
        data: window.__soak,
        heap: performance.memory?.usedJSHeapSize || 0,
      }));
      const processes = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((p) => ({
          type: p.type,
          cpu: p.cpu.percentCPUUsage,
          memory: p.memory.workingSetSize,
        })),
      );
      assert.equal(renderer.data.timestampErrors, 0);
      assert.equal(errors.length, 0);
      if (samples.length)
        assert(
          renderer.data.frames > samples.at(-1).data.frames,
          'Acquisition must continue between observations',
        );
      assert(await page.getByText('模拟设备 · 模拟数据', { exact: true }).isVisible());
      samples.push({ seconds: Math.round((Date.now() - start) / 1000), ...renderer, processes });
      fs.writeFileSync(
        path.join(root, 'test-results/stability-progress.json'),
        JSON.stringify(
          {
            build,
            complete: false,
            startedAt: new Date(start).toISOString(),
            samples,
            errors,
            lifecycle,
          },
          null,
          2,
        ),
      );
      if (i % 4 === 3)
        console.log(
          `Stability ${Math.round((Date.now() - start) / 60000)} min, frames=${renderer.data.frames}, JS heap=${Math.round(renderer.heap / 1048576)} MB`,
        );
    }
    const heaps = samples.slice(8).map((s) => s.heap);
    assert(Math.max(...heaps) < 200 * 1048576, 'Renderer JS heap exceeded 200 MB');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(root, 'test-results/stability-final.png') });
    fs.writeFileSync(
      path.join(root, 'test-results/stability.json'),
      JSON.stringify(
        {
          build,
          mode: 'background acquisition; foreground rendering tested separately',
          complete: true,
          passed: true,
          durationSeconds: Math.round((Date.now() - start) / 1000),
          samples,
          errors,
          lifecycle,
        },
        null,
        2,
      ),
    );
    console.log('PASS: packaged desktop continuous 30-minute synthetic acquisition');
  } catch (e) {
    fs.writeFileSync(
      path.join(root, 'test-results/stability-failure.json'),
      JSON.stringify(
        {
          build,
          complete: false,
          passed: false,
          durationSeconds: Math.round((Date.now() - start) / 1000),
          error: String(e),
          samples,
          errors,
          lifecycle,
        },
        null,
        2,
      ),
    );
    throw e;
  } finally {
    if (app.process().exitCode === null) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
