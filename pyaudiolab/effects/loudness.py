"""
effects/loudness.py — ITU-R BS.1770-4 / EBU R128 Loudness Normalization & Audio Metrics.

DSP Approach:
    Perceived human loudness does not equal peak amplitude or raw RMS.
    ITU-R BS.1770 defines the worldwide broadcast and streaming standard (LUFS / LKFS):

    1. K-Weighting Filter Network:
       - Pre-filter: High-shelf filter modeling the acoustic head effect (+4 dB above 1.5 kHz).
       - RLB filter: 2nd-order highpass filter attenuating low frequencies below ~40 Hz.
    2. Block-based Gated Energy Measurement:
       - 400 ms sliding windows with 75% overlap.
       - Absolute threshold gating (-70 LKFS) excludes silence.
       - Relative threshold gating (-10 LU) excludes quiet pauses and background noise.
    3. Normalization:
       - Adjusts gain so speech matches standard podcast/streaming targets (-16 LUFS for stereo,
         -19 LUFS for mono, or user specified).
       - Followed by ceiling-safe limiting to ensure true peaks do not exceed -1.0 dBFS.
"""

from __future__ import annotations
from typing import Dict, Any
import numpy as np
from scipy.signal import butter, sosfilt, tf2sos
from pyaudiolab.effects.limiter import peak_limit


def _k_weighting_filter(sr: int) -> np.ndarray:
    """Design ITU-R BS.1770 K-weighting filter cascade as SOS matrix."""
    # Pre-filter: high-shelf +4.0 dB at 1681 Hz (Cookbook or BS.1770-4 specification)
    f0 = 1681.974450955533
    G = 3.999843853973347
    Q = 0.7071752369274193
    K = np.tan(np.pi * f0 / sr)
    Vh = 10.0 ** (G / 20.0)
    Vb = Vh ** 0.4996667741545416

    a0 = 1.0 + K / Q + K * K
    b0 = (Vh + Vb * K / Q + K * K) / a0
    b1 = 2.0 * (K * K - Vh) / a0
    b2 = (Vh - Vb * K / Q + K * K) / a0
    a1 = 2.0 * (K * K - 1.0) / a0
    a2 = (1.0 - K / Q + K * K) / a0

    pre_sos = tf2sos([b0, b1, b2], [1.0, a1, a2])

    # RLB filter: 2nd-order highpass filter at 38.13547087602444 Hz
    f_rlb = 38.13547087602444
    Q_rlb = 0.5003270373238773
    K_rlb = np.tan(np.pi * f_rlb / sr)

    a0_r = 1.0 + K_rlb / Q_rlb + K_rlb * K_rlb
    b0_r = 1.0 / a0_r
    b1_r = -2.0 / a0_r
    b2_r = 1.0 / a0_r
    a1_r = 2.0 * (K_rlb * K_rlb - 1.0) / a0_r
    a2_r = (1.0 - K_rlb / Q_rlb + K_rlb * K_rlb) / a0_r

    rlb_sos = tf2sos([b0_r, b1_r, b2_r], [1.0, a1_r, a2_r])

    return np.vstack([pre_sos, rlb_sos])


