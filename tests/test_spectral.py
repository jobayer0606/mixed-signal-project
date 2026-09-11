"""tests/test_spectral.py — Unit tests for spectral analysis (FFT & STFT)."""

import numpy as np
import pytest
from pyaudiolab.spectral import compute_spectrum, compute_spectrogram, next_pow2


def test_next_pow2():
    assert next_pow2(0) == 1
    assert next_pow2(1) == 1
    assert next_pow2(2) == 2
    assert next_pow2(3) == 4
    assert next_pow2(1000) == 1024
    assert next_pow2(1024) == 1024
    assert next_pow2(1025) == 2048


def test_compute_spectrum_sine():
    sr = 44100
    t = np.linspace(0, 1.0, sr, endpoint=False)
    # 440 Hz tone
    audio = 0.8 * np.sin(2 * np.pi * 440 * t)

    res = compute_spectrum(audio, sr, num_bars=48, fft_size=2048)
    assert "bars" in res
    assert len(res["bars"]) == 48
    assert res["sample_rate"] == 44100
    assert res["fft_size"] == 2048
    # All bars should be between 0 and 1
    for val in res["bars"]:
        assert 0.0 <= val <= 1.0
    # Peak should be non-zero
    assert max(res["bars"]) > 0.5


def test_compute_spectrum_stereo():
    sr = 44100
    t = np.linspace(0, 1.0, sr, endpoint=False)
    audio = np.stack([
        0.5 * np.sin(2 * np.pi * 440 * t),
        0.5 * np.sin(2 * np.pi * 880 * t),
    ], axis=1)

    res = compute_spectrum(audio, sr, num_bars=32)
    assert len(res["bars"]) == 32
    assert all(0.0 <= v <= 1.0 for v in res["bars"])


def test_compute_spectrum_empty():
    res = compute_spectrum(np.array([], dtype=np.float32), 44100, num_bars=24)
    assert len(res["bars"]) == 24
    assert all(v == 0.0 for v in res["bars"])


def test_compute_spectrogram():
    sr = 44100
    t = np.linspace(0, 2.0, 2 * sr, endpoint=False)
    audio = 0.7 * np.sin(2 * np.pi * 1000 * t)

    res = compute_spectrogram(audio, sr, target_cols=200, target_rows=80, fft_size=1024)
    assert res["cols"] > 0
    assert res["rows"] == 80
    assert res["sample_rate"] == 44100
    assert res["duration_s"] == pytest.approx(2.0, rel=1e-3)
    assert len(res["data"]) == res["cols"] * res["rows"]
    assert all(0.0 <= v <= 1.0 for v in res["data"])


def test_compute_spectrogram_empty():
    res = compute_spectrogram(np.array([], dtype=np.float32), 44100, target_rows=50)
    assert res["rows"] == 50
    assert len(res["data"]) == res["cols"] * 50
