"""
effects/noise_reduction.py — Spectral Subtraction Noise Reduction.

DSP Approach:
    Spectral subtraction estimates the noise power spectral density (PSD) from
    a "noise-only" region (first noise_duration_ms of the signal), then subtracts
    a scaled version of the noise spectrum from each analysis frame.

    Algorithm:
        1. Compute noise PSD: N(k) = mean(|FFT(noise_frames)|^2) over k frequency bins.
        2. For each analysis frame X(k):
               Y(k) = max(|X(k)|^2 - strength * N(k), floor * N(k))^0.5
           Apply subtraction in magnitude domain; preserve original phase.
        3. Reconstruct with overlap-add iSTFT.

Parameters:
    noise_duration_ms (float): Duration of the initial noise-only region used
                                to estimate the noise profile. Default 500 ms.
    strength (float):          Noise subtraction strength [0, 2]. Default 1.0.
                                Values > 1 over-subtract (aggressive; may distort).
    floor (float):             Spectral floor as a fraction of noise PSD. Default 0.002.
    frame_ms (float):          Analysis frame length in ms. Default 25.
    overlap (float):           Frame overlap fraction [0, 1). Default 0.75.
"""

from __future__ import annotations
import numpy as np


def _spectral_subtraction_mono(
    x: np.ndarray,
    sr: int,
    noise_duration_ms: float,
    strength: float,
    floor: float,
    frame_ms: float,
    overlap: float,
) -> np.ndarray:
    """Spectral subtraction for a mono signal."""
    frame_len = max(256, int(sr * frame_ms / 1000.0))
    # Round up to next power of 2 for FFT efficiency
    n_fft = 1
    while n_fft < frame_len:
        n_fft *= 2

    hop = max(1, int(frame_len * (1.0 - overlap)))
    window = np.hanning(frame_len)

    # --- Step 1: Estimate noise PSD from the first noise_duration_ms ---
    noise_samples = min(int(sr * noise_duration_ms / 1000.0), len(x))
    noise_region = x[:noise_samples]

    noise_psds = []
    for start in range(0, max(1, len(noise_region) - frame_len + 1), hop):
        frame = noise_region[start: start + frame_len]
        if len(frame) < frame_len:
            frame = np.pad(frame, (0, frame_len - len(frame)))
        frame_win = frame * window
        spec = np.fft.rfft(frame_win, n=n_fft)
        noise_psds.append(np.abs(spec) ** 2)

    if not noise_psds:
        return x.copy()

    noise_psd = np.mean(noise_psds, axis=0)

    # --- Step 2: Process each frame ---
    n_total = len(x)
    out = np.zeros(n_total + frame_len, dtype=np.float64)
    norm_win = np.zeros(n_total + frame_len, dtype=np.float64)
    x_pad = np.pad(x, (0, frame_len))

    for start in range(0, n_total, hop):
        frame = x_pad[start: start + frame_len]
        if len(frame) < frame_len:
            frame = np.pad(frame, (0, frame_len - len(frame)))

        frame_win = frame * window
        spec = np.fft.rfft(frame_win, n=n_fft)

        mag_sq = np.abs(spec) ** 2
        phase = np.angle(spec)

        # Spectral subtraction with spectral floor
        mag_sq_clean = np.maximum(
            mag_sq - strength * noise_psd,
            floor * noise_psd,
        )
        mag_clean = np.sqrt(mag_sq_clean)
        spec_clean = mag_clean * np.exp(1j * phase)

        # iFFT and overlap-add with proper COLA normalization
        frame_out = np.fft.irfft(spec_clean, n=n_fft)[:frame_len]
        frame_out *= window

        end = start + frame_len
        out[start:end] += frame_out
        norm_win[start:end] += window ** 2

    # Normalise by OLA window sum
    norm_win = np.where(norm_win > 1e-8, norm_win, 1.0)
    out = out / norm_win
    return out[:n_total]


def reduce_noise(
    audio: np.ndarray,
    sr: int,
    *,
    noise_duration_ms: float = 500.0,
    strength: float = 1.0,
    floor: float = 0.002,
    frame_ms: float = 25.0,
    overlap: float = 0.75,
) -> np.ndarray:
    """Reduce noise via FFT spectral subtraction.

    Args:
        audio:             Input float64 array, shape (N,) or (N, 2).
        sr:                Sample rate in Hz.
        noise_duration_ms: Duration (ms) of noise-only region at start. Default 500.
        strength:          Subtraction strength [0, 2]. Default 1.0.
        floor:             Spectral floor fraction. Default 0.002.
        frame_ms:          Analysis frame length in ms. Default 25.
        overlap:           Frame overlap fraction. Default 0.75.

    Returns:
        Noise-reduced float64 array, same shape as input.
    """
    strength = float(np.clip(strength, 0.0, 2.0))
    floor = float(np.clip(floor, 1e-6, 1.0))

    if audio.ndim == 2:
        left = _spectral_subtraction_mono(
            audio[:, 0], sr, noise_duration_ms, strength, floor, frame_ms, overlap
        )
        right = _spectral_subtraction_mono(
            audio[:, 1], sr, noise_duration_ms, strength, floor, frame_ms, overlap
        )
        n = min(len(left), len(right))
        return np.stack([left[:n], right[:n]], axis=1)
    else:
        return _spectral_subtraction_mono(
            audio, sr, noise_duration_ms, strength, floor, frame_ms, overlap
        )
