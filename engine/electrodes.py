"""Electrode position of each of the 16 channels (设置 → 电极位置). The OpenBCI default order;
the desktop app sends another order with the "montage" command."""

DEFAULT_ELECTRODES = [
    "Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2",
    "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4",
]  # fmt: skip
ELECTRODES = list(DEFAULT_ELECTRODES)


def set_montage(names):
    names = [str(n) for n in names or []]
    if len(names) != 16 or len(set(names)) != 16 or not all(0 < len(n) <= 6 for n in names):
        raise ValueError("电极位置需要 16 个互不相同的名称")
    ELECTRODES[:] = names
    return list(ELECTRODES)
