import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, BookOpen, Info, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AlphaFrame, CheckEvent, Frame, Metadata, Prefs, Status } from './types';
import Workbench from './Workbench';
import ConnectionWizard from './ConnectionWizard';
import DeveloperLab from './DeveloperLab';
import ConnectionCheck from './ConnectionCheck';
import ContactDiagnostics from './ContactDiagnostics';
import Sidebar from './shell/Sidebar';
import TopBar, { ConnectionPill } from './shell/TopBar';
import { recordNow } from './home/BrainRecord';
import { pushAlpha } from './home/brainHistory';
import MontageSettings from './MontageSettings';
import DataPage from './data/DataPage';
import MomentPlayer from './home/MomentPlayer';
import GlossaryPage from './glossary/GlossaryPage';
import { applyTheme, savedTheme, type Theme } from './theme';
import { applyMontage } from './electrodes';
import './shell/shell.css';

const initialPrefs: Prefs = {
  onboarded: false,
  firstWear: true,
  address: '',
  transport: 'wifi',
  model: 'cyton-daisy',
  localPort: 6677,
  sampleRate: 250,
};
const initialStatus: Status = {
  type: 'status',
  status: 'disconnected',
  detail: '连接设备，开始采集',
  demo: false,
};
const development = !!(window as unknown as { neuro?: { development?: boolean } }).neuro
  ?.development;
function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick}>
      <Icon size={17} />
    </button>
  );
}

