"""Acquisition clock vs a simulated Wi-Fi stream: device clock drift, a backlog that builds up
in steps, bursty delivery, lost samples and a transport break."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from acqclock import AcquisitionClock, realign  # noqa: E402

rate = 250


def simulate(seconds=360, drift=870e-6, seed=0, start=1_790_000_000.0):
    """True acquisition times, arrival times and package ids of the samples that arrive."""
    rng = np.random.default_rng(seed)
    n = int(seconds * rate)
    k = np.arange(n)
    true = start + k * (1 + drift) / rate
    # Backlog: steps up to 3.3 s during the first two minutes, then flat (as recorded).
    steps = np.zeros(n)
    for at, size in ((15, 0.35), (40, 0.5), (58, 0.6), (88, 0.3), (110, 1.4), (130, 0.15)):
        steps[int(at * rate) :] += size
    # Bursty delivery: samples wait for the next burst (every 20–120 ms) plus 2–8 ms latency.
    bursts = np.cumsum(rng.uniform(0.02, 0.12, int(seconds / 0.02) + 10)) + start
    ready = true + steps
    arrival = bursts[np.searchsorted(bursts, ready)] + rng.uniform(0.002, 0.008, n)
    arrival = np.maximum.accumulate(arrival) + k * 1e-9
    # Occasional long stalls (up to 2.5 s) that later catch up.
    for at in (70, 200, 300):
        a, b = int(at * rate), int((at + 2.5) * rate)
        arrival[a:b] = np.maximum(arrival[a:b], arrival[b])
    arrival = np.maximum.accumulate(arrival) + k * 1e-9
    packages = k % 256
    keep = np.ones(n, bool)
    keep[rng.choice(n, 12, replace=False)] = False  # 12 single lost samples
    return true[keep], arrival[keep], packages[keep]


true, arrival, packages = simulate()
clock = AcquisitionClock(rate)
acq = np.concatenate(
    [clock.push(arrival[i : i + 10], packages[i : i + 10]) for i in range(0, len(arrival), 10)]
)
err = (acq - true) * 1000
naive = (arrival - true) * 1000
t = true - true[0]
after = t > 32  # drift is estimated from 30 s on
early = (t > 2) & ~after  # the first second has no envelope yet
assert clock.lost == 12 and clock.resets == 0, clock.status()
assert abs(clock.drift - 870e-6) < 150e-6, clock.drift
assert np.abs(err[after]).max() < 15, np.abs(err[after]).max()
assert np.abs(err[early]).max() < 30, np.abs(err[early]).max()
assert np.all(acq <= arrival + 1e-4) and np.all(np.diff(acq) > 0)
assert 3.0 < clock.status()["latency"] < 3.6, clock.status()

off, hind = realign(arrival, packages, rate)
err_off = (off - true) * 1000
assert np.abs(err_off).max() < 15, np.abs(err_off).max()

# A break too long to count restarts the clock instead of mislabelling time.
c2 = AcquisitionClock(rate)
c2.push(arrival[:5000], packages[:5000])
c2.push(arrival[9000:9010] + 0, (packages[9000:9010] + 77) % 256)
assert c2.resets == 1

# No drift, no backlog (USB / demo): exact.
k = np.arange(20000)
exact = 1_790_000_000 + k / rate
c3 = AcquisitionClock(rate)
out = np.concatenate(
    [c3.push(exact[i : i + 25] + 0.003, k[i : i + 25] % 256) for i in range(0, 20000, 25)]
)
assert np.abs(out - exact - 0.003).max() < 1e-4

print(
    f"PASS acqclock: arrival error up to {naive.max():.0f} ms -> online "
    f"{np.abs(err[after]).max():.1f} ms after 32 s ({np.abs(err[early]).max():.1f} ms at 2–32 s), "
    f"offline {np.abs(err_off).max():.1f} ms; drift {clock.drift * 1e6:.0f} ppm (true 870), "
    f"lost {clock.lost}"
)
