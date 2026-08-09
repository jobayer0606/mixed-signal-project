"""tests/test_dynamics.py — Unit tests for effects/dynamics.py"""

import numpy as np
import pytest
from pyaudiolab.effects.dynamics import hard_limit, soft_clip, compress


class TestHardLimit:
    def test_no_sample_exceeds_threshold(self, sine_mono, sr):
        threshold_db = -6.0
        out = hard_limit(sine_mono, sr, threshold_db=threshold_db)
        thresh_lin = 10 ** (threshold_db / 20.0)
        assert np.max(np.abs(out)) <= thresh_lin + 1e-10

    def test_below_threshold_unchanged(self, sr):
        # Signal at -20 dBFS, threshold at -6 dBFS — should pass through unchanged
        t = np.linspace(0, 1.0, sr, endpoint=False)
        x = 0.1 * np.sin(2 * np.pi * 440 * t)  # ~-20 dBFS
        out = hard_limit(x, sr, threshold_db=-6.0)
        np.testing.assert_allclose(out, x, rtol=1e-10)

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = hard_limit(sine_stereo, sr, threshold_db=-6.0)
        assert out.shape == sine_stereo.shape

    def test_silence_stays_silent(self, silence_mono, sr):
        out = hard_limit(silence_mono, sr, threshold_db=-6.0)
        np.testing.assert_allclose(out, 0.0)


class TestSoftClip:
    def test_no_sample_exceeds_1(self, sr):
        # Apply massive amplitude, soft clip should bound to (-1, 1)
        t = np.linspace(0, 1.0, sr, endpoint=False)
        x = 10.0 * np.sin(2 * np.pi * 440 * t)  # WAY above threshold
        out = soft_clip(x, sr, threshold_db=-6.0)
        assert np.max(np.abs(out)) < 1.0 + 1e-10

    def test_below_threshold_largely_unchanged(self, sr):
        t = np.linspace(0, 1.0, sr, endpoint=False)
        x = 0.05 * np.sin(2 * np.pi * 440 * t)  # well below threshold
        out = soft_clip(x, sr, threshold_db=-6.0)
        np.testing.assert_allclose(out, x, rtol=1e-6)

    def test_stereo_preserved(self, sine_stereo, sr):
        out = soft_clip(sine_stereo, sr)
        assert out.shape == sine_stereo.shape


class TestCompress:
    def test_dynamic_range_reduced(self, sr):
        """Output dynamic range should be lower than input dynamic range."""
        n = sr
        t = np.linspace(0, 1.0, n, endpoint=False)
        quiet = 0.05 * np.sin(2 * np.pi * 440 * t[:n//2])
        loud = 0.9 * np.sin(2 * np.pi * 440 * t[:n//2])
        x = np.concatenate([quiet, loud])

        out = compress(x, sr, threshold_db=-20.0, ratio=8.0, attack_ms=5.0, release_ms=50.0)

        input_range = 20 * np.log10(np.max(np.abs(loud)) / max(np.max(np.abs(quiet)), 1e-10))
        out_loud = out[n//2:]
        out_quiet = out[:n//2]
        output_range = 20 * np.log10(np.max(np.abs(out_loud)) / max(np.max(np.abs(out_quiet)), 1e-10))

        # The compressed output should have smaller dynamic range
        assert output_range < input_range

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = compress(sine_stereo, sr)
        assert out.shape == sine_stereo.shape

    def test_silence_stays_quiet(self, silence_mono, sr):
        out = compress(silence_mono, sr)
        np.testing.assert_allclose(out, 0.0, atol=1e-10)

    def test_below_threshold_unity_gain(self, sr):
        """Signal well below threshold should pass through with ~unity gain."""
        t = np.linspace(0, 1.0, sr, endpoint=False)
        x = 0.001 * np.sin(2 * np.pi * 440 * t)  # very quiet signal
        out = compress(x, sr, threshold_db=-20.0, ratio=4.0, makeup_db=0.0)
        # Should be approximately equal (slight difference due to attack smoothing)
        np.testing.assert_allclose(np.max(np.abs(out)), np.max(np.abs(x)), rtol=0.05)
