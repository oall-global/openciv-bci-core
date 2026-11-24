"""Wear probe (engine/wearprobe.py) with a fake device: lead-off on Fp1 while not worn, the
impedance from the 31.2 Hz tone, restore once it is low, then contact.Wear confirms."""

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import contact  # noqa: E402
import wearprobe  # noqa: E402

RATE = 250


class Board:
    def __init__(self):
        self.calls = []

    def stop_stream(self):
        self.calls.append("stop")

    def start_stream(self, n):
        self.calls.append("start")

    def get_board_data(self):
        return np.zeros((1, 0))


class Check:
    active = False
    dirty = None


class Engine:
    def __init__(self, transport="wifi"):
        self.rate = RATE
        self.board = Board()
        self.config = {"transport": transport}
        self.check = Check()
        self.clock = "x"
        self.commands = []
        self.refuse = False

    def check_command(self, command, acknowledge=False):
        if self.refuse:
            raise ValueError("设备未确认阻抗测试指令")
        self.commands.append(command)


def tone(kohm, seconds=1.0, saturate=False):
    """Fp1 samples (µV) for an electrode of this impedance under the 6 nA test current."""
    t = np.arange(int(RATE * seconds)) / RATE
    if saturate:
        return np.full(len(t), 4.5e6)
    rms = (kohm * 1000 + 2200) * 6e-9 / 1e-6 / np.sqrt(2) * 1e-6 * 1e6  # µV
    return rms * np.sqrt(2) * np.sin(2 * np.pi * 31.25 * t) + np.random.default_rng(1).normal(0, 2, len(t))


e = Engine()
p = wearprobe.WearProbe(e)
p.reset()
assert p.usable()
p.start()
assert p.active and e.commands == list(wearprobe.INJECT), e.commands
assert p.switched and e.board.calls[-1] == "start"
p.since -= 2  # settled

# Floating: the test signal saturates — never on the head.
for _ in range(6):
    p.feed(tone(0, saturate=True))
    assert not p.measure()
assert p.result["quality"] == "bad"

# On the head (600 kΩ, a dry electrode): on after 3 good seconds.
hits = []
for _ in range(6):
    p.feed(tone(600))
    hits.append(p.measure())
assert 550 < p.result["kohm"] < 650, p.result
assert hits.index(True) >= 2, hits  # the 3 s window must fill with the new signal first
p.stop()
assert not p.active and e.commands[-2:] == list(wearprobe.RESTORE), e.commands

# Worn judgement with the probe: no run before the probe said so, then rail decides.
ok = [43.0] * 16
w = contact.Wear()
w.use_probe = True
assert all(w.update({}, ok)["wornHold"] == 0 for _ in range(10)) and w.state is False
w.probed()
seq = [w.update({}, ok)["worn"] for _ in range(30)]
assert seq[-1] is True and seq[-2] is False, seq

# Device that refuses the commands: fall back to the signal-only rules.
e2 = Engine()
e2.refuse = True
p2 = wearprobe.WearProbe(e2)
p2.reset()
p2.start()
assert p2.failed and not p2.active and not p2.usable()
# Demo / no device config: never used.
e3 = Engine("demo")
p3 = wearprobe.WearProbe(e3)
p3.reset()
assert not p3.usable()

print("PASS wear probe: Fp1 lead-off while not worn, saturated when floating, on after 3 s below 2500 kΩ, restored; Wear waits for it; refused commands fall back")
