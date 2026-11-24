"""Wireless provisioning test (Windows): join the device hotspot, send the home Wi-Fi through
the firmware's page at 192.168.4.1/wifi, go back to the home Wi-Fi and find the device there.

  engine\\.venv\\Scripts\\python scripts\\wifi-provision.py --hotspot OCBCI01010100002 --home DIJIKEJI

Passwords are asked for on the terminal and not stored; the temporary hotspot profile is
removed afterwards. The page and the reply are saved in test-results/wifi-provision/ to see
the firmware's interface.
"""

import argparse
import getpass
import html.parser
import ipaddress
import json
import pathlib
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DEVICE = "http://192.168.4.1"
OUT = pathlib.Path(__file__).resolve().parents[1] / "test-results" / "wifi-provision"
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # no system proxy


def sh(*args):
    r = subprocess.run(args, capture_output=True, text=True, encoding="mbcs", errors="replace")
    return r.stdout + r.stderr


def current_ssid():
    m = re.search(r"^\s*SSID\s*:\s*(.+)$", sh("netsh", "wlan", "show", "interfaces"), re.M)
    return m[1].strip() if m else None


def get(path, timeout=4):
    with http.open(DEVICE + path, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def xml_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def join_hotspot(ssid, key):
    profile = f"""<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>{xml_escape(ssid)}</name>
  <SSIDConfig><SSID><name>{xml_escape(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType><connectionMode>manual</connectionMode>
  <MSM><security>
    <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{xml_escape(key)}</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>"""
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False, encoding="utf-8") as f:
        f.write(profile)
    try:
        sh("netsh", "wlan", "add", "profile", f"filename={f.name}", "user=current")
    finally:
        pathlib.Path(f.name).unlink(missing_ok=True)
    sh("netsh", "wlan", "connect", f"name={ssid}", f"ssid={ssid}")
    for _ in range(30):
        time.sleep(1)
        try:
            return get("/status", 2)
        except OSError:
            pass
    raise SystemExit("连不上设备热点：请确认热点名和密码，设备已开机且在 AP 模式")


class Form(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms, self.scripts, self._script = [], [], False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self.forms.append({"action": a.get("action", ""), "method": a.get("method", "get"), "inputs": []})
        elif tag in ("input", "select", "textarea") and self.forms and a.get("name"):
            self.forms[-1]["inputs"].append({"tag": tag, **a})
        elif tag == "script":
            self._script = True

    def handle_endtag(self, tag):
        if tag == "script":
            self._script = False

    def handle_data(self, data):
        if self._script:
            self.scripts.append(data)


def provision(page, ssid, password):
    p = Form()
    p.feed(page)
    form = next((f for f in p.forms if any("ssid" in i["name"].lower() for i in f["inputs"])), None)
    if form:
        names = [i["name"] for i in form["inputs"]]
        s = next(n for n in names if "ssid" in n.lower())
        k = next((i["name"] for i in form["inputs"] if i.get("type") == "password" or "pass" in i["name"].lower()), None)
        if not k:
            raise SystemExit(f"页面里没找到密码字段：{names}")
        data = {i["name"]: i.get("value", "") for i in form["inputs"] if i["tag"] == "input" and i.get("type") == "hidden"}
        data.update({s: ssid, k: password})
        action = urllib.parse.urljoin(DEVICE + "/wifi", form["action"] or "/wifi")
        body = urllib.parse.urlencode(data)
        print(f"表单：{form['method'].upper()} {action} 字段 {list(data)}")
        if form["method"].lower() == "post":
            req = urllib.request.Request(action, body.encode(), {"Content-Type": "application/x-www-form-urlencoded"})
        else:
            req = urllib.request.Request(action + "?" + body)
    else:
        # no <form>: the page posts from JavaScript; take the first request that carries the SSID
        js = "\n".join(p.scripts)
        urls = re.findall(r"""(?:fetch|open)\(\s*['"](?:GET|POST)?['"]?\s*,?\s*['"`](/[^'"`?]+)""", js)
        urls = [u for u in urls if not re.search(r"scan|status", u, re.I)]
        if not urls:
            raise SystemExit("页面里没找到提交地址，已保存页面源码，请发给我")
        action = DEVICE + urls[0]
        keys = re.findall(r"""['"]?(\w*(?:ssid|pass|pwd|psk)\w*)['"]?\s*[:=]""", js, re.I)
        s = next((x for x in keys if "ssid" in x.lower()), "ssid")
        k = next((x for x in keys if re.search("pass|pwd|psk", x, re.I)), "password")
        body = urllib.parse.urlencode({s: ssid, k: password})
        print(f"脚本提交：POST {action} 字段 {[s, k]}（从页面脚本推断）")
        req = urllib.request.Request(action, body.encode(), {"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with http.open(req, timeout=6) as r:
            reply = f"{r.status} {r.read().decode('utf-8', errors='replace')}"
    except OSError as e:  # the device may restart before it answers
        reply = f"（没有完整回复：{e}）"
    (OUT / "reply.txt").write_text(reply, encoding="utf-8")
    print("设备回复：", reply[:300])


def find_device(timeout=60):
    me = socket.gethostbyname(socket.gethostname())
    for line in sh("ipconfig").splitlines():
        m = re.search(r"IPv4.*?:\s*([\d.]+)", line)
        if m and not m[1].startswith(("169.254", "127.", "192.168.4.")):
            me = m[1]
            break
    net = ipaddress.ip_network(me + "/24", strict=False)

    def probe(host):
        try:
            with http.open(f"http://{host}/status", timeout=1.5) as r:
                info = json.loads(r.read())
                if "num_channels" in info or "board_connected" in info:
                    return str(host), info
        except (OSError, ValueError):
            pass
        return None

    end = time.monotonic() + timeout
    while time.monotonic() < end:
        with ThreadPoolExecutor(64) as pool:
            for hit in pool.map(probe, net.hosts()):
                if hit:
                    return hit
        time.sleep(3)
    return None


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--hotspot", required=True, help="设备热点名（SN）")
    a.add_argument("--home", required=True, help="要让设备加入的 Wi-Fi 名称")
    args = a.parse_args()
    if sys.platform != "win32":
        raise SystemExit("这个脚本只用于 Windows")
    OUT.mkdir(parents=True, exist_ok=True)
    back = current_ssid()
    hot_key = getpass.getpass(f"设备热点 {args.hotspot} 的密码：")
    home_key = getpass.getpass(f"Wi-Fi {args.home} 的密码（开放网络直接回车）：")
    try:
        print(f"1/4 连接设备热点 {args.hotspot}…")
        status = join_hotspot(args.hotspot, hot_key)
        print("    设备状态：", status)
        page = get("/wifi")
        (OUT / "wifi.html").write_text(page, encoding="utf-8")
        (OUT / "status.json").write_text(status, encoding="utf-8")
        print(f"2/4 发送 {args.home} 给设备…")
        provision(page, args.home, home_key)
    finally:
        print(f"3/4 回到 {back or args.home}…")
        sh("netsh", "wlan", "delete", "profile", f"name={args.hotspot}")
        sh("netsh", "wlan", "connect", f"name={back or args.home}")
        time.sleep(8)
    print("4/4 在局域网里找设备（最多 60 秒）…")
    hit = find_device()
    if hit:
        print(f"成功：设备在 {hit[0]}，{json.dumps(hit[1], ensure_ascii=False)}")
    else:
        print("没有在局域网里找到设备。页面和回复在", OUT)


if __name__ == "__main__":
    main()