export default function App() {
  const api = window.neuro;
  const [page, setPageValue] = useState('home'),
    [prefs, setPrefs] = useState(initialPrefs),
    [status, setStatus] = useState(initialStatus),
    [ready, setReady] = useState(false),
    [meta, setMeta] = useState<Metadata | null>(null);
  const [checkResult, setCheckResult] = useState<CheckEvent | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'contact'>('general');
  const setPage = (p: string) => setPageValue(p === 'signals' ? 'home' : p);
  const [version, setVersion] = useState('');
  // Electrode position of each channel (设置 → 电极位置); views remount when it changes.
  const [montage, setMontage] = useState('');
  useEffect(() => {
    api
      ?.montage()
      .then((m) => {
        applyMontage(m.names);
        setMontage(m.names.join(','));
      })
      .catch(() => {});
  }, [api]);
  useEffect(() => {
    api
      ?.version()
      .then(setVersion)
      .catch(() => {});
  }, [api]);
  const [alpha, setAlpha] = useState<AlphaFrame | null>(null);
  const [theme, setTheme] = useState<Theme>(savedTheme());
  const [frame, setFrame] = useState<Frame | null>(null),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState('');
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const [selected, setSelected] = useState(0),
    [enabled, setEnabled] = useState(Array(16).fill(true)),
    [paused, setPaused] = useState(false);
  const [diag, setDiag] = useState<string | null>(null),
    [clearConfirm, setClearConfirm] = useState(false);
  const [lastAge, setLastAge] = useState(Infinity);
  const buffer = useRef<number[][]>(Array.from({ length: 16 }, () => []));
  const waveClock = useRef({ epoch: -1, count: 0 });
  const rate = useRef(250),
    lastFrame = useRef(0),
    alphaLatest = useRef<AlphaFrame | null>(null),
    alphaTimer = useRef(0),
    lastData = useRef(0),
    epoch = useRef(-1),
    statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    if (diag === null && !clearConfirm) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,[tabindex="0"]',
        ) || [],
      );
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDiag(null);
        setClearConfirm(false);
      }
      if (event.key === 'Tab') {
        const items = focusables(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [diag, clearConfirm]);
  useEffect(() => {
    if (!api) return;
    const unsub = api.subscribe((event) => {
      if (event.type === 'connection-check') setCheckResult(event);
      if (event.type === 'ready') setReady(true);
      if (event.type === 'alpha' && event.epoch === epoch.current) {
        // a Wi-Fi burst brings several at once: the screen takes the latest, at most every
        // 150 ms (each one re-rendered the whole window); the history below keeps them all
        alphaLatest.current = event;
        if (!alphaTimer.current)
          alphaTimer.current = window.setTimeout(() => {
            alphaTimer.current = 0;
            if (alphaLatest.current) setAlpha(alphaLatest.current);
          }, 150);
        // band history and baseline for 主图, collected whatever page is open
        pushAlpha(event, frameRef.current, statusRef.current.demo);
      }
      if (event.type === 'status') {
        setStatus(event);
        if (event.status !== 'streaming') {
          alphaLatest.current = null;
          setAlpha(null);
        }
        if (event.status === 'checking') {
          waveClock.current = { epoch: waveClock.current.epoch + 1, count: 0 };
          setFrame(null);
          buffer.current = Array.from({ length: 16 }, () => []);
        }
        if (['disconnected', 'engine-error', 'reconnecting', 'stale'].includes(event.status))
          setCheckResult(null);
        if (event.status === 'engine-error') {
          setReady(false);
          setFrame(null);
        }
        if (event.status === 'disconnected') {
          setFrame(null);
          lastData.current = 0;
        }
      }
      if (event.type === 'metadata') {
        alphaLatest.current = null;
        setAlpha(null);
        setMeta(event);
        rate.current = event.rate;
        epoch.current = event.epoch;
        waveClock.current = { epoch: event.epoch, count: 0 };
        buffer.current = Array.from({ length: 16 }, () => []);
        setFrame(null);
        setPaused(false);
        lastData.current = 0;
      }
      if (event.type === 'data' && event.epoch === epoch.current) {
        lastData.current = Date.now();
        event.samples.forEach((samples, i) => {
          buffer.current[i].push(...samples);
          if (buffer.current[i].length > rate.current * 9)
            buffer.current[i].splice(0, buffer.current[i].length - rate.current * 9);
        });
        waveClock.current.count += event.samples[0]?.length ?? 0;
        if (Date.now() - lastFrame.current > 150) {
          setFrame(event);
          lastFrame.current = Date.now();
        }
      }
    });
    api
      .preferences()
      .then((p) => {
        setPrefs(p);
        // until a device has been connected once, the app opens on 设备
        if (!p.onboarded) setPageValue('devices');
      })
      .catch(() => setNotice('设置读取失败，已使用默认值'))
      .finally(() => setPrefsLoaded(true));
    api
      .snapshot()
      .then((s) => {
        setStatus(s.status);
        setReady(s.ready);
        setCheckResult(s.connectionCheck || null);
        if (s.metadata) {
          setMeta(s.metadata);
          rate.current = s.metadata.rate;
          epoch.current = s.metadata.epoch;
        }
      })
      .catch(() => setNotice('无法读取引擎状态'));
    const timer = setInterval(
      () => setLastAge(lastData.current ? Date.now() - lastData.current : Infinity),
      500,
    );
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [api]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const streaming = status.status === 'streaming' && lastAge < 3500;
  // until a device has been connected once (the wizard saves onboarded), the app stays on 设备
  // whenever no device is streaming, as the full app's first run does
  useEffect(() => {
    if (prefsLoaded && !prefs.onboarded && !streaming) setPageValue('devices');
  }, [prefsLoaded, prefs.onboarded, streaming]);
  // 概念手册: opened from the menu, or from a 「?」 popup at one entry
  const [glossaryFocus, setGlossaryFocus] = useState<string | null>(null);
  // 片段播放 of a recording: 录制脑电 (moment) or a session
  const [playing, setPlaying] = useState<{
    kind: 'moment' | 'session';
    id: string;
    title?: string;
  } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setPlaying({ kind: 'moment', id: (e as CustomEvent<string>).detail });
    window.addEventListener('brainlab:replay-moment', on);
    return () => window.removeEventListener('brainlab:replay-moment', on);
  }, []);
  useEffect(() => {
    const on = (e: Event) => {
      setGlossaryFocus((e as CustomEvent<string | null>).detail);
      setPage('glossary');
    };
    window.addEventListener('brainlab:glossary', on);
    return () => window.removeEventListener('brainlab:glossary', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const connecting = ['connecting', 'reconnecting', 'checking'].includes(status.status);
  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    try {
      await action();
    } catch (e) {
      setNotice(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          '',
        ),
      );
    } finally {
      setBusy('');
    }
  }
  async function savePrefs(patch: Partial<Prefs>) {
    const value = { ...prefs, ...patch };
    setPrefs(value);
    if (api) await api.preferences(patch);
  }
  const pill = (
    <ConnectionPill
      status={status}
      streaming={streaming}
      ready={ready}
      frame={frame}
      transport={prefs.transport}
      onClick={() => setPage('devices')}
    />
  );

  return (
    <div className="shell app2" key={montage}>
      <Sidebar page={page} onHome={() => setPage('home')} onTool={setPage} />
      {playing && (
        <MomentPlayer
          id={playing.id}
          kind={playing.kind}
          title={playing.title}
          onClose={() => setPlaying(null)}
        />
      )}
      <main>
        <TopBar api={api} left={pill} pill={null} />
        {!api && <div className="alert">请使用桌面应用打开。浏览器预览不连接真实设备。</div>}
        {['error', 'engine-error', 'stale', 'reconnecting'].includes(status.status) && (
          <div className="alert">
            <Info size={17} />
            <span>{status.detail}</span>
            {status.status === 'engine-error' && (
              <button onClick={() => run('restart', () => api!.command('restart'))}>
                重启引擎
              </button>
            )}
          </div>
        )}
        <div className={`content ${page === 'home' ? 'content-home' : ''} page-${page}`}>
          <div hidden={page !== 'devices'}>
            <ConnectionWizard
              api={api}
              ready={ready}
              visible={page === 'devices'}
              status={status}
              frame={frame}
              meta={meta}
              prefs={prefs}
              onSave={savePrefs}
              navigate={setPage}
              onNotice={setNotice}
            />
          </div>
          {page === 'home' && (
            <Workbench
              checkResult={checkResult}
              onCheck={(channel) =>
                api!.command('check-start', {
                  channel,
                  electrode: 'passive-dry',
                  wiring: 'N-SRB2-BIAS',
                })
              }
              onCancel={() => api!.command('check-cancel')}
              buffer={buffer}
              clock={waveClock}
              frame={frame}
              alpha={alpha}
              meta={meta}
              active={streaming}
              demo={status.demo}
              busy={!!busy || connecting}
              paused={paused}
              setPaused={setPaused}
              selected={selected}
              select={setSelected}
              enabled={enabled}
              setEnabled={setEnabled}
              navigate={setPage}
              link={{
                transport: prefs.transport,
                mode: prefs.connectionMode,
                address: prefs.address,
              }}
            />
          )}
          {page === 'developer' && <DeveloperLab alpha={alpha} frame={frame} />}
          {page === 'glossary' && <GlossaryPage focus={glossaryFocus} />}
          {(page === 'data' || page === 'moments') && api && (
            <DataPage
              api={api}
              onReplay={(kind, id, title) => setPlaying({ kind, id, title })}
              onAdd={() => {
                // recording needs a device sending; without one, connect first
                if (!streaming) return setPage('devices');
                setPage('home');
                recordNow();
              }}
            />
          )}
          {page === 'settings' && (
            <>
              <div className="page-heading">
                <h1>设置</h1>
              </div>
              {/* 接触诊断: a tab here, development builds only */}
              {development && (
                <div className="app-tabs" role="tablist" aria-label="设置">
                  {(
                    [
                      ['general', '通用'],
                      ['contact', '接触诊断'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={settingsTab === id}
                      className={settingsTab === id ? 'selected' : ''}
                      onClick={() => setSettingsTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {settingsTab === 'contact' && (
                <>
                  <ConnectionCheck
                    result={checkResult}
                    connected={streaming}
                    demo={status.demo}
                    selected={selected}
                    onSelect={setSelected}
                    onStart={() =>
                      api!.command('check-start', {
                        electrode: 'passive-dry',
                        wiring: 'N-SRB2-BIAS',
                      })
                    }
                    onCancel={() => api!.command('check-cancel')}
                  />
                  <ContactDiagnostics frame={frame} />
                </>
              )}
              {settingsTab === 'general' && (
                <div className="settings-grid">
                  <section className="card settings-card">
                    <h2>外观</h2>
                    <div className="theme-seg" role="radiogroup" aria-label="外观">
                      {(
                        [
                          ['dark', '深色'],
                          ['light', '浅色'],
                          ['system', '跟随系统'],
                        ] as [Theme, string][]
                      ).map(([t, label]) => (
                        <button
                          key={t}
                          role="radio"
                          aria-checked={theme === t}
                          className={theme === t ? 'on' : ''}
                          onClick={() => {
                            applyTheme(t);
                            setTheme(t);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="card settings-card">
                    <h2>隐私与本地数据</h2>
                    <div className="privacy-line">
                      <ShieldCheck />
                      <div>
                        <b>你的信号留在你的电脑</b>
                        <p>
                          你录制的原始脑电保存在这台电脑上，可在「脑电数据库」中删除；不上传。
                          <br />
                          另外保存连接偏好和电极位置。
                        </p>
                      </div>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        run('diag', async () =>
                          setDiag(JSON.stringify(await api?.diagnostics(), null, 2)),
                        )
                      }
                    >
                      <BookOpen size={16} />
                      预览诊断信息
                    </button>
                    <button className="text-button danger" onClick={() => setClearConfirm(true)}>
                      清除本地设置与日志
                    </button>
                    <hr />
                    <h2>关于 开源文明 BCI-001</h2>
                    <p>
                      版本 {version || '—'} ·{' '}
                      {window.neuro?.platform === 'darwin' ? 'macOS' : 'Windows'} 预览版
                      <br />
                      Electron · React · Python · BrainFlow
                      <br />
                      电池电量：当前适配暂不支持
                    </p>
                    <p className="micro">
                      头部模型：Infinite · Lee Perry-Smith
                      <br />
                      来源：Three.js / triplegangers.com · CC BY 3.0
                      <br />
                      已调整比例、材质并叠加示例电极。
                    </p>
                    <p className="micro">
                      大脑模型：Anderson Winkler / Brainder.org
                      <br />
                      GLB：mpatricny / brain-for-web · CC BY-SA 3.0
                      <br />
                      显示调整：镜像、方向、材质与信号动画；模型及其修改沿用同一许可。
                    </p>
                  </section>
                  <section className="card settings-card">
                    <h2>连接偏好</h2>
                    <ConnectionForm prefs={prefs} setPrefs={setPrefs} />
                    <button
                      className="primary"
                      onClick={() =>
                        run('save', async () => {
                          await savePrefs(prefs);
                          setNotice('连接偏好已保存在本机');
                        })
                      }
                    >
                      保存设置
                    </button>
                  </section>
                  {api && (
                    <MontageSettings
                      api={api}
                      onChange={(names) => {
                        applyMontage(names);
                        setMontage(names.join(','));
                        setNotice('电极位置已保存，之后的记录和分析按新的对应关系进行');
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Info size={17} />
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-chip" role="status">
          <LoaderCircle size={14} className="spin" />
          正在处理…
        </div>
      )}
      {diag !== null && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="diag-title">
            <div className="section-title">
              <h2 id="diag-title">诊断信息预览</h2>
              <IconButton icon={X} label="关闭诊断" onClick={() => setDiag(null)} />
            </div>
            <p>仅包含应用版本、引擎状态和事件记录，不包含原始脑电、IP 或串口地址。</p>
            <pre>{diag}</pre>
            <button
              className="primary"
              onClick={() =>
                run('export', async () => {
                  if (await api?.exportDiagnostics()) setNotice('诊断信息已导出');
                })
              }
            >
              <ArrowDownToLine size={16} />
              导出到文件
            </button>
          </section>
        </div>
      )}
      {clearConfirm && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <h2 id="clear-title">清除本地数据？</h2>
            <p>删除连接偏好、引导状态和本次诊断日志。正在运行的采集不会中断。</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setClearConfirm(false)}>
                取消
              </button>
              <button
                className="primary"
                onClick={() =>
                  run('clear', async () => {
                    if (api) setPrefs(await api.clearData());
                    setClearConfirm(false);
                    setNotice('本地设置与日志已清除');
                  })
                }
              >
                确认清除
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ConnectionForm({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  return (
    <div className="connection-form">
      <label>
        设备板型
        <select value={prefs.model} onChange={(e) => setPrefs({ ...prefs, model: e.target.value })}>
          <option value="cyton-daisy">Cyton + Daisy · 16 通道</option>
        </select>
      </label>
      <label>
        连接方式
        <select
          value={prefs.transport}
          onChange={(e) =>
            setPrefs({ ...prefs, transport: e.target.value as 'wifi' | 'serial', address: '' })
          }
        >
          <option value="wifi">Wi-Fi Shield</option>
          <option value="serial">USB 串口</option>
        </select>
      </label>
      <label>
        {prefs.transport === 'wifi' ? '设备 IP 地址（可留空自动发现）' : 'USB 串口端口'}
        <input
          value={prefs.address}
          placeholder={prefs.transport === 'wifi' ? '例如 192.168.4.1' : '例如 COM3'}
          onChange={(e) => setPrefs({ ...prefs, address: e.target.value })}
        />
      </label>
      {prefs.transport === 'wifi' && (
        <label>
          本地接收端口
          <input
            type="number"
            min={1024}
            max={65535}
            value={prefs.localPort}
            onChange={(e) => setPrefs({ ...prefs, localPort: Number(e.target.value) })}
          />
        </label>
      )}
      {prefs.transport === 'wifi' && (
        <label>
          采样率（与官方 GUI 一致）
          <select
            value={prefs.sampleRate}
            onChange={(e) => setPrefs({ ...prefs, sampleRate: Number(e.target.value) })}
          >
            <option value={250}>250 Hz</option>
            <option value={500}>500 Hz</option>
            <option value={1000}>1000 Hz</option>
          </select>
        </label>
      )}
    </div>
  );
}
