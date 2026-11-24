// The scanner component (wechat/components/scanner): a Matter QR code drawn into a camera-sized
// frame at a known place is found by the bundled jsQR, and its box lands on it in the viewfinder
// (the preview fills the square viewfinder, cropped).
const path = require('path');
const QRCode = require('qrcode');

let def;
global.Component = (d) => (def = d);
require(path.resolve(__dirname, '../wechat/components/scanner/index.js'));
const jsQR = require(path.resolve(__dirname, '../wechat/lib/jsqr.js'));
const decode = jsQR.default || jsQR;

const W = 480,
  H = 640; // a portrait camera frame
const text = 'MT:Y.K9042C00KA0648G00';
const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
const n = qr.modules.size,
  cell = 6,
  quiet = 4;
const x0 = 140,
  y0 = 260; // where the code's quiet zone starts in the frame
const data = new Uint8ClampedArray(W * H * 4).fill(255);
for (let y = 0; y < n; y++)
  for (let x = 0; x < n; x++)
    if (qr.modules.get(y, x))
      for (let dy = 0; dy < cell; dy++)
        for (let dx = 0; dx < cell; dx++) {
          const i = ((y0 + (quiet + y) * cell + dy) * W + (x0 + (quiet + x) * cell + dx)) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }

const code = decode(data, W, H, { inversionAttempts: 'dontInvert' });
if (!code || code.data !== text) {
  console.error('FAIL wechat-scanner: jsQR did not read the code');
  process.exit(1);
}
// viewfinder 300×300 px: the 480×640 frame scaled by 300/480, cropped top and bottom
const ctx = { rect: { width: 300, height: 300 } };
const box = def.methods.place.call(ctx, code.location, W, H);
const s = 300 / 480,
  dy = (300 - H * s) / 2;
const want = {
  left: (x0 + quiet * cell) * s,
  top: (y0 + quiet * cell) * s + dy,
  size: n * cell * s,
};
const near = (a, b) => Math.abs(a - b) < 12;
if (!near(box.left, want.left) || !near(box.top, want.top) || !near(box.width, want.size + 16)) {
  console.error(
    'FAIL wechat-scanner: box',
    JSON.stringify(box),
    'expected about',
    JSON.stringify(want),
  );
  process.exit(1);
}
console.log(
  `PASS wechat-scanner: jsQR read the Matter code and its box lands on it (${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}px)`,
);
