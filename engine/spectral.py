"""Local descriptive EEG spectrum; no cognitive-state classification."""

from collections import deque
import numpy as np


AMPLITUDE_UV = 100.0  # 1-40 Hz RMS above this is movement or poor contact, not EEG


def spectrum(samples, rate):
    x = np.asarray(samples, dtype=float)
    if x.ndim != 2 or x.shape[1] < rate * 4 or not np.isfinite(x).all():
        raise ValueError("Four seconds of finite channel samples required")
    x = x[:, -rate * 4 :]
    n = rate * 2
    window = np.hanning(n)
    trend = np.arange(n, dtype=float) - (n - 1) / 2
    powers = []
    for start in range(0, x.shape[1] - n + 1, n // 2):
        segment = x[:, start : start + n].copy()
        segment -= segment.mean(axis=1, keepdims=True)
        segment -= (segment @ trend / (trend @ trend))[:, None] * trend
        psd = abs(np.fft.rfft(segment * window, axis=1)) ** 2 / (rate * (window @ window))
        psd[:, 1:-1] *= 2
        powers.append(psd)
    psd = np.mean(powers, axis=0)
    freq = np.fft.rfftfreq(n, 1 / rate)
    band = (freq >= 8) & (freq <= 13)
    total_band = (freq >= 1) & (freq <= 40)
    # Trapezoidal endpoint weights keep adjacent band boundaries from double counting.
    absolute = np.trapezoid(psd[:, band], freq[band], axis=1)
    total = np.trapezoid(psd[:, total_band], freq[total_band], axis=1)
    centered = x - x.mean(axis=1, keepdims=True)
    rms = np.sqrt(np.mean(centered**2, axis=1))
    # "Amplitude" is judged on the 1-40 Hz band (from the detrended spectrum): slow drift of dry
    # electrodes and mains hum used to flag channels whose EEG band was fine.
    band_rms = np.sqrt(np.maximum(total, 0))
    flags = [
        "flat" if r < 0.2 else "amplitude" if b > AMPLITUDE_UV else ""
        for r, b in zip(rms, band_rms)
    ]
    relative = np.divide(100 * absolute, total, out=np.zeros_like(total), where=total > 1e-12)
    return dict(
        absolute=absolute.tolist(),
        relative=relative.tolist(),
        flags=flags,
        frequencies=freq[total_band].tolist(),
        psd=psd[:, total_band].tolist(),
    )


class AlphaStream:
    def __init__(self, rate=250):
        self.rate = rate
        self.rows = deque(maxlen=rate * 4)
        self.last_timestamp = None
        self.last_emit = 0

    def clear(self):
        self.rows.clear()
        self.last_timestamp = None
        self.last_emit = 0

    def push(self, signals, timestamps, now, check_timing=True):
        # A missing interval must not be silently joined into a continuous FFT window.
        gaps = (
            np.flatnonzero(np.diff(timestamps) > max(0.1, 5 / self.rate))
            if check_timing
            else np.array([], dtype=int)
        )
        if gaps.size:
            self.clear()
            signals, timestamps = signals[:, gaps[-1] + 1 :], timestamps[gaps[-1] + 1 :]
        elif (
            check_timing
            and self.last_timestamp is not None
            and timestamps[0] - self.last_timestamp > max(0.1, 5 / self.rate)
        ):
            self.clear()
        self.rows.extend(signals.T.tolist())
        self.last_timestamp = float(timestamps[-1])
        if len(self.rows) < self.rate * 4 or now - self.last_emit < 0.25:
            return None
        self.last_emit = now
        return dict(
            spectrum(np.asarray(self.rows).T, self.rate),
            timestamp=self.last_timestamp,
            windowSeconds=4,
        )
