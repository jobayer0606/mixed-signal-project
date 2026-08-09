"""tests/test_reverb.py — Unit tests for effects/reverb.py"""

import numpy as np
import pytest
from pyaudiolab.effects.reverb import schroeder_reverb


class TestSchroederReverb:
    def test_output_has_energy(self, sine_mono, sr):
        out = schroeder_reverb(sine_mono, sr, room_size=0.5, damping=0.5, mix=0.5)
        assert np.max(np.abs(out)) > 0.0

    def test_shape_preserved(self, sine_mono, sr):
        out = schroeder_reverb(sine_mono, sr)
        assert out.shape == sine_mono.shape

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = schroeder_reverb(sine_stereo, sr)
        assert out.shape == sine_stereo.shape

    def test_mix_zero_is_dry(self, sine_mono, sr):
        out = schroeder_reverb(sine_mono, sr, mix=0.0)
        np.testing.assert_allclose(out, sine_mono)

    def test_mix_one_is_fully_wet(self, sine_mono, sr):
        out_full = schroeder_reverb(sine_mono, sr, mix=1.0)
        out_dry = schroeder_reverb(sine_mono, sr, mix=0.0)
        # Fully wet should differ from dry
        assert not np.allclose(out_full, out_dry, atol=1e-6)

    def test_silence_stays_silent(self, silence_mono, sr):
        out = schroeder_reverb(silence_mono, sr, mix=1.0)
        np.testing.assert_allclose(out, 0.0, atol=1e-10)

    def test_room_size_affects_sound(self, sine_mono, sr):
        out_small = schroeder_reverb(sine_mono, sr, room_size=0.1, mix=0.5)
        out_large = schroeder_reverb(sine_mono, sr, room_size=1.0, mix=0.5)
        # Different room sizes should produce different outputs
        assert not np.allclose(out_small, out_large, atol=1e-6)

    def test_damping_clamp(self, sine_mono, sr):
        # Should not crash with out-of-range values
        out = schroeder_reverb(sine_mono, sr, room_size=1.5, damping=2.0, mix=1.5)
        assert out.shape == sine_mono.shape
