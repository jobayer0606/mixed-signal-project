"""
effects/delay.py — Feedback delay line (Echo / Delay effect).

DSP Approach:
    A feedback delay line produces exponentially decaying echoes by summing
    the input signal with time-shifted, attenuated copies of itself.

    For k-th echo:  echo_k[n] = feedback^k * x[n - k * delay_samples]

    The wet signal is the sum of all such echoes:
        wet[n] = sum_k(feedback^k * x[n - k*D])

    The output is a wet/dry blend:
        y[n] = (1 - mix) * x[n] + mix * wet[n]

Parameters:
    delay_ms  (float): Delay time in milliseconds. Default 250 ms.
    feedback  (float): Fraction of the delayed signal fed back. Range [0, 0.95].
                       Values ≥ 1.0 cause infinite feedback (clamp enforced).
    mix       (float): Wet/dry mix. 0 = fully dry, 1 = fully wet. Default 0.5.
"""

from __future__ import annotations
import numpy as np


def apply_delay(
    audio: np.ndarray,
    sr: int,
    *,
    delay_ms: float = 250.0,
    feedback: float = 0.4,
    mix: float = 0.5,
) -> np.ndarray:
    """Apply a feedback delay (echo) effect.

    Args:
        audio:    Input float64 array, shape (N,) or (N, 2).
        sr:       Sample rate in Hz.
        delay_ms: Echo delay in milliseconds (default 250).
        feedback: Feedback fraction (default 0.4, clamped to [0, 0.95]).
        mix:      Wet/dry mix, 0=dry, 1=wet (default 0.5).

    Returns:
        Processed float64 array, same shape as input + decay tail.
    """
    feedback = float(np.clip(feedback, 0.0, 0.95))
    mix = float(np.clip(mix, 0.0, 1.0))

    delay_samples = int(sr * delay_ms / 1000.0)
    if delay_samples <= 0:
        return audio.copy()

    n = audio.shape[0]
    is_stereo = audio.ndim == 2

    # Calculate how many echo repeats to include (stop when energy < -80 dB)
    if feedback > 1e-6:
        n_repeats = int(np.ceil(np.log(1e-4) / np.log(feedback))) + 1
    else:
        n_repeats = 1
    n_repeats = max(1, min(n_repeats, 20))

    # Output length = original + tail of last echo
    out_len = n + delay_samples * n_repeats

    if is_stereo:
        dry_full = np.zeros((out_len, 2), dtype=np.float64)
        dry_full[:n] = audio
        wet = np.zeros((out_len, 2), dtype=np.float64)
    else:
        dry_full = np.zeros(out_len, dtype=np.float64)
        dry_full[:n] = audio
        wet = np.zeros(out_len, dtype=np.float64)

    # Build wet signal: sum of time-shifted, attenuated copies of the input
    for k in range(1, n_repeats + 1):
        shift = delay_samples * k
        gain = feedback ** k
        src_end = min(n, out_len - shift)
        if src_end <= 0:
            break
        if is_stereo:
            wet[shift: shift + src_end] += audio[:src_end] * gain
        else:
            wet[shift: shift + src_end] += audio[:src_end] * gain

    result = (1.0 - mix) * dry_full + mix * wet
    return result
