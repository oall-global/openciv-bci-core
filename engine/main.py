"""NeuroLink local engine. NDJSON over private parent-owned stdio; no network server."""

import json
import sys
import time
import threading
import queue
import socket
import ipaddress
import re
import http.client
import xml.etree.ElementTree as ET
from collections import deque
from urllib.parse import urlparse

import numpy as np
from spectral import AlphaStream
import electrodes
from acqclock import AcquisitionClock, SimulatedBacklog, SimulatedStall
from workbench_metrics import TransportStats, emg_rms, FocusEstimator
from rail import check_rails
import wearprobe
import contact
from connection_check import ConnectionCheck, SELECTORS
from connection_setup import (
    usb_inventory,
    probe_shield,
    configure_usb,
    scan_networks,
    shield_info,
)
from connection_setup import battery as read_battery, steady_battery
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from serial.tools import list_ports

# Measure Fp1's impedance automatically until first worn in this app run (wearprobe.py).
# Off: wear is judged from the signal range only; impedance is measured on demand.
AUTO_PROBE = True

BoardShim.disable_board_logger()
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")


_emit_lock = threading.Lock()


def emit(value):
    # One write per line under a lock: background jobs (model training) also emit.
    line = json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n"
    try:
        with _emit_lock:
            sys.stdout.write(line)
            sys.stdout.flush()
    except (BrokenPipeError, OSError):
        raise SystemExit(0)


def identify_shield(response, sender_ip):
    """Read only a same-host SSDP description; never follow arbitrary URLs/redirects."""
    headers = {}
    for line in response.splitlines()[1:]:
        if ":" in line:
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
    if "openbci" in response.lower():
        return "OpenBCI Wi-Fi Shield"
    location = urlparse(headers.get("location", ""))
    if location.scheme != "http" or location.hostname != sender_ip or location.username:
        return None
    conn = None
    try:
        # no is_global check: some routers hand out public ranges (192.158.0.0/22); the
        # description must come from the sender itself, checked above
        if ipaddress.ip_address(sender_ip).is_loopback:
            return None
        conn = http.client.HTTPConnection(sender_ip, location.port or 80, timeout=0.5)
        conn.request("GET", location.path or "/")
        reply = conn.getresponse()
        if reply.status != 200:
            return None
        body = reply.read(16385)
        if len(body) > 16384:
            return None
        root = ET.fromstring(body)
        values = {node.tag.split("}")[-1]: (node.text or "").strip() for node in root.iter()}
        identity = " ".join(
            values.get(k, "") for k in ("friendlyName", "manufacturer", "modelName")
        )
        if "openbci" in identity.lower():
            return values.get("friendlyName", "OpenBCI Wi-Fi Shield")[:80]
    except (OSError, ValueError, ET.ParseError, http.client.HTTPException):
        pass
    finally:
        if conn:
            conn.close()
    return None


def discover(networks=None):
    devices = []
    # the HTTP sweep of the computer's networks runs alongside the SSDP search below
    swept = []
    sweep = threading.Thread(target=lambda: swept.extend(scan_networks(networks)), daemon=True)
    sweep.start()
    for port in list_ports.comports():
        # USB bridge identity does not establish the device's EEG protocol.
        # Include CH340/CP210x and other USB serial bridges without probing them.
        if (
            port.vid is not None
            or "USB" in str(port.hwid).upper()
            or "openbci" in str(port.description).lower()
        ):
            devices.append(
                {
                    "name": "USB 串口候选 · " + port.device,
                    "address": port.device,
                    "transport": "serial",
                    "verified": False,
                    "detail": str(port.description)[:100]
                    + "；请确认是兼容 Cyton 协议的设备或接收器",
                }
            )
    seen = set()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.settimeout(0.3)
        msg = (
            "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n"
            'MAN: "ssdp:discover"\r\nMX: 2\r\n'
            "ST: urn:schemas-upnp-org:device:Basic:1\r\n\r\n"
        )
        try:
            sock.sendto(msg.encode(), ("239.255.255.250", 1900))
            until = time.monotonic() + 3
            while time.monotonic() < until:
                try:
                    raw, addr = sock.recvfrom(8192)
                except socket.timeout:
                    continue
                response = raw.decode("utf-8", errors="replace")
                if addr[0] in seen:
                    continue
                seen.add(addr[0])
                # ESP8266 headers may omit OpenBCI; identity is in description XML.
                name = identify_shield(response, addr[0])
                if not name:
                    continue
                devices.append(
                    {
                        "name": name,
                        "address": addr[0],
                        "transport": "wifi",
                        "verified": True,
                        "detail": "发现设备广播；板型仍需确认",
                    }
                )
        except OSError:
            pass
    sweep.join(5)
    for d in list(swept):
        # the sweep's entry carries the board's own report: it replaces a broadcast one
        devices = [v for v in devices if v["address"] != d["address"]] + [d]
    return devices


