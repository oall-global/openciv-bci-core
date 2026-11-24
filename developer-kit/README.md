# 开源文明 BCI-001 本机开发接口 · v1

这是 0.1.14 的实验接口：允许自己的 Python / Node.js 程序读取脑电及描述性特征，写入实验标记。不提供思想、专注度、运动想象或 SSVEP 目标分类结果。

## 五分钟接入

1. 打开 开源文明 BCI-001，连接设备，或选择「进入演示」。
2. 打开「开发者工作台」，点击「开启本机接口」，点击「复制接入密钥」。
3. 在自己可写的实验目录复制本文件夹，打开 PowerShell。不要把密钥写入代码仓库。
4. Python 示例：安装 `python -m pip install -r requirements.txt`，运行 `python example.py`，按提示粘贴密钥（输入时不显示）。
5. Node.js 示例：运行 `npm install`，设置 `$env:NEUROLINK_TOKEN = Get-Clipboard`，运行 `node example.cjs`。结束后 `Remove-Item Env:NEUROLINK_TOKEN`。

默认地址为 `ws://127.0.0.1:8765`。更改端口后，可通过 `NEUROLINK_URL` 环境变量覆盖示例地址。示例仅允许连接 127.0.0.1，避免把密钥误发到外部服务器。

示例收到新鲜数据后写入一次 `example_started` 标记；只输出特征摘要和事件，不保存原始脑电。按 Ctrl+C 结束。启用演示时所有事件的 `source` 都是 `demo`，不得作为真实实验数据。

## 连接与请求

接口默认关闭，只监听 127.0.0.1，网页也可以直接接入（同样需要密钥）。最多 8 个客户端；连接后 5 秒内认证，单条请求最多 8 KiB，每秒最多 30 条。每次开启生成新密钥，退出后失效；密钥持有者能订阅脑电及写入标记。

先发送：
```json
{"type":"auth","token":"复制的密钥","clientName":"我的实验"}
```
收到 `authenticated` 后订阅。订阅请求会替换原有订阅，默认没有任何主题：
```json
{"type":"subscribe","topics":["metadata","status","quality","eeg","alpha","ssvep","marker"],"channels":[1,2,16],"ssvepFrequencyHz":30}
```
`channels` 为 1–16 中不重复的通道编号，默认全部。目标频率范围 5–36 Hz，默认 30；只是分析频率，不会启动或控制屏幕刺激。

写入实验事件：
```json
{"type":"marker","label":"eyes_closed","clientTimestampMs":1789999999000}
```
标记要求采集有效，名称 1–120 个字符。`clientTimestampMs` 可省略，仅原样附带，不用于校正时钟。写入者收到 `marker_ack`；订阅者收到 `marker`，两者使用同一个 `id`。可以发送 `{"type":"ping","requestId":"test"}` 获取 `pong`。其他请求返回 `error`；本接口不允许连接设备、修改增益、启动刺激或执行任意代码。

## 事件协议

所有事件包含 `schema: "neurolink.v1"`、`type`、`sequence`、`streamId`、`source`、`emittedAtMs` 和 `payload`。

- `streamId` 每次设备重新连接生成新 UUID，未连接时可能为空；变更时清空外部程序的分析缓存。
- `source` 为 `demo` / `device`，结合 status 判断是否正在采集。
- `sequence` 是全局发送编号，不连续可能因为别的客户端或主题，**不能用于计算丢包率**。
- `emittedAtMs` 是电脑发出事件的 Unix 毫秒，不能用它代替脑电的采样时间。

