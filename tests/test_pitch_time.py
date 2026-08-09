"""tests/test_pitch_time.py — Unit tests for effects/pitch_time.py"""

import numpy as np
import pytest
from pyaudiolab.effects.pitch_time import change_speed, time_stretch


class TestChangeSpeed:
    def test_double_speed_halves_length(self, sine_mono, sr):
        out = change_speed(sine_mono, sr, factor=2.0)
        expected_len = int(round(len(sine_mono) / 2.0))
        assert abs(len(out) - expected_len) <= 2  # small rounding tolerance

    def test_half_speed_doubles_length(self, sine_mono, sr):
        out = change_speed(sine_mono, sr, factor=0.5)
        expected_len = int(round(len(sine_mono) / 0.5))
        assert abs(len(out) - expected_len) <= 2

    def test_unity_factor_is_identity(self, sine_mono, sr):
        out = change_speed(sine_mono, sr, factor=1.0)
        np.testing.assert_allclose(out, sine_mono)

    def test_invalid_factor_raises(self, sine_mono, sr):
        with pytest.raises(ValueError):
            change_speed(sine_mono, sr, factor=0.0)
        with pytest.raises(ValueError):
            change_speed(sine_mono, sr, factor=-1.0)

    def test_stereo_output_shape(self, sine_stereo, sr):
        out = change_speed(sine_stereo, sr, factor=2.0)
        assert out.ndim == 2
        assert out.shape[1] == 2
        expected_len = int(round(sine_stereo.shape[0] / 2.0))
        assert abs(out.shape[0] - expected_len) <= 2


class TestTimeStretch:
    def test_double_speed_reduces_length(self, sine_mono, sr):
        out = time_stretch(sine_mono, sr, factor=2.0, window_size=512, hop_length=128)
        assert len(out) < len(sine_mono)

    def test_half_speed_increases_length(self, sine_mono, sr):
        out = time_stretch(sine_mono, sr, factor=0.5, window_size=512, hop_length=128)
        assert len(out) > len(sine_mono)

    def test_unity_factor_preserves_length(self, sine_mono, sr):
        out = time_stretch(sine_mono, sr, factor=1.0, window_size=512, hop_length=128)
        assert len(out) == len(sine_mono)

    def test_output_has_energy(self, sine_mono, sr):
        out = time_stretch(sine_mono, sr, factor=2.0, window_size=512, hop_length=128)
        assert np.max(np.abs(out)) > 0.01

    def test_stereo_output_shape(self, sine_stereo, sr):
        out = time_stretch(sine_stereo, sr, factor=2.0, window_size=512, hop_length=128)
        assert out.ndim == 2
        assert out.shape[1] == 2

    def test_invalid_factor_raises(self, sine_mono, sr):
        with pytest.raises(ValueError):
            time_stretch(sine_mono, sr, factor=-1.0)
