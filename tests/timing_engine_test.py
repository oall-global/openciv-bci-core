"""Engine timing under a simulated Wi-Fi backlog (demo board, fault "backlog").

A blink is injected at a known host time. Its peak must sit at the right place on the
acquisition-time axis the engine emits, although the data arrives about 2 s late; on the
arrival-time axis (the old behaviour) it is 2 s off. Engine events (eye/jaw controls) must
carry acquisition times too.
"""

import json
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np

root = Path(__file__).resolve().parents[1]
p = subprocess.Popen(
    [
        (
            sys.executable
            if sys.platform == "darwin"
            else str(root / "engine/.venv/Scripts/python.exe")
        ),
        "-u",
        str(root / "engine/main.py"),
    ],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
    encoding="utf-8",
)
events = queue.Queue()
threading.Thread(
    target=lambda: [events.put(json.loads(line)) for line in p.stdout], daemon=True
).start()
seq = 0
seen = []


def wait(predicate, timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            value = events.get(timeout=0.3)
        except queue.Empty:
            continue
        seen.append(value)
        if predicate(value):
            return value
    raise AssertionError("timed out")


def command(method, params=None):
    global seq
    seq += 1
    p.stdin.write(json.dumps({"id": seq, "method": method, "params": params or {}}) + "\n")
    p.stdin.flush()
    r = wait(lambda v: v.get("type") == "response" and v.get("id") == seq)
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]


def drain(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            seen.append(events.get(timeout=0.2))
        except queue.Empty:
            pass


try:
    wait(lambda v: v.get("type") == "ready")
    command("connect", {"transport": "demo"})
    wait(lambda v: v.get("type") == "data")
    command("fault", {"value": "backlog"})
    command("demo-artifact", {"enabled": True})
    drain(27)  # the simulated backlog reaches 2 s after 25 s
    blinks = []
    for _ in range(3):
        blinks.append(time.time())
        command("demo-artifact", {"action": "blink"})
        drain(3)
    drain(3)  # let the delayed data arrive

    data = [e for e in seen if e.get("type") == "data"]
    acq = np.concatenate([e["timestamps"] for e in data])
    rec = np.concatenate([e["received"] for e in data])
    fp1 = np.concatenate([e["samples"][0] for e in data])
    latency = data[-1]["clock"]["latency"]
    assert 1.8 < latency < 2.3, latency
    assert np.all(np.diff(acq) > 0)
    # Acquisition times advance by one sample period (no jumps from the bursts).
    steps = np.diff(acq)
    assert np.abs(np.median(steps) - 1 / 250) < 1e-5 and steps.max() < 0.05, steps.max()

    def peak(times, t):
        window = (times >= t - 1) & (times <= t + 1.5)
        return times[window][np.argmax(fp1[window])] - t

    on_acq = [peak(acq, t) for t in blinks]
    # The injected blink peaks 0.15 s after its command time (plus command handling delay).
    assert all(0.12 < d < 0.3 for d in on_acq), on_acq
    # Arrival times put it ~2 s late (outside the ±1 s window it would not even be found).
    lag = [peak(rec, t) for t in blinks]
    assert all(abs(d - 0.15) > 0.5 for d in lag), lag
    print(
        f"PASS timing engine: latency {latency:.2f} s; blink peak at +{np.mean(on_acq) * 1000:.0f} ms "
        f"on acquisition time (expected ~150 ms), on arrival time it is not within ±1 s"
    )
finally:
    try:
        command("shutdown")
    except Exception:
        pass
    p.kill()
