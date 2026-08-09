"""tests/test_normalize.py — Unit tests for effects/normalize.py"""

import numpy as np
import pytest
import warnings
from pyaudiolab.effects.normalize import normalize


class TestNormalizePeak:
    def test_peak_hits_target(self, sine_mono, sr):
        target_db = -1.0
        out = normalize(sine_mono, sr, target_db=target_db, mode="peak")
        target_lin = 10 ** (target_db / 20.0)
        np.testing.assert_allclose(np.max(np.abs(out)), target_lin, rtol=1e-6)

    def test_peak_default_target(self, sine_mono, sr):
        out = normalize(sine_mono, sr)
        np.testing.assert_allclose(np.max(np.abs(out)), 10 ** (-1.0 / 20.0), rtol=1e-6)

    def test_peak_stereo(self, sine_stereo, sr):
        target_db = -3.0
        out = normalize(sine_stereo, sr, target_db=target_db, mode="peak")
        target_lin = 10 ** (target_db / 20.0)
        np.testing.assert_allclose(np.max(np.abs(out)), target_lin, rtol=1e-6)

    def test_invalid_mode_raises(self, sine_mono, sr):
        with pytest.raises(ValueError, match="mode must be"):
            normalize(sine_mono, sr, mode="loudness")


class TestNormalizeRMS:
    def test_rms_hits_target(self, sine_mono, sr):
        target_db = -12.0
        out = normalize(sine_mono, sr, target_db=target_db, mode="rms")
        target_lin = 10 ** (target_db / 20.0)
        actual_rms = np.sqrt(np.mean(out ** 2))
        np.testing.assert_allclose(actual_rms, target_lin, rtol=1e-6)

    def test_rms_stereo(self, sine_stereo, sr):
        target_db = -6.0
        out = normalize(sine_stereo, sr, target_db=target_db, mode="rms")
        target_lin = 10 ** (target_db / 20.0)
        actual_rms = np.sqrt(np.mean(out ** 2))
        np.testing.assert_allclose(actual_rms, target_lin, rtol=1e-6)


class TestNormalizeSilence:
    def test_silence_returns_as_is_with_warning(self, silence_mono, sr):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            out = normalize(silence_mono, sr)
            assert len(w) == 1
            assert issubclass(w[0].category, RuntimeWarning)
        np.testing.assert_allclose(out, 0.0)
