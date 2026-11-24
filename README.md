# 开源文明 BCI-001 · 核心

开源文明 BCI-001 的基础部分：连接 16 通道脑电设备，采集、保存和处理脑电，并通过本机接口交给你自己的程序。数据只留在本机或手机上。

> 本软件是电子产品配套软件，不是医疗器械，不用于诊断或治疗。

## 包含什么

| 部分 | 内容 |
|---|---|
| 设备连接 | USB 配对设备的 Wi-Fi（连家中 Wi-Fi 或设备热点），之后通过 Wi-Fi 采集；也可用 USB 串口。设备自动发现，断流自动重连 |
| 采集 | BrainFlow 读取 Cyton + Daisy 兼容的 16 通道数据，按采集时间对齐（处理 Wi-Fi 积压和时钟偏差） |
| 信号处理 | 与 OpenBCI GUI 一致的显示滤波（5–50 Hz 带通、去除 50/60 Hz 工频）、µVrms、饱和判断；功率谱、δ θ α β γ 频段能量、相对基线；电极接触判断与 Fp1 阻抗测量 |
| 信号工作台 | 时间序列、功率谱、频段能量、头皮图、3D 大脑和时间轴；五种布局；佩戴检查 |
| 保存 | 「录制脑电」保存原始数据和标记；「脑电数据库」列出全部记录，可回放、重命名、删除、看数据详情，导出 BDF；会话可导出为 BIDS |
| 开发接口 | 本机 WebSocket（`ws://127.0.0.1:8765`），提供原始脑电、频段能量、标记等；默认关闭，需要每次开启时生成的密钥。示例在 [`developer-kit/`](developer-kit/) |
| 概念手册 | 脑电、电极、信号质量和信号处理的概念；界面上的「?」链接到这里。内容在 [`content/glossary/`](content/glossary/) |
| 微信小程序 | `wechat/`：添加脑机接口（配对）、信号工作台、录制脑电、脑电数据库。采集和处理用 `src/engine-ts/`（TypeScript） |

## 数据与隐私

- 没有账户，不连接云端，不上传任何数据。
- 只有你主动录制时才保存脑电，保存在本机的应用数据目录（`%APPDATA%\OpenCiv-BCI-001`），可在应用中打开所在文件夹或删除。
- 开发接口默认关闭，只监听本机（127.0.0.1）。

## 开发环境

| 软件 | 版本 | 用途 |
|---|---|---|
| Windows | 10 / 11，64 位 | 桌面端开发与打包 |
| [Node.js](https://nodejs.org/) | 22 | 界面、Electron、测试 |
| [Python](https://www.python.org/) | 3.13 | 采集引擎（BrainFlow） |
| 微信开发者工具 | 任意较新版本 | 只在开发小程序时需要 |

### 第一次配置（Windows）

在项目根目录（PowerShell）：

```powershell
npm.cmd ci
python -m venv engine/.venv
engine/.venv/Scripts/python.exe -m pip install -r engine/requirements-lock.txt
engine/.venv/Scripts/python.exe -m pip install -r engine/requirements-dev.txt
```

引擎必须装在 `engine/.venv`：开发时桌面端直接用 `engine/.venv/Scripts/python.exe` 启动 `engine/main.py`。

### macOS（Conda）

```bash
conda env create -f environment-macos.yml
conda activate openbrain
npm run install:mac
npm run build
npm run start:mac
```

没有硬件时用 `npm run start:demo`。Mac 的 Python 依赖锁在 `engine/requirements-macos-lock.txt`。

### 运行

```powershell
npm.cmd run build
npm.cmd start
```

不需要脑电设备也能开发：

```powershell
npm.cmd start -- --demo
```

`--demo` 启动开发版并自动连接模拟设备（只用于开发和测试，应用界面里没有模拟设备）。改了界面后需要重新 `npm run build`；改了引擎（`engine/*.py`）只需重启应用。

### 微信小程序

```powershell
npm.cmd run build:wechat
```

把 `src/wechat/`、`src/engine-ts/` 等打包成小程序用的 `wechat/lib/core.js`、`wechat/lib/openbci.js`、`wechat/lib/jsqr.js` 和 `wechat/moment/lib/card.js`。然后用微信开发者工具导入 `wechat/` 目录；`project.config.json` 里的 AppID 需要换成你自己的。开发版打开时加 `?demo=1` 会连接模拟设备。

### 打包 Windows 安装包

先编译引擎，再打包。打包只会放入 `engine/dist` 里已有的引擎：

```powershell
engine/.venv/Scripts/python.exe -m PyInstaller --clean --noconfirm --onedir --name neurolink-engine --collect-all brainflow --distpath engine/dist --workpath engine/build --specpath engine engine/main.py
npm.cmd run package
```

安装包输出到 `release/OpenCiv-BCI-001-Setup-<版本>.exe`。

## 测试

```powershell
npm.cmd test
```

全部测试不需要硬件：单元测试、引擎测试（Python）和桌面界面测试（Electron + 模拟设备）。修改时用 `npm run test:changed` 只跑相关的测试，`npm run test:quick` 只跑单元和引擎测试。`tests/manual_*`、`capture-*`、`profile-*` 和 `*-current-connection` 需要真实设备，不在自动测试里。

类型检查与构建：`npm run build`；格式：`npm run format:check`（Prettier 和 ruff）。

## 目录结构

| 目录 | 内容 |
|---|---|
| `src/` | 桌面界面（React）；`src/wechat/`、`src/engine-ts/` 是小程序的采集与处理 |
| `electron/` | 桌面端：窗口、受限的 preload 接口、引擎管理、开发接口、本机存储（录制、会话、数据库、导出） |
| `engine/` | Python 引擎：BrainFlow 采集、时间对齐、滤波与频谱、饱和与接触判断、配网 |
| `wechat/` | 微信小程序 |
| `content/glossary/` | 概念手册（Markdown），编写指南见其中的 README |
| `developer-kit/` | 开发接口示例（Python、Node.js） |
| `docs/` | 原则、会话数据格式、配网说明 |
| `tests/` | 自动化测试 |

## 参与

见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [原则](docs/product-principles.md)。

## 许可

[MIT](LICENSE)。第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
