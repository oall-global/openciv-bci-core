// Use a locally branded macOS app bundle without modifying the Electron dependency.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

function desktopExecutable() {
  if (process.platform !== 'darwin')
    throw new Error('Mac-only launcher; use npm start on Windows.');
  const electron = require('electron');
  const version = require('electron/package.json').version;
  const cache = path.resolve(__dirname, '../node_modules/.cache/brainlab', `${version}-v1`);
  const bundle = path.join(cache, 'OpenCiv BCI-001.app');
  const executable = path.join(bundle, 'Contents/MacOS/Electron');
  const ready = path.join(cache, 'ready');
  if (!fs.existsSync(ready)) {
    fs.mkdirSync(cache, { recursive: true });
    // A failed preparation is safe to retry; only this generated cache is replaced.
    fs.rmSync(bundle, { recursive: true, force: true });
    execFileSync('/usr/bin/ditto', [path.resolve(electron, '../../..'), bundle]);
    const plist = path.join(bundle, 'Contents/Info.plist');
    for (const [key, value] of Object.entries({
      CFBundleName: 'OpenCiv BCI-001',
      CFBundleDisplayName: 'OpenCiv BCI-001',
      CFBundleIdentifier: 'com.neurolink.desktop.development',
    })) {
      execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    }
    // Development-only ad-hoc signing after changing the bundle metadata.
    execFileSync(
      '/usr/bin/codesign',
      [
        '--force',
        '--deep',
        '--sign',
        '-',
        '--preserve-metadata=entitlements,requirements,flags',
        bundle,
      ],
      { stdio: 'pipe' },
    );
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    fs.writeFileSync(ready, version);
  }
  return executable;
}

if (require.main === module) {
  try {
    const child = spawn(
      desktopExecutable(),
      [path.resolve(__dirname, '..'), ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: process.env,
      },
    );
    child.on('error', (error) => {
      console.error(error);
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  } catch (error) {
    console.error('Could not prepare the OpenCiv BCI-001 desktop app:', error.message);
    process.exitCode = 1;
  }
}
module.exports = { desktopExecutable };
