"""
effects/normalize.py — Peak and RMS normalization.

DSP Approach:
    Peak normalization:
        scale = 10^(target_db/20) / max(|audio|)
        Guarantees the loudest sample hits exactly target_db dBFS.

    RMS normalization:
        rms = sqrt(mean(audio^2))
        scale = 10^(target_db/20) / rms
        Matches perceived loudness more closely than peak normalization.
        Used in broadcast loudness standards (LUFS is a weighted RMS).

Parameters:
    target_db (float): Target level in dBFS. Default -1.0 dBFS.
    mode (str):        'peak' or 'rms'. Default 'peak'.
"""

from __future__ import annotations
import numpy as np


def _rms(audio: np.ndarray) -> float:
    """Compute RMS over entire array (all channels)."""
    return float(np.sqrt(np.mean(audio ** 2)))


def _peak(audio: np.ndarray) -> float:
    """Compute peak absolute value over entire array."""
    return float(np.max(np.abs(audio)))


def normalize(
    audio: np.ndarray,
    sr: int,
    *,
    target_db: float = -1.0,
    mode: str = "peak",
) -> np.ndarray:
    """Normalize audio to a target level.

    Args:
        audio:     Input float64 array, shape (N,) or (N, 2).
        sr:        Sample rate (unused; kept for uniform signature).
        target_db: Target level in dBFS (e.g., -1.0).
        mode:      'peak' or 'rms'.

    Returns:
        Normalized float64 array, same shape as input.

    Raises:
        ValueError: If mode is not 'peak' or 'rms'.
        RuntimeWarning: If audio is silent (returns as-is with a warning).
    """
    if mode not in ("peak", "rms"):
        raise ValueError(f"mode must be 'peak' or 'rms', got {mode!r}")

    if mode == "peak":
        current_level = _peak(audio)
    else:
        current_level = _rms(audio)

    if current_level < 1e-10:
        import warnings
        warnings.warn("Audio appears silent — normalize has no effect.", RuntimeWarning)
        return audio.copy()

    target_linear = 10.0 ** (target_db / 20.0)
    scale = target_linear / current_level
    return audio * scale
