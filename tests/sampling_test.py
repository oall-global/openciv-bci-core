"""Verify actual Shield HTTP ack instead of BrainFlow's empty config return."""

import importlib.util
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "engine", Path(__file__).resolve().parents[1] / "engine/main.py"
)
m = importlib.util.module_from_spec(spec)
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
spec.loader.exec_module(m)


def setup(shim, http, reply, status=200):
    shim.get_eeg_channels.return_value = list(range(1, 17))
    shim.get_timestamp_channel.return_value = 30
    shim.return_value.config_board.return_value = ""
    http.return_value.getresponse.return_value.status = status
    http.return_value.getresponse.return_value.read.return_value = reply


cfg = {"transport": "wifi", "model": "cyton-daisy", "address": "192.168.4.1", "sampleRate": 250}
for rate, command in ((250, "~6"), (500, "~5"), (1000, "~4")):
    with (
        patch.object(m, "BoardShim") as shim,
        patch.object(m.http.client, "HTTPConnection") as http,
        redirect_stdout(io.StringIO()),
    ):
        setup(shim, http, f"Success: Sample rate is now {rate}Hz".encode())
        e = m.Engine()
        e.connect({**cfg, "sampleRate": rate})
        args = http.return_value.request.call_args
        assert args.args == ("POST", "/command") and json.loads(args.kwargs["body"]) == {
            "command": command
        }
        # connect clears lead-off on all channels and the wear probe's test gain on Fp1
        sent = [c.args[0] for c in shim.return_value.config_board.call_args_list]
        assert all(c.startswith("z") for c in sent[:-1]) and sent[-1] == "x1060110X", sent
        shim.return_value.start_stream.assert_called_once_with(rate * 10)
        assert e.rate == rate and e.history.maxlen == rate * 2
        http.return_value.close.assert_called_once()
        e.close_board()
for reply, status in (
    (b"", 200),
    (b"Failure", 200),
    (b"Success: Sample rate is now 500Hz", 200),
    (b"Success: Sample rate is now 250Hz", 500),
    (b"x" * 4097, 200),
):
    with (
        patch.object(m, "BoardShim") as shim,
        patch.object(m.http.client, "HTTPConnection") as http,
        redirect_stdout(io.StringIO()),
    ):
        setup(shim, http, reply, status)
        try:
            m.Engine().connect(cfg)
        except ValueError:
            pass
        else:
            raise AssertionError("Bad ack must fail")
        shim.return_value.start_stream.assert_not_called()
        shim.return_value.release_session.assert_called_once()
        http.return_value.close.assert_called_once()
with (
    patch.object(m, "BoardShim") as shim,
    patch.object(m.http.client, "HTTPConnection") as http,
    patch.object(m, "discover", return_value=[{"transport": "wifi", "address": "192.168.4.1"}]),
    redirect_stdout(io.StringIO()),
):
    setup(shim, http, b"Success: Sample rate is now 250Hz")
    e = m.Engine()
    e.connect({**cfg, "address": ""})
    http.assert_called_once_with("192.168.4.1", 80, timeout=8)
    e.close_board()
print(
    "PASS: empty BrainFlow return bypassed; 250/500/1000 HTTP ack; wrong/missing/status/oversize rejection; discovery uses resolved IP"
)
