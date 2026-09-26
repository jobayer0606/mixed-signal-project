"""
effects/compressor.py — Dynamic Range Compressor for Voice Mastering.

DSP Approach:
    Vocal dynamic range requires transparent leveling that tames loud plosives and
    shouts while lifting quiet words and sentence tails without audible 'breathing' or pumping.

    Algorithm:
    1. Detector: Hybrid Peak/RMS smoothed level detector.
    2. Soft Knee Characteristic:
       For level L (dB):
           if 2 * (L - threshold) < -knee:
               y = L  (no compression)
           elif 2 * abs(L - threshold) <= knee:
               y = L + ((1/ratio - 1) * (L - threshold + knee/2)^2) / (2 * knee)
           else:
               y = threshold + (L - threshold) / ratio
       Gain reduction (dB) = y - L
    3. Smooth 1-pole envelope filtering for attack and release.
    4. Stereo linked detection to maintain stereo soundstage stability.
"""

from __future__ import annotations
import numpy as np


def voice_compress(
    audio: np.ndarray,
    sr: int,
    *,
    threshold_db: float = -18.0,
    ratio: float = 3.0,
    attack_ms: float = 12.0,
    release_ms: float = 100.0,
    makeup_db: float = 0.0,
    knee_db: float = 6.0,
) -> np.ndarray:
    """Apply transparent soft-knee vocal compression.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        threshold_db: Compression threshold in dBFS (default -18.0).
        ratio: Compression ratio (e.g. 3.0 for 3:1).
        attack_ms: Attack time constant in ms (default 12.0).
        release_ms: Release time constant in ms (default 100.0).
        makeup_db: Makeup gain in dB applied after compression (default 0.0).
        knee_db: Soft-knee width in dB (default 6.0).

    Returns:
        Compressed audio array, same shape as input.
    """
    ratio = max(1.0, float(ratio))
    knee = max(0.0, float(knee_db))

    # Linked mono detection signal
    if audio.ndim == 2:
        detect_sig = np.max(np.abs(audio), axis=1)
    else:
        detect_sig = np.abs(audio)

    n_samples = len(detect_sig)
    if n_samples == 0:
        return audio.copy()

    # Time constants for envelope follower
    alpha_attack = np.exp(-1.0 / max(1.0, sr * attack_ms / 1000.0))
    alpha_release = np.exp(-1.0 / max(1.0, sr * release_ms / 1000.0))

    # Envelope detector in linear domain
    env = np.zeros(n_samples, dtype=np.float64)
    curr_env = 1e-6
    for i in range(n_samples):
        val = detect_sig[i]
        if val > curr_env:
            curr_env = alpha_attack * curr_env + (1.0 - alpha_attack) * val
        else:
            curr_env = alpha_release * curr_env + (1.0 - alpha_release) * val
        env[i] = curr_env

    # Convert envelope to dBFS
    env_db = 20.0 * np.log10(np.maximum(env, 1e-6))

    # Soft-knee gain computer
    gain_reduction_db = np.zeros(n_samples, dtype=np.float64)
    T = threshold_db
    R = ratio
    half_knee = knee / 2.0

    diff = env_db - T

    # Vectorized soft-knee computation
    below_knee = diff < -half_knee
    above_knee = diff > half_knee
    in_knee = ~(below_knee | above_knee)

    # 1. Below knee: gain reduction is 0 dB
    gain_reduction_db[below_knee] = 0.0

    # 2. Above knee: standard compression
    gain_reduction_db[above_knee] = (diff[above_knee]) * (1.0 / R - 1.0)

    # 3. Inside soft-knee: quadratic interpolation
    if knee > 1e-4:
        val_in = diff[in_knee] + half_knee
        gain_reduction_db[in_knee] = ((1.0 / R - 1.0) * (val_in ** 2)) / (2.0 * knee)

    # Total gain = reduction + makeup
    total_gain_db = gain_reduction_db + makeup_db
    gain_lin = 10.0 ** (total_gain_db / 20.0)

    # Apply gain to audio
    if audio.ndim == 2:
        return audio * gain_lin[:, np.newaxis]
    else:
        return audio * gain_lin
