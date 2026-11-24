"""Electrode contact from the live signal (no current injected): 正常 / 接触差 / 未接触.

An electrode that does not touch the skin has a floating input. It saturates or drifts, picks
up far more mains hum (50 / 60 Hz) than a worn one, and its 1–40 Hz band is either huge
(drift, movement) or dominated by hum. From the last 2 s of each channel:

  band   RMS of 1–40 Hz (µV), from the Hann-windowed spectrum of the detrended signal
  mains  RMS of 48–52 + 58–62 Hz (µV)
  share  mains power / (band + mains power)

The state follows the saturation check only, as OpenBCI GUI does (rail.py, ported from the
GUI's DataStatus: peak of the last 3 s as a share of the amplifier's full scale):

  off  (未接触)  railed (> 90 % of full scale) or flat (the signal does not change)
  poor (接触差)  near railed (> 75 %)
  ok   (正常)    otherwise

band, mains and share are still computed and reported (tooltips, 佩戴对照录制) but do not
decide the state.

If most channels are off at once, the reference (SRB2) or BIAS electrode is the likely cause:
without it every channel floats.

This is not impedance measurement; the on-demand impedance check is connection_check.py.
"""

import numpy as np

THRESHOLDS = {
    "OFF_MAINS": 150.0,  # µV
    "OFF_BAND": 400.0,  # µV
    "POOR_BAND": 100.0,  # µV
    "POOR_SHARE": 0.8,
    "REFERENCE_OFF": 12,  # channels off at once
}
TEXT = {"ok": "正常", "poor": "接触差", "off": "未接触", "unknown": "无信号"}


def features(x, rate):
    """Per-channel band RMS, mains RMS and mains share for a (channels × samples) window."""
    x = np.asarray(x, dtype=float)
    n = x.shape[1]
    t = np.arange(n)
    # Remove offset and linear drift: the device carries ~10^4 µV DC, floating inputs drift.
    slope = ((x - x.mean(axis=1, keepdims=True)) @ (t - t.mean())) / np.sum((t - t.mean()) ** 2)
    x = x - x.mean(axis=1, keepdims=True) - np.outer(slope, t - t.mean())
    w = np.hanning(n)
    psd = 2 * np.abs(np.fft.rfft(x * w, axis=1)) ** 2 / (rate * np.sum(w**2))
    f = np.fft.rfftfreq(n, 1 / rate)
    df = f[1] - f[0]
    band = psd[:, (f >= 1) & (f <= 40)].sum(axis=1) * df
    hum = ((f >= 48) & (f <= 52)) | ((f >= 58) & (f <= 62))
    mains = psd[:, hum].sum(axis=1) * df
    share = mains / np.maximum(band + mains, 1e-12)
    return np.sqrt(band), np.sqrt(mains), share


def wear_features(x, rate):
    """Whole-cap quantities for "is the cap worn at all" (all electrodes together):
    floor   median over channels of the RMS in a band free of EEG and mains (µV):
            65–95 Hz when the sampling rate allows, else 41–47 Hz; floating inputs are
            noisier
    corr    mean absolute correlation between channels (detrended): floating channels all
            pick up the same mains and interference, worn ones carry their own signals
    spread  standard deviation across channels of log10 of the 1–40 Hz power: worn
            electrodes differ (posterior alpha, frontal eye signals), floating ones are alike
    per-channel floor values are returned too (hf).
    """
    x = np.asarray(x, dtype=float)
    n = x.shape[1]
    t = np.arange(n)
    slope = ((x - x.mean(axis=1, keepdims=True)) @ (t - t.mean())) / np.sum((t - t.mean()) ** 2)
    x = x - x.mean(axis=1, keepdims=True) - np.outer(slope, t - t.mean())
    w = np.hanning(n)
    psd = 2 * np.abs(np.fft.rfft(x * w, axis=1)) ** 2 / (rate * np.sum(w**2))
    f = np.fft.rfftfreq(n, 1 / rate)
    df = f[1] - f[0]
    hi = (f >= 65) & (f <= 95) if rate / 2 > 100 else (f >= 41) & (f <= 47)
    hf = np.sqrt(psd[:, hi].sum(axis=1) * df)
    band = psd[:, (f >= 1) & (f <= 40)].sum(axis=1) * df
    sd = x.std(axis=1)
    keep = sd > 1e-9
    if keep.sum() >= 2:
        c = np.corrcoef(x[keep])
        k = c.shape[0]
        corr = float((np.abs(c).sum() - k) / (k * (k - 1)))
    else:
        corr = float("nan")
    spread = float(np.std(np.log10(np.maximum(band, 1e-12))))
    return {"floor": float(np.median(hf)), "corr": corr, "spread": spread, "hf": hf}


def _wear(x, rate):
    w = wear_features(x, rate)
    r = lambda v, d: round(v, d) if np.isfinite(v) else None  # noqa: E731
    return {
        "floor": r(w["floor"], 2),
        "corr": r(w["corr"], 3),
        "spread": r(w["spread"], 3),
        "hf": np.round(w["hf"], 2).tolist(),
    }


