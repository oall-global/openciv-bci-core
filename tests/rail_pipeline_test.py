"""Exercise the real ingestion path, not just the standalone rail formula."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import main as m

e = m.Engine()
e.board = MagicMock()
e.config = {"transport": "wifi"}
e.channels = list(range(1, 17))
e.timestamp_channel = 17
e.package_channel = 0
e.received = True
e.last_data = 10.0
counter = 1000.0


def feed(ids, values):
    global counter
    d = np.zeros((18, len(ids)))
    d[0] = ids
    d[1:17] = values
    d[17] = counter + np.arange(len(ids)) * 0.004
    counter = d[17, -1] + 0.004
    e.board.get_board_data.return_value = d
    with patch.object(m, "emit") as output, patch.object(m.time, "monotonic", return_value=11.0):
        e.tick()
    frames = [x.args[0] for x in output.call_args_list if x.args[0]["type"] == "data"]
    assert frames, "Pipeline failed to emit a frame"
    return frames[-1]["rail"]


assert feed([0, 1], [180000, 180001])["states"] == ["railed"] * 16
# A jump must reset Alpha continuity, but must not erase the rail window's peak.
assert feed([3, 4, 5, 6], [0, 100, 0, 100])["states"] == ["railed"] * 16
# A saturated value inside the batch, before a sequence break, must also count.
assert feed([7, 9, 10, 11], [180000, 180001, 0, 100])["states"] == ["railed"] * 16
# It expires only when 3 seconds worth of received samples replace it.
assert feed(np.arange(12, 762) % 256, np.tile([0, 100], 375))["states"] == ["normal"] * 16
print(
    "PASS: ingestion retains peaks across sequence gaps and within batches; expires at 3s of samples"
)
