"""Explicit, short hardware test; persists statistics only, never raw EEG."""

import argparse, json, subprocess, threading, queue, time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--address", required=True)
parser.add_argument("--seconds", type=int, default=10)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
p = subprocess.Popen(
    [str(root / "engine/dist/neurolink-engine/neurolink-engine.exe")],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
    encoding="utf-8",
)
q = queue.Queue()
threading.Thread(target=lambda: [q.put(json.loads(line)) for line in p.stdout], daemon=True).start()


def send(method, params=None):
    p.stdin.write(json.dumps({"id": method, "method": method, "params": params or {}}) + "\n")
    p.stdin.flush()


s = {
    "packaged": True,
    "samples": 0,
    "batches": 0,
    "channels": 16,
    "statuses": [],
    "alphaEvents": 0,
    "railFrames": 0,
}
first = last = None
try:
    event = q.get(timeout=15)
    assert event["type"] == "ready"
    s["engineVersion"] = event["version"]
    send(
        "connect",
        {
            "transport": "wifi",
            "model": "cyton-daisy",
            "address": args.address,
            "sampleRate": 250,
            "localPort": 6677,
        },
    )
    until = time.monotonic() + args.seconds
    while time.monotonic() < until:
        event = q.get(timeout=12)
        if event["type"] == "response" and event.get("error"):
            raise RuntimeError(event["error"])
        if event["type"] == "status":
            s["statuses"].append(event["status"])
        if event["type"] == "alpha":
            assert len(event["absolute"]) == 16 and all(0 <= x <= 100 for x in event["relative"])
            s["alphaEvents"] += 1
        if event["type"] == "data":
            assert len(event["samples"]) == 16
            if "rail" in event:
                assert len(event["rail"]["states"]) == 16
                if "warming" not in event["rail"]["states"]:
                    s["railFrames"] += 1
            s["samples"] += len(event["timestamps"])
            s["batches"] += 1
            if first is None:
                first = event["timestamps"][0]
            last = event["timestamps"][-1]
    assert s["samples"] > 0 and "streaming" in s["statuses"] and s["alphaEvents"] > 0
    s["observedSamplesPerSecond"] = round((s["samples"] - 1) / (last - first), 2)
    s["passed"] = True
finally:
    send("disconnect")
    send("shutdown")
    p.wait(timeout=12)
s["exitCode"] = p.returncode
(root / "test-results/hardware-packaged.json").write_text(json.dumps(s, indent=2), encoding="utf-8")
print(json.dumps(s))
