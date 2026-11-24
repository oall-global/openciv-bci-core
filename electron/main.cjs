const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, shell } = require('electron');
const nodePath = require('path');
// The data folder is OpenCiv-BCI-001, for the installed app and the development build alike.
// The folder of the earlier names moves there once (installed: NeuroLink; development:
// neurolink-desktop); while another copy of the app holds it open, it is used where it is.
if (!process.argv.some((a) => a.startsWith('--user-data-dir'))) {
  const fs = require('fs'),
    appData = app.getPath('appData'),
    data = nodePath.join(appData, 'OpenCiv-BCI-001'),
    old = nodePath.join(appData, app.isPackaged ? 'NeuroLink' : 'neurolink-desktop');
  let at = data;
  if (!fs.existsSync(data) && fs.existsSync(old))
    try {
      fs.renameSync(old, data);
    } catch {
      at = old;
    }
  app.setPath('userData', at);
}
// Branding must not move existing preferences, recordings or the test profile.
if (process.platform === 'darwin') {
  const existingUserData = app.getPath('userData');
  app.setName('OpenCiv BCI-001');
  app.setPath('userData', existingUserData);
}
const { DeveloperBridge } = require('./developer.cjs');
const developer = new DeveloperBridge();
const { RecordingStore, readRecording } = require('./recording.cjs');
const recorder = new RecordingStore();
const { agentGuide } = require('./agentguide.cjs');
const { MomentStore } = require('./moments.cjs');
const { DataStore } = require('./dataStore.cjs');
const { currentWifi, wifiPassword } = require('./wifi.cjs');
const hotspot = require('./hotspot.cjs');
let moments = null; // 录制脑电 (electron/moments.cjs)
let data = null; // 数据: recordings and task sessions together (electron/dataStore.cjs)
const montage = require('./montage.cjs');
const { SessionStore } = require('./session.cjs');
const { exportBdf, exportBids } = require('./export.cjs');
let sessions = null;
developer.onMarker = (marker) => {
  emit({ type: 'marker', ...marker });
  // Markers also go into an active task or free-recording session, aligned there by host
  // receive time; a client-supplied timestamp is kept as data only.
  if (sessions?.state().active)
    try {
      sessions.event({
        label: 'marker',
        t: marker.receivedAtMs / 1000,
        data: {
          text: marker.label,
          client: marker.clientName,
          clientTimestampMs: marker.clientTimestampMs,
        },
      });
    } catch {
      // A marker must never break the recording itself.
    }
};
const FREE_RECORDING = { id: 'free-recording', version: 1, title: '自由录制' };
// Sessions are recorded under one pseudonymous participant (BIDS sub-local); there is no
// participant management here.
const LOCAL_PARTICIPANT = { code: 'local', consent: null };
recorder.onStopped = () => {
  if (sessions?.state().task !== FREE_RECORDING.id) return;
  const seconds = Math.round(sessions.state().seconds);
  void sessions.finish({ summary: { headline: `自由录制 ${seconds} 秒` } }).catch(() => {});
};
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
let win,
  engine,
  quitting = false,
  ready = false,
  lastHeartbeat = 0,
  sequence = 0;
let snapshot = {
  type: 'status',
  status: 'disconnected',
  detail: '连接设备，开始采集',
  demo: false,
};
let metadata = null,
  connectionCheck = null;
const pending = new Map(),
  logs = [];