def configure_wifi_sampling(address, rate):
    """BrainFlow 5.19 Wi-Fi config_board discards the HTTP response body.

    Use the same Shield endpoint and command, retaining its acknowledgement.
    """
    ipaddress.IPv4Address(address)
    command = {250: "~6", 500: "~5", 1000: "~4"}[rate]
    conn = http.client.HTTPConnection(address, 80, timeout=8)
    try:
        conn.request(
            "POST",
            "/command",
            body=json.dumps({"command": command}),
            headers={"Content-Type": "application/json"},
        )
        reply = conn.getresponse()
        body = reply.read(4097)
        if reply.status != 200 or len(body) > 4096:
            raise ValueError("设备未确认采样率，请检查连接后重试")
        text = body.decode("utf-8", errors="replace")
        match = re.search(r"sample[\s_-]*rate[^\d]*(\d+)\s*Hz", text, re.IGNORECASE)
        if not match or int(match.group(1)) != rate:
            raise ValueError("设备未确认所选采样率，请核对固件和官方 GUI 参数")
    finally:
        conn.close()


class Engine:
    def __init__(self):
        self.board = None
        self.config = None
        self.networks = None  # this computer's IPv4 networks (from Electron), for the sweep
        self.battery = None  # the board's battery over Wi-Fi ({percent, low}), when it reports one
        self.rate = 250
        self.channels = []
        self.timestamp_channel = None
        self.history = deque(maxlen=500)
        self.rail_history = deque([[0.0] * 16 for _ in range(750)], maxlen=750)
        self.alpha = AlphaStream()
        self.focus = FocusEstimator()
        self.focus_value = None
        self.focus_at = 0
        self.last_data = 0
        self.last_timestamp = None
        self.reconnect_at = None
        self.attempts = 0
        self.fault = ""
        self.running = True
        self.epoch = 0
        self.last_package = None
        self.package_channel = None
        self.accel_channels = []
        self.check = ConnectionCheck(self, emit)
        self.recovery_required = False
        self.transport_stats = TransportStats()
        self.emg_value = None
        self.emg_at = 0
        self.emg_timestamp = 0  # wall time of the last EMG update, sent as emgAt
        self.contact = None
        self.contact_at = 0
        self.wear = contact.Wear()
        self.worn_once = False  # the 30 s first confirmation is needed once per app run
        self.probe = wearprobe.WearProbe(self)
        self.demo_rng = np.random.default_rng()
        self.demo_artifacts = None  # {'queue': [(action, start)]}
        self.clock = None  # AcquisitionClock of the current stream segment
        self.sim_backlog = None  # demo only: SimulatedBacklog imitating a Wi-Fi backlog

    def inject_artifacts(self, signals, timestamps):
        """Demo only. The synthetic board's pure sines would hide eye/jaw activity, so the
        eye and jaw channels become noise plus the queued simulated actions."""
        signals = signals.copy()
        n = len(timestamps)
        for name in ("Fp1", "Fp2", "F7", "F8", "T7", "T8"):
            signals[electrodes.ELECTRODES.index(name)] = self.demo_rng.normal(0, 8, n)
        keep = []
        for action, start in self.demo_artifacts["queue"]:
            dt = timestamps - start
            if dt[0] > 1.0:
                continue
            keep.append((action, start))
            if action == "blink":
                bump = 150 * np.exp(-((dt - 0.15) ** 2) / (2 * 0.05**2)) * (dt >= 0)
                for name in ("Fp1", "Fp2"):
                    signals[electrodes.ELECTRODES.index(name)] += bump
            elif action in ("left", "right"):
                step = (1 if action == "left" else -1) * 60 * ((dt >= 0) & (dt < 0.6))
                signals[electrodes.ELECTRODES.index("F7")] += step
                signals[electrodes.ELECTRODES.index("F8")] -= step
            else:
                burst = (dt >= 0) & (dt < 0.6)
                for name, f in (("T7", 35), ("T8", 41)):
                    signals[electrodes.ELECTRODES.index(name)] += burst * (
                        40 * np.sin(2 * np.pi * f * timestamps) + self.demo_rng.normal(0, 25, n)
                    )
        self.demo_artifacts["queue"] = keep
        return signals

    def check_command(self, command, acknowledge=False):
        # Gain changes MUST go through BrainFlow to update its raw-to-uV scaling.
        if not acknowledge or self.config["transport"] != "wifi":
            response = self.board.config_board(command)
            if acknowledge and "success" not in response.lower():
                raise ValueError("设备未确认阻抗测试指令")
            if command.startswith("x") and self.config["transport"] == "wifi":
                conn = http.client.HTTPConnection(self.config["address"], 80, timeout=3)
                try:
                    conn.request("GET", "/board")
                    reply = conn.getresponse()
                    body = reply.read(8193)
                    if reply.status != 200 or len(body) > 8192:
                        raise ValueError("无法核对测试增益")
                    gains = json.loads(body).get("gains", [])
                    channel = SELECTORS.index(command[1])
                    expected = 1 if command[3] == "0" else 24
                    if len(gains) <= channel or gains[channel] != expected:
                        raise ValueError("设备报告的增益与测试设置不一致")
                finally:
                    conn.close()
            return
        conn = http.client.HTTPConnection(self.config["address"], 80, timeout=3)
        try:
            conn.request(
                "POST",
                "/command",
                body=json.dumps({"command": command}),
                headers={"Content-Type": "application/json"},
            )
            reply = conn.getresponse()
            body = reply.read(4097).decode("utf-8", errors="replace")
            if reply.status != 200 or "success" not in body.lower() or "fail" in body.lower():
                raise ValueError("设备未确认阻抗测试指令，请核对固件")
        finally:
            conn.close()

    def state(self, status, detail=""):
        emit(
            {
                "type": "status",
                "status": status,
                "detail": detail,
                "demo": bool(self.config and self.config["transport"] == "demo"),
                "epoch": self.epoch,
            }
        )

    def watch_battery(self, address, epoch):
        # every 30 s while this connection lasts (the board answers /status while streaming)
        while self.epoch == epoch and self.board is not None:
            reading = read_battery(address)
            if self.epoch != epoch:
                return
            self.battery = steady_battery(self.battery, reading)
            for _ in range(30):
                if self.epoch != epoch or self.board is None:
                    return
                time.sleep(1)

    def close_board(self):
        self.battery = None
        if self.check.active or self.check.dirty is not None:
            self.check.finish("cancelled", "连接已结束，检测结果不再有效")
        self.alpha.clear()
        self.focus_value = None
        self.focus_at = 0
        self.rail_history.clear()
        self.probe.active = False  # lead-off is cleared on the next connect
        board, self.board = self.board, None
        if board:
            try:
                board.stop_stream()
            except Exception:
                pass
            try:
                board.release_session()
            except Exception:
                pass

    def connect(self, cfg, retry=False):
        self.close_board()
        self.reconnect_at = None
        transport = cfg.get("transport")
        if transport not in ("demo", "serial", "wifi"):
            raise ValueError("请选择连接方式")
        params = BrainFlowInputParams()
        params.timeout = 8
        requested_rate = int(cfg.get("sampleRate", 250))
        if transport == "demo":
            board_id = BoardIds.SYNTHETIC_BOARD.value
        else:
            if cfg.get("model") != "cyton-daisy":
                raise ValueError("当前版本仅适配 Cyton + Daisy 16 通道")
            address = str(cfg.get("address", "")).strip()
            if transport == "serial":
                if not address.upper().startswith("COM") or not address[3:].isdigit():
                    raise ValueError("请填写接收器端口，例如 COM3")
                params.serial_port = address
                board_id = BoardIds.CYTON_DAISY_BOARD.value
            else:
                if requested_rate not in (250, 500, 1000):
                    raise ValueError("Wi-Fi 采样率请选择 250、500 或 1000 Hz")
                if address:
                    ipaddress.IPv4Address(address)
                if cfg.get("networks") is not None:
                    self.networks = cfg["networks"]
                # the router hands the board a new address now and then: when the saved one
                # doesn't answer, look for the board again (one found → that one)
                if address and shield_info(address, timeout=1.5) is None:
                    found = scan_networks(self.networks)
                    if len(found) == 1:
                        address = found[0]["address"]
                if not address:
                    candidates = [d for d in discover(self.networks) if d["transport"] == "wifi"]
                    if len(candidates) != 1:
                        raise ValueError("请先搜索并选择一台设备，或手动填写设备 IP 地址")
                    address = candidates[0]["address"]
                params.ip_address = address
                params.ip_port = int(cfg.get("localPort", 6677))
                if not 1024 <= params.ip_port <= 65535:
                    raise ValueError("本地端口需在 1024 到 65535 之间")
                board_id = BoardIds.CYTON_DAISY_WIFI_BOARD.value
        self.config = {**cfg, "transport": transport}
        self.epoch += 1
        self.state("connecting", "正在建立连接并等待数据")
        if transport == "demo" and self.fault == "connect":
            raise ValueError("模拟连接失败：请关闭故障模拟后重试")
        board = BoardShim(board_id, params)
        try:
            board.prepare_session()
            if transport == "wifi":
                configure_wifi_sampling(params.ip_address, requested_rate)
                self.config["address"] = params.ip_address
            if transport != "demo":
                # Also clear any lead-off left by an interrupted process/session, and the wear
                # probe's test gain.
                for group in (SELECTORS[:8], SELECTORS[8:]):
                    board.config_board("".join("z" + ch + "00Z" for ch in group))
                board.config_board(wearprobe.RESTORE[1])
            channels = BoardShim.get_eeg_channels(board_id)
            if len(channels) != 16:
                raise ValueError("通道数量与本版的 16 通道配置不一致")
            self.rate = (
                requested_rate if transport == "wifi" else BoardShim.get_sampling_rate(board_id)
            )
            self.channels = channels
            self.timestamp_channel = BoardShim.get_timestamp_channel(board_id)
            self.package_channel = BoardShim.get_package_num_channel(board_id)
            self.last_package = None
            self.transport_stats = TransportStats(2 if transport == "serial" else 1)
            self.clock = None
            self.sim_backlog = None
            self.emg_value = None
            self.emg_at = 0
            self.emg_timestamp = 0
            self.contact = None
            self.contact_at = 0
            self.accel_channels = BoardShim.get_accel_channels(board_id)
            board.start_stream(self.rate * 10)
        except Exception:
            try:
                board.release_session()
            except Exception:
                pass
            raise
        self.board = board
        self.battery = None
        if transport == "wifi":
            threading.Thread(
                target=self.watch_battery, args=(params.ip_address, self.epoch), daemon=True
            ).start()
        self.recovery_required = False
        self.check.dirty = None
        self.check.result = None
        emit({"type": "connection-check", "phase": "idle", "active": False, "epoch": self.epoch})
        self.history = deque(maxlen=self.rate * 2)
        self.rail_history = deque([[0.0] * 16 for _ in range(self.rate * 3)], maxlen=self.rate * 3)
        self.wear = contact.Wear(again=self.worn_once)
        self.probe.reset()
        self.alpha = AlphaStream(self.rate)
        self.last_data = time.monotonic()
        self.received = False
        self.last_timestamp = None
        if not retry:
            self.attempts = 0
        emit(
            {
                "type": "metadata",
                "rate": self.rate,
                "channels": 16,
                "unit": "µV",
                "boardId": board_id,
                "epoch": self.epoch,
                "accelChannels": len(self.accel_channels),
            }
        )

    def disconnect(self):
        self.reconnect_at = None
        self.demo_artifacts = None
        self.close_board()
        self.config = None
        self.fault = ""
        self.state("disconnected", "设备已断开")

    def schedule_retry(self):
        self.close_board()
        self.attempts += 1
        if self.attempts <= 3 and self.config:
            self.reconnect_at = time.monotonic() + 5
            self.state("reconnecting", f"数据中断，5 秒后尝试重连（{self.attempts}/3）")
        else:
            self.reconnect_at = None
            self.state("error", "重连未成功，请检查设备电源和连接后手动重试")

    def tick(self):
        if self.reconnect_at and time.monotonic() >= self.reconnect_at:
            try:
                self.connect(self.config, retry=True)
            except Exception:
                self.schedule_retry()
        if not self.board:
            return
        if self.recovery_required:
            return
        try:
            data = self.board.get_board_data()
            if self.probe.switched:  # the wear probe restarted the stream: a new segment
                self.probe.switched = False
                self.clock = None
            if self.fault == "stream":
                data = data[:, :0]
            if self.check.active:
                self.clock = None  # the check consumes samples; count again afterwards
                try:
                    self.check.tick(data)
                except Exception:
                    self.check.finish("error", "设备未确认检测操作，检测已停止。请核对固件与接线")
                return
            if data.shape[1]:
                signals = data[self.channels, :]
                timestamps = data[self.timestamp_channel]
                if self.demo_artifacts and self.config["transport"] == "demo":
                    signals = self.inject_artifacts(signals, timestamps)
                if self.sim_backlog is not None and self.config["transport"] == "demo":
                    # Demo only: hold data back and stamp it with its (late) release time, the
                    # way a Wi-Fi backlog does. Injections above used the true sample times.
                    data = data.copy()
                    data[self.channels, :] = signals
                    data = self.sim_backlog.push(data, self.timestamp_channel, time.time())
                    if not data.shape[1]:
                        return
                    signals = data[self.channels, :]
                    timestamps = data[self.timestamp_channel]
                # Match GUI Board.accumulatedData: rail sees all raw channel samples,
                # including those before a sequence break. Alpha has separate continuity rules.
                self.rail_history.extend(signals.T.tolist())
                if self.probe.active:
                    self.probe.feed(signals[wearprobe.CHANNEL])
                valid = (
                    signals.shape[0] == 16
                    and np.isfinite(signals).all()
                    and np.isfinite(timestamps).all()
                    and (timestamps > 0).all()
                    and (np.diff(timestamps) > 0).all()
                    and (self.last_timestamp is None or timestamps[0] > self.last_timestamp)
                )
                if not valid:
                    self.alpha.clear()
                    self.received = False
                    self.state("stale", "收到无效数据，正在等待有效信号")
                    # Invalid packets must not reset the valid-data watchdog.
                    if time.monotonic() - self.last_data > 3:
                        self.schedule_retry()
                    return
                self.last_data = time.monotonic()
                self.last_timestamp = float(timestamps[-1])
                # From here on every consumer uses acquisition times, not arrival times.
                received = timestamps
                if self.clock is None:
                    self.clock = AcquisitionClock(
                        self.rate, 2 if self.config["transport"] == "serial" else 1
                    )
                timestamps = self.clock.push(
                    received,
                    data[self.package_channel] if self.package_channel is not None else None,
                )
                if not self.received:
                    self.received = True
                    self.state(
                        "streaming",
                        "正在接收模拟信号"
                        if self.config["transport"] == "demo"
                        else "正在接收真实设备信号",
                    )
                if self.config["transport"] == "wifi" and self.package_channel is not None:
                    ids = data[self.package_channel].astype(int)
                    previous = np.concatenate(
                        (
                            [
                                self.last_package
                                if self.last_package is not None
                                else (ids[0] - 1) % 256
                            ],
                            ids[:-1],
                        )
                    )
                    if np.any((ids - previous) % 256 != 1):
                        # Sequence discontinuity invalidates the spectrum even if TCP arrives in a burst.
                        self.alpha.clear()
                        last_break = int(np.flatnonzero((ids - previous) % 256 != 1)[-1])
                        alpha_signals, alpha_times = (
                            signals[:, last_break + 1 :],
                            timestamps[last_break + 1 :],
                        )
                    else:
                        alpha_signals, alpha_times = signals, timestamps
                    self.last_package = int(ids[-1])
                else:
                    alpha_signals, alpha_times = signals, timestamps
                analysis = (
                    self.alpha.push(
                        alpha_signals,
                        alpha_times,
                        time.monotonic(),
                        check_timing=self.config["transport"] != "wifi",
                    )
                    if len(alpha_times)
                    else None
                )
                if analysis:
                    if time.monotonic() - self.focus_at >= 1:
                        focus_rails = check_rails(
                            np.asarray(self.rail_history).reshape(-1, 16).T, self.rate
                        )
                        channels = [
                            i
                            for i in range(16)
                            if not analysis["flags"][i] and focus_rails["states"][i] == "normal"
                        ]
                        self.focus_value = self.focus.predict(
                            np.asarray(self.alpha.rows).T, self.rate, channels
                        )
                        self.focus_at = time.monotonic()
                    analysis["focus"] = self.focus_value
                    emit({"type": "alpha", "epoch": self.epoch, "at": time.time(), **analysis})
                rail = check_rails(np.asarray(self.rail_history).reshape(-1, 16).T, self.rate)
                self.history.extend(signals.T.tolist())
                hist = np.array(self.history).T
                rms = np.sqrt(np.mean((hist - np.mean(hist, axis=1, keepdims=True)) ** 2, axis=1))
                # Unvalidated contact classification must not look clinically calibrated.
                quality = ["unknown"] * 16
                if self.config["transport"] == "demo":
                    quality = ["good"] * 16
                    if self.fault == "quality":
                        quality[3], quality[11] = "bad", "warn"
                # Electrode contact from the live signal, about once a second.
                if time.monotonic() - self.contact_at >= 1.0:
                    self.contact = contact.assess(hist, self.rate, rail["states"])
                    # Not worn: Fp1's impedance says when the cap is on the head (wearprobe.py).
                    # Only until the cap is first worn in this app run.
                    self.wear.use_probe = AUTO_PROBE and self.probe.usable() and not self.worn_once
                    if self.probe.active and self.probe.measure():
                        self.probe.stop()
                        if not self.probe.active:
                            self.wear.probed()
                    self.contact.update(self.wear.update(self.contact, rail.get("percentages")))
                    contact.unworn(self.contact)
                    self.contact["probe"] = self.probe.report()
                    if (
                        self.wear.use_probe
                        and self.wear.state is not True
                        and not self.wear.probe_ok
                        and not self.probe.active
                    ):
                        self.probe.start()
                    self.worn_once = self.worn_once or self.wear.again
                    if self.worn_once and self.probe.active:
                        self.probe.stop()
                    if self.config["transport"] == "demo":
                        # Scripted states, but the measured quantities are still reported.
                        self.contact = {**self.contact, **contact.demo(quality), "worn": True}
                    self.contact_at = time.monotonic()
                if time.monotonic() - self.emg_at >= 0.25:
                    self.emg_value = emg_rms(hist, self.rate)
                    self.emg_at = time.monotonic()
                    self.emg_timestamp = time.time()
                transport_stats = (
                    self.transport_stats.push(
                        data[self.package_channel].astype(int), time.monotonic()
                    )
                    if self.package_channel is not None
                    else None
                )
                accel = (
                    data[self.accel_channels, :].mean(axis=1).tolist()
                    if len(self.accel_channels) == 3
                    else None
                )
                emit(
                    {
                        "type": "data",
                        "transport": transport_stats,
                        "battery": self.battery,
                        "emg": self.emg_value,
                        "emgAt": self.emg_timestamp,
                        "accel": accel,
                        "epoch": self.epoch,
                        "samples": signals.tolist(),
                        "timestamps": timestamps.tolist(),
                        "received": received.tolist(),
                        "clock": self.clock.status(),
                        "sampleNumbers": data[self.package_channel].astype(int).tolist()
                        if self.package_channel is not None
                        else None,
                        "rms": np.round(rms, 3).tolist(),
                        "quality": quality,
                        "contact": self.contact,
                        "rail": rail,
                        "windowSeconds": round(len(self.history) / self.rate, 2),
                        "at": time.time(),
                    }
                )
            elif time.monotonic() - self.last_data > 3:
                if self.received:
                    self.received = False
                    self.alpha.clear()
                    self.state("stale", "数据暂时延迟，正在等待恢复")
                # TCP may resume after retransmission. Do not tear down a Wi-Fi session at 3 seconds.
                grace = 10 if self.config and self.config["transport"] == "wifi" else 3
                if time.monotonic() - self.last_data > grace:
                    self.schedule_retry()
        except Exception:
            self.schedule_retry()

    def command(self, cmd):
        method = cmd.get("method")
        if method == "setup-usb":
            if self.board is not None:
                raise ValueError("请先断开当前采集，再扫描配置串口")
            return usb_inventory(cmd.get("params", {}).get("ending", "none"))
        if method == "setup-configure":
            if self.board is not None:
                raise ValueError("请先断开当前采集，再配置网络")
            return configure_usb(cmd.get("params", {}))
        if method == "setup-probe":
            if self.board is not None:
                raise ValueError("请先断开当前采集，再检查其他设备")
            return probe_shield(cmd.get("params", {}).get("address", ""))
        if method == "discover":
            networks = cmd.get("params", {}).get("networks")
            if networks is not None:
                self.networks = networks
            return [] if self.fault == "discover" else discover(self.networks)
        if method == "connect":
            self.connect(cmd.get("params", {}))
        elif method == "disconnect":
            self.disconnect()
        elif method == "demo-artifact":
            if not self.config or self.config["transport"] != "demo":
                raise ValueError("模拟动作仅用于演示设备")
            p = cmd.get("params", {})
            if p.get("enabled") is False:
                self.demo_artifacts = None
            else:
                self.demo_artifacts = self.demo_artifacts or {"queue": []}
                action = p.get("action")
                if action is not None:
                    if action not in ("blink", "left", "right", "clench"):
                        raise ValueError("不支持的模拟动作")
                    self.demo_artifacts["queue"].append((action, time.time()))
        elif method == "montage":
            return electrodes.set_montage(cmd.get("params", {}).get("names"))
        elif method == "check-start":
            if self.recovery_required:
                raise ValueError("请关闭设备电源后重新连接")
            self.probe.stop()  # the check sets the channels itself
            self.check.start(cmd.get("params", {}))
        elif method == "check-cancel":
            if self.check.active:
                self.check.finish("cancelled", "检测已取消，未测通道保持待判断")
        elif method == "fault":
            value = cmd.get("params", {}).get("value", "")
            if value not in (
                "",
                "discover",
                "connect",
                "stream",
                "quality",
                "crash",
                "backlog",
                "stall",
            ):
                raise ValueError("不支持的模拟场景")
            if self.config and self.config["transport"] != "demo":
                raise ValueError("故障模拟仅用于演示设备")
            if value == "crash":
                self.running = False
            self.sim_backlog = (
                SimulatedBacklog()
                if value == "backlog"
                else SimulatedStall()
                if value == "stall"
                else None
            )
            self.fault = value
        elif method == "shutdown":
            self.running = False
        else:
            raise ValueError("未知命令")
        return True


