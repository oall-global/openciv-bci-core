// THIRD_PARTY_NOTICES.md: everything shipped in the installer that is not our own code, with the
// full license texts. Run after changing dependencies:  node scripts/third-party-notices.cjs
const fs = require('fs'),
  path = require('path');
const root = path.resolve(__dirname, '..');
const site = path.join(root, 'engine/.venv/Lib/site-packages');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n').trim();
const findDist = (name) => fs.readdirSync(site).find((d) => d.toLowerCase().startsWith(name.toLowerCase() + '-') && d.endsWith('.dist-info'));

// pyserial's wheel carries no license file; the text of its LICENSE.txt.
const PYSERIAL = `Copyright (c) 2001-2020 Chris Liechti <cliechti@gmx.net>
All Rights Reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.

  * Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following
    disclaimer in the documentation and/or other materials provided
    with the distribution.

  * Neither the name of the copyright holder nor the names of its
    contributors may be used to endorse or promote products derived
    from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const entries = [];
// JavaScript bundled into the app (production dependency tree).
for (const name of ['react', 'react-dom', 'scheduler', 'three', 'lucide-react', 'ws']) {
  const pkg = JSON.parse(read(root, 'node_modules', name, 'package.json'));
  entries.push({ name, version: pkg.version, license: pkg.license, use: '界面', text: read(root, 'node_modules', name, 'LICENSE') });
}
// Electron (its Chromium licenses ship as LICENSES.chromium.html next to the executable).
{
  const pkg = JSON.parse(read(root, 'node_modules/electron/package.json'));
  entries.push({ name: 'electron', version: pkg.version, license: 'MIT', use: '桌面外壳；Chromium 等组件的许可见安装目录 LICENSES.chromium.html', text: read(root, 'node_modules/electron/dist/LICENSE') });
}
// Python packages inside the bundled engine.
const py = [
  ['brainflow', 'BrainFlow', 'MIT', '设备连接与信号处理', ['LICENSE.txt']],
  ['numpy', 'NumPy', 'BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0', '信号计算', ['licenses/LICENSE.txt']],
  ['pyserial', 'pyserial', 'BSD-3-Clause', 'USB 串口', null],
  ['setuptools', 'setuptools', 'MIT', 'BrainFlow 运行时依赖（pkg_resources）', ['licenses/LICENSE']],
  ['pyinstaller', 'PyInstaller', 'GPL-2.0-or-later WITH Bootloader-exception', '引擎打包（只含其 bootloader，按例外条款不约束本程序）', ['licenses/COPYING.txt']],
];
for (const [dist, name, license, use, files] of py) {
  const d = findDist(dist);
  const version = d.slice(dist.length + 1).replace('.dist-info', '');
  entries.push({ name, version, license, use, text: files ? read(site, d, files[0]) : PYSERIAL });
}

let md = `# Third-party notices

开源文明 BCI-001 本身以 MIT 许可发布（见 LICENSE）。安装包中还包含以下第三方软件和素材，它们各自适用自己的许可。
本文件由 \`scripts/third-party-notices.cjs\` 生成。

## 素材与借用的代码

| 内容 | 来源 | 许可 | 说明 |
|---|---|---|---|
| 大脑模型 \`src/assets/brain-atlas.glb\` | Anderson Winkler, Brainder.org；GLB：mpatricny/brain-for-web | CC BY-SA 3.0 | 不适用本项目的 MIT 许可；修改模型文件后须按 CC BY-SA 3.0 发布。详见 \`public/licenses/BrainAtlas.txt\` |
| 头部模型 \`src/assets/head.json\` | Lee Perry-Smith, Infinite 3D Head Scan | CC BY 3.0 | 不适用本项目的 MIT 许可。详见 \`public/licenses/LeePerrySmith.txt\` |
| 接触 / 饱和检测、阻抗换算（\`engine/rail.py\`、\`engine/contact.py\`、\`engine/connection_check.py\`） | OpenBCI GUI | MIT | 详见 \`public/licenses/OpenBCI-GUI-MIT.txt\` |
| 星表 \`src/assets/stars.json\`（脑电时刻卡片的星空） | Yale Bright Star Catalogue, 5th Revised Ed.（Hoffleit & Warren, 1991），经 Harvard-Smithsonian Center for Astrophysics 发布 | 公开数据 | 只取赤经、赤纬、星等、B−V；行星位置按 JPL 公布的近似轨道根数（E. M. Standish）计算 |

## 软件包

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
${entries.map((e) => `| ${e.name} | ${e.version} | ${e.license} | ${e.use} |`).join('\n')}

## 许可全文
`;
for (const e of entries) md += `\n### ${e.name} ${e.version}\n\n\`\`\`text\n${e.text}\n\`\`\`\n`;
for (const f of ['OpenBCI-GUI-MIT.txt', 'BrainAtlas.txt', 'LeePerrySmith.txt'])
  md += `\n### ${f.replace('.txt', '')}\n\n\`\`\`text\n${read(root, 'public/licenses', f)}\n\`\`\`\n`;
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), md);
console.log('THIRD_PARTY_NOTICES.md:', entries.length, 'packages');
