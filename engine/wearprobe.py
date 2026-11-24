"""Wear probe: while the cap is not worn, keep measuring one electrode's impedance.

The same 6 nA lead-off tone as the connection check (connection_check.py, from OpenBCI GUI), on
Fp1 only (forehead, no hair: the best contact). The current returns through the BIAS electrode,
so the impedance drops only when both touch skin, i.e. the cap is on the head; holding it in the
hand rarely does that, and a floating input saturates. When the impedance stays low for ON
seconds the channel is restored and contact.Wear confirms (and builds the baseline).
Nothing is measured while the cap is worn: the signal stays clean.
"""

import time
from collections import deque

import numpy as np

from connection_check import SELECTORS, contact_result

CHANNEL = 0  # Fp1
ON = 3  # consecutive seconds with an acceptable impedance
SETTLE = 1.0  # s after switching before samples count
INJECT = ("x" + SELECTORS[CHANNEL] + "000100X", "z" + SELECTORS[CHANNEL] + "01Z")
RESTORE = ("z" + SELECTORS[CHANNEL] + "00Z", "x" + SELECTORS[CHANNEL] + "060110X")


class WearProbe:
    def __init__(self, engine):
        self.e = engine
        self.active = False  # lead-off on, or possibly on after a failed switch
        self.switched = False
        self.failed = False  # the device did not accept it: fall back to the signal-only rules
        self.samples = deque()
        self.good = 0
        self.result = None
        self.since = 0.0

    def reset(self):
        """New connection: the device starts without lead-off (cleared on connect)."""
        self.active = self.failed = False
        self.samples = deque(maxlen=self.e.rate * 4)
        self.good = 0
        self.result = None

    def usable(self):
        e = self.e
        return (
            not self.failed
            and e.config is not None
            and e.config.get("transport") in ("wifi", "serial")
            and not e.check.active
            and e.check.dirty is None
        )

    def switch(self, commands):
        e = self.e
        try:
            e.board.stop_stream()
        except Exception:
            pass
        e.check_command(commands[0], acknowledge=commands[0].startswith("z"))
        e.check_command(commands[1], acknowledge=commands[1].startswith("z"))
        e.board.get_board_data()  # drop samples from before the switch
        e.board.start_stream(e.rate * 10)
        self.switched = True  # the engine starts a new stream segment on its next tick
        self.samples = deque(maxlen=e.rate * 4)
        self.good = 0
        self.since = time.monotonic()

    def start(self):
        self.active = True  # before touching the hardware: a partial failure still restores
        try:
            self.switch(INJECT)
        except Exception:
            self.fail()

    def stop(self):
        if not self.active:
            return
        try:
            self.switch(RESTORE)
            self.active = False
        except Exception:
            self.fail()

    def fail(self):
        self.failed = True
        try:
            self.switch(RESTORE)
        except Exception:
            pass
        self.active = False

    def feed(self, x):
        if self.active and time.monotonic() - self.since >= SETTLE:
            self.samples.extend(np.asarray(x, dtype=float).tolist())

    def measure(self):
        """About once a second while active: Fp1's impedance from the last 3 s. True once it has
        been acceptable (< 2500 kΩ, OpenBCI GUI's limit for dry electrodes) for ON seconds."""
        rate = self.e.rate
        if not self.active or len(self.samples) < rate * 3:
            return False
        r = contact_result(np.asarray(self.samples)[-rate * 3 :], rate)
        self.result = r
        ok = r["kohm"] is not None and r["quality"] in ("good", "warn")
        self.good = self.good + 1 if ok else 0
        return self.good >= ON

    def report(self):
        return {
            "channel": CHANNEL,
            "active": self.active,
            "failed": self.failed,
            "kohm": (self.result or {}).get("kohm") if self.active else None,
            "quality": (self.result or {}).get("quality") if self.active else None,
        }
