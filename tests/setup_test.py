import sys, json
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from connection_setup import (
    usb_inventory,
    probe_shield,
    validate_address,
    parse_identity,
    configure_usb,
)
import main

for address in (
    "127.0.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "http://192.168.4.1",
    "192.168.4.1/evil",
    "1.2.3.4:80",
):
    try:
        validate_address(address)
    except ValueError:
        pass
    else:
        raise AssertionError(address)
assert validate_address("192.167.1.13") == "192.167.1.13"
assert parse_identity(b"eeg\r\n") == {"identity": "eeg"}
identity = parse_identity(b"eeg-2-16\r\neeg-2-16-Lab-WiFi-192.158.0.140\r\n")
assert (
    identity["mode"] == 2
    and identity["channels"] == 16
    and identity["address"] == "192.158.0.140"
    and identity["networkName"] == "Lab-WiFi"
)
for reply in (b"not eeg", b"eegx", b"eeg-9-16", b"No device", b""):
    assert parse_identity(reply) is None
with (
    patch(
        "connection_setup.list_ports.comports",
        return_value=[
            MagicMock(device="COM3", description="CH340", vid=123),
            MagicMock(device="/dev/cu.Bluetooth-Incoming-Port", vid=None),
            MagicMock(device="/dev/cu.debug-console", vid=None),
        ],
    ),
    patch("connection_setup.open_serial") as opened,
    patch("connection_setup.handshake", return_value=identity) as handshake,
):
    with patch("connection_setup.sys.platform", "win32"):
        windows = usb_inventory()
        assert len(windows["ports"]) == 3
        assert opened.call_count == 3
    opened.reset_mock()
    with patch("connection_setup.sys.platform", "darwin"):
        r = usb_inventory()
    opened.assert_called_once_with("COM3")
    assert len(r["ports"]) == 1
    assert (
        r["provisioning"] == "serial-v1"
        and r["ports"][0]["verified"]
        and r["ports"][0]["address"] == "192.158.0.140"
    )
    c = opened.return_value
    for mode, ending, expected in [
        ("direct", "none", b"1|NeuroLink|12345678"),
        ("router", "crlf", b"2|NeuroLink|12345678\r\n"),
    ]:
        c.write.return_value = len(expected)
        result = configure_usb(
            {
                "port": "COM3",
                "mode": mode,
                "ending": ending,
                "name": "NeuroLink",
                "password": "12345678",
            }
        )
        c.write.assert_called_with(expected)
        assert result == {"sent": True, "confirmed": False}
        c.close.assert_called()
    handshake.return_value = None
    c.write.reset_mock()
    try:
        configure_usb(
            {"port": "COM3", "mode": "direct", "name": "NeuroLink", "password": "12345678"}
        )
    except ValueError:
        pass
    else:
        raise AssertionError("must re-identify before configuration")
    c.write.assert_not_called()
    for name, password in [
        ("Bad|SSID", "12345678"),
        ("SSID", "1234\n678"),
        ("SSID", "short"),
        ("SSID", "x" * 64),
    ]:
        try:
            configure_usb({"port": "COM3", "mode": "direct", "name": name, "password": password})
        except ValueError:
            pass
        else:
            raise AssertionError("invalid fields must not be transmitted")
with patch("connection_setup.http.client.HTTPConnection") as http:
    response = http.return_value.getresponse.return_value
    response.status = 200
    response.read.return_value = json.dumps({"board_type": "Cyton", "num_channels": 32}).encode()
    r = probe_shield("192.168.4.1")
    assert r["verified"] and r["reportedChannels"] == 32 and "sn" not in r
    http.return_value.request.assert_any_call("GET", "/board")
    http.return_value.close.assert_called()
    # the newer board answers both: its serial number from /status
    board = {"board_type": "Cyton", "num_channels": 32}
    response.read.side_effect = [json.dumps(board).encode(), b'{"sn":"OCBCI01010100002"}']
    r = probe_shield("192.168.4.1")
    assert r["reportedChannels"] == 32 and r["sn"] == "OCBCI01010100002"
    response.read.side_effect = None
    for body in (
        b"{}",
        b"[]",
        b'{"board_type":"cyton","num_channels":true}',
        b"not json",
        b"x" * 8193,
    ):
        response.read.return_value = body
        try:
            probe_shield("192.168.4.1")
        except ValueError:
            pass
        else:
            raise AssertionError(body[:80])
    # the newer firmware: no /board, GET /status instead
    status = {"board_connected": True, "mode": 2, "ssid": "Lab", "num_channels": 32}
    response.read.side_effect = [b"not found", json.dumps(status).encode()]
    r = probe_shield("192.168.4.1")
    assert r["boardType"] == "cyton" and r["reportedChannels"] == 32 and r["networkName"] == "Lab"
    http.return_value.request.assert_called_with("GET", "/status")
    response.read.side_effect = None
    response.status = 302
    response.read.return_value = b"{}"
    try:
        probe_shield("192.168.4.1")
    except ValueError:
        pass
    else:
        raise AssertionError("redirect")