def classify(band, mains, share, rail, th=THRESHOLDS):
    # Saturation check only (OpenBCI GUI). band / mains / share are kept for reporting.
    if rail == "railed":
        return "off", "饱和（超过量程 90%）"
    if rail == "flat":
        return "off", "信号不变"
    if rail == "near":
        return "poor", "接近饱和（超过量程 75%）"
    return "ok", "正常"


def assess(x, rate, rail_states, th=THRESHOLDS):
    x = np.asarray(x, dtype=float)
    if x.ndim != 2 or x.shape[1] < rate:
        k = len(rail_states)
        return {"states": ["unknown"] * k, "reasons": [""] * k, "reference": False}
    band, mains, share = features(x, rate)
    states, reasons = [], []
    for i in range(x.shape[0]):
        s, r = classify(band[i], mains[i], share[i], rail_states[i] if i < len(rail_states) else "")
        states.append(s)
        reasons.append(r)
    return {
        "states": states,
        "reasons": reasons,
        "band": np.round(band, 1).tolist(),
        "mains": np.round(mains, 1).tolist(),
        "share": np.round(share, 2).tolist(),
        "reference": sum(s == "off" for s in states) >= th["REFERENCE_OFF"],
        **_wear(x, rate),
    }


# Is the cap worn at all (whole cap, not per electrode). Mains and the high-band floor were
# tried and dropped (they depend on the room). Now:
#  - until it is first worn in this app run: Fp1's impedance (wearprobe.py) says the cap is on the
#    head, then WINDOW seconds with most electrodes not railed confirm it (at most MISSES failed;
#    these seconds build the baseline, see brainHistory.ts);
#  - after that the impedance is not measured again; AGAIN seconds confirm it after a reconnect;
#  - only a saturated amplifier (median rail >= RAIL_MAX in OFF of the last OFF_OF seconds) counts
#    as not worn any more.
WEAR = {
    "RAIL_MAX": 90.0,
    "WINDOW": 30,
    "MISSES": 6,
    "OFF": 4,
    "OFF_OF": 5,
    "AGAIN": 5,
    "AGAIN_MISSES": 1,
}


def wear_votes(c, rail_percent=None, th=WEAR):
    """Per second: most electrodes not railed (no rail data yet is not held against it)."""
    rails = [p for p in (rail_percent or []) if p is not None]
    return [not rails or float(np.median(rails)) < th["RAIL_MAX"]]


def unworn(c):
    """Not worn: every electrode shows as not in contact (gray: "unknown", as before any signal;
    "off" is a saturated one, 需调整), whatever its signal."""
    if c.get("worn") is False and c.get("states"):
        k = len(c["states"])
        c["states"], c["reasons"] = ["unknown"] * k, ["未佩戴"] * k
    return c


class Wear:
    def __init__(self, th=WEAR, again=False):
        self.th = th
        self.again = again  # worn before in this app run: the short confirmation
        # With the wear probe (wearprobe.py) a run starts only after Fp1's impedance said the cap
        # is on the head.
        self.use_probe = False
        self.probe_ok = False
        self.state = None  # None = not decided yet
        self.run = 0  # seconds of the current run towards "worn"
        self.misses = 0  # failed seconds within that run
        self.recent = []  # last OFF_OF seconds, True = passed

    def probed(self):
        self.probe_ok = True

    def update(self, c, rail_percent=None):
        th = self.th
        need = th["AGAIN"] if self.again else th["WINDOW"]
        votes = wear_votes(c, rail_percent, th)
        ok = all(votes)
        if self.use_probe and self.state is not True:
            ok = self.probe_ok and ok
        self.recent = (self.recent + [ok])[-th["OFF_OF"] :]
        failing = len(self.recent) == th["OFF_OF"] and self.recent.count(False) >= th["OFF"]
        if self.state is True:
            if failing:
                self.state, self.run, self.misses = False, 0, 0
                self.probe_ok = False
        else:
            if ok:
                self.run += 1
            elif self.run:
                self.misses += 1
                self.run += 1
                if self.misses > th["AGAIN_MISSES" if self.again else "MISSES"] or failing:
                    self.run = self.misses = 0
                    self.probe_ok = False
            if self.run >= need:
                self.state, self.run, self.misses = True, 0, 0
                self.again = True
            elif failing or (
                self.state is None and len(self.recent) == th["OFF_OF"] and not self.run
            ):
                self.state = False
        hold = self.run if self.state is not True else 0
        return {
            "worn": self.state,
            "wornVotes": votes,
            "wornHold": hold,
            "wornNeed": need,
            "wornAgain": self.again,
        }


def demo(quality):
    """Demo device: follow its scripted quality (good / warn / bad)."""
    m = {"good": "ok", "warn": "poor", "bad": "off"}
    states = [m.get(q, "unknown") for q in quality]
    return {
        "states": states,
        "reasons": [TEXT[s] for s in states],
        "reference": False,
    }
