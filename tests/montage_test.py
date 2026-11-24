"""Electrode montage (设置 → 电极位置): set_montage validates and changes the names in place."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import electrodes  # noqa: E402

default = list(electrodes.DEFAULT_ELECTRODES)
assert electrodes.ELECTRODES == default and electrodes.ELECTRODES.index("T7") == 12
try:
    custom = list(default)
    custom[12], custom[13] = "T8", "T7"
    custom[14] = "Pz"
    assert electrodes.set_montage(custom) == custom
    assert electrodes.ELECTRODES == custom and electrodes.ELECTRODES.index("T7") == 13
    for bad in [default[:15], default[:15] + ["Fp1"], None]:
        try:
            electrodes.set_montage(bad)
            raise AssertionError(f"accepted {bad}")
        except ValueError:
            pass
    assert electrodes.ELECTRODES == custom  # a rejected montage changes nothing
    print("PASS montage: set / validate, names changed in place")
finally:
    electrodes.set_montage(electrodes.DEFAULT_ELECTRODES)
