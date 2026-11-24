"""Acquisition clock: when each sample was measured, on the host clock.

BrainFlow stamps samples with the host time they were *received*. Over Wi-Fi the shield
delivers in bursts and a backlog can build up: a real 6-minute recording showed arrival
lagging acquisition by 0 s at the start, rising in steps to 3.4 s within two minutes. Aligning
events (stimulus onsets, host clock) to arrival times therefore put them seconds away from
the EEG they belong to.

The device samples at a fixed rate, so sample k was acquired at

    acq(k) = A + k · (1 + d) / rate

where k counts samples since the stream (re)started, including samples lost in transit
(from the package counter), d is the relative clock-rate error of the device (ADS1299
oscillator vs host clock) and A is the host time of sample 0.

Estimation uses the lower envelope of lag(k) = arrival(k) − k / rate: a sample can never
arrive before it was acquired, and the fastest deliveries sit close to the true curve.
- d: slope of the block minima (5 s blocks) after removing backlog steps (block-to-block
  jumps too steep to be clock drift, or far from the median slope), from a least-squares
  line through the resulting step-free envelope. Estimated after 30 s, refreshed every 10 s, limited to
  ±3000 ppm.
- A: minimum over blocks of lag − d·k/rate, i.e. the least-delayed moment of the stream —
  normally its start, before any backlog.
Samples are never stamped later than they arrived. If a transport break makes the sample
count ambiguous (package jump > 128 or a long silence with a jump), the clock restarts.
"""

import numpy as np

BLOCK_SECONDS = 5.0
WARMUP_BLOCKS = 6
UPDATE_SECONDS = 10.0
MAX_DRIFT = 0.003


def estimate_drift(blocks, rate, previous=0.0):
    """Clock-rate error from block minima [(k, lag)], ignoring backlog steps.

    A block-to-block slope beyond twice the plausible clock error is a backlog step, not
    drift; among the rest, outliers from the median (4 MAD) are steps too. Steps are replaced
    by the median slope and a line is fitted through the step-free envelope. With fewer
    than three plausible differences the previous estimate is kept.
    """
    t = np.array([b[0] for b in blocks], dtype=float) / rate
    m = np.array([b[1] for b in blocks])
    dt, dm = np.diff(t), np.diff(m)
    slopes = dm / dt
    plausible = np.abs(slopes) <= 2 * MAX_DRIFT
    if plausible.sum() < 3:
        return previous
    med = np.median(slopes[plausible])
    mad = 1.4826 * np.median(np.abs(slopes[plausible] - med))
    steps = ~plausible | (np.abs(slopes - med) > max(4 * mad, 50e-6))
    dm = np.where(steps, med * dt, dm)
    flat = np.concatenate(([0.0], np.cumsum(dm)))
    drift = np.polyfit(t, flat, 1)[0]
    return float(np.clip(drift, -MAX_DRIFT, MAX_DRIFT))


class AcquisitionClock:
    def __init__(self, rate, package_step=1):
        self.rate = float(rate)
        self.step = package_step
        self.drift = 0.0
        self.resets = 0
        self.lost = 0
        self.indices = None  # set to a list to record each sample's index (offline use)
        self._restart()
        self.resets = 0

    def _restart(self):
        self.count = 0  # index of the next sample in this clock segment
        self.anchor = None
        self.blocks = []  # (k, minimum lag) per finished block
        self.block = None  # [start k, k at minimum, minimum lag]
        self.last_package = None
        self.last_arrival = None
        self.last_acq = None
        self.next_update = WARMUP_BLOCKS * BLOCK_SECONDS * self.rate
        self.resets += 1

    def _envelope(self):
        points = self.blocks + ([(self.block[1], self.block[2])] if self.block else [])
        return min(m - self.drift * k / self.rate for k, m in points)

    def _update_drift(self):
        if len(self.blocks) < WARMUP_BLOCKS:
            return
        self.drift = estimate_drift(self.blocks, self.rate, self.drift)
        self.anchor = self._envelope()

    def push(self, arrival, packages=None):
        """Acquisition times (host clock, seconds) for a chunk of samples in arrival order."""
        arrival = np.asarray(arrival, dtype=float)
        out = np.empty(len(arrival))
        for i, t in enumerate(arrival):
            if packages is not None:
                p = int(packages[i])
                if self.last_package is not None:
                    delta = (p - self.last_package) % 256
                    silence = t - self.last_arrival
                    if delta > 128 or (delta not in (0, self.step) and silence > 1.0):
                        # Too many samples may be missing to count them: start a new segment.
                        self._restart()
                    elif delta > self.step:
                        missing = delta // self.step - 1
                        self.count += missing
                        self.lost += missing
                self.last_package = p
            self.last_arrival = t
            k = self.count
            lag = t - k / self.rate
            if self.block is None or k - self.block[0] >= BLOCK_SECONDS * self.rate:
                if self.block is not None:
                    self.blocks.append((self.block[1], self.block[2]))
                self.block = [k, k, lag]
            elif lag < self.block[2]:
                self.block[1], self.block[2] = k, lag
            base = lag - self.drift * k / self.rate
            if self.anchor is None or base < self.anchor:
                self.anchor = base  # never stamp a sample later than it arrived
            if k >= self.next_update:
                self._update_drift()
                self.next_update = k + UPDATE_SECONDS * self.rate
            acq = self.anchor + k * (1 + self.drift) / self.rate
            if self.last_acq is not None and acq <= self.last_acq:
                acq = self.last_acq + 1e-6  # keep times strictly increasing across updates
            out[i] = self.last_acq = acq
            if self.indices is not None:
                self.indices.append(k)
            self.count += 1
        return out

    def status(self):
        return {
            "driftPpm": round(self.drift * 1e6),
            "lost": self.lost,
            "resets": self.resets,
            "latency": None
            if self.last_arrival is None
            else round(self.last_arrival - self.last_acq, 3),
        }


