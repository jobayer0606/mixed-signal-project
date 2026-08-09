"""tests/test_eq.py — Unit tests for effects/eq.py"""

import numpy as np
import pytest
from pyaudiolab.effects.eq import graphic_eq, EQ_BAND_CENTERS


class TestGraphicEQ:
    def test_flat_eq_is_near_identity(self, sine_mono, sr):
        """All bands at 0 dB should produce ~identical output."""
        gains = [0.0] * 10
        out = graphic_eq(sine_mono, sr, gains_db=gains)
        # Allow small numerical error from filter cascade
        np.testing.assert_allclose(out, sine_mono, atol=1e-6)

    def test_wrong_band_count_raises(self, sine_mono, sr):
        with pytest.raises(ValueError, match="10"):
            graphic_eq(sine_mono, sr, gains_db=[0.0] * 5)

    def test_boost_increases_energy(self, sine_mono, sr):
        """Boosting all bands should increase overall signal energy."""
        gains = [6.0] * 10
        out = graphic_eq(sine_mono, sr, gains_db=gains)
        assert np.mean(out ** 2) > np.mean(sine_mono ** 2)

    def test_cut_decreases_energy(self, sine_mono, sr):
        """Cutting all bands should decrease overall signal energy."""
        gains = [-6.0] * 10
        out = graphic_eq(sine_mono, sr, gains_db=gains)
        assert np.mean(out ** 2) < np.mean(sine_mono ** 2)

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        gains = [0.0] * 10
        out = graphic_eq(sine_stereo, sr, gains_db=gains)
        assert out.shape == sine_stereo.shape

    def test_default_gains_flat(self, sine_mono, sr):
        """Default (None) gains should be flat."""
        out = graphic_eq(sine_mono, sr)
        np.testing.assert_allclose(out, sine_mono, atol=1e-6)

    def test_band_centers_count(self):
        assert len(EQ_BAND_CENTERS) == 10

    def test_silence_stays_silent(self, silence_mono, sr):
        gains = [12.0] * 10  # massive boost on silence → still silence
        out = graphic_eq(silence_mono, sr, gains_db=gains)
        np.testing.assert_allclose(out, 0.0, atol=1e-10)
