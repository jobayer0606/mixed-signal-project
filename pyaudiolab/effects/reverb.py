"""
effects/reverb.py — Schroeder Reverb (comb + allpass filter network).

DSP Approach:
    The Schroeder reverb model (1961) approximates a reverberant space using:

    1. Four parallel comb filters (each a feedback delay line with damping):
           y[n] = x[n] + feedback * (y[n-D] * (1-damping) + prev_damp * damping)
       Each comb filter uses a different prime-ish delay length to distribute
       resonances and avoid metallic colouration.

    2. Two series allpass filters:
           y[n] = -x[n] + x[n-D] + feedback * y[n-D]
       Allpass filters spread energy without colouring the frequency response.

    The four comb outputs are summed, then passed through both allpass filters.
    The final wet signal is mixed with the dry signal.

Parameters:
    room_size (float): Controls comb filter delay lengths (scales reverb tail).
                       Range [0.1, 1.0]. Default 0.5.
    damping   (float): High-frequency damping inside comb filters [0, 1].
                       0 = bright, 1 = dull/dark. Default 0.5.
    mix       (float): Wet/dry blend [0, 1]. Default 0.3.
"""

from __future__ import annotations
import numpy as np


# Comb and allpass delay lengths in samples at 44100 Hz (will be scaled by sr/44100)
_COMB_DELAYS_BASE = [1557, 1617, 1491, 1422]
_ALLPASS_DELAYS_BASE = [225, 556]
_COMB_FEEDBACK = 0.84
_ALLPASS_FEEDBACK = 0.5


def _scale_delays(base_delays: list[int], sr: int, room_size: float) -> list[int]:
    scale = (sr / 44100.0) * room_size * 2.0
    return [max(1, int(d * scale)) for d in base_delays]


def _comb_filter(
    x: np.ndarray,
    delay: int,
    feedback: float,
    damping: float,
) -> np.ndarray:
    """Feedback comb filter with per-sample damping."""
    n = len(x)
    buf = np.zeros(delay, dtype=np.float64)
    out = np.zeros(n, dtype=np.float64)
    damp_store = 0.0
    idx = 0

    for i in range(n):
        buf_out = buf[idx]
        damp_store = buf_out * (1.0 - damping) + damp_store * damping
        buf[idx] = x[i] + feedback * damp_store
        out[i] = buf_out
        idx = (idx + 1) % delay

    return out


def _allpass_filter(x: np.ndarray, delay: int, feedback: float) -> np.ndarray:
    """Schroeder allpass filter."""
    n = len(x)
    buf = np.zeros(delay, dtype=np.float64)
    out = np.zeros(n, dtype=np.float64)
    idx = 0

    for i in range(n):
        buf_out = buf[idx]
        buf_val = x[i] + feedback * buf_out
        buf[idx] = buf_val
        out[i] = buf_out - x[i]
        idx = (idx + 1) % delay

    return out


def _reverb_mono(
    x: np.ndarray,
    sr: int,
    room_size: float,
    damping: float,
) -> np.ndarray:
    """Apply Schroeder reverb to a mono signal."""
    comb_delays = _scale_delays(_COMB_DELAYS_BASE, sr, room_size)
    allpass_delays = _scale_delays(_ALLPASS_DELAYS_BASE, sr, 1.0)

    # Parallel comb filters
    comb_out = sum(
        _comb_filter(x, d, _COMB_FEEDBACK, damping)
        for d in comb_delays
    )
    comb_out = comb_out / len(comb_delays)  # Normalise level

    # Series allpass filters
    ap_out = _allpass_filter(comb_out, allpass_delays[0], _ALLPASS_FEEDBACK)
    ap_out = _allpass_filter(ap_out, allpass_delays[1], _ALLPASS_FEEDBACK)

    return ap_out


def schroeder_reverb(
    audio: np.ndarray,
    sr: int,
    *,
    room_size: float = 0.5,
    damping: float = 0.5,
    mix: float = 0.3,
) -> np.ndarray:
    """Apply Schroeder reverb (4 comb + 2 allpass) to audio.

    Args:
        audio:     Input float64 array, shape (N,) or (N, 2).
        sr:        Sample rate in Hz.
        room_size: Reverb tail length scale [0.1, 1.0]. Default 0.5.
        damping:   High-frequency absorption [0, 1]. Default 0.5.
        mix:       Wet/dry blend [0, 1]. Default 0.3.

    Returns:
        Reverberant float64 array, same shape as input.
    """
    room_size = float(np.clip(room_size, 0.1, 1.0))
    damping = float(np.clip(damping, 0.0, 1.0))
    mix = float(np.clip(mix, 0.0, 1.0))

    if audio.ndim == 2:
        wet_left = _reverb_mono(audio[:, 0], sr, room_size, damping)
        wet_right = _reverb_mono(audio[:, 1], sr, room_size, damping)
        wet = np.stack([wet_left, wet_right], axis=1)
    else:
        wet = _reverb_mono(audio, sr, room_size, damping)

    return (1.0 - mix) * audio + mix * wet
