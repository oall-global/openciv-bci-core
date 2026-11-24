"""Read-only setup checks. USB bridges are not assumed to support provisioning."""

import http.client
import ipaddress
import json
import time
import re
import socket
import sys
from concurrent.futures import ThreadPoolExecutor
import serial
from serial.tools import list_ports

ENDINGS = {"none": b"", "lf": b"\n", "crlf": b"\r\n"}


def open_serial(port):
    # Avoid deliberately pulsing DTR/RTS when opening the configuration port.
    connection = serial.Serial(port=None, baudrate=115200, timeout=0.1, write_timeout=1)
    connection.dtr = False
    connection.rts = False
    connection.port = port
    connection.open()
    time.sleep(1.8)  # This board needs time after opening its CH340 configuration port.
    return connection


def parse_identity(response):
    text = response.decode("utf-8", errors="replace")
    for line in text.splitlines():
        line = line.strip()
        if line.lower() == "eeg":
            return {"identity": "eeg"}
        match = re.fullmatch(r"eeg-([123])-(\d+)(?:-(.*))?", line, re.IGNORECASE)
        if match:
            result = {"identity": "eeg", "mode": int(match[1]), "channels": int(match[2])}
            # Actual firmware replies first eeg-2-16, then eeg-2-16-SSID-IP.
            for detail in text.splitlines():
                suffix = re.fullmatch(
                    r"eeg-[123]-\d+-(.*)-(\d+\.\d+\.\d+\.\d+)", detail.strip(), re.IGNORECASE
                )
                if suffix:
                    try:
                        result.update(
                            address=validate_address(suffix[2]), networkName=suffix[1][:64]
                        )
                    except ValueError:
                        pass
            return result
    return None


def handshake(connection, ending):
    """The device's identity, or None. With no line ending: the older firmware answers a bare
    "connect"; the newer one waits for the end of the line, so a newline follows after a
    pause when nothing came back (identity["newline"]: later commands end with one too)."""
    connection.reset_input_buffer()
    connection.write(b"connect" + ending)
    connection.flush()
    response = bytearray()
    start = time.monotonic()
    deadline, newline = start + 3.5, False
    while time.monotonic() < deadline and len(response) < 256:
        response.extend(connection.read(64))
        identity = parse_identity(bytes(response))
        if identity is not None and identity.get("address"):
            return {**identity, "newline": True} if newline else identity
        if not ending and not newline and not response and time.monotonic() - start > 1.2:
            connection.write(ENDINGS["lf"])
            connection.flush()
            newline, deadline = True, time.monotonic() + 3.5
    identity = parse_identity(bytes(response))
    return {**identity, "newline": True} if identity and newline else identity


def usb_inventory(ending="none"):
    if ending not in ENDINGS:
        raise ValueError("命令结尾请选择 none、lf 或 crlf")
    # Bluetooth and debug-console ports on macOS can block during open(), before
    # the serial read timeout applies. USB provisioning must only probe USB ports.
    ports = list(list_ports.comports())
    if sys.platform == "darwin":
        ports = [p for p in ports if p.vid is not None]
    if len(ports) > 16:
        raise ValueError("串口超过 16 个，请先断开不使用的串口设备再扫描")

    def probe(p):
        connection = None
        result = {"port": p.device, "description": str(p.description)[:120], "verified": False}
        try:
            connection = open_serial(p.device)
            identity = handshake(connection, ENDINGS[ending])
            result["verified"] = identity is not None
            if identity:
                result.update(identity)
            result["state"] = "eeg" if result["verified"] else "no-match"
        except (OSError, serial.SerialException):
            result["state"] = "unavailable"
        finally:
            if connection is not None:
                connection.close()
        return result

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(probe, ports))
    return {
        "ports": results,
        "provisioning": "serial-v1",
        "detail": "115200 波特率 · 已发送 connect；支持 eeg 与 eeg-模式-通道数 身份回复。",
    }