e = main.Engine()
e.board = MagicMock()
try:
    e.command({"method": "setup-probe", "params": {"address": "192.168.4.1"}})
except ValueError:
    pass
else:
    raise AssertionError("active acquisition must not be probed")
print(
    "PASS actual EEG identity variants, USB config exact AP/client bytes, re-identification, no unacknowledged success, field validation, read-only HTTP probe and active-board guard; serial writes mocked"
)


# the newer firmware answers "connect" only at the end of a line: a newline follows the bare
# command after a pause, and the reply says later commands need one too
class LineFirmware:
    def __init__(self, needs_newline):
        self.sent, self.needs = b"", needs_newline

    def reset_input_buffer(self):
        pass

    def flush(self):
        pass

    def write(self, data):
        self.sent += data

    def read(self, n):
        done = self.sent.endswith(b"connect\n") if self.needs else self.sent == b"connect"
        if done and not getattr(self, "told", False):
            self.told = True
            return b"eeg-1-16\r\n"
        return b""


import connection_setup  # noqa: E402

with patch.object(connection_setup.time, "monotonic", side_effect=[i * 0.2 for i in range(200)]):
    new = connection_setup.handshake(LineFirmware(True), b"")
with patch.object(connection_setup.time, "monotonic", side_effect=[i * 0.2 for i in range(200)]):
    old = connection_setup.handshake(LineFirmware(False), b"")
assert new == {"identity": "eeg", "mode": 1, "channels": 16, "newline": True}, new
assert old == {"identity": "eeg", "mode": 1, "channels": 16}, old
print("PASS handshake: bare connect (older firmware), newline after a pause (newer)")


# the battery: GET /status of the newer firmware; none from the OpenBCI Shield
from connection_setup import battery, battery_percent, steady_battery  # noqa: E402

with patch("connection_setup.http.client.HTTPConnection") as http:
    response = http.return_value.getresponse.return_value
    response.status = 200
    response.read.return_value = json.dumps(
        {"battery_v": 3.91, "battery_percent": 68, "battery_low": False}
    ).encode()
    # the corrected voltage on the discharge curve, not the board's linear percent
    assert battery("192.168.4.1") == {"percent": 100, "low": False}
    http.return_value.request.assert_called_with("GET", "/status")
    response.read.return_value = json.dumps({"battery_percent": 9, "battery_low": True}).encode()
    assert battery("192.168.4.1") == {"percent": 9, "low": True}
    for body in (b"{}", b'{"battery_percent": 140}', b'{"battery_percent": "68"}', b"x"):
        response.read.return_value = body
        assert battery("192.168.4.1") is None, body
# 3.61 V just after a full charge reads near full; the low end and the bounds
assert 95 <= battery_percent(3.61) <= 100
assert battery_percent(2.9) == 0 and battery_percent(4.0) == 100
assert battery_percent(3.30) < battery_percent(3.40) < battery_percent(3.50)
assert steady_battery({"percent": 80, "low": False}, {"percent": 83, "low": False})["percent"] == 80
assert steady_battery({"percent": 80, "low": False}, {"percent": 78, "low": False})["percent"] == 78
assert steady_battery({"percent": 40, "low": False}, {"percent": 60, "low": False})["percent"] == 60
print("PASS battery: /status percent and low flag; nothing when absent or invalid")
