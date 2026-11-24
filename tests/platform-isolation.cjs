const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'electron/python-path.cjs'), 'utf8');
function interpreter(platform, env) {
  const context = {
    process: { platform, env },
    module: { exports: {} },
    require: () => (platform === 'win32' ? path.win32 : path.posix),
  };
  vm.runInNewContext(source, context);
  return context.module.exports.pythonPath(platform === 'win32' ? 'C:\\brainlab' : '/brainlab');
}
assert.equal(
  interpreter('win32', { OPENBRAIN_PYTHON: 'ignored', CONDA_PREFIX: 'ignored' }),
  'C:\\brainlab\\engine\\.venv\\Scripts\\python.exe',
);
assert.equal(
  interpreter('darwin', { OPENBRAIN_PYTHON: '/custom/python', CONDA_PREFIX: '/conda' }),
  '/custom/python',
);
assert.equal(interpreter('darwin', { CONDA_PREFIX: '/conda' }), '/conda/bin/python');
assert.equal(interpreter('darwin', {}), '/brainlab/engine/.venv/bin/python');
for (const platform of ['win32', 'darwin']) {
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8'), {
    process: { platform, argv: [] },
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, exposed) => {
          api = exposed;
        },
      },
      ipcRenderer: {},
    }),
  });
  // the window's state on both (full screen on macOS, maximised on Windows: the title bar)
  assert.equal(api.platform, platform);
  assert.equal(typeof api.windowState, 'function');
  assert.equal(typeof api.onWindowState, 'function');
}
assert.equal(require('../package.json').scripts.start, 'electron .');
console.log(
  'PASS platform isolation: original Windows interpreter/start/preload, Mac-only Conda, window state on both',
);
