"""
tests/conftest.py — Shared pytest fixtures for PyAudioLab tests.

All fixtures produce float64 arrays in [-1, 1] at sr=44100 Hz,
so no real WAV files are needed for any test.
"""

import numpy as np
import pytest

SR = 44100


@pytest.fixture
def sr():
    return SR


@pytest.fixture
def sine_mono():
    """1-second 440 Hz sine wave, mono, amplitude 0.5."""
    t = np.linspace(0, 1.0, SR, endpoint=False)
    return (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float64)


@pytest.fixture
def sine_stereo():
    """1-second 440/880 Hz sine wave, stereo, amplitude 0.5."""
    t = np.linspace(0, 1.0, SR, endpoint=False)
    left = 0.5 * np.sin(2 * np.pi * 440 * t)
    right = 0.5 * np.sin(2 * np.pi * 880 * t)
    return np.stack([left, right], axis=1).astype(np.float64)


@pytest.fixture
def silence_mono():
    """1-second silence, mono."""
    return np.zeros(SR, dtype=np.float64)


@pytest.fixture
def silence_stereo():
    """1-second silence, stereo."""
    return np.zeros((SR, 2), dtype=np.float64)


@pytest.fixture
def white_noise():
    """1-second white noise, mono, amplitude ~0.3."""
    rng = np.random.default_rng(0)
    return rng.uniform(-0.3, 0.3, SR).astype(np.float64)


@pytest.fixture
def impulse_mono():
    """Impulse at sample 0, mono."""
    x = np.zeros(SR, dtype=np.float64)
    x[0] = 1.0
    return x


@pytest.fixture
def full_scale_sine():
    """1-second 440 Hz sine at full scale (amplitude 0.99)."""
    t = np.linspace(0, 1.0, SR, endpoint=False)
    return (0.99 * np.sin(2 * np.pi * 440 * t)).astype(np.float64)


@pytest.fixture
def silence_tone_silence():
    """1s silence + 1s 440 Hz tone + 1s silence, mono."""
    n = SR
    silent = np.zeros(n, dtype=np.float64)
    t = np.linspace(0, 1.0, n, endpoint=False)
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    return np.concatenate([silent, tone, silent])
