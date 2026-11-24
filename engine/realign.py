"""Re-align sessions recorded before format version 2 (NeuroLink ≤ 0.1.31).

Version 1 stamped samples with their host *receive* time and aligned events to it, so a Wi-Fi
backlog shifted events by up to seconds. This tool recomputes acquisition times from the
sample counter with hindsight (acqclock.realign), then:
- eeg.csv: "timestamp" becomes the acquisition time; the original receive time moves to a new
  "received" column (nothing is lost);
- events.jsonl: "sample" re-aligned; the original file is kept as events.v1.jsonl;
- session.json: version 2, "clock" summary with "realigned" details;
- analysis.json (if any) is renamed analysis.v1.json: it was computed with the old alignment.

Limitation: the clock is anchored at the least-delayed moment of the session itself. If the
backlog had already built up before the session started, a constant offset remains.

Usage:  python engine/realign.py SESSION_DIR [SESSION_DIR ...]   (skips version-2 sessions)
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from acqclock import realign

SERIAL_BOARDS = {0, 2}  # Cyton / Cyton+Daisy over USB count packages in steps of 2


def realign_session(path):
    path = Path(path)
    info = json.loads((path / "session.json").read_text(encoding="utf-8"))
    if info.get("version", 1) >= 2:
        return {"id": info["id"], "skipped": "already version 2"}
    if info.get("status") == "recording":
        return {"id": info["id"], "skipped": "still recording"}
    rate = info["device"]["rate"]
    with open(path / "eeg.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    if not body:
        return {"id": info["id"], "skipped": "no samples"}
    received = np.array([float(r[1]) for r in body])
    packages = [r[2] for r in body]
    has_packages = all(p != "" for p in packages)
    step = 2 if info["device"].get("boardId") in SERIAL_BOARDS else 1
    acq, clock = realign(received, [int(p) for p in packages] if has_packages else None, rate, step)

    # Events: first sample acquired at or after the event time (same rule as the app).
    events_file = path / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    moved = []
    for e in events:
        t = e.get("t")
        old = e.get("sample")
        if isinstance(t, (int, float)) and acq[0] - 1 <= t <= acq[-1] + 1:
            e["sample"] = int(np.searchsorted(acq, t))
        else:
            e["sample"] = None
        if isinstance(old, int) and e["sample"] is not None:
            moved.append((old - e["sample"]) / rate)

    # Write: backups first, then the new files.
    (path / "events.v1.jsonl").write_text(events_file.read_text(encoding="utf-8"), encoding="utf-8")
    if (path / "analysis.json").exists():
        (path / "analysis.json").replace(path / "analysis.v1.json")
    tmp = path / "eeg.csv.tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header + ["received"])
        for r, a in zip(body, acq):
            w.writerow([r[0], f"{a:.6f}"] + r[2:] + [r[1]])
    tmp.replace(path / "eeg.csv")
    events_file.write_text(
        "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events), encoding="utf-8"
    )
    latency = received - acq
    info["version"] = 2
    info["clock"] = {
        "driftPpm": round(clock.drift * 1e6),
        "latencyMax": round(float(latency.max()), 3),
        "latencyEnd": round(float(latency[-1]), 3),
        "lostSamples": clock.lost,
        "restarts": clock.resets,
        "realigned": {
            "at": datetime.now(timezone.utc).isoformat(),
            "tool": "engine/realign.py",
            "eventShiftSeconds": {
                "median": round(float(np.median(moved)), 3) if moved else None,
                "max": round(float(np.max(np.abs(moved))), 3) if moved else None,
            },
            "note": "Anchored at the least-delayed moment of this session; a backlog that "
            "existed before the session started would remain as a constant offset.",
        },
    }
    info["timing"] = (
        'Event "sample" = first EEG row whose acquisition time is at or after the event host '
        "time (re-aligned from receive times by engine/realign.py)."
    )
    (path / "session.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"id": info["id"], **info["clock"]}


if __name__ == "__main__":
    for d in sys.argv[1:]:
        print(json.dumps(realign_session(d), ensure_ascii=False))
