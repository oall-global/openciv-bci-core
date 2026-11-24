import json
import subprocess
import queue
import threading
import time
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
packaged = "--packaged" in sys.argv
exe = (
    [str(root / "engine/dist/neurolink-engine/neurolink-engine.exe")]
    if packaged
    else [
        (
            sys.executable
            if sys.platform == "darwin"
            else str(root / "engine/.venv/Scripts/python.exe")
        ),
        "-u",
        str(root / "engine/main.py"),
    ]
)
p = subprocess.Popen(
    exe,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    encoding="utf-8",
)
events = queue.Queue()
errors = []


def read():
    for line in p.stdout:
        events.put(json.loads(line))


threading.Thread(target=read, daemon=True).start()
threading.Thread(target=lambda: errors.append(p.stderr.read()), daemon=True).start()


def wait(predicate, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            value = events.get(timeout=0.3)
        except queue.Empty:
            continue
        if predicate(value):
            return value
    raise AssertionError("Timed out; process=" + str(p.poll()) + "; stderr=" + str(errors))


seq = 0


def command(method, params=None):
    global seq
    seq += 1
    p.stdin.write(json.dumps({"id": seq, "method": method, "params": params or {}}) + "\n")
    p.stdin.flush()
    return wait(lambda v: v.get("type") == "response" and v.get("id") == seq)


try:
    wait(lambda v: v["type"] == "ready")
    assert command("connect", {"transport": "demo"})["result"]
    data = wait(lambda v: v["type"] == "data")
    assert len(data["samples"]) == 16 and len(data["timestamps"]) == len(data["samples"][0])
    assert all(x == "good" for x in data["quality"])
    assert len(data["rail"]["states"]) == 16 and data["rail"]["sampleCount"] == 750
    assert len(data["rail"]["peaks"]) == 16 and 187499 < data["rail"]["fullScale"] < 187501
    assert command("fault", {"value": "quality"})["result"]
    data = wait(lambda v: v["type"] == "data" and "bad" in v["quality"])
    assert data["quality"][3] == "bad"
    assert command("fault", {"value": "stream"})["result"]
    wait(lambda v: v["type"] == "status" and v["status"] == "reconnecting", 8)
    assert command("disconnect")["result"]
    assert command(
        "connect", {"transport": "serial", "model": "cyton-daisy", "address": "invalid"}
    ).get("error")
    assert command("fault", {"value": "connect"})["result"]
    assert command("connect", {"transport": "demo"}).get("error")
    command("fault", {"value": ""})
    assert command("connect", {"transport": "demo"})["result"]
    wait(lambda v: v["type"] == "data")
    command("shutdown")
    p.wait(timeout=5)
    assert p.returncode == 0
    print(
        "PASS: synthetic 16 channels, timestamps, quality fault, stale/reconnect, disconnect, validation, failed connect, recovery, clean shutdown; packaged="
        + str(packaged)
    )
finally:
    if p.poll() is None:
        p.kill()
