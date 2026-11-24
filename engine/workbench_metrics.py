"""Descriptive transport and high-frequency amplitude; never intent classification."""

import numpy as np


# Link quality over the last QUALITY_SECONDS: lost packages, the longest pause between data
# batches, and counter jumps too large to count. One indicator for the Wi-Fi signal; the
# cumulative arrival delay is not shown (it only grows with a backlog and says little).
QUALITY_SECONDS = 10.0
# good: < 1 % lost, no pause over 0.5 s, no counter jump; fair: < 5 % lost, no pause over 1.5 s
QUALITY_LIMITS = {"good": (1.0, 500), "fair": (5.0, 1500)}


def link_quality(window):
    """window: [(time, received, lost, breaks, gap_ms)] of the recent batches."""
    if not window:
        return None
    received = sum(w[1] for w in window)
    lost = sum(w[2] for w in window)
    breaks = sum(w[3] for w in window)
    gap = max((w[4] or 0) for w in window)
    loss = 100 * lost / max(1, received + lost)
    if loss < QUALITY_LIMITS["good"][0] and gap <= QUALITY_LIMITS["good"][1] and not breaks:
        level, bars = "good", 3
    elif loss < QUALITY_LIMITS["fair"][0] and gap <= QUALITY_LIMITS["fair"][1] and breaks <= 1:
        level, bars = "fair", 2
    else:
        level, bars = "poor", 1
    return dict(
        level=level,
        bars=bars,
        lossPercent=round(loss, 2),
        longestGapMs=round(gap),
        breaks=breaks,
        seconds=QUALITY_SECONDS,
    )


class TransportStats:
    def __init__(self, step=1):
        self.step = step
        self.last = None
        self.received = 0
        self.lost = 0
        self.duplicates = 0
        self.breaks = 0
        self.started = None
        self.last_at = None
        self.window = []

    def push(self, ids, now):
        if self.started is None:
            self.started = now
        interval = None if self.last_at is None else (now - self.last_at) * 1000
        lost_before, breaks_before = self.lost, self.breaks
        for item in ids:
            current = int(item)
            if self.last is not None:
                delta = (current - self.last) % 256
                if delta == 0:
                    self.duplicates += 1
                elif delta != self.step:
                    if (
                        delta % self.step == 0
                        and delta <= 128
                        and (interval is None or interval < 1000)
                    ):
                        self.lost += delta // self.step - 1
                    else:
                        self.breaks += 1
            self.last = current
        self.received += len(ids)
        self.last_at = now
        self.window.append(
            (now, len(ids), self.lost - lost_before, self.breaks - breaks_before, interval)
        )
        self.window = [w for w in self.window if now - w[0] <= QUALITY_SECONDS]
        return dict(
            quality=link_quality(self.window),
            received=self.received,
            estimatedLost=self.lost,
            duplicates=self.duplicates,
            ambiguous=self.breaks,
            lossPercent=100 * self.lost / max(1, self.received + self.lost),
            batchMs=interval,
            elapsed=now - self.started,
        )


def emg_rms(samples, rate):
    """One-second Hann-window 20–min(90, 0.4*fs) Hz power, excluding 50/60 Hz ±2 Hz."""
    x = np.asarray(samples, dtype=float)
    if x.shape[1] < rate or not np.isfinite(x).all():
        return None
    x = x[:, -rate:]
    x = x - x.mean(axis=1, keepdims=True)
    w = np.hanning(rate)
    f = np.fft.rfftfreq(rate, 1 / rate)
    power = abs(np.fft.rfft(x * w, axis=1)) ** 2 / (rate * np.sum(w * w))
    power[:, 1:-1] *= 2
    mask = (f >= 20) & (f <= min(90, rate * 0.4)) & (abs(f - 50) > 2) & (abs(f - 60) > 2)
    return np.sqrt(np.sum(power[:, mask], axis=1) * (f[1] - f[0])).tolist()


from brainflow.data_filter import DataFilter
from brainflow.ml_model import MLModel, BrainFlowModelParams, BrainFlowMetrics, BrainFlowClassifiers


class FocusEstimator:
    def __init__(self):
        self.models = []
        self.error = False
        try:
            for metric in (BrainFlowMetrics.MINDFULNESS, BrainFlowMetrics.RESTFULNESS):
                model = MLModel(
                    BrainFlowModelParams(
                        metric.value, BrainFlowClassifiers.DEFAULT_CLASSIFIER.value
                    )
                )
                model.prepare()
                self.models.append(model)
        except Exception:
            self.error = True

    def predict(self, samples, rate, channels):
        if self.error or not channels:
            return None
        try:
            powers, _ = DataFilter.get_avg_band_powers(
                np.ascontiguousarray(samples, dtype=float), channels, rate, True
            )
            values = [float(model.predict(powers)[0]) for model in self.models]
            if not all(np.isfinite(v) and 0 <= v <= 1 for v in values):
                return None
            return dict(
                mindfulness=values[0],
                restfulness=values[1],
                channels=channels,
                bands=powers.tolist(),
                model="BrainFlow default classifier",
            )
        except Exception:
            return None

    def close(self):
        for model in self.models:
            try:
                model.release()
            except Exception:
                pass
        self.models = []
