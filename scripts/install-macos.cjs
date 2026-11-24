// Keep the Windows lockfile untouched. Its @webgpu/types tarball URL is stale,
// but its integrity matches the official 0.1.74 tarball. Populate npm's content
// cache first; npm ci still validates every package against the original lock.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function installMac(root) {
  if (process.platform !== 'darwin') throw new Error('Mac-only installer; use npm ci on Windows.');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const webgpu = lock.packages['node_modules/@webgpu/types'];
  if (webgpu?.version === '0.1.94') {
    const integrity =
      'sha512-lgiI4hbuLcI9unnm2cL/tvCaQU45dp0xcLWJh5uB/9MBGvIA4F8XIk7nSiBeg+K4xWGYwgZKn80LmERI5CxoTA==';
    if (webgpu.integrity !== integrity)
      throw new Error('Unexpected lock integrity; review the Mac dependency workaround.');
    execFileSync('npm', ['cache', 'add', '@webgpu/types@0.1.74'], { cwd: root, stdio: 'inherit' });
  }
  execFileSync('npm', ['ci', '--prefer-offline'], { cwd: root, stdio: 'inherit' });
}
if (require.main === module) {
  try {
    installMac(path.resolve(__dirname, '..'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { installMac };
