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

    def test_over_subtraction_deeper_attenuation(self, sr):
        """Higher subtraction strength should attenuate noise more deeply."""
        rng = np.random.default_rng(42)
        noise = rng.normal(0, 0.08, sr * 2).astype(np.float64)
        out_mild = reduce_noise(noise, sr, noise_duration_ms=200.0, strength=0.5, floor=0.01)
        out_strong = reduce_noise(noise, sr, noise_duration_ms=200.0, strength=1.8, floor=0.002)

        rms_mild = _rms(out_mild[sr // 2:])
        rms_strong = _rms(out_strong[sr // 2:])
        assert rms_strong < rms_mild


class TestAdaptiveNoiseReduction:
    def test_suppression_depth(self, sr):
        """Deep noise reduction on noise achieves deep suppression."""
        from pyaudiolab.effects.noise_reduction import reduce_noise_deep
        rng = np.random.default_rng(100)
        noise = rng.normal(0, 0.05, sr * 2).astype(np.float64)

        out = reduce_noise_deep(noise, sr)
        in_rms = _rms(noise[sr // 2:])
        out_rms = _rms(out[sr // 2:])

        # Attenuation in dB: 20 * log10(in_rms / out_rms)
        attenuation_db = 20.0 * np.log10(in_rms / max(out_rms, 1e-12))
        assert attenuation_db >= 10.0

    def test_continuous_fan_hum_tracking(self, sr):
        """Continuous stationary hum (e.g. 120Hz fan + white noise) is tracked and suppressed."""
        from pyaudiolab.effects.noise_reduction import reduce_noise_deep
        t = np.linspace(0, 2.0, sr * 2, endpoint=False)
        fan_hum = 0.04 * np.sin(2 * np.pi * 120.0 * t) + 0.02 * np.sin(2 * np.pi * 240.0 * t)
        noise = 0.02 * np.random.RandomState(42).randn(len(t))
        ambient = fan_hum + noise

        out = reduce_noise_deep(ambient, sr)
        assert _rms(out[sr:]) < 0.5 * _rms(ambient[sr:])

    def test_max_suppression_digital_blackness(self, sr):
        """On pure background noise, noise floor is suppressed."""
        from pyaudiolab.effects.noise_reduction import reduce_noise_deep
        rng = np.random.default_rng(2024)
        noise = rng.normal(0, 0.05, sr * 2).astype(np.float64)

        out = reduce_noise_deep(noise, sr)
        in_rms = _rms(noise[sr // 2:])
        out_rms = _rms(out[sr // 2:])

        attenuation_db = 20.0 * np.log10(in_rms / max(out_rms, 1e-12))
        assert attenuation_db >= 10.0

class TestDeepFilterNoiseReduction:
    def test_reduce_noise_deep_mono_shape(self, white_noise, sr):
        from pyaudiolab.effects.noise_reduction import reduce_noise_deep
        out = reduce_noise_deep(white_noise, sr)
        assert out.shape == white_noise.shape
        assert isinstance(out, np.ndarray)

    def test_reduce_noise_deep_stereo_shape(self, sine_stereo, sr):
        from pyaudiolab.effects.noise_reduction import reduce_noise_deep
        out = reduce_noise_deep(sine_stereo, sr)
        assert out.shape == sine_stereo.shape
        assert out.ndim == 2
        assert out.shape[1] == 2

    def test_reduce_noise_deep_different_sample_rates(self):
        from pyaudiolab.effects.noise_reduction import reduce_noise_deep
        for sample_rate in [16000, 22050, 44100, 48000]:
            sig = np.sin(2 * np.pi * 440.0 * np.linspace(0, 0.5, int(sample_rate * 0.5)))
            out = reduce_noise_deep(sig, sample_rate)
            assert out.shape == sig.shape



