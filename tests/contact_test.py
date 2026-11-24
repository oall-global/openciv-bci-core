"""Live electrode contact (engine/contact.py) on synthetic 2 s windows."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import contact  # noqa: E402

rate = 250
t = np.arange(2 * rate) / rate
rng = np.random.default_rng(3)


def eeg(uv=10):
    """Worn: 1/f-ish noise plus a 10 Hz rhythm, a little mains, device DC offset."""
    x = np.cumsum(rng.normal(0, 1, len(t)))
    x = (x - np.convolve(x, np.ones(25) / 25, mode="same")) * uv / 3
    return 12000 + x + 4 * np.sin(2 * np.pi * 10 * t) + 1.5 * np.sin(2 * np.pi * 50 * t)


def floating():
    """Not touching the skin: the input drifts to the rail (full scale ±187 500 µV at gain 24)."""
    return -180000 + 400 * t + 400 * np.sin(2 * np.pi * 50 * t + 0.3) + rng.normal(0, 3, len(t))


def humming():
    """Poor contact: EEG-sized noise but hum dominates."""
    return eeg(4) + 40 * np.sin(2 * np.pi * 50 * t)


# The state follows the saturation check only (as OpenBCI GUI): hum and noise do not count.
x = np.array([eeg() for _ in range(12)] + [humming(), eeg(60), eeg(), eeg()])
rails = ["normal"] * 16
rails[13] = "near"
rails[14] = "railed"
rails[15] = "flat"
x[1] += 60 * np.exp(-(((t - 1) / 0.1) ** 2))  # a blink
r = contact.assess(x, rate, rails)
assert r["states"][:13] == ["ok"] * 13, list(zip(r["states"], r["band"], r["mains"], r["share"]))
assert r["states"][12] == "ok" and r["share"][12] > 0.8  # strong hum alone: still 正常
assert r["states"][13] == "poor" and r["reasons"][13].startswith("接近饱和")
assert r["states"][14] == "off" and r["reasons"][14].startswith("饱和")
assert r["states"][15] == "off" and r["reasons"][15] == "信号不变"
assert r["reference"] is False

# Reference / BIAS not worn: every channel rails.
ref = contact.assess(np.array([floating() for _ in range(16)]), rate, ["railed"] * 16)
assert ref["reference"] is True and set(ref["states"]) == {"off"}

# Whole-cap features: floating channels are alike (high correlation, little spread); worn
# channels carry their own signals.
off = contact.wear_features(np.array([floating() for _ in range(16)]), rate)
on = contact.wear_features(np.array([eeg(5 + 2 * k) for k in range(16)]), rate)
assert off["corr"] > 0.8 and on["corr"] < 0.3, (off["corr"], on["corr"])
assert on["spread"] > off["spread"], (on["spread"], off["spread"])
assert {"floor", "corr", "spread", "hf"} <= set(r)

# Worn judgement: most electrodes not railed; with the wear probe, only after Fp1's impedance
# said so; 30 s (at most 6 misses) the first time, 5 s after that; off when saturated 4 of 5 s.
ok, sat = [43.0] * 16, [100.0] * 12 + [40.0] * 4
assert contact.wear_votes({}, ok) == [True]
assert contact.wear_votes({}, sat) == [False]
assert contact.wear_votes({}) == [True]  # no rail data yet: not held against
w = contact.Wear()
w.use_probe = True
assert all(w.update({}, ok)["wornHold"] == 0 for _ in range(10)) and w.state is False
w.probed()
seq = [w.update({}, sat if k % 7 == 3 else ok) for k in range(30)]
assert [x["worn"] for x in seq] == [False] * 29 + [True], [x["worn"] for x in seq]
assert seq[2]["wornHold"] == 3 and seq[-1]["wornHold"] == 0
w.update({}, sat)  # one odd second does not flip it
assert all(w.update({}, ok)["worn"] is True for _ in range(5))
seq = [w.update({}, sat)["worn"] for _ in range(5)]
assert seq == [True] * 3 + [False] * 2, seq  # saturated 4 of the last 5

# After the first time (this app run): no probe, 5 s confirm; the baseline is kept.
assert w.again
w.use_probe = False
seq = [w.update({}, ok)["worn"] for _ in range(5)]
assert seq == [False] * 4 + [True], seq
assert contact.Wear(again=True).update({}, ok)["wornNeed"] == 5
assert contact.Wear().update({}, ok)["wornNeed"] == 30

# Too little data, and the demo device's scripted quality.
assert contact.assess(x[:, :100], rate, rails)["states"] == ["unknown"] * 16
assert contact.demo(["good", "warn", "bad", "unknown"])["states"] == [
    "ok",
    "poor",
    "off",
    "unknown",
]
print(
    "PASS contact: saturation only (as OpenBCI GUI) — worn and hum (share %.2f) ok, near railed "
    "poor, railed / flat off, reference detected" % r["share"][12]
)
