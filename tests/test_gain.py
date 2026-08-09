"""tests/test_gain.py — Unit tests for effects/gain.py"""

import numpy as np
import pytest
from pyaudiolab.effects.gain import apply_gain


class TestApplyGain:
    def test_zero_db_is_identity(self, sine_mono, sr):
        out = apply_gain(sine_mono, sr, gain_db=0.0, soft_clip=False)
        np.testing.assert_allclose(out, sine_mono)

    def test_positive_gain_amplifies(self, sine_mono, sr):
        out = apply_gain(sine_mono, sr, gain_db=6.0, soft_clip=False)
        expected_scale = 10 ** (6.0 / 20.0)
        np.testing.assert_allclose(np.max(np.abs(out)), np.max(np.abs(sine_mono)) * expected_scale, rtol=1e-6)

    def test_negative_gain_attenuates(self, sine_mono, sr):
        out = apply_gain(sine_mono, sr, gain_db=-6.0, soft_clip=False)
        expected_scale = 10 ** (-6.0 / 20.0)
        np.testing.assert_allclose(np.max(np.abs(out)), np.max(np.abs(sine_mono)) * expected_scale, rtol=1e-6)

    def test_soft_clip_prevents_overflow(self, sine_mono, sr):
        # Apply massive gain — soft clip should prevent |out| > 1
        out = apply_gain(sine_mono, sr, gain_db=60.0, soft_clip=True)
        assert np.max(np.abs(out)) <= 1.0 + 1e-10

    def test_no_clip_allows_overflow_for_diagnosis(self, sine_mono, sr):
        out = apply_gain(sine_mono, sr, gain_db=40.0, soft_clip=False)
        assert np.max(np.abs(out)) > 1.0  # Should exceed 1.0 without clipping

    def test_stereo_preserved(self, sine_stereo, sr):
        out = apply_gain(sine_stereo, sr, gain_db=0.0)
        assert out.shape == sine_stereo.shape

    def test_silence_stays_silent(self, silence_mono, sr):
        out = apply_gain(silence_mono, sr, gain_db=40.0)
        np.testing.assert_allclose(out, 0.0)

    def test_output_dtype_float64(self, sine_mono, sr):
        out = apply_gain(sine_mono, sr, gain_db=6.0)
        assert out.dtype == np.float64
