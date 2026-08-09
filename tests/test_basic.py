"""tests/test_basic.py — Unit tests for effects/basic.py (reverse, invert, trim_silence)"""

import numpy as np
import pytest
from pyaudiolab.effects.basic import reverse, invert, trim_silence


class TestReverse:
    def test_first_becomes_last(self, sine_mono, sr):
        out = reverse(sine_mono, sr)
        assert out[0] == pytest.approx(sine_mono[-1])

    def test_last_becomes_first(self, sine_mono, sr):
        out = reverse(sine_mono, sr)
        assert out[-1] == pytest.approx(sine_mono[0])

    def test_double_reverse_is_identity(self, sine_mono, sr):
        out = reverse(reverse(sine_mono, sr), sr)
        np.testing.assert_allclose(out, sine_mono)

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = reverse(sine_stereo, sr)
        assert out.shape == sine_stereo.shape

    def test_stereo_reversal_correct(self, sine_stereo, sr):
        out = reverse(sine_stereo, sr)
        np.testing.assert_allclose(out[0], sine_stereo[-1])

    def test_length_unchanged(self, sine_mono, sr):
        out = reverse(sine_mono, sr)
        assert len(out) == len(sine_mono)


class TestInvert:
    def test_invert_is_negation(self, sine_mono, sr):
        out = invert(sine_mono, sr)
        np.testing.assert_allclose(out, -sine_mono)

    def test_double_invert_is_identity(self, sine_mono, sr):
        out = invert(invert(sine_mono, sr), sr)
        np.testing.assert_allclose(out, sine_mono)

    def test_null_test_cancels(self, sine_mono, sr):
        out = invert(sine_mono, sr)
        np.testing.assert_allclose(out + sine_mono, 0.0, atol=1e-15)

    def test_stereo_preserved(self, sine_stereo, sr):
        out = invert(sine_stereo, sr)
        assert out.shape == sine_stereo.shape

    def test_silence_stays_silent(self, silence_mono, sr):
        out = invert(silence_mono, sr)
        np.testing.assert_allclose(out, 0.0)


class TestTrimSilence:
    def test_all_silence_returns_empty(self, silence_mono, sr):
        out = trim_silence(silence_mono, sr, threshold_db=-40.0)
        assert len(out) == 0

    def test_all_tone_fully_kept(self, sine_mono, sr):
        # 440 Hz sine at amplitude 0.5 should be well above -40 dBFS
        out = trim_silence(sine_mono, sr, threshold_db=-40.0)
        assert len(out) > 0

    def test_silence_tone_silence_trims_silence(self, silence_tone_silence, sr):
        total = len(silence_tone_silence)
        out = trim_silence(silence_tone_silence, sr, threshold_db=-40.0)
        # Should be shorter than original (silence removed)
        assert len(out) < total

    def test_silence_tone_silence_keeps_tone(self, silence_tone_silence, sr):
        out = trim_silence(silence_tone_silence, sr, threshold_db=-40.0)
        # Should retain roughly 1 second of tone
        assert len(out) > sr * 0.5  # at least half of the tone duration

    def test_stereo_empty_on_silence(self, silence_stereo, sr):
        out = trim_silence(silence_stereo, sr)
        assert len(out) == 0
        assert out.ndim == 2

    def test_length_reduced_or_equal(self, sine_mono, sr):
        out = trim_silence(sine_mono, sr)
        assert len(out) <= len(sine_mono)