def measure_loudness(audio: np.ndarray, sr: int) -> Dict[str, float]:
    """Measure integrated LUFS, peak dBFS, and RMS dBFS according to ITU-R BS.1770.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.

    Returns:
        Dictionary with keys:
            - lufs: Integrated loudness in LUFS.
            - peak_dbfs: Peak absolute amplitude in dBFS.
            - rms_dbfs: Overall RMS energy in dBFS.
            - dynamic_range_db: Difference between peak and noise floor.
    """
    if audio.size == 0:
        return {"lufs": -70.0, "peak_dbfs": -120.0, "rms_dbfs": -120.0, "dynamic_range_db": 0.0}

    # Peak & RMS
    peak_val = float(np.max(np.abs(audio)))
    peak_dbfs = 20.0 * np.log10(max(1e-6, peak_val))

    rms_val = float(np.sqrt(np.mean(audio ** 2)))
    rms_dbfs = 20.0 * np.log10(max(1e-6, rms_val))

    # K-weighting filtering
    sos = _k_weighting_filter(sr)
    if audio.ndim == 2:
        n_channels = audio.shape[1]
        filtered = np.zeros_like(audio)
        for ch in range(n_channels):
            filtered[:, ch] = sosfilt(sos, audio[:, ch])
    else:
        n_channels = 1
        filtered = sosfilt(sos, audio)[:, np.newaxis]

    # Block-based measurement (400 ms window, 100 ms hop)
    block_len = max(64, int(0.400 * sr))
    hop_len = max(16, int(0.100 * sr))
    n_samples = filtered.shape[0]

    if n_samples < block_len:
        # Fallback to un-gated K-weighted power
        p = np.mean(filtered ** 2)
        lufs = -0.691 + 10.0 * np.log10(max(1e-12, p))
        return {
            "lufs": float(np.clip(lufs, -120.0, 0.0)),
            "peak_dbfs": float(peak_dbfs),
            "rms_dbfs": float(rms_dbfs),
            "dynamic_range_db": float(max(0.0, peak_dbfs - rms_dbfs)),
        }

    n_blocks = 1 + (n_samples - block_len) // hop_len
    # Channel weightings: 1.0 for Left, Right, Center (BS.1770)
    ch_weights = np.ones(n_channels)
    block_powers = np.zeros(n_blocks, dtype=np.float64)

    for b in range(n_blocks):
        start = b * hop_len
        block = filtered[start : start + block_len, :]
        ch_ms = np.mean(block ** 2, axis=0)
        block_powers[b] = np.sum(ch_weights * ch_ms)

    # 1. Absolute threshold gating (-70 LKFS)
    # Power corresponding to -70 LKFS: 10^((-70 + 0.691)/10)
    abs_thresh_power = 10.0 ** ((-70.0 + 0.691) / 10.0)
    above_abs = block_powers > abs_thresh_power

    if not np.any(above_abs):
        return {
            "lufs": -70.0,
            "peak_dbfs": float(peak_dbfs),
            "rms_dbfs": float(rms_dbfs),
            "dynamic_range_db": float(max(0.0, peak_dbfs - rms_dbfs)),
        }

    # 2. Relative threshold gating (-10 LU below un-gated loudness of above_abs blocks)
    mean_power_j = np.mean(block_powers[above_abs])
    gamma_j = -0.691 + 10.0 * np.log10(max(1e-12, mean_power_j))
    rel_thresh_power = 10.0 ** ((gamma_j - 10.0 + 0.691) / 10.0)

    above_rel = block_powers > rel_thresh_power
    if not np.any(above_rel):
        lufs = gamma_j
    else:
        final_mean_power = np.mean(block_powers[above_rel])
        lufs = -0.691 + 10.0 * np.log10(max(1e-12, final_mean_power))

    return {
        "lufs": float(np.clip(lufs, -120.0, 0.0)),
        "peak_dbfs": float(peak_dbfs),
        "rms_dbfs": float(rms_dbfs),
        "dynamic_range_db": float(max(0.0, peak_dbfs - rms_dbfs)),
    }


def normalize_loudness(
    audio: np.ndarray,
    sr: int,
    *,
    target_lufs: float = -16.0,
    max_gain_db: float = 18.0,
) -> np.ndarray:
    """Normalize audio to a target integrated loudness with peak protection.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        target_lufs: Target loudness in LUFS (default -16.0).
        max_gain_db: Maximum boost gain allowed in dB to prevent noise blowup (default 18.0).

    Returns:
        Loudness-normalized audio array.
    """
    metrics = measure_loudness(audio, sr)
    current_lufs = metrics["lufs"]

    if current_lufs < -65.0:
        # Audio essentially silent — skip normalization
        return audio.copy()

    # Required gain in dB
    gain_db = target_lufs - current_lufs
    gain_db = float(np.clip(gain_db, -24.0, max_gain_db))

    gain_lin = 10.0 ** (gain_db / 20.0)
    scaled = audio * gain_lin

    # Run peak limiter with -1.0 dBFS ceiling to ensure no clipping
    return peak_limit(scaled, sr, ceiling_db=-1.0, lookahead_ms=3.0, release_ms=50.0)
