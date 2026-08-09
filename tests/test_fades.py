"""tests/test_fades.py — Unit tests for effects/fades.py"""

import numpy as np
import pytest
from pyaudiolab.effects.fades import fade_in, fade_out


class TestFadeIn:
    def test_first_sample_near_zero(self, sine_mono, sr):
        out = fade_in(sine_mono, sr, duration_ms=500.0)
        assert abs(out[0]) < abs(sine_mono[0]) or abs(out[0]) < 1e-10

    def test_fade_in_envelope_starts_at_zero(self, sr):
        # Use a constant signal to directly measure the envelope
        const = np.ones(sr, dtype=np.float64)
        out = fade_in(const, sr, duration_ms=1000.0)
        assert abs(out[0]) < 1e-10  # first sample should be ~0

    def test_fade_in_envelope_ends_at_one(self, sr):
        const = np.ones(sr, dtype=np.float64)
        out = fade_in(const, sr, duration_ms=500.0)
        n_fade = int(sr * 0.5)
        # After fade region, signal should be unchanged
        np.testing.assert_allclose(out[n_fade:], const[n_fade:])

    def test_exponential_curve_monotone(self, sr):
        const = np.ones(sr, dtype=np.float64)
        out = fade_in(const, sr, duration_ms=500.0, curve="exponential")
        n_fade = int(sr * 0.5)
        # Envelope should be non-decreasing
        envelope = out[:n_fade]
        assert np.all(np.diff(envelope) >= -1e-12)

    def test_duration_clamped_to_audio_length(self, sr):
        short = np.ones(100, dtype=np.float64)
        # Duration longer than audio — should not crash
        out = fade_in(short, sr, duration_ms=10000.0)
        assert len(out) == len(short)

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = fade_in(sine_stereo, sr, duration_ms=200.0)
        assert out.shape == sine_stereo.shape

    def test_zero_duration_is_identity(self, sine_mono, sr):
        out = fade_in(sine_mono, sr, duration_ms=0.0)
        np.testing.assert_allclose(out, sine_mono)


class TestFadeOut:
    def test_last_sample_near_zero(self, sr):
        const = np.ones(sr, dtype=np.float64)
        out = fade_out(const, sr, duration_ms=500.0)
        assert abs(out[-1]) < 1e-6

    def test_early_signal_unchanged(self, sr):
        const = np.ones(sr, dtype=np.float64)
        out = fade_out(const, sr, duration_ms=500.0)
        n_fade = int(sr * 0.5)
        np.testing.assert_allclose(out[:sr - n_fade], const[:sr - n_fade])

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = fade_out(sine_stereo, sr, duration_ms=200.0)
        assert out.shape == sine_stereo.shape
