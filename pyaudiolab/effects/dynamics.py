"""
effects/dynamics.py — Hard Limiter, Soft Clip, and Compressor.

DSP Approach:

    Hard Limit:
        Any sample exceeding the threshold is clipped to exactly ±threshold.
        Produces harmonic distortion (flat-top clipping).

    Soft Clip:
        Samples exceeding threshold are passed through:
            y = threshold * tanh(x / threshold)
        This smoothly compresses the waveform above the threshold,
        reducing harsh clipping artefacts vs. hard clipping.

    Compressor:
        Gain-computer stage:
            gain_reduction_db = 0                         if level ≤ threshold
            gain_reduction_db = (level - threshold)(1-1/ratio)  otherwise
        Level detection uses a smoothed RMS with attack/release time constants:
            τ_attack  = exp(-1 / (sr * attack_ms  / 1000))
            τ_release = exp(-1 / (sr * release_ms / 1000))
        Output = input × 10^((gain_reduction + makeup) / 20)

Parameters:
    hard_limit / soft_clip:
        threshold_db (float): Threshold in dBFS. Default -6.0.

    compress:
        threshold_db (float): Compression starts above this level. Default -20.
        ratio (float):        Compression ratio (e.g. 4 = 4:1). Default 4.0.
        attack_ms (float):    Attack time in ms. Default 10.
        release_ms (float):   Release time in ms. Default 100.
        makeup_db (float):    Make-up gain in dB applied after compression. Default 0.
"""

from __future__ import annotations
import numpy as np


def hard_limit(
    audio: np.ndarray,
    sr: int,
    *,
    threshold_db: float = -6.0,
) -> np.ndarray:
    """Hard-clip any samples exceeding the threshold.

    Args:
        audio:        Input float64 array, shape (N,) or (N, 2).
        sr:           Sample rate (unused).
        threshold_db: Clip threshold in dBFS (default -6.0).

    Returns:
        Limited float64 array, same shape as input.
    """
    thresh = 10.0 ** (threshold_db / 20.0)
    return np.clip(audio, -thresh, thresh)


def soft_clip(
    audio: np.ndarray,
    sr: int,
    *,
    threshold_db: float = -6.0,
) -> np.ndarray:
    """Soft-clip samples above threshold using tanh waveshaping.

    Args:
        audio:        Input float64 array, shape (N,) or (N, 2).
        sr:           Sample rate (unused).
        threshold_db: Transition threshold in dBFS (default -6.0).

    Returns:
        Soft-clipped float64 array, same shape as input.
    """
    thresh = 10.0 ** (threshold_db / 20.0)
    out = audio.copy()
    above = np.abs(out) > thresh
    # tanh maps threshold * tanh(x/threshold); sign preserving
    out = np.where(above, thresh * np.tanh(out / thresh), out)
    return out


def compress(
    audio: np.ndarray,
    sr: int,
    *,
    threshold_db: float = -20.0,
    ratio: float = 4.0,
    attack_ms: float = 10.0,
    release_ms: float = 100.0,
    makeup_db: float = 0.0,
) -> np.ndarray:
    """Feed-forward RMS compressor with smooth attack/release envelope.

    Args:
        audio:        Input float64 array, shape (N,) or (N, 2).
        sr:           Sample rate in Hz.
        threshold_db: Compression threshold in dBFS (default -20).
        ratio:        Compression ratio, e.g. 4 for 4:1 (default 4.0).
        attack_ms:    Attack time constant in ms (default 10).
        release_ms:   Release time constant in ms (default 100).
        makeup_db:    Make-up gain in dB (default 0).

    Returns:
        Compressed float64 array, same shape as input.
    """
    # Work on mono envelope regardless of channel count
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio

    # Time constants (1-pole IIR)
    tau_a = np.exp(-1.0 / (sr * attack_ms / 1000.0))
    tau_r = np.exp(-1.0 / (sr * release_ms / 1000.0))

    n = len(mono)
    gain_db = np.zeros(n, dtype=np.float64)
    level_db = -120.0  # smoothed RMS level in dB

    makeup_lin = 10.0 ** (makeup_db / 20.0)
    gain_lin_arr = np.ones(n, dtype=np.float64)

    prev_level_db = -120.0
    prev_gain_db = 0.0

    for i in range(n):
        # Instantaneous level
        instant_linear = abs(float(mono[i]))
        instant_db = 20.0 * np.log10(max(instant_linear, 1e-10))

        # Smooth level with attack / release
        if instant_db > prev_level_db:
            level_db = tau_a * prev_level_db + (1.0 - tau_a) * instant_db
        else:
            level_db = tau_r * prev_level_db + (1.0 - tau_r) * instant_db
        prev_level_db = level_db

        # Gain computer
        if level_db <= threshold_db:
            target_gain_db = 0.0
        else:
            over = level_db - threshold_db
            target_gain_db = -over * (1.0 - 1.0 / ratio)

        # Smooth gain changes
        if target_gain_db < prev_gain_db:
            gain_db_i = tau_a * prev_gain_db + (1.0 - tau_a) * target_gain_db
        else:
            gain_db_i = tau_r * prev_gain_db + (1.0 - tau_r) * target_gain_db
        prev_gain_db = gain_db_i

        gain_lin_arr[i] = 10.0 ** (gain_db_i / 20.0) * makeup_lin

    # Apply gain to all channels
    if audio.ndim == 2:
        gain_lin_arr = gain_lin_arr[:, np.newaxis]

    return audio * gain_lin_arr
