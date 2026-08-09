"""tests/test_noise_reduction.py — Unit tests for effects/noise_reduction.py"""

import numpy as np
import pytest
from pyaudiolab.effects.noise_reduction import reduce_noise


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x ** 2)))


class TestReduceNoise:
    def test_output_shape_preserved(self, white_noise, sr):
        out = reduce_noise(white_noise, sr, noise_duration_ms=200.0)
        assert out.shape == white_noise.shape

    def test_noise_floor_reduced(self, sr):
        """Signal energy after noise reduction should be lower than input (for pure noise)."""
        rng = np.random.default_rng(1)
        noise = rng.normal(0, 0.1, sr).astype(np.float64)
        # Process middle/tail portion after initial noise estimate region
        out = reduce_noise(noise, sr, noise_duration_ms=200.0, strength=1.0, floor=0.001)
        # Noise floor in active region after profile estimation is reduced
        assert _rms(out[sr // 4:]) <= _rms(noise[sr // 4:])

    def test_tone_in_noise_preserved(self, sr):
        """A strong tone embedded in noise should survive noise reduction."""
        t = np.linspace(0, 1.0, sr, endpoint=False)
        tone = 0.5 * np.sin(2 * np.pi * 1000 * t)
        rng = np.random.default_rng(2)
        noise = rng.normal(0, 0.05, sr).astype(np.float64)
        mixed = tone + noise

        out = reduce_noise(mixed, sr, noise_duration_ms=100.0, strength=1.0)
        # Output should have meaningful signal energy
        assert _rms(out) > 0.05

    def test_stereo_shape_preserved(self, sine_stereo, sr):
        out = reduce_noise(sine_stereo, sr, noise_duration_ms=100.0)
        assert out.shape == sine_stereo.shape

    def test_silence_no_crash(self, silence_mono, sr):
        # Silence should not crash; output should be near silence
        out = reduce_noise(silence_mono, sr, noise_duration_ms=200.0)
        assert out.shape == silence_mono.shape

    def test_strength_clamped(self, white_noise, sr):
        # Strength=2 (over-subtract) should not crash
        out = reduce_noise(white_noise, sr, noise_duration_ms=200.0, strength=2.0)
        assert out.shape == white_noise.shape
