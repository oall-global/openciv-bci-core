// OpenBCI Cyton + Daisy packets as the Wi-Fi Shield streams them in "raw" mode: 33 bytes,
// 0xA0 · sample index · 8 × 24-bit channels · 6 aux bytes · end byte 0xC0–0xC6. Board and
// Daisy packets come in pairs with the same sample index: channels 1–8, then 9–16.
// Layout and scaling as in BrainFlow's cyton_daisy_wifi (MIT, brainflow-dev/brainflow).
export const PACKET = 33;
const START = 0xa0;
export const scale = (gain: number) => (4.5 / (2 ** 23 - 1) / gain) * 1e6; // µV per count

export type Sample = { index: number; channels: number[]; accel: number[] | null };

const int24 = (b: Uint8Array, o: number) => {
  const v = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
  return v & 0x800000 ? v - 0x1000000 : v;
};
const int16 = (b: Uint8Array, o: number) => {
  const v = (b[o] << 8) | b[o + 1];
  return v & 0x8000 ? v - 0x10000 : v;
};

export class PacketParser {
  private buf = new Uint8Array(0);
  private first: { index: number; ch: number[]; accel: number[] | null } | null = null;
  dropped = 0; // bytes skipped while looking for a packet start
  constructor(public gains: number[] = Array(16).fill(24)) {}

  push(bytes: Uint8Array): Sample[] {
    const all = new Uint8Array(this.buf.length + bytes.length);
    all.set(this.buf);
    all.set(bytes, this.buf.length);
    const out: Sample[] = [];
    let o = 0;
    while (all.length - o >= PACKET) {
      const end = all[o + PACKET - 1];
      if (all[o] !== START || end < 0xc0 || end > 0xc6) {
        o++;
        this.dropped++;
        continue;
      }
      const index = all[o + 1];
      const half = this.first && this.first.index === index ? 1 : 0;
      const ch = Array.from(
        { length: 8 },
        (_, i) => int24(all, o + 2 + i * 3) * scale(this.gains[half * 8 + i]),
      );
      let accel: number[] | null = null;
      if (end === 0xc0) {
        const a = [0, 1, 2].map((i) => int16(all, o + 26 + i * 2) * (0.002 / 16));
        if (a.some((v) => v !== 0)) accel = a;
      }
      if (!half) this.first = { index, ch, accel };
      else {
        out.push({
          index,
          channels: [...this.first!.ch, ...ch],
          accel: this.first!.accel ?? accel,
        });
        this.first = null;
      }
      o += PACKET;
    }
    this.buf = all.slice(o);
    return out;
  }
}

// Build packets (for tests and the simulated shield).
export function encode(index: number, channelsUv: number[], gains = Array(8).fill(24), end = 0xc6) {
  const b = new Uint8Array(PACKET);
  b[0] = START;
  b[1] = index & 0xff;
  channelsUv.forEach((uv, i) => {
    let v = Math.round(uv / scale(gains[i]));
    v = Math.max(-(2 ** 23), Math.min(2 ** 23 - 1, v));
    if (v < 0) v += 0x1000000;
    b[2 + i * 3] = (v >> 16) & 0xff;
    b[3 + i * 3] = (v >> 8) & 0xff;
    b[4 + i * 3] = v & 0xff;
  });
  b[PACKET - 1] = end;
  return b;
}
