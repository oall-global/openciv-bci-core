const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('neuro', {
  // development build (not packaged): development-only tabs are shown in 设置
  development: process.argv.includes('--neuro-development'),
  // the window's state: full screen on macOS, maximised elsewhere (the title bar's buttons)
  platform: process.platform,
  windowState: () => ipcRenderer.invoke('window:state'),
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },
  recording: (action) => ipcRenderer.invoke('recording:action', action),
  moment: (action, params) => ipcRenderer.invoke('moment:action', action, params),
  data: (action, params) => ipcRenderer.invoke('data:action', action, params),
  session: (action, params) => ipcRenderer.invoke('session:action', action, params),
  setup: (action, params) => ipcRenderer.invoke('setup:action', action, params),
  developer: (action, params) => ipcRenderer.invoke('developer:action', action, params),
  command: (method, params) => ipcRenderer.invoke('engine:command', method, params),
  subscribe: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('engine:event', handler);
    return () => ipcRenderer.removeListener('engine:event', handler);
  },
  snapshot: () => ipcRenderer.invoke('engine:snapshot'),
  version: () => ipcRenderer.invoke('app:version'),
  preferences: (patch) => ipcRenderer.invoke('preferences', patch),
  montage: (names) => ipcRenderer.invoke('montage', names),
  diagnostics: () => ipcRenderer.invoke('diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  clearData: () => ipcRenderer.invoke('data:clear'),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
});
