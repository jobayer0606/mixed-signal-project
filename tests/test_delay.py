"""tests/test_delay.py — Unit tests for effects/delay.py"""

import numpy as np
import pytest
from pyaudiolab.effects.delay import apply_delay


class TestApplyDelay:
    def test_impulse_echo_at_correct_offset(self, impulse_mono, sr):
        """Echo of an impulse should appear at delay_samples offset."""
        delay_ms = 100.0
        delay_samples = int(sr * delay_ms / 1000.0)
        # Wet mix with feedback
        out = apply_delay(impulse_mono, sr, delay_ms=delay_ms, feedback=0.5, mix=1.0)
        # The echo peak should be at delay_samples
        assert len(out) > delay_samples
        echo_region = out[delay_samples - 5: delay_samples + 5]
        assert np.max(np.abs(echo_region)) > 0.1

    def test_mix_zero_is_dry(self, sine_mono, sr):
        """mix=0 should produce the dry signal (no echo), same length."""
        out = apply_delay(sine_mono, sr, delay_ms=100.0, feedback=0.4, mix=0.0)
        # First N samples should match input
        n = len(sine_mono)
        np.testing.assert_allclose(out[:n], sine_mono, rtol=1e-10)

    def test_output_longer_than_input(self, sine_mono, sr):
        """Delay extends the signal tail."""
        out = apply_delay(sine_mono, sr, delay_ms=100.0, feedback=0.4, mix=0.5)
        assert len(out) > len(sine_mono)

    def test_feedback_clamped(self, sine_mono, sr):
        """feedback >= 1.0 should be clamped to 0.95, not cause infinite growth."""
        out = apply_delay(sine_mono, sr, delay_ms=50.0, feedback=2.0, mix=0.5)
        assert np.max(np.abs(out)) < 100.0  # reasonable bound

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = apply_delay(sine_stereo, sr, delay_ms=100.0, feedback=0.3, mix=0.5)
        assert out.ndim == 2
        assert out.shape[1] == 2

    def test_zero_delay_no_crash(self, sine_mono, sr):
        out = apply_delay(sine_mono, sr, delay_ms=0.0, feedback=0.4, mix=0.5)
        assert len(out) > 0
