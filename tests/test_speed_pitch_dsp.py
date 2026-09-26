"""tests/test_speed_pitch_dsp.py — Unit tests for pyaudiolab/speed_pitch_dsp.py"""

import numpy as np
import pytest

from pyaudiolab.speed_pitch_dsp import (
    fft,
    analyzeMovingFrame,
    wsolaTimeStretch,
    computeResampledBuffer,
    evaluateAliasingState,
    generateSynthetic440,
    analyze_moving_frame,
    wsola_time_stretch,
    compute_resampled_buffer,
    evaluate_aliasing_state,
    generate_synthetic_440,
)


class TestCooleyTukeyFFT:
    def test_fft_impulse(self):
        n = 8
        re = np.zeros(n, dtype=np.float64)
        im = np.zeros(n, dtype=np.float64)
        re[0] = 1.0  # unit impulse

        fft(re, im)
        np.testing.assert_allclose(re, np.ones(n))
        np.testing.assert_allclose(im, np.zeros(n))

    def test_fft_matches_numpy_fft(self):
        n = 64
        t = np.linspace(0, 1, n, endpoint=False)
        sig = np.sin(2 * np.pi * 4 * t) + 0.5 * np.cos(2 * np.pi * 10 * t)

        re = sig.copy().astype(np.float64)
        im = np.zeros(n, dtype=np.float64)

        fft(re, im)
        np_fft = np.fft.fft(sig)

        np.testing.assert_allclose(re, np_fft.real, atol=1e-5)
        np.testing.assert_allclose(im, np_fft.imag, atol=1e-5)


class TestSyntheticTone:
    def test_generate_synthetic_440(self):
        sr = 44100
        dur = 2.0
        buf = generateSynthetic440(sampleRate=sr, duration=dur)
        assert len(buf) == int(sr * dur)
        assert buf.dtype == np.float32
        assert np.max(np.abs(buf)) > 0.1
        # Ends should fade to zero by Hann envelope
        assert abs(buf[0]) < 1e-4
        assert abs(buf[-1]) < 1e-4


class TestAnalyzeMovingFrame:
    def test_analyze_synthetic_frame(self):
        sr = 44100
        buf = generateSynthetic440(sampleRate=sr, duration=2.0)
        res = analyzeMovingFrame(buf, timeSec=1.0, sampleRate=sr)

        assert "barMags" in res
        assert len(res["barMags"]) == 64
        assert "peakFreq" in res
        # Peak frequency should be near 440 Hz
        assert abs(res["peakFreq"] - 440.0) < 30.0

    def test_empty_buffer(self):
        res = analyzeMovingFrame([], timeSec=0.0)
        assert len(res["barMags"]) == 64
        assert res["peakFreq"] == 440.0


class TestWSOLATimeStretch:
    def test_unity_stretch_is_identity(self):
        sr = 44100
        buf = generateSynthetic440(sampleRate=sr, duration=1.0)
        out = wsolaTimeStretch(buf, speedFactor=1.0, sampleRate=sr)
        np.testing.assert_allclose(out, buf)

    def test_half_speed_doubles_length(self):
        sr = 44100
        buf = generateSynthetic440(sampleRate=sr, duration=1.0)
        out = wsolaTimeStretch(buf, speedFactor=0.5, sampleRate=sr)
        expected_len = int(len(buf) / 0.5)
        assert abs(len(out) - expected_len) <= 5

    def test_double_speed_halves_length(self):
        sr = 44100
        buf = generateSynthetic440(sampleRate=sr, duration=1.0)
        out = wsolaTimeStretch(buf, speedFactor=2.0, sampleRate=sr)
        expected_len = int(len(buf) / 2.0)
        assert abs(len(out) - expected_len) <= 5


class TestComputeResampledBuffer:
    def test_naive_resampling_length(self):
        sr = 44100
        buf = generateSynthetic440(sampleRate=sr, duration=1.0)
        out = computeResampledBuffer(buf, speedFactor=1.5, targetFs=44100, resampleMode="naive", sampleRate=sr)
        expected_len = int(len(buf) / 1.5)
        assert abs(len(out) - expected_len) <= 2

    def test_smart_resampling_length(self):
        sr = 44100
        buf = generateSynthetic440(sampleRate=sr, duration=1.0)
        out = computeResampledBuffer(buf, speedFactor=1.5, targetFs=44100, resampleMode="smart", sampleRate=sr)
        expected_len = int(len(buf) / 1.5)
        assert abs(len(out) - expected_len) <= 5

    def test_downsampling_ratio(self):
        sr = 44100
        buf = generateSynthetic440(sampleRate=sr, duration=1.0)
        out = computeResampledBuffer(buf, speedFactor=1.0, targetFs=22050, resampleMode="naive", sampleRate=sr)
        assert len(out) == len(buf)


class TestEvaluateAliasingState:
    def test_safe_state(self):
        res = evaluateAliasingState(origPeakFreq=440.0, targetFs=44100, speedFactor=1.0, resampleMode="naive")
        assert res["status"] == "SAFE"
        assert res["aliasFreq"] is None
        assert res["nyquist"] == 22050.0

    def test_aliasing_state(self):
        # 440 Hz * 2.0x speed = 880 Hz, target Fs = 800 Hz -> Nyquist = 400 Hz -> folded alias = 80 Hz
        res = evaluateAliasingState(origPeakFreq=440.0, targetFs=800.0, speedFactor=2.0, resampleMode="naive")
        assert res["status"] == "ALIASING"
        assert res["nyquist"] == 400.0
        assert res["aliasFreq"] == 80.0

    def test_smart_mode_no_speed_multiplier_on_frequency(self):
        # In smart mode, peak freq is preserved at 440 Hz regardless of 2.0x speed
        # If target Fs = 1000 Hz, Nyquist = 500 Hz -> 440 < 500 Hz (near nyquist or safe)
        res = evaluateAliasingState(origPeakFreq=440.0, targetFs=1000.0, speedFactor=2.0, resampleMode="smart")
        assert res["status"] in ("SAFE", "NEAR NYQUIST")
