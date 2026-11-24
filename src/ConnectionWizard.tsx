import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, RefreshCw, Usb, Wifi, Router, Info } from 'lucide-react';
import type { Api, Device, Frame, Metadata, Prefs, Status } from './types';
import ConnectionIllustration from './ConnectionIllustration';
import DevicePower from './DevicePower';
import { usbNetworkHint } from './usbNetwork';
import './connection-wizard.css';

type Props = {
  api: Api | undefined;
  ready: boolean;
  visible: boolean;
  status: Status;
  frame: Frame | null;
  meta: Metadata | null;
  prefs: Prefs;
  onSave: (p: Partial<Prefs>) => Promise<unknown>;
  navigate: (p: string) => void;
  // Connection progress as a short message (the wizard returns to the workbench at once).
  onNotice?: (text: string) => void;
};
type Mode = 'direct' | 'router';
type UsbPort = {
  port: string;
  verified: boolean;
  mode?: number;
  channels?: number;
  address?: string;
  networkName?: string;
};
export default function ConnectionWizard({
  api,
  ready,
  visible,
  status,
  frame,
  meta,
  prefs,
  onSave,
  navigate,
  onNotice,
}: Props) {
  const [step, setStep] = useState(0),
    // 打开设备 comes first; skipped when a device is already connected.
    [powered, setPowered] = useState(false),
    [mode, setMode] = useState<Mode>('router'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [ports, setPorts] = useState<UsbPort[]>([]),
    [identified, setIdentified] = useState<UsbPort | null>(null),
    [ending, setEnding] = useState('none');
  const [configure, setConfigure] = useState(false),
    [wifiName, setWifiName] = useState(''),
    [password, setPassword] = useState(''),
    [hotspot, setHotspot] = useState(false);
  const [address, setAddress] = useState(''),
    [rate, setRate] = useState(250),
    [port, setPort] = useState(6677),
    [devices, setDevices] = useState<Device[]>([]),
    [device, setDevice] = useState<Device | null>(null);
  const [attempt, setAttempt] = useState<{ at: number; epoch: number | null } | null>(null),
    [stableSince, setStableSince] = useState<number | null>(null),
    [now, setNow] = useState(Date.now()),
    [complete, setComplete] = useState(false);
  const initialized = useRef(false),
    lock = useRef(false),
    saving = useRef(false),
    previousStatus = useRef(status.status),
    connectionGeneration = useRef(0);
  const occupied = ['streaming', 'connecting', 'reconnecting', 'checking', 'stale'].includes(
    status.status,
  );
  const validPort = Number.isInteger(port) && port >= 1024 && port <= 65535;
  const configValid =
    new TextEncoder().encode(wifiName).length > 0 &&
    new TextEncoder().encode(wifiName).length <= 32 &&
    new TextEncoder().encode(password).length >= 8 &&
    new TextEncoder().encode(password).length <= 63 &&
    !/[|\r\n\0]/.test(wifiName + password);
  const verified =
    !!frame &&
    !!meta &&
    !!attempt &&
    status.status === 'streaming' &&
    !status.demo &&
    frame.epoch === meta.epoch &&
    frame.epoch === attempt.epoch &&
    meta.channels === 16 &&
    now - frame.at * 1000 < 1500 &&
    now - frame.at * 1000 >= -1000 &&
    frame.at * 1000 >= attempt.at &&
    frame.samples.length === 16 &&
    frame.samples.every((row) => row.length > 0 && row.every(Number.isFinite));
  const stable = verified && stableSince !== null && now - stableSince >= 3000;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!verified) setStableSince(null);
    else setStableSince((t) => t ?? Date.now());
  }, [verified, frame]);
  useEffect(() => {
    if (!visible) setPassword('');
  }, [visible]);
  useEffect(() => {
    if (!visible || initialized.current) return;
    initialized.current = true;
    setAddress(prefs.address);
    setRate(prefs.sampleRate);
    setPort(prefs.localPort);
    setMode(prefs.connectionMode === 'direct' ? 'direct' : 'router');
  }, [visible, prefs]);
  useEffect(() => {
    if (status.status === 'disconnected' && previousStatus.current !== 'disconnected')
      resetConnection();
    previousStatus.current = status.status;
  }, [status.status]);
  useEffect(() => {
    if (!stable || complete || !device || saving.current) return;
    saving.current = true;
    const generation = connectionGeneration.current;
    void onSave({
      onboarded: true,
      transport: 'wifi',
      model: 'cyton-daisy',
      address: device.address,
      sampleRate: rate,
      localPort: port,
      connectionMode: mode,
    })
      .then(() => {
        if (generation !== connectionGeneration.current) return;
        setComplete(true);
        setError('');
        onNotice?.(
          '设备已连接，正在接收 16 通道脑电。请拔掉 USB 数据线，正常使用时不需要连接 USB。',
        );
      })
      .catch(() => {
        if (generation !== connectionGeneration.current) return;
        setError('已连接，但未能保存连接设置。请稍后重试。');
      });
  }, [stable, complete, device, rate, port, mode, onSave]);
  const warned = useRef(false);
  useEffect(() => {
    if (!attempt || stable || complete || warned.current || now - attempt.at <= 20000) return;
    warned.current = true;
    onNotice?.('连接等待较久：请确认已关闭官方 GUI，且防火墙允许本应用访问当前网络。');
  }, [attempt, stable, complete, now, onNotice]);
  async function act(label: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          '',
        ),
      );
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  function selectUsb(p: UsbPort) {
    setIdentified(p);
    const hint = usbNetworkHint(p);
    setMode(hint.mode ?? 'router');
    setAddress(hint.address);
    setWifiName(p.networkName ?? '');
    setConfigure(!hint.mode);
    setHotspot(false);
    setPassword('');
    setStep(1);
  }
  async function scanUsb() {
    const r = await api!.command('setup-usb', { ending });
    const found: UsbPort[] = r.ports.filter((p: UsbPort) => p.verified);
    setPorts(found);
    if (found.length === 1) selectUsb(found[0]);
    else if (!found.length)
      throw Error('没有识别到设备。请检查电源，使用 USB 数据线连接，并关闭串口助手后重试。');
  }
  function chooseMode(m: Mode) {
    setMode(m);
    setConfigure(!!identified && identified.mode !== (m === 'direct' ? 1 : 2));
    setWifiName(
      m === 'direct'
        ? identified?.mode === 1
          ? (identified.networkName ?? '')
          : 'NeuroLink-EEG'
        : (identified?.networkName ?? ''),
    );
    setAddress(
      m === 'direct'
        ? (identified?.mode === 1 ? identified.address : '') || '192.168.4.1'
        : identified?.mode === 2
          ? (identified.address ?? '')
          : '',
    );
    setPassword('');
    setHotspot(false);
    setDevices([]);
    setError('');
  }
  async function begin(d: Device) {
    setDevice(d);
    setStep(2);
    setComplete(false);
    saving.current = false;
    setStableSince(null);
    const at = Date.now();
    setAttempt({ at, epoch: null });
    setBusy('正在连接并检查脑电信号');
    await api!.command('connect', {
      transport: 'wifi',
      model: 'cyton-daisy',
      address: d.address,
      sampleRate: rate,
      localPort: port,
    });
    const snapshot = await api!.snapshot();
    setAttempt({ at, epoch: snapshot.metadata?.epoch ?? null });
    // No separate "connecting" page: back to the workbench; the status pill and a message
    // show the progress, and this wizard keeps confirming and saving in the background.
    warned.current = false;
    onNotice?.('正在连接设备…');
    navigate('signals');
  }
  async function findAndConnect(candidate = address, readUsb = true) {
    setDevices([]);
    setBusy('正在寻找设备');
    if (readUsb && identified) {
      try {
        const r = await api!.command('setup-usb', { ending });
        const p: UsbPort | undefined = r.ports.find(
          (v: UsbPort) => v.verified && v.port === identified.port,
        );
        if (p?.mode === (mode === 'direct' ? 1 : 2) && p.address) {
          candidate = p.address;
          setAddress(candidate);
        }
      } catch {
        /* Discovery remains available when USB is unplugged. */
      }
    }
    let reachable: (Device & { boardType?: string }) | null = null;
    if (candidate.trim()) {
      try {
        reachable = await api!.command('setup-probe', { address: candidate.trim() });
      } catch {
        /* A saved address may have changed. */
      }
    }
    if (reachable) {
      if (reachable.boardType !== 'cyton') throw Error('请连接 Cyton + Daisy 设备');
      await begin(reachable);
      return;
    }
    const found: Device[] = (await api!.command('discover')).filter(
      (d: Device) => d.transport === 'wifi',
    );
    if (found.length === 1) {
      const d = await api!.command('setup-probe', { address: found[0].address });
      if (d.boardType !== 'cyton') throw Error('请连接 Cyton + Daisy 设备');
      await begin(d);
      return;
    }
    if (found.length > 1) {
      setDevices(found);
      return;
    }
    throw Error(
      mode === 'direct'
        ? '还没有找到设备。请让电脑连接设备热点，再试一次。'
        : '还没有找到设备。请确认设备已通电，电脑和设备连接的是同一个 Wi-Fi。',
    );
  }
  async function connect() {
    if (configure) {
      if (!identified || !configValid) return;
      try {
        const r = await api!.command('setup-configure', {
          port: identified.port,
          ending,
          mode,
          name: wifiName,
          password,
        });
        if (!r.sent) throw Error('配置未能发送，请重试。');
      } finally {
        setPassword('');
      }
      setConfigure(false);
      setAddress(mode === 'direct' ? '192.168.4.1' : '');
      if (mode === 'direct') {
        setHotspot(true);
        return;
      }
      // Writing is not an acknowledgement. Discover and verify actual EEG before success.
      await findAndConnect('', true);
      return;
    }
    if (mode === 'direct' && !hotspot) {
      setHotspot(true);
      return;
    }
    await findAndConnect();
  }
  function resetConnection() {
    connectionGeneration.current++;
    saving.current = false;
    setAttempt(null);
    setStableSince(null);
    setComplete(false);
    setDevice(null);
    setDevices([]);
    setIdentified(null);
    setPorts([]);
    setConfigure(false);
    setHotspot(false);
    setWifiName('');
    setPassword('');
    setError('');
    setStep(0);
  }
  async function cancel() {
    await api!.command('disconnect');
    resetConnection();
  }
  useEffect(() => {
    if (occupied) setPowered(true);
  }, [occupied]);
  const disabled = !!busy || !ready || occupied;
  const shown = powered ? step + 1 : 0;
  const titles = [
    '连接 USB，开始配对',
    '选择连接方式',
    complete ? (verified ? '设备已连接' : '脑电信号已中断') : '正在连接设备',
  ];
  return (
    <div className="connection-wizard">
      <div className="cw-heading">
        <div>
          <span className="eyebrow">DEVICE SETUP</span>
          <h1>连接你的脑电设备</h1>
        </div>
      </div>
      <ol className="cw-steps" aria-label="设备连接步骤">
        {['打开设备', 'USB 配对', '选择连接方式', '开始使用'].map((s, i) => (
          <li
            key={s}
            aria-current={shown === i ? 'step' : undefined}
            className={shown === i ? 'current' : shown > i ? 'passed' : ''}
          >
            <span>{shown > i ? <Check size={13} /> : i + 1}</span>
            <b>{s}</b>
          </li>
        ))}
      </ol>
      {occupied && step < 2 && (
        <div className="cw-alert">
          <Info size={17} />
          <div>设备已有连接，可以直接查看信号。</div>
          <button className="text-button" onClick={() => navigate('signals')}>
            查看工作台
          </button>
          <button
            className="text-button"
            disabled={!!busy || status.status === 'checking'}
            onClick={() => act('断开连接', cancel)}
          >
            断开连接
          </button>
        </div>
      )}
      <div className="cw-stage">
        <section className="cw-visual">
          <div className="cw-visual-label">
            <span>STEP {shown + 1}</span>
            <span>NEUROLINK</span>
          </div>
          {!powered ? (
            <div className="cw-power">
              <figure>
                <DevicePower on={false} />
                <figcaption>
                  <b>关闭</b>开关在下方，指示灯不亮
                </figcaption>
              </figure>
              <figure className="on">
                <DevicePower on />
                <figcaption>
                  <b>开机</b>开关推到上方，指示灯亮绿色
                </figcaption>
              </figure>
            </div>
          ) : (
            <>
              <ConnectionIllustration
                step={
                  step === 0 ? 0 : step === 1 ? (hotspot ? 3 : configure ? 2 : 1) : complete ? 5 : 4
                }
                mode={mode}
                usbConfig={!!identified}
                success={complete && verified}
              />
              <div className="cw-diagram-caption">
                {step === 0
                  ? '用 USB 数据线连接电脑'
                  : mode === 'direct'
                    ? '设备热点 → 笔记本'
                    : '设备 → 家中或办公室 Wi-Fi ← 笔记本'}
              </div>
              <div className="cw-tip">
                <Info size={16} />
                <p>
                  {step === 0
                    ? 'USB 只在配对时使用：配对完成后拔掉，正常使用时不要连接 USB。'
                    : mode === 'router'
                      ? '使用日常 Wi-Fi，连接设备时电脑仍然可以上网。'
                      : '电脑连接设备热点后，通常无法通过这张 Wi-Fi 网卡上网。'}
                </p>
              </div>
            </>
          )}
        </section>
        <section className="cw-instructions">
          <h2>{powered ? titles[step] : '打开设备电源'}</h2>
          {!powered && (
            <>
              <p className="cw-description">
                开关在设备侧面、USB 接口上方。将开关向上推到顶，看到绿色指示灯亮起即为开机。
              </p>
              <button className="primary" onClick={() => setPowered(true)}>
                已开机，下一步 <ArrowRight size={15} />
              </button>
            </>
          )}
          {powered && step === 0 && (
            <>
              <p className="cw-description">插好 USB 数据线，然后点击下方按钮。</p>
              <button
                className="primary"
                disabled={disabled}
                onClick={() => act('正在识别设备', scanUsb)}
              >
                <Usb size={16} />
                识别设备 <ArrowRight size={15} />
              </button>
              {ports.length > 1 && (
                <div className="cw-device-list">
                  <p>发现多台设备，请选择本次使用的设备。</p>
                  {ports.map((p) => (
                    <button key={p.port} onClick={() => selectUsb(p)}>
                      脑电设备 · {p.port}
                    </button>
                  ))}
                </div>
              )}
              <div className="cw-actions">
                <button
                  className="cw-link"
                  disabled={disabled}
                  onClick={() => {
                    setStep(1);
                    setConfigure(false);
                  }}
                >
                  设备已配网，直接连接 <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              {hotspot ? (
                <>
                  <p className="cw-description">
                    在电脑的 Wi-Fi 列表中选择 <b>{wifiName || '设备热点'}</b>
                    ，连接后返回这里。显示“无 Internet”也可以继续。
                  </p>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      act('打开 Wi-Fi 设置', async () => {
                        await api!.setup('wifi-settings');
                      })
                    }
                  >
                    <Wifi size={15} />
                    打开电脑 Wi-Fi 设置
                  </button>
                  <div className="cw-actions">
                    <button
                      className="primary"
                      disabled={disabled || !validPort}
                      onClick={() => act('正在连接', () => findAndConnect())}
                    >
                      已连接热点，继续 <ArrowRight size={15} />
                    </button>
                    <button
                      className="text-button"
                      disabled={!!busy || occupied}
                      onClick={() => setHotspot(false)}
                    >
                      返回
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="cw-description">
                    {identified
                      ? '已识别设备。选择一种方式，剩下的交给我们。'
                      : '设备已配置过网络时，无需重新填写。'}
                  </p>
                  <div className="cw-mode-options">
                    {(['router', 'direct'] as Mode[]).map((m) => (
                      <button
                        key={m}
                        aria-pressed={mode === m}
                        className={mode === m ? 'chosen' : ''}
                        disabled={disabled}
                        onClick={() => chooseMode(m)}
                      >
                        {m === 'router' ? <Router /> : <Wifi />}
                        <div>
                          <b>{m === 'router' ? '使用现有 Wi-Fi' : '直连电脑'}</b>
                          <p>
                            {m === 'router'
                              ? '推荐 · 电脑可以继续上网'
                              : '连接设备热点，无需路由器'}
                          </p>
                        </div>
                        <span className="cw-radio">{mode === m ? '●' : '○'}</span>
                      </button>
                    ))}
                  </div>
                  {configure && identified ? (
                    <div className="cw-fields cw-credentials">
                      <label>
                        {mode === 'direct' ? '设备热点名称' : 'Wi-Fi 名称'}
                        <input
                          aria-label="配置 Wi-Fi 名称"
                          autoComplete="off"
                          value={wifiName}
                          disabled={disabled}
                          onChange={(e) => setWifiName(e.target.value)}
                        />
                      </label>
                      <label>
                        Wi-Fi 密码
                        <input
                          aria-label="配置 Wi-Fi 密码"
                          type="password"
                          autoComplete="new-password"
                          placeholder="至少 8 位"
                          value={password}
                          disabled={disabled}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                      <small className="cw-small">仅用于设置设备，不保存密码。</small>
                    </div>
                  ) : (
                    <p className="cw-small">
                      使用设备已保存的网络配置。
                      {identified && (
                        <button
                          className="text-button"
                          disabled={disabled}
                          onClick={() => {
                            setConfigure(true);
                            setWifiName(
                              mode === 'direct' ? 'NeuroLink-EEG' : (identified.networkName ?? ''),
                            );
                          }}
                        >
                          更换网络
                        </button>
                      )}
                    </p>
                  )}
                  <div className="cw-actions">
                    <button
                      className="primary"
                      disabled={disabled || !validPort || (configure && !configValid)}
                      onClick={() => act(configure ? '正在设置网络' : '正在连接', connect)}
                    >
                      {configure ? '保存并连接' : mode === 'direct' ? '连接设备热点' : '连接设备'}{' '}
                      <ArrowRight size={15} />
                    </button>
                    <button
                      className="text-button"
                      disabled={!!busy || occupied}
                      onClick={() => {
                        setPassword('');
                        setStep(0);
                      }}
                    >
                      返回
                    </button>
                  </div>
                </>
              )}
              {devices.length > 1 && (
                <div className="cw-device-list">
                  <p>找到多台设备，请选择一台连接。</p>
                  {devices.map((d) => (
                    <button
                      key={d.address}
                      disabled={disabled}
                      onClick={() =>
                        act('正在连接', async () => {
                          const checked = await api!.command('setup-probe', { address: d.address });
                          if (checked.boardType !== 'cyton')
                            throw Error('请连接 Cyton + Daisy 设备');
                          await begin(checked);
                        })
                      }
                    >
                      {d.name} · {d.address}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <div className={`cw-finish ${verified ? 'online' : ''}`}>
                <Check size={25} />
                <div>
                  <b>
                    {complete
                      ? verified
                        ? '正在接收 16 通道脑电'
                        : '当前没有有效脑电数据'
                      : verified
                        ? '已收到脑电，正在确认连接稳定'
                        : '等待脑电信号…'}
                  </b>
                  <p>{complete ? '连接设置已自动记住。' : '通常只需几秒钟，无需手动设置参数。'}</p>
                </div>
              </div>
              {attempt && now - attempt.at > 20000 && !stable && (
                <p className="cw-small">
                  等待较久，请确认已关闭官方 GUI，且防火墙允许本应用访问当前网络。
                </p>
              )}
              {complete && verified && (
                <div className="cw-notice" role="status">
                  <b>请拔掉 USB 数据线</b>
                  <p>配对已完成，脑电信号通过 Wi-Fi 传输。正常使用时不要连接 USB。</p>
                </div>
              )}
              {complete && (
                <div className="cw-actions">
                  <button
                    className="primary"
                    disabled={!verified}
                    onClick={() => navigate('signals')}
                  >
                    进入信号工作台 <ArrowRight size={15} />
                  </button>
                </div>
              )}
              <div className="cw-actions">
                <button
                  className="text-button"
                  disabled={!!busy || status.status === 'checking'}
                  onClick={() => act('正在停止连接', cancel)}
                >
                  {complete ? '断开连接' : '停止并返回'}
                </button>
              </div>
              <p className="cw-small">
                连接成功后，可在信号工作台的「通道状态」中查看各电极是否正常。
              </p>
            </>
          )}
          {busy && (
            <p className="cw-progress" role="status">
              <RefreshCw size={14} className="spin" />
              {busy}…
            </p>
          )}
          {error && (
            <div className="cw-error" role="alert">
              {error}
            </div>
          )}
          <details className="cw-advanced">
            <summary>连接遇到问题？高级设置</summary>
            <p>一般无需修改。找不到设备时，可以填写已知地址。</p>
            <div className="cw-fields">
              <label>
                设备 IP 地址
                <input
                  aria-label="设备 IP 地址"
                  value={address}
                  disabled={disabled}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
              <label>
                采样率
                <select
                  aria-label="连接采样率"
                  value={rate}
                  disabled={disabled}
                  onChange={(e) => setRate(Number(e.target.value))}
                >
                  {[250, 500, 1000].map((r) => (
                    <option key={r} value={r}>
                      {r} Hz
                    </option>
                  ))}
                </select>
              </label>
              <label>
                接收端口
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  disabled={disabled}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </label>
              <label>
                USB 命令结尾
                <select
                  value={ending}
                  disabled={disabled}
                  onChange={(e) => setEnding(e.target.value)}
                >
                  <option value="none">默认</option>
                  <option value="lf">LF</option>
                  <option value="crlf">CRLF</option>
                </select>
              </label>
            </div>
            {step < 2 && (
              <button
                className="secondary"
                disabled={disabled || !address.trim() || !validPort}
                onClick={() => act('正在连接', () => findAndConnect(address, false))}
              >
                使用此地址连接
              </button>
            )}
            <p>没有 USB 数据线？连接设备热点后，可以打开设备配网页面。</p>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() =>
                act('打开设备页面', async () => {
                  await api!.setup('portal', { address: address || '192.168.4.1' });
                })
              }
            >
              打开设备配网页面
            </button>
            {step === 2 && <p>{status.detail}</p>}
          </details>
        </section>
      </div>
    </div>
  );
}
