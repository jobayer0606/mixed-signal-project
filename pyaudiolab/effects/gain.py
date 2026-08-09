"""
effects/gain.py — Amplitude gain with soft-clip guard.

DSP Approach:
    Linear amplitude scale = 10^(gain_db / 20).
    After scaling, any samples with |x| > 1 are soft-clipped via tanh
    to prevent hard digital clipping while preserving transient shape.

Parameters:
    gain_db (float): Gain in decibels. Positive amplifies, negative attenuates.
                     Range: any real number (typical: -60 to +40 dB).
    soft_clip (bool): If True (default), apply tanh soft-clipping after gain.
                      Set to False to allow raw overflow for diagnostic use.
"""

from __future__ import annotations
import numpy as np


def apply_gain(
    audio: np.ndarray,
    sr: int,
    *,
    gain_db: float = 0.0,
    soft_clip: bool = True,
) -> np.ndarray:
    """Scale amplitude by gain_db decibels with optional soft-clip guard.

    Args:
        audio:     Input float64 array, shape (N,) or (N, 2).
        sr:        Sample rate (unused here; kept for uniform signature).
        gain_db:   Gain in dB.
        soft_clip: Apply tanh soft-clipping if True.

    Returns:
        Processed float64 array, same shape as input.
    """
    linear_scale = 10.0 ** (gain_db / 20.0)
    out = audio * linear_scale

    if soft_clip:
        # tanh maps ℝ → (-1, 1); normalise so that tanh(1)=1 → scale input
        # Only clip where |out| > 1 to avoid colouring unclipped signal
        needs_clip = np.abs(out) > 1.0
        out = np.where(needs_clip, np.tanh(out), out)

    return out
