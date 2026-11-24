import importlib.util
import sys
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
spec = importlib.util.spec_from_file_location(
    "engine", Path(__file__).resolve().parents[1] / "engine/main.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
identify = module.identify_shield
assert identify("HTTP/1.1 200 OK\r\nSERVER: OpenBCI", "192.168.4.1")
with patch.object(module.http.client, "HTTPConnection") as http:
    assert identify("HTTP/1.1 200 OK\r\nLOCATION: http://example.com/secret", "192.168.4.1") is None
    http.assert_not_called()
    response = http.return_value.getresponse.return_value
    response.status = 200
    response.read.return_value = (
        b"<root><device><friendlyName>OpenBCI-1234</friendlyName></device></root>"
    )
    assert (
        identify("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.4.1/description.xml", "192.168.4.1")
        == "OpenBCI-1234"
    )
    response.read.return_value = b"<root><device><friendlyName>My TV</friendlyName></device></root>"
    assert (
        identify("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.4.1/description.xml", "192.168.4.1")
        is None
    )
print(
    "PASS discovery: headers, OpenBCI XML identity, unrelated-device exclusion, off-host URL rejection"
)

ports = [
    SimpleNamespace(
        device="COM3", vid=0x1A86, hwid="USB VID:PID=1A86:7522", description="USB-SERIAL CH340K"
    ),
    SimpleNamespace(device="COM4", vid=0x0403, hwid="USB", description="FTDI"),
    SimpleNamespace(device="COM5", vid=0x10C4, hwid="USB", description="CP210x"),
    SimpleNamespace(device="COM6", vid=None, hwid="BTHENUM", description="Bluetooth"),
]
with (
    patch.object(module.list_ports, "comports", return_value=ports),
    patch.object(module.socket, "socket") as sock,
):
    sock.return_value.__enter__.return_value.sendto.side_effect = OSError("offline")
    devices = module.discover()
    assert [d["address"] for d in devices] == ["COM3", "COM4", "COM5"]
    assert all(d["verified"] is False and d["transport"] == "serial" for d in devices)
print(
    "PASS: CH340K, FTDI, CP210x shown as unverified candidates; Bluetooth excluded; works without network"
)

# the HTTP sweep: the computer's own networks, /22 at most, link-local skipped; a public range
# handed out by a router (192.158.0.0/22) is swept too
hosts = module.scan_networks.__globals__["scan_hosts"]
assert len(hosts([{"cidr": "192.158.0.131/22"}])) == 1021
assert len(hosts([{"cidr": "10.1.2.3/16"}])) == 253
assert hosts([{"cidr": "169.254.1.1/16"}, {"cidr": "bad"}, {}]) == []
print("PASS sweep: own networks, /22 at most, link-local skipped")
