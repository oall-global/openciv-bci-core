import sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from rail import check_rails

full = 4.5 / (2**23 - 1) / 24 * 1e6 * 2**23
for rate in [125, 250, 500, 1000]:
    levels = [0.5, 0.749, 0.751, 0.899, 0.901]
    rows = np.array([np.tile([0, full * level], rate * 3 // 2 + 1)[: rate * 3] for level in levels])
    r = check_rails(rows, rate)
    assert r["states"] == ["normal", "normal", "near", "near", "railed"], r
    assert check_rails(-rows, rate)["states"] == r["states"]
    # A DC offset must not be removed before this check.
    assert check_rails(rows[:1] * 0.01 + full * 0.95, rate)["states"] == ["railed"]
    assert check_rails(np.zeros((1, rate * 3)), rate)["states"] == ["flat"]
    assert check_rails(np.ones((1, rate * 3)) * 100, rate)["states"] == ["flat"]
    assert check_rails(np.ones((1, rate * 3 - 1)), rate)["states"] == ["flat"]
    assert check_rails(np.full((1, rate * 3), np.nan), rate)["states"] == ["unknown"]
    # Only the last three seconds count; an old saturation must expire.
    assert check_rails(np.concatenate([np.ones((1, rate)) * full, rows[:1]], axis=1), rate)[
        "states"
    ] == ["normal"]
print(
    "PASS: rail thresholds, polarity, DC preservation, flat signal, warmup, invalid data, 3s expiry at all rates"
)

assert check_rails(np.zeros((1, 0)), 250)["states"] == ["unknown"]
assert check_rails(np.zeros((1, 2)), 250, streaming=False)["states"] == ["normal"]


# Match the original GUI's float data buffer and imperative decision logic.
def original(row, rate):
    row = np.asarray(row, dtype=np.float32)[-3 * rate :]
    peak = abs(row[0])
    straight = True
    for i in range(1, len(row)):
        peak = max(peak, abs(row[i]))
        if abs(row[i - 1] - row[i]) > 1e-5 and abs(row[i]) > 1e-5:
            straight = False
    pct = float(peak) / full * 100
    state = "normal"
    if pct > 75:
        state = "near"
    if pct > 90:
        state = "railed"
    elif straight:
        state = "flat"
    return state, round(pct, 2)


rng = np.random.default_rng(8)
for length in [1, 2, 100, 750, 1000]:
    rows = rng.normal(size=(16, length)) * full * 0.3
    rows[0] = 0
    rows[1] = full * 0.8
    rows[2] = full * 0.95
    out = check_rails(rows, 250)
    for i, row in enumerate(rows):
        expected = original(row, 250)
        assert (out["states"][i], out["percentages"][i]) == expected
print(
    "PASS: GUI parity for startup, float32 buffer, peak thresholds, flat priority and nonstreaming"
)
