// The device from the mini program: configured over HTTP as BrainFlow does it (src/mobile/shield.ts,
// openbci_wifi_shield_board, MIT) but streaming over UDP to a socket the mini program binds — a
// mini program cannot accept the TCP connection the phone app uses. POST /udp is the OpenBCI
// Wi-Fi firmware's (udpSetup); the current device firmware answers it 404 (2026-10-20), so this
// waits for a firmware with UDP output.
import { PacketParser } from '../engine-ts/openbci';
import type { OnSamples, Source } from '../engine-ts/engine';

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const RATE_COMMAND: Record<number, string> = { 250: '~6', 500: '~5', 1000: '~4' };

function http(address: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  return new Promise<string>((resolve, reject) =>
    wx.request({
      url: `http://${address}${path}`,
      method,
      data: body,
      header: body ? { 'content-type': 'application/json' } : {},
      dataType: '其他',
      timeout: 8000,
      success: (r: { statusCode: number; data: unknown }) =>
        r.statusCode === 200
          ? resolve(String(r.data ?? ''))
          : reject(
              Error(
                r.statusCode === 404 && path === '/udp'
                  ? '设备固件不支持 UDP 输出'
                  : `设备回复 ${r.statusCode}`,
              ),
            ),
      fail: () => reject(Error('设备没有响应，请确认手机和设备在同一个 Wi-Fi 下')),
    }),
  );
}
const localIp = () =>
  new Promise<string>((resolve, reject) =>
    wx.getLocalIPAddress({
      success: (r: { localip: string }) => resolve(r.localip),
      fail: () => reject(Error('无法获取手机的局域网地址，请确认已连接 Wi-Fi')),
    }),
  );

export class UdpShield implements Source {
  demo = false;
  private socket: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private parser = new PacketParser();
  private streaming = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private address: string,
    public rate = 250,
  ) {}

  async start(on: OnSamples) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(this.address)) throw Error('设备地址无效');
    // the OpenBCI shield answers GET /board, the BCI-001 board GET /status (engine/connection_setup.py)
    await http(this.address, 'GET', '/board').catch(() => http(this.address, 'GET', '/status'));
    const ip = await localIp();
    this.socket = wx.createUDPSocket();
    const port: number = this.socket.bind();
    // every datagram is a packet or two; the engine is handed 50 ms batches as from the simulated
    // device (one engine update per datagram, hundreds a second, stalls the phone)
    let got: ReturnType<PacketParser['push']> = [];
    this.socket.onMessage((r: { message: ArrayBuffer; remoteInfo: { address: string } }) => {
      if (r.remoteInfo.address !== this.address) return;
      got = got.concat(this.parser.push(new Uint8Array(r.message)));
    });
    this.timer = setInterval(() => {
      if (!got.length) return;
      const batch = got;
      got = [];
      on(
        Array.from({ length: 16 }, (_, c) => batch.map((g) => g.channels[c])),
        batch.map((g) => g.index),
      );
    }, 50);
    await http(this.address, 'POST', '/udp', {
      ip,
      port,
      output: 'raw',
      delimiter: true,
      latency: 10000,
    });
    const reply = await http(this.address, 'POST', '/command', {
      command: RATE_COMMAND[this.rate] ?? '~6',
    });
    const m = /sample[\s_-]*rate[^\d]*(\d+)\s*Hz/i.exec(reply);
    if (m && Number(m[1]) !== this.rate) throw Error('设备未确认所选采样率');
    // as the desktop engine: clear lead-off left from an interrupted session and Fp1's test gain
    for (const group of ['12345678', 'QWERTYUI'])
      await http(this.address, 'POST', '/command', {
        command: [...group].map((ch) => `z${ch}00Z`).join(''),
      }).catch(() => {});
    await http(this.address, 'POST', '/command', { command: 'x1060110X' }).catch(() => {});
    await http(this.address, 'GET', '/stream/start');
    this.streaming = true;
  }

  async stop() {
    if (this.streaming) await http(this.address, 'GET', '/stream/stop').catch(() => {});
    this.streaming = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }

  // lead-off for the wear probe: the stream pauses while the board takes the commands
  probe = {
    commands: async (list: string[]) => {
      await http(this.address, 'GET', '/stream/stop');
      try {
        for (const c of list) await http(this.address, 'POST', '/command', { command: c });
      } finally {
        await http(this.address, 'GET', '/stream/start');
      }
    },
  };
}
