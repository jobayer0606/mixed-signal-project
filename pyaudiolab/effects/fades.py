"""
effects/fades.py — Fade-in and Fade-out amplitude envelopes.

DSP Approach:
    A fade envelope is a ramp from 0→1 (fade-in) or 1→0 (fade-out)
    applied over the first/last N samples.

    Linear:      envelope[i] = i / N
    Exponential: envelope[i] = (e^(i/N) - 1) / (e - 1)
        The exponential curve better matches human loudness perception
        (equal-loudness in dB space → exponential in linear amplitude space).

Parameters:
    duration_ms (float): Length of the fade in milliseconds. Clamped to
                         [0, total_duration_ms].
    curve (str):         'linear' or 'exponential' (default 'linear').
"""

from __future__ import annotations
import numpy as np


def _fade_envelope(n_samples: int, curve: str) -> np.ndarray:
    """Return a 0→1 fade-in envelope of length n_samples."""
    t = np.linspace(0.0, 1.0, n_samples, endpoint=True)
    if curve == "exponential":
        e = np.e
        envelope = (np.exp(t) - 1.0) / (e - 1.0)
    else:  # linear
        envelope = t
    return envelope


def fade_in(
    audio: np.ndarray,
    sr: int,
    *,
    duration_ms: float = 500.0,
    curve: str = "linear",
) -> np.ndarray:
    """Apply a fade-in envelope to the start of the audio.

    Args:
        audio:       Input float64 array, shape (N,) or (N, 2).
        sr:          Sample rate in Hz.
        duration_ms: Duration of the fade in milliseconds.
        curve:       Envelope shape: 'linear' or 'exponential'.

    Returns:
        Processed float64 array, same shape as input.
    """
    out = audio.copy()
    n_fade = min(int(sr * duration_ms / 1000.0), out.shape[0])
    if n_fade <= 0:
        return out

    env = _fade_envelope(n_fade, curve)  # shape (n_fade,)

    if out.ndim == 2:
        # Broadcast over channels: (n_fade,) → (n_fade, 1)
        env = env[:, np.newaxis]

    out[:n_fade] *= env
    return out


def fade_out(
    audio: np.ndarray,
    sr: int,
    *,
    duration_ms: float = 500.0,
    curve: str = "linear",
) -> np.ndarray:
    """Apply a fade-out envelope to the end of the audio.

    Args:
        audio:       Input float64 array, shape (N,) or (N, 2).
        sr:          Sample rate in Hz.
        duration_ms: Duration of the fade in milliseconds.
        curve:       Envelope shape: 'linear' or 'exponential'.

    Returns:
        Processed float64 array, same shape as input.
    """
    out = audio.copy()
    n_total = out.shape[0]
    n_fade = min(int(sr * duration_ms / 1000.0), n_total)
    if n_fade <= 0:
        return out

    env = _fade_envelope(n_fade, curve)[::-1].copy()  # reverse: 1→0

    if out.ndim == 2:
        env = env[:, np.newaxis]

    out[n_total - n_fade:] *= env
    return out
