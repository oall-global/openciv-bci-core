"""Compare production Python against the user's installed GUI bytecode.
Run from project root, after compiling work/rail-parity/InstalledGuiRail.java.
No acquisition or hardware commands; original recordings are read-only.
"""

import csv, hashlib, json, os, struct, subprocess, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
from rail import check_rails

# The installed OpenBCI GUI and its recordings (manual parity check).
GUI = Path(os.environ.get("OPENBCI_GUI", Path.home() / "Desktop/BCI/OpenBCI_GUI"))
WORK = ROOT / "work/rail-parity"
OUTPUT = ROOT / "test-results/rail-gui-comparison"
OUTPUT.mkdir(parents=True, exist_ok=True)
cases = []
files = []


def add(name, channel, end, x, rate=250, gain=24, streaming=True):
    x = np.asarray(x, dtype=np.float32)
    actual = check_rails(x[None, :], rate, gain, streaming)
    cases.append(
        dict(
            dataset=name,
            channel=channel,
            endSample=end,
            rate=rate,
            gain=gain,
            streaming=streaming,
            x=x,
            state=actual["states"][0],
            percent=actual["percentages"][0],
        )
    )


recordings = sorted(
    Path(os.environ.get("OPENBCI_RECORDINGS", Path.home() / "Documents/OpenBCI_GUI/Recordings")).glob("**/OpenBCI-RAW-*.txt"),
    key=lambda p: p.name,
    reverse=True,
)
for file in recordings:
    with file.open(encoding="utf-8-sig") as f:
        headers = [next(f) for _ in range(5)]
        if "%Number of channels = 16" not in headers[1]:
            continue
        rate = int(headers[2].split("=")[1].split()[0])
        data = []
        for row in csv.reader(f):
            if len(row) < 17:
                continue
            try:
                values = [float(v) for v in row[1:17]]
            except ValueError:
                continue
            if not np.isfinite(values).all():
                continue
            data.append(values)
            if len(data) >= rate * 120:
                break
    if len(data) < 3 * rate:
        continue
    data = np.asarray(data)
    files.append(
        dict(
            name=file.name,
            sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
            samplesUsed=len(data),
            rate=rate,
        )
    )
    # Same endpoint each second; 3-second window. Startup is zero-prefilled like GUI and engine.
    for end in range(rate, len(data) + 1, rate):
        window = np.zeros((16, 3 * rate), dtype=np.float32)
        tail = data[max(0, end - 3 * rate) : end].T
        window[:, -tail.shape[1] :] = tail
        for ch in range(16):
            add(file.name, ch + 1, end, window[ch], rate)
    if len(files) >= 4:
        break

for rate in (125, 250, 500, 1000):
    for gain in (1, 2, 4, 6, 8, 12, 24):
        full = 4.5 / (2**23 - 1) / gain * 1e6 * 2**23
        for level in (0, 0.5, 0.7499999, 0.75, 0.7500001, 0.8999999, 0.9, 0.9000001, 0.95, 1):
            for sign in (1, -1):
                x = np.tile([0, sign * full * level], 3 * rate // 2 + 1)[: 3 * rate]
                add(f"boundary_{level}_{sign}", 1, len(x), x, rate, gain)
        for level in (0, 0.5, 0.8, 0.95):
            for streaming in (True, False):
                x = np.full(3 * rate, full * level)
                add(f"flat_{level}", 1, len(x), x, rate, gain, streaming)
        x = np.tile([0, 100], rate * 2)
        x[0] = full
        add("expired_peak", 1, len(x), x, rate, gain)
        x = np.tile([0, 100], rate * 2)
        x[-rate] = full
        add("recent_peak", 1, len(x), x, rate, gain)

for level in (
    np.float32(1e-5),
    np.nextafter(np.float32(1e-5), np.float32(0)),
    np.nextafter(np.float32(1e-5), np.float32(1)),
):
    add("epsilon_" + str(level), 1, 750, np.tile([0, level], 375))

binary = WORK / "same-samples.bin"
original = WORK / "original-results.csv"
with binary.open("wb") as out:
    out.write(struct.pack(">i", len(cases)))
    for c in cases:
        out.write(struct.pack(">id?i", c["rate"], c["gain"], c["streaming"], len(c["x"])))
        out.write(c["x"].astype(">f4").tobytes())
try:
    subprocess.run(
        [
            str(GUI / "java/bin/java.exe"),
            "-cp",
            str(WORK) + ";" + str(GUI / "lib/*"),
            "InstalledGuiRail",
            str(binary),
            str(original),
        ],
        check=True,
        cwd=ROOT,
    )
finally:
    binary.unlink(missing_ok=True)  # Do not keep another copy of EEG.
rows = []
for line, c in zip(original.read_text(encoding="utf-8").splitlines(), cases):
    index, state, percent, notification = line.split(",", 3)
    assert int(index) == len(rows)
    original_percent = float(percent)
    rows.append(
        dict(
            dataset=c["dataset"],
            channel=c["channel"],
            endSample=c["endSample"],
            rate=c["rate"],
            gain=c["gain"],
            streaming=c["streaming"],
            guiState=state,
            appState=c["state"],
            guiPercent=original_percent,
            appPercent=c["percent"],
            stateMatch=state == c["state"],
            displayPercentMatch=abs(round(original_percent, 2) - c["percent"]) < 1e-9,
        )
    )
assert len(rows) == len(cases)
with (OUTPUT / "comparison.csv").open("w", newline="", encoding="utf-8-sig") as out:
    writer = csv.DictWriter(out, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
summary = dict(
    reference="Installed OpenBCI_GUI.jar DataStatus.update (unmodified bytecode)",
    guiJarSha256=hashlib.sha256((GUI / "lib/OpenBCI_GUI.jar").read_bytes()).hexdigest(),
    appSourceSha256=hashlib.sha256((ROOT / "engine/rail.py").read_bytes()).hexdigest(),
    files=files,
    total=len(rows),
    recordedComparisons=sum(r["dataset"].endswith(".txt") for r in rows),
    states=sorted(set(r["guiState"] for r in rows)),
    stateMismatches=sum(not r["stateMatch"] for r in rows),
    displayPercentageMismatches=sum(not r["displayPercentMatch"] for r in rows),
    mismatches=[r for r in rows if not r["stateMatch"] or not r["displayPercentMatch"]],
    assumptions="Historical recordings: both algorithms gain24, streaming=true, thresholds75/90; timestamp transport/firmware/settings equality not established by this replay.",
)
(OUTPUT / "summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(
    json.dumps(
        {k: v for k, v in summary.items() if k not in ("mismatches", "files")},
        ensure_ascii=False,
        indent=2,
    )
)
if summary["mismatches"]:
    print("FIRST MISMATCHES", json.dumps(summary["mismatches"][:4], ensure_ascii=False))

assert summary["stateMismatches"] == 0 and summary["displayPercentageMismatches"] == 0, (
    "GUI parity regression"
)
