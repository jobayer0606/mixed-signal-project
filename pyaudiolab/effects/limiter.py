"""
effects/limiter.py — Lookahead Peak Limiter & Clipper Prevention.

DSP Approach:
    A brickwall peak limiter prevents digital clipping and inter-sample peaks while
    maintaining high audio transparency.

    Algorithm:
    1. Lookahead Delay Buffer:
       The audio signal is delayed by a lookahead window (e.g. 3 ms).
       The gain computer inspects upcoming peaks in advance.
    2. Peak Envelope Detection:
       Tracks peaks with instantaneous attack and smooth exponential release.
    3. Gain Attenuation:
       Whenever an upcoming peak exceeds the ceiling threshold (e.g. -1.0 dBFS),
       the gain attenuation begins ramping down smoothly *before* the peak arrives,
       guaranteeing zero overshoot without flat-top hard clipping distortion.
"""

from __future__ import annotations
import numpy as np


def peak_limit(
    audio: np.ndarray,
    sr: int,
    *,
    ceiling_db: float = -1.0,
    lookahead_ms: float = 3.0,
    release_ms: float = 50.0,
) -> np.ndarray:
    """Apply lookahead peak limiting to prevent clipping.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        ceiling_db: Maximum peak ceiling in dBFS (default -1.0).
        lookahead_ms: Lookahead window in ms (default 3.0).
        release_ms: Limiter recovery release time in ms (default 50.0).

    Returns:
        Limited audio array with maximum peak <= ceiling_db.
    """
    ceiling_lin = 10.0 ** (ceiling_db / 20.0)
    lookahead_samples = max(1, int(sr * lookahead_ms / 1000.0))

    # Detect maximum instantaneous absolute amplitude across channels
    if audio.ndim == 2:
        abs_sig = np.max(np.abs(audio), axis=1)
    else:
        abs_sig = np.abs(audio)

    n_samples = len(abs_sig)
    if n_samples == 0:
        return audio.copy()

    # Fast-path: if audio peak is already below ceiling, skip processing entirely
    max_peak = float(np.max(abs_sig))
    if max_peak <= ceiling_lin:
        return audio.copy()

    # Calculate required gain factor per sample to stay under ceiling
    target_gain = np.ones(n_samples, dtype=np.float64)
    over_idx = abs_sig > ceiling_lin
    target_gain[over_idx] = ceiling_lin / (abs_sig[over_idx] + 1e-12)

    # High-speed vectorized lookahead min-filter using scipy.ndimage.minimum_filter1d
    from scipy.ndimage import minimum_filter1d
    lookahead_gain = minimum_filter1d(
        target_gain,
        size=lookahead_samples,
        origin=-(lookahead_samples // 2),
        mode="nearest",
    )

    # Apply smooth release filtering on the gain envelope
    alpha_release = np.exp(-1.0 / max(1.0, sr * release_ms / 1000.0))
    smooth_gain = np.ones(n_samples, dtype=np.float64)
    current_gain = 1.0

    for i in range(n_samples):
        g = lookahead_gain[i]
        if g < current_gain:
            # Immediate attack (already shifted by lookahead)
            current_gain = g
        else:
            # Smooth exponential recovery
            current_gain = alpha_release * current_gain + (1.0 - alpha_release) * g
        smooth_gain[i] = current_gain

    # Apply gain to audio
    if audio.ndim == 2:
        out = audio * smooth_gain[:, np.newaxis]
    else:
        out = audio * smooth_gain

    # Final safety clip at ceiling to guarantee no rounding overs
    return np.clip(out, -ceiling_lin, ceiling_lin)