| type | payload 关键字段与含义 |
|---|---|
| metadata | rate、channels、boardId、epoch、channelNumbers；unit / sampleUnit 为 µV；electrodePositions=null，实际电极位置需要实验者自己对应 |
| status | status（streaming / stale / checking / disconnected 等）、valid、reason；初次进入 streaming 时 valid 可能为 false，等下一条 quality |
| eeg | channels；samples 为通道×样本二维数组；timestamps 为每个样本的 Unix 秒；receivedSampleStart 为本次连接已接收的有效样本序号；sampleNumbers 为 BrainFlow 原始包编号（不可用时 null） |
| quality | valid 表示近期收到数值有效的样本，**不是佩戴合格**；rail 含 states、percentages 等原版 Railed 指标。无效时 reason 给出断流或状态原因 |
| alpha | bandHz=[8,13]；windowEndTimestamp、windowSeconds=4；channels 内各项为 channel、valid、reason、absoluteUv2、relativePercent |
| bands | 每 0.25 秒，最近 4 秒窗口。各通道 channel、valid、reason、bands（delta 1–4 / theta 4–8 / alpha 8–13 / beta 13–30 / gamma 30–40 Hz，各含 absoluteUv2、relativePercent，占 1–40 Hz 总能量）、totalUv2、alphaPeakHz（7–14 Hz 谱峰，无峰为 null）、dominantHz；valid=false 时数值为 null |
| waves | 与 eeg 同步，每条最多 250 点；channels、broadband（1–40 Hz，去 50 Hz 工频）、alpha（8–13 Hz 带通，8/13 Hz 为 −3 dB 边界）、alphaAmplitude（α 最近 0.5 秒幅度包络）、timestamps、receivedSampleStart、settled（滤波约 2 秒后稳定）；实时因果滤波，有少量延迟 |
| ssvep | targetFrequencyHz、windowEndTimestamp、windowSeconds；各通道 channel、valid、reason、snrDb；只表示谱比，不是目标识别或置信度 |
| marker / marker_ack | id、label、clientName、receivedAtMs、clientTimestampMs、timing、lastReceivedSampleIndex、streamId |
| decoder | 识别器每个窗口一条（约 4 次/秒，仅在应用启动识别后）：kind=`decoder`，scores（各目标分数，**不是概率**）、nullMax（对照频率最高分）、best、margin、state（idle / candidate / selected / cooldown / calibrating）、progress、t（窗口最后一个样本的 BrainFlow 时间戳）；空闲校准结束时 kind=`decoder-calibration`，含 threshold、windows |
| control | 「控制」功能的统一事件：method（`eye` 眼电 / `jaw` 肌电 / `ssvep`）、action（blink、double-blink、left、right、clench、target-1…）、t（动作开始的样本时间戳）、strength（眼电 / 肌电为个人门槛的倍数，SSVEP 为领先幅度；都不是概率）、label。**眼电和肌电不是脑电** |
| command | 指令层的离散选择：action=`select`、target（目标序号）、label、t、margin。同一次注视只触发一次，之后有冷却期；没有 command 表示"没有明确目标"，不代表取消 |

脑电原始样本是 BrainFlow 解码、按增益缩放后的 µV，未经过本应用频谱滤波，不是 ADC 整数。每条最多 250 个样本。receivedSampleStart 只统计已收到的数据，不能说明中间没有漏样本。sampleNumbers 的计数方式随板型/传输方式而异，256 回绕；需要结合时间戳、采样率及设备协议判断，不应仅据序号计算精确丢包率。

BrainFlow 时间戳来自主机侧，不代表已经校准的硬件采样时钟。网络批量到达、系统时钟调整可能影响时间解释。多设备同步、视觉刺激物理开始时间和精确反应时实验需要额外时钟/光电测量验证。

## 特征和无效数据

Alpha 使用最近连续 4 秒数据，2 秒 Hann 窗、50% 重叠、去均值和线性趋势，频率间隔 0.5 Hz；8–13 Hz 功率采用梯形积分，占比的分母为 1–40 Hz 总功率。约每秒输出 4 次，刚开始/断流后须重新积累窗口。

SSVEP SNR = 10 log10（目标频率 ±0.5 Hz 范围的平均 PSD / 距目标 2–4 Hz 两侧范围的平均 PSD）。这与本应用 SSVEP 页的谱比定义一致。没有训练、基线归一化、谐波分类或目标选择解码。高 SNR 也可能来自伪迹。

平直/幅度异常或 Railed 异常时，通道特征 valid=false，数值为 null。reason 可为 flat、amplitude、near、railed、unknown、insufficient_spectrum。有效仅指当前检查没有发现这些问题，不等于信号来自大脑或接触已验证。

连续 1.5 秒没有新数据，发送 quality valid=false / data_timeout；离开 streaming 也立即无效。订阅时先发送 await_next_frame，等待新数据。外部程序还应设置自己的接收超时，看见非 streaming、无效 quality 或连接关闭时立即停止使用旧特征。不要在没有新 alpha/ssvep 事件时持续使用旧值。

## 标记精度与记录

本版标记 `timing="host_received_unaligned"`：表示 Electron 收到事件的时间，**未插入硬件采样流、未与某个采样点精确对齐**。lastReceivedSampleIndex 只是最近已接收样本位置，不是标记对应采样点。适合初步睁闭眼/操作阶段观察，不适合声称精确 ERP 或毫秒级反应时同步。

程序应自行保存需要的 EEG、事件和 metadata；本应用不默认录制，工作台只保留本次连接最近 30 条标记。关闭接口不会停止设备采集；重新开启密钥变化，程序需要重新认证订阅。客户端积压超过 1 MiB 时关闭连接（1013），避免拖慢采集；认证失败 1008。客户端必须把断开视为数据中断，不能拼成连续记录。

## 尚未包含

SSVEP 识别器与指令层已提供 `decoder` / `command` 主题（算法与局限见 docs/recognition.md）；识别由应用内任务启动，外部程序目前只能订阅结果，不能启动或配置识别。识别器插件、运动想象等其他模型、精确采样标记与 LSL 等留待后续。当前 API 的 schema 已版本化；未来破坏性变更会采用新版本。
