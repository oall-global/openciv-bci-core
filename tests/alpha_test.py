import sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from spectral import spectrum, AlphaStream

for rate in (125, 250, 500, 1000):
    t = np.arange(rate * 4) / rate
    a = 20 * np.sin(2 * np.pi * 10 * t)
    b = 20 * np.sin(2 * np.pi * 20 * t)
    result = spectrum(np.array([a, b, a + b, a * 2, a + 100000 + 3 * t, t * 0]), rate)
    assert abs(result["absolute"][0] - 200) < 1
    assert result["relative"][0] > 99
    assert result["relative"][1] < 0.01
    assert abs(result["relative"][2] - 50) < 0.1
    assert abs(result["absolute"][3] / result["absolute"][0] - 4) < 0.001
    assert abs(result["absolute"][4] - result["absolute"][0]) < 0.01
    assert result["flags"][5] == "flat"
    stream = AlphaStream(rate)
    assert stream.push(np.array([a[:rate]]), t[:rate] + 100, 1) is None
    assert stream.push(np.array([a[rate:]]), t[rate:] + 100, 2) is not None
    assert stream.push(np.array([a[:rate]]), t[:rate] + 110, 3) is None, "Gap must restart warmup"
    stream.clear()
    assert len(stream.rows) == 0
for bad in [np.zeros((16, 100)), np.full((16, 1000), np.nan)]:
    try:
        spectrum(bad, 250)
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid input accepted")
print(
    "PASS: known frequencies, power units, relative power, scaling, drift, all sample rates, invalid data and gap reset"
)

stream = AlphaStream(250)
t = np.arange(1000) / 250
x = np.array([20 * np.sin(2 * np.pi * 10 * t)])
# Wi-Fi timestamps mark host reception; contiguous IDs can arrive in bursts.
stream.push(x[:, :500], t[:500] + 100, 1, check_timing=False)
assert stream.push(x[:, 500:], t[500:] + 101, 2, check_timing=False) is not None
print("PASS: sequence-validated Wi-Fi batching does not restart spectrum warmup")
