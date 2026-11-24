"""Known signals and failure paths; hardware behavior needs separate live validation."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import main as m
from connection_check import contact_result, signal_results

for rate in (125, 250, 500, 1000):
    t = np.arange(rate * 3) / rate
    for kohm, q in ((200, "good"), (1000, "warn"), (3000, "bad")):
        amplitude = (kohm * 1000 + 2200) * 6e-9 * 1e6
        r = contact_result(amplitude * np.sin(2 * np.pi * 31.25 * t), rate)
        assert r["quality"] == q, (rate, kohm, r)
        assert abs(r["kohm"] / kohm - 1) < 0.1, (rate, kohm, r)
    assert contact_result(np.ones(rate * 3) * 100, rate)["quality"] == "unknown"
    assert contact_result(np.sin(2 * np.pi * 10 * t) * 100, rate)["quality"] == "unknown"
    assert contact_result(np.ones(rate * 3) * 4.4e6, rate)["quality"] == "bad"
    assert contact_result([float("nan")] * rate * 3, rate)["quality"] == "unknown"

t = np.arange(2500) / 250
x = np.tile(20 * np.sin(2 * np.pi * 10 * t), (16, 1))
x[0, :250] += 180000
assert signal_results(x.T.tolist(), 250)[0]["quality"] == "bad", (
    "Early saturation must not disappear from the 10-second result"
)

clock = [100.0]
events = []
with (
    patch.object(m, "emit", side_effect=events.append),
    patch("time.monotonic", side_effect=lambda: clock[0]),
):
    e = m.Engine()
    e.board = MagicMock()
    e.board.config_board.return_value = "Success"
    e.config = {"transport": "serial"}
    e.channels = list(range(1, 17))
    e.timestamp_channel = 17
    e.package_channel = 0
    e.received = True
    e.last_data = 100.0
    e.rate = 250
    checker = e.check
    checker.start({"electrode": "passive-dry", "wiring": "N-SRB2-BIAS"})

    def batch(n=250):
        x = np.zeros((18, n))
        x[0] = (np.arange(n) * 2) % 256
        x[17] = clock[0] + np.arange(n) / 250
        x[1:17] = 100 * np.sin(2 * np.pi * 31.25 * np.arange(n) / 250)
        return x

    # Directly enter the first channel; no native command is allowed to enable two channels.
    checker.next_channel()
    commands = lambda: [c.args[0] for c in e.board.config_board.call_args_list]
    assert commands() == ["x1000100X", "z101Z"], commands()
    checker.next_channel()
    assert commands() == ["x1000100X", "z101Z", "z100Z", "x1060110X", "x2000100X", "z201Z"], (
        commands()
    )
    checker.finish("cancelled", "cancel")
    assert commands()[-2:] == ["z200Z", "x2060110X"] and checker.dirty is None
    assert not checker.active and not e.alpha.rows

    # Normal frames and Alpha can resume after all test history has been discarded.
    e.board.get_board_data.return_value = batch()
    events.clear()
    e.tick()
    assert any(v["type"] == "data" for v in events), events
    assert any(v.get("status") == "streaming" for v in events), events

    # Partial start failure leaves stream stopped; cleanup must still disable injection.
    e.received = True
    e.last_data = 100.0
    checker.start({"electrode": "passive-dry", "wiring": "N-SRB2-BIAS"})
    checker.dirty = 0
    e.board.stop_stream.side_effect = RuntimeError("already stopped")
    checker.finish("error", "partial failure")
    assert checker.dirty is None and not e.recovery_required
    e.board.stop_stream.side_effect = None

    # Failed acknowledgement blocks normal analysis until reconnection.
    e.received = True
    e.last_data = 100.0
    checker.start({"electrode": "passive-dry", "wiring": "N-SRB2-BIAS"})
    checker.dirty = 0
    e.board.config_board.return_value = "Failure"
    checker.finish("cancelled", "cancel")
    assert e.recovery_required and checker.result["phase"] == "error" and checker.dirty == 0
    e.board.get_board_data.reset_mock()
    e.tick()
    e.board.get_board_data.assert_not_called()

    # Engine routes injected data only to check logic: no alpha / waveform frames.
    e.recovery_required = False
    checker.dirty = None
    e.received = True
    e.board.config_board.return_value = "Success"
    checker.start({"electrode": "passive-dry", "wiring": "N-SRB2-BIAS"})
    events.clear()
    e.board.get_board_data.return_value = batch()
    e.tick()
    assert not any(v["type"] in ("alpha", "data") for v in events)
    clock[0] += 6
    e.board.get_board_data.return_value = np.zeros((18, 0))
    e.tick()
    assert not checker.active and checker.result["phase"] == "error"

# Wi-Fi gain updates must use BrainFlow and verify Shield gain; no silent empty ack.
e = m.Engine()
e.board = MagicMock()
e.config = {"transport": "wifi", "address": "192.168.4.1"}
with patch.object(m.http.client, "HTTPConnection") as http:
    reply = http.return_value.getresponse.return_value
    reply.status = 200
    reply.read.return_value = b'{"gains":[1,24,24,24,24,24,24,24,24,24,24,24,24,24,24,24]}'
    e.check_command("x1000100X")
    e.board.config_board.assert_called_once_with("x1000100X")
    reply.read.return_value = b'{"gains":[24]}'
    try:
        e.check_command("x1000100X")
    except ValueError:
        pass
    else:
        raise AssertionError("Wrong gain must fail")
    reply.read.return_value = b""
    try:
        e.check_command("z101Z", acknowledge=True)
    except ValueError:
        pass
    else:
        raise AssertionError("Empty acknowledgement must fail")
print(
    "PASS: calibrated tone, invalid/flat response, channel isolation, cancellation, partial failure cleanup, restore failure blocks analysis, no test EEG escapes, timeout, Wi-Fi gain/ack checks"
)
