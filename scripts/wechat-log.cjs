// Receives the mini program's development logs (wechat/lib/devlog.js) on port 8787 and appends
// them to test-results/wechat-phone.log (also printed). The phone must be on the same network and
// the mini program in 开发调试 mode (requests to this computer's address are not whitelisted).
const http = require('http'),
  fs = require('fs'),
  path = require('path');
const file = path.resolve(__dirname, '../test-results/wechat-phone.log');
fs.mkdirSync(path.dirname(file), { recursive: true });
http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/log') return res.writeHead(404).end();
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        const lines = JSON.parse(body).lines || [];
        const from = req.socket.remoteAddress;
        const text = lines.map((l) => `${from} ${l}`).join('\n') + '\n';
        fs.appendFileSync(file, text);
        process.stdout.write(text);
      } catch {
        /* not a log batch */
      }
      res.writeHead(204).end();
    });
  })
  .listen(8787, () => console.log(`wechat-log: listening on :8787 → ${file}`));
