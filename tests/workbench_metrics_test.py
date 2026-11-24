import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import numpy as np
from workbench_metrics import TransportStats, emg_rms, FocusEstimator


class MetricsTests(unittest.TestCase):
    def test_transport(self):
        t = TransportStats()
        t.push([254, 255, 0, 1], 0)
        s = t.push([4, 4, 3], 0.05)
        self.assertEqual(
            (s["received"], s["estimatedLost"], s["duplicates"], s["ambiguous"]), (7, 2, 1, 1)
        )
        self.assertAlmostEqual(s["lossPercent"], 200 / 9)
        t = TransportStats(2)
        t.push([253, 255, 1], 0)
        self.assertEqual(t.push([5], 0.05)["estimatedLost"], 1)
        t = TransportStats()
        t.push([1], 0)
        self.assertEqual(t.push([10], 2)["ambiguous"], 1)

    def test_emg(self):
        rate = 250
        t = np.arange(rate) / rate
        signals = np.array([10 * np.sin(2 * np.pi * f * t) + 1000 for f in [10, 35, 50, 60]])
        values = emg_rms(signals, rate)
        self.assertAlmostEqual(values[1], 10 / np.sqrt(2), places=2)
        self.assertLess(max(values[0], values[2], values[3]), 0.01)
        self.assertIsNone(emg_rms(signals[:, :100], rate))

    def test_focus(self):
        model = FocusEstimator()
        try:
            self.assertFalse(model.error)
            t = np.arange(1000) / 250
            s = np.array([20 * np.sin(2 * np.pi * 10 * t), 10 * np.sin(2 * np.pi * 20 * t)])
            result = model.predict(np.asfortranarray(s), 250, [0, 1])
            self.assertIsNotNone(result)
            self.assertTrue(0 <= result["mindfulness"] <= 1)
            self.assertIsNone(model.predict(s, 250, []))
        finally:
            model.close()


if __name__ == "__main__":
    unittest.main()
