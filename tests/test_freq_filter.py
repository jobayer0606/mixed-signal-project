"""tests/test_freq_filter.py — Unit tests for FFT Frequency Range Explorer & Filter DSP."""

import numpy as np
import pytest
from pyaudiolab.effects.freq_filter import frequency_filter
from pyaudiolab.effects import EFFECT_REGISTRY


class TestFrequencyFilter:
    def test_registered_in_effect_registry(self):
        assert "freq_filter" in EFFECT_REGISTRY
        assert "frequency_filter" in EFFECT_REGISTRY
        assert EFFECT_REGISTRY["freq_filter"] is frequency_filter

    def test_empty_audio(self, sr):
        empty = np.array([], dtype=np.float64)
        out = frequency_filter(empty, sr)
        assert out.size == 0

    def test_lowpass_passes_low_freq_and_attenuates_high(self, sr):
        t = np.linspace(0, 1.0, sr, endpoint=False)
        # Mix 100 Hz bass tone + 5000 Hz high pitch tone
        s_low = 0.5 * np.sin(2 * np.pi * 100.0 * t)
        s_high = 0.5 * np.sin(2 * np.pi * 5000.0 * t)
        signal = s_low + s_high

        # Lowpass filter with cutoff at 500 Hz
        filtered = frequency_filter(signal, sr, filter_type="lowpass", high_freq=500.0, order=6)
        assert filtered.shape == signal.shape

        # FFT analysis: 100 Hz energy should be preserved, 5000 Hz energy heavily attenuated
        fft_orig = np.abs(np.fft.rfft(signal))
        fft_filt = np.abs(np.fft.rfft(filtered))
        freqs = np.fft.rfftfreq(len(signal), d=1.0 / sr)

        idx_100 = np.argmin(np.abs(freqs - 100.0))
        idx_5000 = np.argmin(np.abs(freqs - 5000.0))

        # 100 Hz should be nearly intact (ratio > 0.8)
        assert fft_filt[idx_100] / fft_orig[idx_100] > 0.8
        # 5000 Hz should be attenuated by > 30 dB (ratio < 0.03)
        assert fft_filt[idx_5000] / fft_orig[idx_5000] < 0.03

    def test_highpass_passes_high_freq_and_attenuates_low(self, sr):
        t = np.linspace(0, 1.0, sr, endpoint=False)
        s_low = 0.5 * np.sin(2 * np.pi * 100.0 * t)
        s_high = 0.5 * np.sin(2 * np.pi * 5000.0 * t)
        signal = s_low + s_high

        # Highpass filter with cutoff at 1000 Hz
        filtered = frequency_filter(signal, sr, filter_type="highpass", low_freq=1000.0, order=6)

        fft_orig = np.abs(np.fft.rfft(signal))
        fft_filt = np.abs(np.fft.rfft(filtered))
        freqs = np.fft.rfftfreq(len(signal), d=1.0 / sr)

        idx_100 = np.argmin(np.abs(freqs - 100.0))
        idx_5000 = np.argmin(np.abs(freqs - 5000.0))

        # 100 Hz should be heavily attenuated
        assert fft_filt[idx_100] / fft_orig[idx_100] < 0.03
        # 5000 Hz should be nearly intact
        assert fft_filt[idx_5000] / fft_orig[idx_5000] > 0.8

    def test_bandpass_isolates_specific_range(self, sr):
        t = np.linspace(0, 1.0, sr, endpoint=False)
        s_low = 0.4 * np.sin(2 * np.pi * 80.0 * t)
        s_mid = 0.4 * np.sin(2 * np.pi * 1000.0 * t)
        s_high = 0.4 * np.sin(2 * np.pi * 8000.0 * t)
        signal = s_low + s_mid + s_high

        # Bandpass filter from 500 Hz to 2000 Hz
        filtered = frequency_filter(signal, sr, filter_type="bandpass", low_freq=500.0, high_freq=2000.0, order=6)

        fft_orig = np.abs(np.fft.rfft(signal))
        fft_filt = np.abs(np.fft.rfft(filtered))
        freqs = np.fft.rfftfreq(len(signal), d=1.0 / sr)

        idx_low = np.argmin(np.abs(freqs - 80.0))
        idx_mid = np.argmin(np.abs(freqs - 1000.0))
        idx_high = np.argmin(np.abs(freqs - 8000.0))

        # Mid is preserved
        assert fft_filt[idx_mid] / fft_orig[idx_mid] > 0.8
        # Low and high are attenuated
        assert fft_filt[idx_low] / fft_orig[idx_low] < 0.05
        assert fft_filt[idx_high] / fft_orig[idx_high] < 0.05

    def test_stereo_channel_shape_preserved(self, sine_stereo, sr):
        out = frequency_filter(sine_stereo, sr, filter_type="bandpass", low_freq=200.0, high_freq=2000.0)
        assert out.shape == sine_stereo.shape
        assert out.ndim == 2

    def test_silence_input(self, silence_mono, sr):
        out = frequency_filter(silence_mono, sr, filter_type="lowpass", high_freq=1000.0)
        np.testing.assert_allclose(out, 0.0, atol=1e-10)

    def test_invalid_filter_type_raises(self, sine_mono, sr):
        with pytest.raises(ValueError, match="Unsupported filter_type"):
            frequency_filter(sine_mono, sr, filter_type="invalid_type")