def configure_usb(params):
    port, mode = params.get("port"), params.get("mode")
    ending = params.get("ending", "none")
    name, password = params.get("name"), params.get("password")
    if ending not in ENDINGS or mode not in ("direct", "router"):
        raise ValueError("请选择有效的连接模式和命令结尾")
    if not isinstance(name, str) or not 1 <= len(name.encode("utf-8")) <= 32:
        raise ValueError("Wi-Fi 名称需为 1–32 字节")
    if not isinstance(password, str) or not 8 <= len(password.encode("utf-8")) <= 63:
        raise ValueError("Wi-Fi 密码需为 8–63 字节；当前向导支持有密码的网络")
    if any(c in name + password for c in ("|", "\r", "\n", "\0")):
        raise ValueError("名称和密码不能含竖线、换行或空字符")
    if port not in [p.device for p in list_ports.comports()]:
        raise ValueError("所选 USB 串口已移除，请重新扫描")
    connection = None
    try:
        connection = open_serial(port)
        identity = handshake(connection, ENDINGS[ending])
        if not identity:
            raise ValueError("设备连接失败，请断开 USB 连接并重启脑机设备后重试")
        command = ("1" if mode == "direct" else "2") + "|" + name + "|" + password
        end = ENDINGS["lf"] if identity.get("newline") else ENDINGS[ending]
        payload = command.encode("utf-8") + end
        if connection.write(payload) != len(payload):
            raise ValueError("配置未完整发送，请重新插拔 USB 后重试")
        connection.flush()
        # No configuration acknowledgement is specified in the supplied protocol.
        # Never echo a reply: firmware may echo credentials. Verify over Wi-Fi next.
        return {"sent": True, "confirmed": False}
    except (OSError, serial.SerialException) as error:
        raise ValueError("USB 配置发送失败，请检查设备连接或串口占用") from error
    finally:
        if connection is not None:
            connection.close()


def validate_address(value):
    address = ipaddress.IPv4Address(str(value).strip())
    if (
        address.is_loopback
        or address.is_multicast
        or address.is_unspecified
        or int(address) == 0xFFFFFFFF
    ):
        raise ValueError("请填写设备的 IPv4 地址")
    return str(address)


def read_json(address, path, timeout):
    conn = http.client.HTTPConnection(address, 80, timeout=timeout)
    try:
        conn.request("GET", path)
        response = conn.getresponse()
        body = response.read(8193)
        if response.status != 200 or len(body) > 8192:
            return None
        info = json.loads(body)
        return info if isinstance(info, dict) else None
    except (OSError, http.client.HTTPException, ValueError):
        return None
    finally:
        conn.close()


def shield_info(address, timeout=2):
    """The device at address, or None. Two firmwares answer: the OpenBCI Wi-Fi Shield's
    GET /board (board_type, num_channels), and the newer board's GET /status (num_channels or
    board_connected, its Wi-Fi mode, network and battery); both stream as a Cyton."""
    info = read_json(address, "/board", timeout)
    board_type = str(info.get("board_type", "")).lower() if info else ""
    status = read_json(address, "/status", timeout)
    if board_type in ("cyton", "ganglion") and type(info.get("num_channels")) is int:
        # the newer board answers /board too, without its serial number: that is in /status,
        # and it tells which device just joined after the hotspot when several are on the Wi-Fi
        sn = str(status.get("sn", ""))[:32] if status else ""
        return {"boardType": board_type, "reportedChannels": info["num_channels"], "sn": sn or None}
    info = status
    channels = info.get("num_channels") if info else None
    if info and (type(channels) is int or type(info.get("board_connected")) is bool):
        return {
            "boardType": "cyton",
            "reportedChannels": channels if type(channels) is int else None,
            "networkName": str(info.get("ssid", ""))[:64] or None,
            # the serial number (its hotspot's name): which one, after it joined the Wi-Fi
            "sn": str(info.get("sn", ""))[:32] or None,
        }
    return None


