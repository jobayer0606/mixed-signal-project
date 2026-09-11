"""
pyaudiolab.spectral — Frequency-domain analysis functions (FFT Spectrum & STFT Spectrogram).

Performs real FFT and STFT calculations using NumPy.
"""

from __future__ import annotations

from typing import Dict, Any, List, Union
import numpy as np


def next_pow2(n: int) -> int:
    """Return the next power of 2 greater than or equal to n."""
    if n <= 1:
        return 1
    return 1 << (int(n) - 1).bit_length()


def _ensure_mono(audio: np.ndarray) -> np.ndarray:
    """Convert multi-channel audio to mono by averaging channels."""
    if audio.ndim == 2:
        return np.mean(audio, axis=1)
    return audio


def compute_spectrum(
    audio: np.ndarray,
    sr: int,
    num_bars: int = 48,
    fft_size: int = 2048,
) -> Dict[str, Any]:
    """Compute a log-binned magnitude spectrum normalized to [0, 1] for visual display.

    Args:
        audio: 1D or 2D audio array (float).
        sr: Sample rate in Hz.
        num_bars: Number of output frequency bars.
        fft_size: Desired FFT window size.

    Returns:
        Dictionary containing:
            - bars: list of float values in [0, 1] normalized magnitude (-90 dB to 0 dBFS).
            - sample_rate: sample rate in Hz.
            - num_bars: number of bars.
            - fft_size: actual FFT size used.
    """
    samples = _ensure_mono(audio)
    n = len(samples)
    if n == 0:
        return {
            "bars": [0.0] * num_bars,
            "sample_rate": int(sr),
            "num_bars": int(num_bars),
            "fft_size": int(fft_size),
        }

    size = next_pow2(min(fft_size, next_pow2(max(1, n))))
    start = max(0, (n - size) // 2)

    # Slice or pad to exact size
    if start + size <= n:
        segment = samples[start : start + size].astype(np.float64, copy=False)
    else:
        segment = np.zeros(size, dtype=np.float64)
        available = samples[start:]
        segment[: len(available)] = available

    # Hann window
    if size > 1:
        window = 0.5 - 0.5 * np.cos((2.0 * np.pi * np.arange(size)) / (size - 1))
    else:
        window = np.ones(1, dtype=np.float64)

    windowed = segment * window
    spec = np.fft.rfft(windowed, n=size)
    half = size // 2
    if half == 0:
        return {
            "bars": [0.0] * num_bars,
            "sample_rate": int(sr),
            "num_bars": int(num_bars),
            "fft_size": int(size),
        }

    mags = np.abs(spec[:half]) / half

    min_hz = 20.0
    max_hz = max(min_hz + 1.0, float(sr) / 2.0)
    log_min = np.log10(min_hz)
    log_max = np.log10(max_hz)

    bars: List[float] = []
    for b in range(num_bars):
        f0 = 10.0 ** (log_min + ((log_max - log_min) * b) / num_bars)
        f1 = 10.0 ** (log_min + ((log_max - log_min) * (b + 1)) / num_bars)
        i0 = max(1, int(np.floor((f0 / max_hz) * half)))
        i1 = min(half, int(np.ceil((f1 / max_hz) * half)))
        if i0 < i1:
            peak = float(np.max(mags[i0:i1]))
        elif i0 < half:
            peak = float(mags[i0])
        else:
            peak = float(mags[-1])
        db = 20.0 * np.log10(peak + 1e-6)
        val = max(0.0, min(1.0, (db + 90.0) / 90.0))
        bars.append(float(val))

    return {
        "bars": bars,
        "sample_rate": int(sr),
        "num_bars": int(num_bars),
        "fft_size": int(size),
    }


def compute_spectrogram(
    audio: np.ndarray,
    sr: int,
    target_cols: int = 360,
    target_rows: int = 160,
    fft_size: int = 1024,
) -> Dict[str, Any]:
    """Compute an STFT-based log-frequency spectrogram heatmap normalized to [0, 1].

    Args:
        audio: 1D or 2D audio array (float).
        sr: Sample rate in Hz.
        target_cols: Target number of time columns.
        target_rows: Target number of frequency rows.
        fft_size: FFT window size.

    Returns:
        Dictionary containing:
            - cols: number of time columns.
            - rows: number of frequency rows.
            - data: 1D list of length cols * rows with normalized values in [0, 1].
            - sample_rate: sample rate in Hz.
            - fft_size: FFT size used.
            - hop_size: hop step between windows.
            - duration_s: duration in seconds.
    """
    samples = _ensure_mono(audio).astype(np.float64, copy=False)
    n = len(samples)

    if n == 0:
        return {
            "cols": 1,
            "rows": int(target_rows),
            "data": [0.0] * target_rows,
            "sample_rate": int(sr),
            "fft_size": int(fft_size),
            "hop_size": 32,
            "duration_s": 0.0,
        }

    actual_fft_size = fft_size
    if n < actual_fft_size:
        actual_fft_size = next_pow2(max(64, n))

    hop = max(32, int(np.floor((n - actual_fft_size) / max(1, target_cols - 1))))
    cols = max(1, int(np.floor((n - actual_fft_size) / hop)) + 1)
    if cols > target_cols * 2:
        hop = max(1, int(np.floor((n - actual_fft_size) / target_cols)))
        cols = max(1, int(np.floor((n - actual_fft_size) / hop)) + 1)

    half = actual_fft_size // 2
    if actual_fft_size > 1:
        window = 0.5 - 0.5 * np.cos(
            (2.0 * np.pi * np.arange(actual_fft_size)) / (actual_fft_size - 1)
        )
    else:
        window = np.ones(1, dtype=np.float64)

    min_hz = 20.0
    max_hz = max(min_hz + 1.0, float(sr) / 2.0)
    log_min = np.log10(min_hz)
    log_max = np.log10(max_hz)

    row_lo = np.zeros(target_rows, dtype=np.int32)
    row_hi = np.zeros(target_rows, dtype=np.int32)
    for r in range(target_rows):
        f0 = 10.0 ** (log_min + ((log_max - log_min) * r) / target_rows)
        f1 = 10.0 ** (log_min + ((log_max - log_min) * (r + 1)) / target_rows)
        row_lo[r] = max(1, int(np.floor((f0 / max_hz) * half)))
        row_hi[r] = min(half, int(np.ceil((f1 / max_hz) * half)))

    data = np.zeros((cols, target_rows), dtype=np.float32)

    for c in range(cols):
        start = c * hop
        end = start + actual_fft_size
        if end <= n:
            frame = samples[start:end]
        else:
            frame = np.zeros(actual_fft_size, dtype=np.float64)
            avail = samples[start:]
            frame[: len(avail)] = avail

        windowed = frame * window
        spec = np.fft.rfft(windowed, n=actual_fft_size)
        mag = np.abs(spec[:half]) / max(1, half)

        for r in range(target_rows):
            lo = row_lo[r]
            hi = row_hi[r]
            if lo < hi:
                peak = float(np.max(mag[lo:hi]))
            elif lo < half:
                peak = float(mag[lo])
            elif half > 0:
                peak = float(mag[-1])
            else:
                peak = 0.0
            db = 20.0 * np.log10(peak + 1e-7)
            data[c, r] = max(0.0, min(1.0, (db + 95.0) / 95.0))

    return {
        "cols": int(cols),
        "rows": int(target_rows),
        "data": data.flatten().tolist(),
        "sample_rate": int(sr),
        "fft_size": int(actual_fft_size),
        "hop_size": int(hop),
        "duration_s": float(n / sr) if sr > 0 else 0.0,
    }
