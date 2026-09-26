"""
effects/basic.py — Reverse, Invert, and Trim Silence.

DSP Approach:

    Reverse:
        Flip the sample array along the time axis.
        result[i] = audio[N-1-i]

    Invert (Phase Invert):
        Multiply every sample by -1.
        Flips the polarity of the waveform.
        When mixed with the original, produces perfect cancellation (null test).

    Trim Silence:
        Divide the signal into overlapping windows of window_ms milliseconds.
        Compute per-window energy (RMS).
        Retain only windows whose energy exceeds threshold_db dBFS.
        Reconstruct audio from retained windows.

Parameters:
    Trim: threshold_db (float) — silence threshold in dBFS, default -40.
          window_ms (float)    — window length in ms, default 20 ms.
"""

from __future__ import annotations
import numpy as np

def reverse(audio: np.ndarray, sr: int) -> np.ndarray:
    """Reverse the audio in time.

    Args:
        audio: Input float64 array, shape (N,) or (N, 2).
        sr:    Sample rate (unused; kept for uniform signature).

    Returns:
        Time-reversed float64 array, same shape as input.
    """
    return audio[::-1].copy()


def invert(audio: np.ndarray, sr: int) -> np.ndarray:
    """Phase-invert the audio (multiply by -1).

    Args:
        audio: Input float64 array, shape (N,) or (N, 2).
        sr:    Sample rate (unused; kept for uniform signature).

    Returns:
        Phase-inverted float64 array, same shape as input.
    """
    return audio * -1.0

def trim_silence(
    audio: np.ndarray,
    sr: int,
    *,
    threshold_db: float = -40.0,
    window_ms: float = 20.0,
) -> np.ndarray:
    """Remove silence from the start and end (and internal) of the signal.

    Each audio window is tested for energy above threshold_db.
    Windows below the threshold are dropped; the remaining windows
    are concatenated to form the trimmed output.

    Args:
        audio:        Input float64 array, shape (N,) or (N, 2).
        sr:           Sample rate in Hz.
        threshold_db: Silence gate threshold in dBFS (default -40).
        window_ms:    Analysis window length in milliseconds (default 20).

    Returns:
        Trimmed float64 array. Returns an array of shape (0,) or (0, 2)
        if the entire input is below the threshold.
    """
    threshold_linear = 10.0 ** (threshold_db / 20.0)
    window_samples = max(1, int(sr * window_ms / 1000.0))

    n_total = audio.shape[0]
    is_stereo = audio.ndim == 2

    # Use mono energy for gating decision
    mono = audio.mean(axis=1) if is_stereo else audio

    kept_chunks = []
    for start in range(0, n_total, window_samples):
        end = min(start + window_samples, n_total)
        chunk_mono = mono[start:end]
        rms = float(np.sqrt(np.mean(chunk_mono ** 2)))
        if rms >= threshold_linear:
            kept_chunks.append(audio[start:end])

    if not kept_chunks:
        if is_stereo:
            return np.zeros((0, 2), dtype=audio.dtype)
        return np.zeros((0,), dtype=audio.dtype)

    return np.concatenate(kept_chunks, axis=0)