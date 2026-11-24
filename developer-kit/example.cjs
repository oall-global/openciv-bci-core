const WebSocket = require('ws');
const token = process.env.NEUROLINK_TOKEN;
if (!token) throw Error('先设置 NEUROLINK_TOKEN 环境变量（在工作台复制密钥）');
const address = process.env.NEUROLINK_URL || 'ws://127.0.0.1:8765';
const url = new URL(address);
if (url.hostname !== '127.0.0.1' || url.protocol !== 'ws:') throw Error('示例只允许本机接口');
const ws = new WebSocket(address);
let marked = false;
ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token, clientName: 'Node.js 示例' })));
ws.on('message', (bytes) => {
  const event = JSON.parse(bytes.toString());
  if (event.type === 'authenticated')
    ws.send(
      JSON.stringify({
        type: 'subscribe',
        topics: ['metadata', 'status', 'quality', 'alpha', 'ssvep', 'marker'],
        channels: [1],
        ssvepFrequencyHz: 30,
      }),
    );
  if (event.type === 'quality') {
    if (!event.payload.valid) console.log('信号不可用：', event.payload.reason);
    else if (!marked) {
      marked = true;
      ws.send(
        JSON.stringify({ type: 'marker', label: 'example_started', clientTimestampMs: Date.now() }),
      );
    }
  } else console.log(event.type, event.source, event.payload);
});
ws.on('error', () => console.error('接入失败，请检查工作台的接口状态和端口'));
ws.on('close', (code) => console.log('连接结束，停止使用旧数据。关闭码：', code));
process.on('SIGINT', () => ws.close());
