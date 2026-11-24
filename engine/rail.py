"""ADS1299 rail check, adapted from OpenBCI GUI Extras.pde DataStatus.

Upstream e23869e7b5cc621e733d8fa0d81f05d477264306, MIT, Copyright (c) 2018 OpenBCI.
License: public/licenses/OpenBCI-GUI-MIT.txt. This is not impedance measurement.
"""

import numpy as np


def check_rails(samples, rate, gain=24, streaming=True):
    x = np.asarray(samples, dtype=np.float32)
    channels = x.shape[0]
    if x.shape[1] == 0:
        return dict(states=["unknown"] * channels, percentages=[None] * channels, gain=gain)
    x = x[:, -rate * 3 :]
    # Processing compiles 4.5/(pow(2,23)-1) as float division before
    # promoting to double for getGain(). Preserve this order at 75/90% edges.
    adc_scale = float(np.float32(4.5) / np.float32(2**23 - 1))
    full_scale = adc_scale / gain * 1e6 * 2**23
    states, percentages, peaks = [], [], []
    for row in x:
        if not np.isfinite(row).all():
            states.append("unknown")
            percentages.append(None)
            peaks.append(None)
            continue
        peak = float(np.max(abs(row)))
        peaks.append(peak)
        percent = peak / full_scale * 100
        changing = np.any((abs(np.diff(row)) > 1e-5) & (abs(row[1:]) > 1e-5))
        state = (
            "railed"
            if percent > 90
            else "flat"
            if streaming and not changing
            else "near"
            if percent > 75
            else "normal"
        )
        states.append(state)
        percentages.append(round(percent, 2))
    return dict(
        states=states,
        percentages=percentages,
        gain=gain,
        peaks=peaks,
        fullScale=full_scale,
        sampleCount=x.shape[1],
    )