# The board's battery_v reads low: a cell just charged overnight reports 3.61-3.64 V while
# streaming, where a full Li-ion cell holds about 4.15 V. Its own battery_percent is linear in
# that voltage, while a Li-ion cell stays near 3.7-3.9 V for most of its charge and falls fast
# at the end, so the percent comes from the corrected voltage and a discharge curve under load.
BATTERY_V_SCALE = 4.15 / 3.64
BATTERY_CURVE = [  # cell volts, percent
    (3.30, 0),
    (3.45, 5),
    (3.60, 10),
    (3.66, 20),
    (3.71, 30),
    (3.75, 40),
    (3.79, 50),
    (3.84, 60),
    (3.90, 70),
    (3.97, 80),
    (4.05, 90),
    (4.15, 100),
]
BATTERY_LOW = 15


def battery_percent(volts):
    v = volts * BATTERY_V_SCALE
    if v <= BATTERY_CURVE[0][0]:
        return 0
    for (v0, p0), (v1, p1) in zip(BATTERY_CURVE, BATTERY_CURVE[1:]):
        if v <= v1:
            return round(p0 + (p1 - p0) * (v - v0) / (v1 - v0))
    return 100


def battery(address):
    """The board's battery from GET /status (the newer firmware; the OpenBCI Shield has none):
    {percent, low}, or None. From battery_v when the board reports it, else its own percent."""
    info = read_json(address, "/status", 2)
    if not info:
        return None
    volts = info.get("battery_v")
    if type(volts) in (int, float) and 2.5 <= volts <= 5:
        percent = battery_percent(volts)
        return {"percent": percent, "low": percent <= BATTERY_LOW}
    percent = info.get("battery_percent")
    if type(percent) not in (int, float) or not 0 <= percent <= 100:
        return None
    return {"percent": round(percent), "low": info.get("battery_low") is True}


def steady_battery(previous, reading):
    """The voltage swings with the radio's load: within one connection the level only falls,
    and rises only by 5 points or more (charging)."""
    if previous and reading and 0 < reading["percent"] - previous["percent"] < 5:
        return previous
    return reading


def describe(address, info):
    channels = info["reportedChannels"]
    return {
        "name": "OpenBCI Wi-Fi Shield",
        "address": address,
        "transport": "wifi",
        "verified": True,
        "detail": f"{info['boardType']} · 设备报告 {channels} 通道（采集使用 16 通道配置）"
        if channels is not None
        else f"{info['boardType']}（采集使用 16 通道配置）",
        **{k: v for k, v in info.items() if v is not None},
    }


def probe_shield(address):
    address = validate_address(address)
    info = shield_info(address)
    if info is None:
        raise ValueError("暂时无法访问设备。请检查电脑所连 Wi-Fi、设备电源及 IP 地址")
    return describe(address, info)


def scan_hosts(networks):
    """The addresses to try on this computer's own networks ([{cidr}] from Electron; not only
    private ranges: some routers hand out public ones, e.g. 192.158.0.0/22). One wider than
    /22 is narrowed to the computer's own /24."""
    hosts, own = [], set()
    for n in networks or []:
        try:
            ip = ipaddress.IPv4Interface(str(n.get("cidr", "")))
        except (ValueError, AttributeError):
            continue
        if ip.ip.is_link_local or ip.ip.is_loopback or ip.ip.is_multicast:
            continue
        net = ip.network
        if net.prefixlen < 22:
            net = ipaddress.ip_network(f"{ip.ip}/24", strict=False)
        own.add(str(ip.ip))
        hosts += [str(h) for h in net.hosts()]
    return [h for h in dict.fromkeys(hosts) if h not in own][:2048]


def scan_networks(networks, deadline=4.0):
    """Find devices by asking every address on the computer's networks (multicast discovery
    often doesn't reach the board): an open port 80 first, then its /board or /status."""
    until = time.monotonic() + deadline

    def probe(host):
        try:
            with socket.create_connection((host, 80), timeout=0.25):
                pass
        except OSError:
            return None
        if time.monotonic() > until:
            return None
        info = shield_info(host, timeout=0.6)
        return describe(host, info) if info else None

    with ThreadPoolExecutor(max_workers=128) as pool:
        return [d for d in pool.map(probe, scan_hosts(networks)) if d]
