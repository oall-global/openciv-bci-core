"""Sequential Cyton dry-electrode check. No test samples leave this module.

Commands, 6 nA / 2.2 kohm conversion and default filter settings are adapted
from OpenBCI GUI (MIT; public/licenses/OpenBCI-GUI-MIT.txt).
"""

import time
from collections import deque
import numpy as np
from brainflow.data_filter import DataFilter, FilterTypes, NoiseTypes
from rail import check_rails

SELECTORS = "12345678QWERTYUI"


def contact_result(samples, rate):
    x = np.asarray(samples, dtype=float)
    if len(x) < rate * 3 or not np.isfinite(x).all():
        return dict(kohm=None, quality="unknown", reason="有效测试数据不足")
    if np.max(abs(x)) > 4.5e6 * 0.9:
        return dict(kohm=None, quality="bad", reason="测试信号饱和，检查电极与参考接线")
    y = x.copy()
    DataFilter.perform_bandpass(y, rate, 5.0, 50.0, 4, FilterTypes.BUTTERWORTH.value, 1.0)
    for noise in (NoiseTypes.FIFTY, NoiseTypes.SIXTY):
        DataFilter.remove_environmental_noise(y, rate, noise.value)
    # GUI uses the final second of filtered signal and rms-to-peak conversion.
    kohm = max(0.0, np.sqrt(2.0) * np.std(y[-rate:]) * 1e-6 / 6e-9 - 2200.0) / 1000.0
    # A flat line / unconfirmed injected tone must never pass as low impedance.
    z = x[-rate * 2 :] - np.mean(x[-rate * 2 :])
    p = abs(np.fft.rfft(z * np.hanning(len(z)))) ** 2
    f = np.fft.rfftfreq(len(z), 1 / rate)
    ratio = float(p[(f >= 29) & (f <= 34)].sum() / max(p[(f >= 5) & (f <= 50)].sum(), 1e-12))
    if kohm <= 0 or np.std(z) < 0.2 or ratio < 0.5:
        return dict(
            kohm=round(kohm, 1), quality="unknown", reason="未识别到可靠测试响应，请检查接线或固件"
        )
    quality = "good" if kohm < 750 else "warn" if kohm <= 2500 else "bad"
    return dict(
        kohm=round(kohm, 1),
        quality=quality,
        reason={
            "good": "阻抗在默认范围内",
            "warn": "接触偏弱，建议调整",
            "bad": "阻抗偏高，请检查接触",
        }[quality],
    )


def signal_results(rows, rate):
    x = np.asarray(rows).T
    # Inspect every second, so a bad interval near the beginning is not hidden
    # by the final 3-second Railed window.
    rail_windows = [
        check_rails(x[:, start : start + rate], rate)["states"]
        for start in range(0, x.shape[1] - rate + 1, rate)
    ]
    centered = x - x.mean(axis=1, keepdims=True)
    p = abs(np.fft.rfft(centered * np.hanning(x.shape[1]), axis=1)) ** 2
    f = np.fft.rfftfreq(x.shape[1], 1 / rate)
    total = p[:, (f >= 1) & (f <= min(65, rate / 2))].sum(axis=1)
    mains = p[:, ((f >= 49) & (f <= 51)) | ((f >= 59) & (f <= 61))].sum(axis=1)
    ratios = np.divide(mains, total, out=np.zeros(16), where=total > 1e-12)
    jumps = np.max(abs(np.diff(x, axis=1)), axis=1)
    results = []
    for i in range(16):
        reasons = []
        states = [window[i] for window in rail_windows]
        if any(state != "normal" for state in states):
            reasons.append("饱和、接近饱和或信号不变")
        if np.std(centered[i]) < 0.2:
            reasons.append("信号近乎不变")
        if ratios[i] > 0.5:
            reasons.append("工频干扰较强")
        if jumps[i] > 500:
            reasons.append("波形突跳较多")
        results.append(
            dict(
                quality="bad"
                if any(state in ("railed", "flat") for state in states)
                else "warn"
                if reasons
                else "good",
                reason="；".join(reasons) or "观察窗口内未发现明显异常",
                mainsPercent=round(float(ratios[i] * 100), 1),
            )
        )
    return results


