const ts = require('typescript'),
  fs = require('fs'),
  assert = require('assert/strict');
require.extensions['.ts'] = (m, p) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(p, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    p,
  );
const { usbNetworkHint: h } = require('../src/usbNetwork.ts');
assert.equal(h({ mode: 1 }).address, '192.168.4.1');
assert.equal(h({ mode: 1 }).mode, 'direct');
assert(h({ mode: 1 }).message.includes('尚未验证'));
assert.equal(h({ mode: 1, address: '192.168.8.1' }).address, '192.168.8.1');
assert.equal(h({ mode: 2 }).address, '');
assert.equal(h({ mode: 2 }).mode, 'router');
assert(h({ mode: 2 }).message.includes('Wi-Fi 名称和密码'));
assert.equal(h({ mode: 2, address: '192.158.0.140' }).address, '192.158.0.140');
assert.equal(h({ mode: 3 }).address, '');
assert(h({ mode: 3 }).message.includes('蓝牙模式'));
assert(h(null).message.includes('身份回复'));
console.log(
  'PASS AP-without-IP is an unverified candidate; router, Bluetooth, missing device and explicit address are distinguished',
);
