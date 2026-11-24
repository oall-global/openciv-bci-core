"""Invalid data must never declare streaming or keep the connection alive."""

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np

spec = importlib.util.spec_from_file_location(
    "engine", Path(__file__).resolve().parents[1] / "engine/main.py"
)
m = importlib.util.module_from_spec(spec)
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
spec.loader.exec_module(m)


def batch(times=(1000.0, 1000.004)):
    data = np.ones((17, len(times)))
    data[16] = times
    return data


def setup():
    e = m.Engine()
    e.board = MagicMock()
    e.channels = list(range(16))
    e.timestamp_channel = 16
    e.config = {"transport": "demo"}
    e.last_data = 10.0
    e.received = False
    return e


invalid = []
for value in (np.nan, np.inf, -np.inf):
    data = batch()
    data[3, 0] = value
    invalid.append(data)
for times in ((np.nan, 1000.0), (1000.0, np.inf), (0.0, 0.004), (1000.0, 999.0), (1000.0, 1000.0)):
    invalid.append(batch(times))
for data in invalid:
    e = setup()
    board = e.board
    board.get_board_data.return_value = data
    with patch.object(m, "emit") as emit, patch.object(m.time, "monotonic", return_value=12.0):
        e.tick()
        events = [c.args[0] for c in emit.call_args_list]
        assert not any(x.get("status") == "streaming" or x["type"] == "data" for x in events)
        assert e.last_data == 10.0 and len(e.history) == 0 and e.board is board
    with patch.object(m, "emit") as emit, patch.object(m.time, "monotonic", return_value=14.0):
        e.tick()
        assert e.board is None and e.reconnect_at == 19.0
        assert any(c.args[0].get("status") == "reconnecting" for c in emit.call_args_list)
        board.release_session.assert_called_once()

# Repeated timestamps across batches are also rejected, and valid recovery works.
e = setup()
e.board.get_board_data.return_value = batch()
with patch.object(m, "emit") as emit, patch.object(m.time, "monotonic", return_value=11.0):
    e.tick()
    assert e.last_timestamp == 1000.004 and e.received
    assert any(c.args[0]["type"] == "data" for c in emit.call_args_list)
with patch.object(m, "emit") as emit, patch.object(m.time, "monotonic", return_value=12.0):
    e.tick()
    assert not e.received and e.last_data == 11.0
    assert not any(c.args[0]["type"] == "data" for c in emit.call_args_list)
e.board.get_board_data.return_value = batch((1000.008, 1000.012))
with patch.object(m, "emit") as emit, patch.object(m.time, "monotonic", return_value=12.5):
    e.tick()
    assert e.received and e.last_data == 12.5
    assert any(c.args[0].get("status") == "streaming" for c in emit.call_args_list)
    assert len(e.history) == 4
print(
    "PASS: nonfinite signals, invalid/repeated timestamps rejected; persistent invalid data reconnects; valid data recovers"
)

# Short Wi-Fi stalls should not discard a live TCP session; persistent outages still recover.
e = setup()
e.config = {"transport": "wifi"}
e.received = True
e.board.get_board_data.return_value = np.zeros((17, 0))
with (
    patch.object(m, "emit"),
    patch.object(m.time, "monotonic", return_value=14.0),
    patch.object(e, "schedule_retry") as retry,
):
    e.tick()
    retry.assert_not_called()
    assert not e.received
with (
    patch.object(m, "emit"),
    patch.object(m.time, "monotonic", return_value=21.0),
    patch.object(e, "schedule_retry") as retry,
):
    e.tick()
    retry.assert_called_once()
print("PASS: Wi-Fi transient stall keeps TCP; persistent 10-second outage reconnects")