def realign(arrival, packages, rate, package_step=1):
    """Offline, with hindsight: drift and anchor from the whole recording, applied to every
    sample (the online clock only knows the past). Returns (acquisition times, clock)."""
    clock = AcquisitionClock(rate, package_step)
    clock.indices = []
    online = clock.push(arrival, packages)
    if clock.resets > 0 or len(arrival) < 2:
        return online, clock  # several segments: keep the online estimate
    clock.blocks.append((clock.block[1], clock.block[2]))
    clock.block = None
    if len(clock.blocks) >= 3:
        clock.drift = estimate_drift(clock.blocks, clock.rate, clock.drift)
    clock.anchor = clock._envelope()
    k = np.asarray(clock.indices, dtype=float)
    return clock.anchor + k * (1 + clock.drift) / clock.rate, clock


class SimulatedStall:
    """Demo device only: a Wi-Fi stall — every PERIOD s nothing arrives for HOLD s, then all of
    it at once (as recorded stalls of up to 2.7 s), so the screens can be checked to stay smooth.
    Sample times are kept."""

    PERIOD = 6.0
    HOLD = 2.0

    def __init__(self):
        self.start = None
        self.held = []

    def push(self, data, timestamp_channel, now):
        if self.start is None:
            self.start = now
        if (now - self.start) % self.PERIOD < self.HOLD:
            if data.shape[1]:
                self.held.append(data)
            return data[:, :0]
        if self.held:
            data = np.concatenate([*self.held, data], axis=1)
            self.held = []
        return data


class SimulatedBacklog:
    """Demo device only: imitate a Wi-Fi backlog so the whole data path can be tested.

    Samples are held back by a delay that grows in 0.4 s steps to 2 s over the first 25 s,
    released in bursts every 60–150 ms, and stamped with their release (arrival) time —
    what BrainFlow reports for a real Wi-Fi board.
    """

    STEPS = (5.0, 10.0, 15.0, 20.0, 25.0)

    def __init__(self, seed=None):
        self.rng = np.random.default_rng(seed)
        self.start = None
        self.queue = None
        self.due = np.empty(0)
        self.next_burst = 0.0

    def delay(self, t):
        return 0.4 * sum(t - self.start >= s for s in self.STEPS)

    def push(self, data, timestamp_channel, now):
        if self.start is None:
            self.start = now
        if data.shape[1]:
            due = data[timestamp_channel] + np.array(
                [self.delay(t) for t in data[timestamp_channel]]
            )
            self.queue = data if self.queue is None else np.hstack([self.queue, data])
            self.due = np.concatenate([self.due, due])
        if self.queue is None or now < self.next_burst:
            return np.empty((data.shape[0], 0))
        self.next_burst = now + self.rng.uniform(0.06, 0.15)
        n = int(np.searchsorted(self.due, now, side="right"))
        out, self.queue, self.due = self.queue[:, :n].copy(), self.queue[:, n:], self.due[n:]
        out[timestamp_channel] = now + np.arange(n) * 1e-6
        return out
