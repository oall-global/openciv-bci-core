"""本地实验接口示例；不保存原始脑电。Ctrl+C 结束。"""

import asyncio
import getpass
import json
import os
import time
from urllib.parse import urlparse
import websockets


async def main():
    address = os.getenv("NEUROLINK_URL", "ws://127.0.0.1:8765")
    parsed = urlparse(address)
    if parsed.hostname != "127.0.0.1" or parsed.scheme != "ws":
        raise ValueError("示例只允许本机接口")
    token = os.getenv("NEUROLINK_TOKEN") or getpass.getpass("粘贴工作台密钥（不显示）：")
    async with websockets.connect(address, max_size=4 * 1024 * 1024) as ws:
        await ws.send(json.dumps(dict(type="auth", token=token, clientName="Python 示例")))
        marked = False
        async for text in ws:
            event = json.loads(text)
            kind, payload = event["type"], event["payload"]
            if kind == "authenticated":
                await ws.send(
                    json.dumps(
                        dict(
                            type="subscribe",
                            topics=[
                                "metadata",
                                "status",
                                "quality",
                                "alpha",
                                "ssvep",
                                "marker",
                            ],
                            channels=[1],
                            ssvepFrequencyHz=30,
                        )
                    )
                )
            if kind == "quality":
                if not payload["valid"]:
                    print("信号不可用：", payload.get("reason"))
                elif not marked:
                    marked = True
                    await ws.send(
                        json.dumps(
                            dict(
                                type="marker",
                                label="example_started",
                                clientTimestampMs=time.time() * 1000,
                            )
                        )
                    )
            else:
                print(kind, event["source"], payload)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except (OSError, websockets.exceptions.ConnectionClosed) as error:
        print("连接结束或失败，请检查接口状态。停止使用旧数据。", type(error).__name__)