class ConnectionCheck:
    def __init__(self, engine, emit):
        self.e, self.emit = engine, emit
        self.active = False
        self.dirty = None
        self.result = None

    def publish(self, detail):
        self.result.update(detail=detail, at=time.time(), active=self.active)
        self.emit(dict(self.result))

    def start(self, params):
        if self.active:
            raise ValueError("连接检测正在进行")
        if not self.e.board or not self.e.received or time.monotonic() - self.e.last_data > 3:
            raise ValueError("请先连接设备并等待有效信号")
        if params.get("electrode") != "passive-dry" or params.get("wiring") != "N-SRB2-BIAS":
            raise ValueError("请确认被动干电极及 N / SRB2 / BIAS 接线")
        target = params.get("channel")
        if target is not None and (type(target) is not int or not 0 <= target < 16):
            raise ValueError("单电极检测通道必须在 0–15 之间")
        self.single_target = target
        self.active = True
        self.demo = self.e.config["transport"] == "demo"
        self.result = dict(
            type="connection-check",
            epoch=self.e.epoch,
            phase="connection",
            active=True,
            demo=self.demo,
            channel=-1,
            contacts=[None] * 16,
            signals=[None] * 16,
            connection="unknown",
            overall="unknown",
        )
        self.result.update(scope="single" if target is not None else "all", targetChannel=target)
        self.e.alpha.clear()
        self.e.state("checking", "连接检测中，Alpha 分析已暂停")
        self.reset_window()
        self.publish("保持静止，先观察 5 秒数据连续性")
        if target is not None:
            self.result["channel"] = target - 1
            try:
                self.next_channel()
            except Exception:
                self.finish("error", "无法启动单电极检测，请检查设备后重试")

    def reset_window(self):
        self.started = self.last_arrival = time.monotonic()
        self.rows = deque(maxlen=self.e.rate * 12)
        self.count = 0
        self.previous = None
        self.previous_timestamp = None
        self.gaps = 0
        self.max_gap = 0.0

    def restore(self):
        if self.dirty is None:
            return
        ch = self.dirty
        try:
            self.e.board.stop_stream()
        except Exception:
            pass  # Already stopped after a partially failed switch: still disable injection.
        # Turn injection OFF before restoring gain. Keep dirty set on any failure.
        self.e.check_command("z" + SELECTORS[ch] + "00Z", acknowledge=True)
        self.e.check_command("x" + SELECTORS[ch] + "060110X")
        self.e.board.get_board_data()
        self.e.board.start_stream(self.e.rate * 10)
        self.dirty = None

    def next_channel(self):
        self.restore()
        if (
            self.single_target is not None
            and self.result["contacts"][self.single_target] is not None
        ):
            self.result["overall"] = self.result["contacts"][self.single_target]["quality"]
            self.finish(
                "complete", f"CH {self.single_target + 1} 接触检测完成；其他通道与整体信号未检测"
            )
            return
        ch = self.result["channel"] + 1
        if ch == 16:
            self.result["phase"] = "signal"
            self.reset_window()
            self.publish("已恢复采集设置，等待 3 秒稳定后观察 10 秒信号")
            return
        self.result.update(phase="impedance", channel=ch)
        if not self.demo:
            self.e.board.stop_stream()
            self.dirty = ch  # Set BEFORE hardware mutation, including partial failures.
            self.e.check_command("x" + SELECTORS[ch] + "000100X")
            self.e.check_command("z" + SELECTORS[ch] + "01Z", acknowledge=True)
            self.e.board.get_board_data()
            self.e.board.start_stream(self.e.rate * 10)
        self.reset_window()
        self.publish(f"正在检测 CH {ch + 1:02d} / 16 的电极接触，请保持静止")

    def finish(self, phase, detail):
        try:
            self.restore()
            self.e.board.get_board_data()  # Discard queued test samples before normal processing.
        except Exception:
            self.active = False
            self.result.update(phase="error", overall="unknown")
            self.publish("恢复采集设置未确认。请关闭设备电源后重新连接，再开始采集")
            self.e.recovery_required = True
            self.e.state("error", self.result["detail"])
            return
        self.active = False
        self.result["phase"] = phase
        if phase != "complete":
            self.result["overall"] = "unknown"
        self.publish(detail)
        self.e.alpha.clear()
        self.e.history.clear()
        self.e.rail_history.clear()
        self.e.last_timestamp = self.e.last_package = None
        self.e.last_data = time.monotonic()
        self.e.received = False
        self.e.state("connecting", "检测结束，正在恢复正常脑电采集")

    def tick(self, data):
        now = time.monotonic()
        if now - self.last_arrival > 5:
            self.finish("error", "检测期间数据中断，本次结果不完整。检查网络后重新检测")
            return
        if not data.shape[1]:
            return
        x = data[self.e.channels]
        ts = data[self.e.timestamp_channel]
        if (
            not np.isfinite(x).all()
            or not np.isfinite(ts).all()
            or np.any(ts <= 0)
            or np.any(np.diff(ts) <= 0)
            or (self.previous_timestamp is not None and ts[0] <= self.previous_timestamp)
        ):
            self.finish("error", "收到无效数据，本次检测已停止")
            return
        self.previous_timestamp = ts[-1]
        self.max_gap = max(self.max_gap, now - self.last_arrival)
        self.last_arrival = now
        if not self.demo and self.e.package_channel is not None:
            ids = data[self.e.package_channel].astype(int)
            before = np.r_[
                self.previous if self.previous is not None else (ids[0] - self.step()) % 256,
                ids[:-1],
            ]
            self.gaps += int(np.count_nonzero((ids - before) % 256 != self.step()))
            self.previous = ids[-1]
        self.rows.extend(x.T.tolist())
        self.count += x.shape[1]
        elapsed = now - self.started
        phase = self.result["phase"]
        if phase == "connection" and elapsed >= 5:
            observed = self.count / elapsed
            passed = (
                self.gaps == 0
                and self.max_gap < 1
                and 0.85 * self.e.rate <= observed <= 1.15 * self.e.rate
            )
            self.result.update(
                connection="good" if passed else "warn",
                observedRate=round(observed, 1),
                discontinuities=self.gaps,
            )
            self.next_channel()
        elif phase == "impedance" and elapsed >= 4 and self.count >= 4 * self.e.rate:
            ch = self.result["channel"]
            if self.demo:
                value = [180.0, 280.0, 360.0, 1050.0, 2900.0][ch % 5]
                result = dict(
                    kohm=value,
                    quality="good" if value < 750 else "warn" if value <= 2500 else "bad",
                    reason="模拟接触结果",
                )
            elif self.gaps or self.max_gap >= 1:
                result = dict(kohm=None, quality="unknown", reason="测试期间数据不连续，请重测")
            else:
                result = contact_result(np.asarray(self.rows)[-self.e.rate * 3 :, ch], self.e.rate)
            self.result["contacts"][ch] = result
            self.next_channel()
        elif phase == "signal" and elapsed >= 13 and self.count >= 13 * self.e.rate:
            self.result["signals"] = signal_results(
                list(self.rows)[-self.e.rate * 10 :], self.e.rate
            )
            qualities = [r["quality"] for r in self.result["contacts"] + self.result["signals"]]
            qualities += [
                self.result["connection"],
                "warn" if self.gaps or self.max_gap >= 1 else "good",
            ]
            self.result["overall"] = (
                "bad"
                if "bad" in qualities
                else "unknown"
                if "unknown" in qualities
                else "warn"
                if "warn" in qualities
                else "good"
            )
            self.finish("complete", "检测完成。调整电极或重新佩戴后，请重新检测")
        elif elapsed > (20 if phase == "signal" else 12):
            self.finish("error", "有效样本不足，无法完成检测。请检查采样率或网络")

    def step(self):
        return 2 if self.e.config["transport"] == "serial" else 1