const defaultPrefs = {
  connectionMode: 'router',
  onboarded: false,
  firstWear: true,
  address: '',
  transport: 'wifi',
  model: 'cyton-daisy',
  localPort: 6677,
  sampleRate: 250,
};
function log(event) {
  logs.push({ time: new Date().toISOString(), event });
  if (logs.length > 200) logs.shift();
}
function emit(data) {
  recorder.ingest(data);
  moments?.ingest(data);
  sessions?.ingest(data);
  try {
    developer.ingest(data);
  } catch {
    developer.error = '接口数据处理失败，请关闭后重新开启';
    developer.stop();
  }
  if (win && !win.isDestroyed()) win.webContents.send('engine:event', data);
}
function failEngine(message) {
  connectionCheck = null;
  ready = false;
  snapshot = { type: 'status', status: 'engine-error', detail: message, demo: false };
  emit(snapshot);
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
  log('engine unavailable');
}
// the engine executable and its arguments
function engineCommand() {
  const base = path.join(__dirname, '..');
  const exe = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'engine',
        process.platform === 'win32' ? 'neurolink-engine.exe' : 'neurolink-engine',
      )
    : require('./python-path.cjs').pythonPath(base);
  return [exe, app.isPackaged ? [] : ['-u', path.join(base, 'engine', 'main.py')]];
}
function startEngine() {
  if (engine) throw new Error('引擎仍在运行');
  const [exe, args] = engineCommand();
  ready = false;
  lastHeartbeat = Date.now();
  const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  engine = child;
  child.stdin.on('error', () => {});
  child.on('error', () => failEngine('本地引擎未能启动，请重新打开应用'));
  child.on('exit', () => {
    if (engine === child) engine = null;
    if (!quitting) failEngine('本地引擎已停止，点击“重启引擎”恢复');
  });
  child.stderr.on('data', () => {}); // BrainFlow diagnostics may contain device addresses; do not persist them.
  createInterface({ input: child.stdout }).on('line', (line) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    if (data.type === 'ready') {
      ready = true;
      if (!montage.isDefault())
        command('montage', { names: [...montage.electrodeNames] }).catch((e) =>
          log(`montage not applied: ${e.message}`),
        );
      lastHeartbeat = Date.now();
      log('engine ready');
      if (snapshot.status === 'engine-error') {
        snapshot = {
          type: 'status',
          status: 'disconnected',
          detail: '引擎已恢复，可以重新连接设备',
          demo: false,
        };
        emit(snapshot);
      }
      emit(data);
      // Development only: `npm start -- --demo` connects the simulated device (not in the app).
      if (!app.isPackaged && process.argv.includes('--demo'))
        command('connect', { transport: 'demo' }).catch((e) =>
          log(`demo connection failed: ${e.message}`),
        );
      return;
    }
    if (data.type === 'heartbeat') {
      lastHeartbeat = Date.now();
      return;
    }
    if (data.type === 'response') {
      const p = pending.get(data.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(data.id);
        data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
      }
      return;
    }
    if (data.type === 'status') {
      snapshot = data;
      log(`status: ${data.status}`);
    }
    if (data.type === 'metadata') metadata = data;
    if (data.type === 'connection-check') connectionCheck = data;
    emit(data);
  });
}
function command(method, params = {}) {
  if (!ready || !engine) return Promise.reject(new Error('引擎尚未就绪，请稍后重试或重启引擎'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('设备响应超时，请检查连接'));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    engine.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
function prefsFile() {
  return path.join(app.getPath('userData'), 'preferences.json');
}
function readPrefs() {
  try {
    return { ...defaultPrefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) };
  } catch {
    return { ...defaultPrefs };
  }
}
function diagnostic() {
  return {
    app: 'OpenCiv BCI-001',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    engineReady: ready,
    status: snapshot.status,
    metadata,
    events: logs,
  };
}
function assertSender(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
    throw new Error('不允许的请求');
}
function handle(name, handler) {
  ipcMain.handle(name, (event, ...args) => {
    assertSender(event);
    return handler(...args);
  });
}
app.whenReady().then(() => {
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          { label: 'OpenCiv BCI-001', role: 'appMenu' },
          { role: 'fileMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ])
      : null,
  );
  if (process.platform === 'darwin')
    app.setAboutPanelOptions({ applicationName: 'OpenCiv BCI-001' });
  moments = new MomentStore(path.join(app.getPath('userData'), 'moments'));
  sessions = new SessionStore(path.join(app.getPath('userData'), 'sessions'), app.getVersion());
  data = new DataStore(moments, sessions);
  handle('session:action', async (action, params) => {
    if (action === 'state') return sessions.state();
    if (action === 'start') {
      if (snapshot.status !== 'streaming' || !developer.fresh() || !metadata)
        throw Error('请先连接设备并等待数据');
      return sessions.start(params, metadata, snapshot.demo ? 'demo' : 'device', LOCAL_PARTICIPANT);
    }
    if (action === 'event') return sessions.event(params);
    if (action === 'finish') return sessions.finish(params);
    if (action === 'abort') return sessions.abort(params?.reason);
    if (action === 'list') return sessions.list();
    if (action === 'delete') return sessions.remove(params?.id);
    if (action === 'export-bdf') {
      const dir = sessions.dirOf(params?.id);
      const target = await dialog.showSaveDialog(win, {
        defaultPath: `${params.id}.bdf`,
        filters: [{ name: 'BDF', extensions: ['bdf'] }],
      });
      if (target.canceled || !target.filePath) return null;
      if (fs.existsSync(target.filePath)) throw Error('文件已存在，请换一个文件名');
      return exportBdf(dir, target.filePath);
    }
    if (action === 'export-bids') {
      const target = await dialog.showOpenDialog(win, {
        title: '选择保存 BIDS 数据集的位置',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (target.canceled || !target.filePaths[0]) return null;
      const list = (await sessions.list()).filter((s) => s.status === 'completed');
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      return exportBids(
        list.map((s) => sessions.dirOf(s.id)),
        path.join(target.filePaths[0], `OpenCiv-BCI-001-BIDS-${stamp}`),
        app.getVersion(),
      );
    }
    if (action === 'reveal') {
      const error = await shell.openPath(sessions.dirOf(params?.id));
      if (error) throw Error('无法打开会话目录');
      return true;
    }
    throw Error('不支持的会话操作');
  });
  handle('developer:action', async (action, params) => {
    if (action === 'state') return developer.state();
    if (action === 'start') return developer.start(params?.port ?? 8765);
    if (action === 'stop') return developer.stop();
    if (action === 'copy-token') {
      if (!developer.token) throw Error('请先开启接口');
      clipboard.writeText(developer.token);
      return true;
    }
    // The interface description for an AI agent, with the key: shown (接口说明) or copied
    if (action === 'agent-guide') {
      if (!developer.server) throw Error('请先开启接口');
      return agentGuide({
        endpoint: developer.state().endpoint,
        token: developer.token,
        tasks: [],
        running: [],
      });
    }
    // opens the interface if needed
    if (action === 'copy-agent-guide') {
      if (!developer.server) await developer.start(params?.port ?? developer.port);
      clipboard.writeText(
        agentGuide({
          endpoint: developer.state().endpoint,
          token: developer.token,
          tasks: [],
          running: [],
        }),
      );
      return true;
    }
    if (action === 'open-kit') {
      const error = await shell.openPath(
        app.isPackaged
          ? path.join(process.resourcesPath, 'developer-kit')
          : path.join(__dirname, '..', 'developer-kit'),
      );
      if (error) throw Error('无法打开开发示例目录');
      return true;
    }
    if (action === 'marker') return developer.marker(params ?? {});
    throw Error('不支持的开发接口操作');
  });
  handle('data:action', async (action, params) => {
    const kind = params?.kind,
      id = params?.id;
    if (action === 'list') return data.list();
    if (action === 'frames') return data.frames(kind, id);
    if (action === 'print') return data.print(kind, id);
    if (action === 'bandmap') return data.bandMap(kind, id);
    if (action === 'detail') return data.detail(kind, id);
    if (action === 'metrics') return data.metrics(kind, id);
    if (action === 'open') return data.open(kind, id);
    if (action === 'image') return data.image(kind, id, params?.name);
    if (action === 'rename') return data.rename(kind, id, params?.name);
    // 删除: to the recycle bin — not erased, so it can be restored
    if (action === 'used-by') return [];
    if (action === 'delete') {
      if (kind === 'moment' && id === moments.current) throw Error('正在录制');
      await shell.trashItem(data.dir(kind, id));
      return true;
    }
    if (action === 'export') {
      data.dir(kind, id); // a valid id before asking where to save
      const target = await dialog.showSaveDialog(win, {
        defaultPath: `OpenCiv-BCI-001-${id}.bdf`,
        filters: [{ name: 'BDF', extensions: ['bdf'] }],
      });
      if (target.canceled || !target.filePath) return null;
      if (fs.existsSync(target.filePath)) throw Error('文件已存在，请换一个文件名');
      return { ...(await data.exportBdf(kind, id, target.filePath)), file: target.filePath };
    }
    if (action === 'save-images')
      return data.saveImages(kind, id, params?.card, params?.thumb, params?.info);
    throw Error('不支持的数据操作');
  });
  handle('moment:action', async (action, params) => {
    if (action === 'start') {
      if (!developer.fresh() || !metadata) throw Error('请先连接设备并等待数据');
      return moments.start(metadata, snapshot.demo ? 'demo' : 'device');
    }
    if (action === 'stop') return moments.stop(params?.id);
    if (action === 'save') return moments.save(params?.id, params);
    if (action === 'list') return moments.list();
    if (action === 'card') return moments.card(params?.id);
    if (action === 'open') return moments.open(params?.id);
    if (action === 'delete') return moments.remove(params?.id);
    if (action === 'reveal') {
      shell.showItemInFolder(path.join(moments.folder(params?.id), 'eeg.neuro.jsonl'));
      return true;
    }
    throw Error('不支持的操作');
  });
  handle('recording:action', async (action) => {
    if (action === 'state') return recorder.state();
    if (action === 'stop') return recorder.stop();
    if (action === 'start') {
      if (!developer.fresh() || !metadata) throw Error('请先连接设备并等待数据');
      if (sessions.state().active) throw Error('有会话正在记录，请先结束再录制');
      const target = await dialog.showSaveDialog(win, {
        defaultPath: `OpenCiv-BCI-001-${Date.now()}.neuro.jsonl`,
        filters: [{ name: '开源文明 BCI-001 录制', extensions: ['jsonl'] }],
      });
      if (target.canceled) return recorder.state();
      if (!developer.fresh()) throw Error('设备数据已中断');
      const source = snapshot.demo ? 'demo' : 'device';
      const state = await recorder.start(target.filePath, metadata, source);
      try {
        await sessions.start(
          {
            task: FREE_RECORDING,
            channels: [],
            params: { replayFile: path.basename(target.filePath) },
          },
          metadata,
          source,
          LOCAL_PARTICIPANT,
        );
      } catch (error) {
        await recorder.stop();
        throw error;
      }
      return state;
    }
    if (action === 'open') {
      const target = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: '开源文明 BCI-001 录制', extensions: ['jsonl'] }],
      });
      if (target.canceled) return null;
      return {
        ...(await readRecording(target.filePaths[0])),
        file: path.basename(target.filePaths[0]),
      };
    }
    throw Error('不支持的录制操作');
  });
  const localNetworks = () =>
    Object.values(require('node:os').networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal && a.cidr)
      .map((a) => ({ cidr: a.cidr }))
      .slice(0, 8);
  handle('engine:command', async (method, params) => {
    if (method === 'restart') {
      if (connectionCheck?.active) throw new Error('请先取消连接检测，再重启引擎');
      if (engine) {
        engine.kill();
        await new Promise((r) => setTimeout(r, 400));
      }
      if (engine) throw new Error('正在停止旧引擎，请稍后重试');
      startEngine();
      return true;
    }
    if (
      ![
        'connect',
        'disconnect',
        'discover',
        'fault',
        'check-start',
        'check-cancel',
        'setup-usb',
        'setup-probe',
        'setup-configure',
        'demo-artifact',
        'accel-capture',
      ].includes(method)
    )
      throw new Error('不支持的操作');
    if (
      params !== undefined &&
      (typeof params !== 'object' || params === null || JSON.stringify(params).length > 2048)
    )
      throw new Error('参数无效');
    // 配网: the device joins this computer's Wi-Fi with the
    // password Windows already keeps for it, read here so it never passes through the page
    if (method === 'setup-configure' && params.mode === 'router' && params.fromComputer) {
      const w = await currentWifi();
      const password = w && w.ssid === params.name ? await wifiPassword(w.ssid) : '';
      if (!password) throw new Error('没有读到这个 Wi-Fi 的密码');
      const { fromComputer, ...rest } = params;
      return command(method, { ...rest, password });
    }
    // the engine sweeps these networks for the board (its address changes with DHCP)
    if (method === 'discover' || (method === 'connect' && params?.transport === 'wifi'))
      return command(method, { ...params, networks: localNetworks() });
    return command(method, params);
  });
  handle('engine:snapshot', () => ({ status: snapshot, metadata, ready, connectionCheck }));
  handle('app:version', () => app.getVersion());
  handle('setup:action', async (action, params) => {
    if (action === 'network')
      return Object.entries(require('node:os').networkInterfaces()).flatMap(([name, addresses]) =>
        (addresses || [])
          .filter((a) => a.family === 'IPv4' && !a.internal)
          .map((a) => ({ name, address: a.address })),
      );
    if (action === 'wifi') {
      // the Wi-Fi this computer is on, and whether its password can be read here
      const w = await currentWifi();
      return w ? { ssid: w.ssid, saved: !!(await wifiPassword(w.ssid)) } : null;
    }
    // 配网 through the device's hotspot instead of USB (electron/hotspot.cjs)
    if (action === 'hotspots') return hotspot.list();
    if (action === 'provision') {
      const { hotspot: ssid, name, fromComputer } = params ?? {};
      if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 32)
        throw Error('Wi-Fi 名称需为 1–32 字节');
      const w = await currentWifi();
      const password = fromComputer
        ? w && w.ssid === name
          ? await wifiPassword(name)
          : ''
        : String(params.password ?? '');
      if (fromComputer && !password) throw Error('没有读到这个 Wi-Fi 的密码');
      if (Buffer.byteLength(password) > 64) throw Error('Wi-Fi 密码过长');
      return hotspot.provision({ hotspot: String(ssid), name, password, back: w?.ssid ?? name });
    }
    if (action === 'wifi-settings') {
      await shell.openExternal('ms-settings:network-wifi');
      return true;
    }
    if (action === 'guide') {
      await shell.openExternal('https://docs.openbci.com/Deprecated/WiFiShield/WiFiGS/');
      return true;
    }
    if (action === 'portal') {
      if (typeof params?.address !== 'string' || params.address.length > 15)
        throw Error('设备地址无效');
      const device = await command('setup-probe', { address: params.address });
      await shell.openExternal(`http://${device.address}/`);
      return true;
    }
    throw Error('不支持的连接设置操作');
  });
  // Electrode position of each channel: saved in preferences, applied here and in the engine.
  try {
    if (readPrefs().montage) montage.setMontage(readPrefs().montage);
  } catch {
    log('saved montage invalid, using the default');
  }
  handle('montage', async (names) => {
    if (names) {
      const next = montage.validate(names);
      if (sessions?.state().active) throw Error('正在记录数据，结束后再修改电极位置');
      if (ready) await command('montage', { names: next });
      montage.setMontage(next);
      const value = readPrefs();
      value.montage = next;
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(prefsFile(), JSON.stringify(value));
    }
    return {
      names: [...montage.electrodeNames],
      default: montage.DEFAULT,
      positions: montage.POSITIONS,
    };
  });
  handle('preferences', (patch) => {
    const value = readPrefs();
    if (patch) {
      for (const key of Object.keys(defaultPrefs)) {
        if (Object.hasOwn(patch, key) && typeof patch[key] === typeof defaultPrefs[key])
          value[key] = patch[key];
      }
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(prefsFile(), JSON.stringify(value));
    }
    return value;
  });
  handle('diagnostics', () => diagnostic());
  handle('diagnostics:export', async () => {
    const target = await dialog.showSaveDialog(win, {
      defaultPath: 'OpenCiv-BCI-001-诊断信息.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target.canceled && target.filePath) {
      fs.writeFileSync(target.filePath, JSON.stringify(diagnostic(), null, 2));
      return true;
    }
    return false;
  });
  handle('data:clear', () => {
    if (fs.existsSync(prefsFile())) fs.unlinkSync(prefsFile());
    logs.splice(0);
    return defaultPrefs;
  });
  handle('window:action', (action) => {
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') {
      if (process.platform === 'darwin') win.setFullScreen(!win.isFullScreen());
      else win.isMaximized() ? win.unmaximize() : win.maximize();
    }
    if (action === 'close') win.close();
  });
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0d0c', // dark theme is the default
    frame: false,
    title: '开源文明 BCI-001',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: app.isPackaged ? [] : ['--neuro-development'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  if (process.platform === 'darwin') {
    const windowState = () => ({ fullScreen: win.isFullScreen(), maximized: win.isMaximized() });
    handle('window:state', windowState);
    for (const event of ['enter-full-screen', 'leave-full-screen'])
      win.on(event, () => win.webContents.send('window:state', windowState()));
  } else {
    // Windows / Linux: the maximise button shows the system's maximise or restore glyph
    const windowState = () => ({ fullScreen: false, maximized: win.isMaximized() });
    handle('window:state', windowState);
    for (const event of ['maximize', 'unmaximize'])
      win.on(event, () => win.webContents.send('window:state', windowState()));
  }
  // Links that open a new window (概念手册 references) go to the system browser, https only.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // no camera, microphone or other permission is ever granted
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--background-test')) win.show();
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  startEngine();
  const timer = setInterval(() => {
    if (engine && Date.now() - lastHeartbeat > 25000) {
      engine.kill();
      failEngine('引擎长时间无响应，请重启引擎');
    }
  }, 2000);
  timer.unref();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  developer.stop();
  void recorder.stop();
  void sessions?.abort('应用已关闭');
  if (engine && !quitting) {
    event.preventDefault();
    quitting = true;
    command('shutdown').catch(() => {});
    const child = engine;
    const timer = setTimeout(() => {
      child.kill();
      app.quit();
    }, 15000);
    child.once('exit', () => {
      clearTimeout(timer);
      app.quit();
    });
  }
});
