# 微信小程序

手机上的采集、保存和查看：

| 页面 | 内容 |
|---|---|
| `bci/pages/add` | 添加脑机接口：设备开机、配对 Wi-Fi、在网络里找到设备 |
| `pages/workbench` | 信号工作台：3D 大脑、实时波形、频段能量、佩戴检查、时间轴，录制脑电 |
| `pages/data` | 脑电数据库：手机上保存的记录，导出 BDF |
| `moment/pages/card` | 一段记录的卡片 |
| `pages/settings` | 设备；开发版里的「设备直连验证」（`pages/dev`） |

## 和桌面端的区别

小程序不能开 TCP 服务端，所以设备改用 UDP 发数据：小程序绑定一个 UDP 端口，通过 `POST /udp {ip, port}` 告诉设备（固件 OpenBCI_WIFI 的 `udpSetup`）。采集与处理用 `src/engine-ts/`（TypeScript），页面共用的库由 `npm run build:wechat`（`scripts/wechat-lib.cjs`）打包成 `lib/core.js`、`lib/openbci.js`、`lib/jsqr.js` 和 `moment/lib/card.js`。

## 运行

1. 安装「微信开发者工具」，导入本目录（`wechat/`）。
2. AppID：`project.config.json` 里是原项目的小程序 AppID，自己运行时换成你的。
3. 「详情 → 本地设置」勾选「不校验合法域名」。
4. 「真机调试」或「预览」扫码，在手机上打开。开发版打开时加 `?demo=1` 会连接模拟设备。

开发版的日志可以发到电脑上：`node scripts/wechat-log.cjs`（端口 8787，见 `lib/devlog.js`）。