def main():
    commands = queue.Queue()

    def reader():
        for line in sys.stdin:
            try:
                commands.put(json.loads(line))
            except ValueError:
                continue
        commands.put({"method": "shutdown"})

    threading.Thread(target=reader, daemon=True).start()
    engine = Engine()
    emit({"type": "ready", "version": "0.7.0"})
    heartbeat = 0
    try:
        while engine.running:
            try:
                cmd = commands.get(timeout=0.04)
                try:
                    result = engine.command(cmd)
                    emit({"type": "response", "id": cmd.get("id"), "result": result})
                except Exception as exc:
                    if cmd.get("method") == "connect":
                        engine.state(
                            "error",
                            "连接未成功，请检查板型、电源、端口或网络；同时关闭占用设备的官方 GUI",
                        )
                    # Only validation text reaches UI; native exception details may contain addresses.
                    message = (
                        str(exc)
                        if isinstance(exc, ValueError)
                        else "设备操作未成功，请检查连接设置和设备状态"
                    )
                    emit({"type": "response", "id": cmd.get("id"), "error": message})
            except queue.Empty:
                pass
            engine.tick()
            if time.monotonic() - heartbeat > 1:
                emit({"type": "heartbeat", "at": time.time()})
                heartbeat = time.monotonic()
    finally:
        engine.close_board()
        engine.focus.close()


if __name__ == "__main__":
    main()
