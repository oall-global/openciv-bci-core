// The interface description copied for an AI agent: everything it needs to connect to the
// running app and read the live EEG, in one Markdown text (endpoint, key, topics, code).
function agentGuide({ endpoint, token }) {
  return `# 开源文明 BCI-001 本机接口说明

你可以通过下面的接口读取这台电脑上 开源文明 BCI-001 的实时脑电数据和频段特征，并写入实验标记。接口只在本机（127.0.0.1）可用。

## 连接

- 地址：\`${endpoint}\`（WebSocket，消息均为 JSON 文本）
- 接入密钥：\`${token}\`
- 密钥在每次开启接口时重新生成，退出 开源文明 BCI-001 后失效；失效后请让用户重新复制本说明。
- 连接后 5 秒内必须发送验证消息，否则连接被关闭。每个连接每秒最多 30 条请求，最多 8 个连接。

## 请求

1. 验证（第一条消息）：
\`\`\`json
{"type":"auth","token":"${token}","clientName":"AI 助手"}
\`\`\`
返回 \`authenticated\`，其中 payload.topics 为可订阅的主题。

2. 订阅主题：
\`\`\`json
{"type":"subscribe","topics":["bands","status"]}
\`\`\`
可选字段：\`channels\`（1–16 的通道号数组，默认全部），\`ssvepFrequencyHz\`（5–36，默认 30）。返回 \`subscribed\`。再次发送 subscribe 会替换之前的订阅。

3. 写入实验标记（需要设备正在采集）：\`{"type":"marker","label":"事件名称"}\`，返回 \`marker_ack\`。
4. 心跳：\`{"type":"ping","requestId":"1"}\`，返回 \`pong\`。

请求出错时返回 \`error\`，payload.message 为原因。

## 推送消息

每条推送消息的外层格式：
\`\`\`json
{"schema":"neurolink.v1","type":"bands","sequence":12,"streamId":"…","source":"device","emittedAtMs":1790000000000,"payload":{}}
\`\`\`
source 为 device（真实设备）或 demo（模拟数据）。

| 主题 | 内容 |
|---|---|
| status | 设备状态：payload.status（streaming 表示正在采集），payload.valid |
| quality | 数据是否新鲜：payload.valid，payload.reason |
| metadata | 采样率、通道数等 |
| eeg | 原始脑电，µV；payload.samples 为每个通道的样本数组，数据量大，按需订阅 |
| bands | 每通道各频段的能量与占比、α 峰频、最强频率（见下节） |
| waves | 处理后的波形：去漂移和工频的脑电、α 波形、α 幅度（见下节） |
| alpha | 每通道 8–13 Hz 能量 |
| ssvep | 每通道目标频率的信噪比（dB） |
| marker | 实验标记 |

## 处理后的信号

只需要 α 等频段信息时，订阅 bands 或 waves 即可，不必自己处理原始脑电。

bands：每 0.25 秒一次，基于最近 4 秒数据。
\`\`\`json
{"windowEndTimestamp":1790000000.5,"windowSeconds":4,"channels":[{"channel":15,"valid":true,"reason":null,"bands":{"delta":{"absoluteUv2":12.1,"relativePercent":20.5},"theta":{"absoluteUv2":6.3,"relativePercent":10.7},"alpha":{"absoluteUv2":25.4,"relativePercent":43.1},"beta":{"absoluteUv2":12.8,"relativePercent":21.7},"gamma":{"absoluteUv2":2.4,"relativePercent":4.0}},"totalUv2":59.0,"alphaPeakHz":10,"dominantHz":10}]}
\`\`\`
- 频段：delta 1–4、theta 4–8、alpha 8–13、beta 13–30、gamma 30–40 Hz；relativePercent 为占 1–40 Hz 总能量的百分比。
- alphaPeakHz：7–14 Hz 内的谱峰（个体 α 频率），没有峰时为 null；dominantHz：1–40 Hz 内能量最强的频率。
- valid 为 false 时（接触不良、超量程等），reason 说明原因，数值为 null，不要使用。

waves：与原始脑电同步推送，每条最多 250 个采样点。
\`\`\`json
{"channels":[15,16],"broadband":[[1.2,0.8]],"alpha":[[0.9,0.4]],"alphaAmplitude":[[18.2,18.3]],"timestamps":[1790000000.004,1790000000.008],"settled":true,"unit":"µV"}
\`\`\`
- broadband：1–40 Hz 带通并去除 50 Hz 工频；alpha：8–13 Hz 带通；alphaAmplitude：α 波形最近 0.5 秒的幅度（包络）。数组按 channels 顺序，每个通道一行。
- 滤波为实时因果滤波，有少量延迟；settled 为 false 表示刚开始订阅、滤波尚未稳定（约 2 秒）。

通道号与电极位置（默认）：1 Fp1、2 Fp2、3 C3、4 C4、5 P7、6 P8、7 O1、8 O2、9 F7、10 F8、11 F3、12 F4、13 T7、14 T8、15 P3、16 P4。α 通常在后脑（O1、O2、P3、P4）最明显。

## 示例（Python，需要 \`pip install websockets\`）

\`\`\`python
import asyncio, json, websockets

async def main():
    async with websockets.connect("${endpoint}") as ws:
        await ws.send(json.dumps({"type": "auth", "token": "${token}", "clientName": "AI 助手"}))
        await ws.send(json.dumps({"type": "subscribe", "topics": ["bands"], "channels": [7, 8]}))
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] != "bands":
                continue
            for c in msg["payload"]["channels"]:
                if c["valid"]:
                    print(c["channel"], "α", c["bands"]["alpha"]["relativePercent"], "%")

asyncio.run(main())
\`\`\`

## 示例（Node.js，需要 \`npm install ws\`）

\`\`\`js
const WebSocket = require('ws');
const ws = new WebSocket('${endpoint}');
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: '${token}', clientName: 'AI 助手' }));
  ws.send(JSON.stringify({ type: 'subscribe', topics: ['bands'], channels: [7, 8] }));
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type !== 'bands') return;
  for (const c of msg.payload.channels)
    if (c.valid) console.log(c.channel, 'α', c.bands.alpha.relativePercent, '%');
});
\`\`\`

## 注意

- 频段数值描述的是信号，不能读出想法；接触不良或肌肉活动也会改变它们。
- 接入密钥只用于本机程序，不要发送到其他服务。
`;
}
module.exports = { agentGuide };
