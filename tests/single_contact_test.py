import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import main as m

clock = [100.0]
with patch("time.monotonic", side_effect=lambda: clock[0]), patch.object(m, "emit"):
    e = m.Engine()
    e.board = MagicMock()
    e.board.config_board.return_value = "Success"
    e.config = {"transport": "serial"}
    e.channels = list(range(1, 17))
    e.timestamp_channel = 17
    e.package_channel = 0
    e.rate = 250
    params = {"electrode": "passive-dry", "wiring": "N-SRB2-BIAS"}

    def ready():
        e.received = True
        e.last_data = clock[0]

    for ch in (-1, 16, True, 1.5, "7"):
        ready()
        try:
            e.check.start({**params, "channel": ch})
        except ValueError:
            pass
        else:
            raise AssertionError(ch)
    assert not e.check.active and not e.board.config_board.called
    ready()
    e.check.start({**params, "channel": 8})
    commands = lambda: [c.args[0] for c in e.board.config_board.call_args_list]
    assert commands() == ["xQ000100X", "zQ01Z"], commands()
    # Four continuous seconds, one channel result; normal EEG history stays separate.
    for k in range(4):
        clock[0] += 1
        data = np.zeros((18, 250))
        data[0] = (np.arange(250) * 2 + k * 500) % 256
        data[17] = 100 + k + np.arange(250) / 250
        data[1:17] = (202200 * 6e-9 * 1e6) * np.sin(2 * np.pi * 31.25 * (k + np.arange(250) / 250))
        e.check.tick(data)
    assert e.check.result["phase"] == "complete" and e.check.result["scope"] == "single", (
        e.check.result
    )
    assert [i for i, r in enumerate(e.check.result["contacts"]) if r is not None] == [8]
    assert all(r is None for r in e.check.result["signals"])
    assert commands()[-2:] == ["zQ00Z", "xQ060110X"] and e.check.dirty is None
    ready()
    e.check.start({**params, "channel": 15})
    e.check.finish("cancelled", "cancel")
    assert commands()[-2:] == ["zI00Z", "xI060110X"]
    # Injection command fails once; restoration must still run before returning error.
    ready()

    def fail_once(cmd):
        if cmd == "z701Z":
            raise RuntimeError("ack failure")
        return "Success"

    e.board.config_board.side_effect = fail_once
    e.check.start({**params, "channel": 6})
    assert not e.check.active and e.check.result["phase"] == "error" and e.check.dirty is None
    assert commands()[-2:] == ["z700Z", "x7060110X"]
print(
    "PASS single target validation, Daisy selectors, isolated result, restoration, cancellation and partial start failure"
)
