"""
effects/distortion.py — Waveshaping Distortion.

DSP Approach:
    Distortion is achieved by applying a non-linear transfer function
    (waveshaper) to the signal after applying pre-gain to push the
    signal into the non-linear region.

    Soft distortion (tanh waveshaper):
        y = tanh(drive_lin * x) / tanh(drive_lin)
        Produces smooth, harmonically rich saturation (tube-amp character).
        Normalised by tanh(drive_lin) to keep output in [-1, 1].

    Hard distortion (hard clip + pre-gain):
        y = clip(drive_lin * x, -1, +1)
        Square waveshaping; generates strong odd harmonics (transistor/fuzz character).

    Post-gain normalisation is applied so output level matches input level.

Parameters:
    drive_db (float): Pre-amp gain driving the non-linearity. Default 12 dB.
    mode (str):       'soft' (tanh) or 'hard' (clip). Default 'soft'.
    mix (float):      Wet/dry blend. 0 = clean, 1 = full distortion. Default 1.0.
"""

from __future__ import annotations
import numpy as np


def distort(
    audio: np.ndarray,
    sr: int,
    *,
    drive_db: float = 12.0,
    mode: str = "soft",
    mix: float = 1.0,
) -> np.ndarray:
    """Apply waveshaping distortion.

    Args:
        audio:    Input float64 array, shape (N,) or (N, 2).
        sr:       Sample rate (unused; kept for uniform signature).
        drive_db: Pre-amp gain in dB driving the waveshaper (default 12).
        mode:     'soft' (tanh) or 'hard' (hard clip). Default 'soft'.
        mix:      Wet/dry blend [0, 1]. Default 1.0 (full effect).

    Returns:
        Distorted float64 array, same shape as input.
    """
    if mode not in ("soft", "hard"):
        raise ValueError(f"mode must be 'soft' or 'hard', got {mode!r}")

    mix = float(np.clip(mix, 0.0, 1.0))
    drive_lin = 10.0 ** (drive_db / 20.0)

    driven = audio * drive_lin

    if mode == "soft":
        # Normalised tanh waveshaper: output stays in [-1, 1]
        norm = np.tanh(drive_lin) if drive_lin > 1e-6 else 1.0
        wet = np.tanh(driven) / norm
    else:  # hard
        wet = np.clip(driven, -1.0, 1.0)

    return (1.0 - mix) * audio + mix * wet
