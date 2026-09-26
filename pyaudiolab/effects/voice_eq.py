"""
effects/voice_eq.py — Voice-Focused Equalizer Chain.

DSP Approach:
    Standard graphic EQs have fixed 1-octave bands that do not align with the acoustic
    resonances and formants of the human vocal tract. This module implements a dedicated
    parametric voice mastering EQ chain:

    1. Highpass Rumble Filter (80 Hz, 2nd-order Butterworth):
       Removes subsonic thumps, mic handling noises, and HVAC rumble without thinning speech.
    2. Mud & Boxiness Control (320 Hz, Peaking Bell, Q=1.2):
       Dips boxy chest resonance and room acoustic boominess based on the `clarity` parameter.
    3. Vocal Warmth / Fundamental Support (180 Hz, Peaking Bell, Q=1.0):
       Maintains foundational vocal warmth.
    4. Speech Intelligibility & Presence (3.2 kHz, Peaking Bell, Q=1.4):
       Boosts critical consonant articulation formants based on the `presence` parameter.
    5. High-Frequency Air Shelf (10 kHz, High Shelf):
       Provides professional broadcast sheen and clarity without harshness.
    6. De-harshness Control (6.5 kHz, Gentle Peaking Cut):
       Tames excessive sibilance when presence is elevated.
"""

from __future__ import annotations
import numpy as np
from scipy.signal import butter, sosfilt, tf2sos


def _peaking_sos(center_hz: float, gain_db: float, q: float, sr: int) -> np.ndarray:
    """Audio EQ Cookbook peaking filter (biquad SOS)."""
    if abs(gain_db) < 1e-4:
        return np.array([[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]])

    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * center_hz / sr
    cos_w0 = np.cos(w0)
    sin_w0 = np.sin(w0)
    alpha = sin_w0 / (2.0 * q)

    b0 = 1.0 + alpha * A
    b1 = -2.0 * cos_w0
    b2 = 1.0 - alpha * A
    a0 = 1.0 + alpha / A
    a1 = -2.0 * cos_w0
    a2 = 1.0 - alpha / A

    b = np.array([b0 / a0, b1 / a0, b2 / a0])
    a = np.array([1.0, a1 / a0, a2 / a0])
    return tf2sos(b, a)


def _high_shelf_sos(center_hz: float, gain_db: float, sr: int) -> np.ndarray:
    """Audio EQ Cookbook high-shelf filter (biquad SOS)."""
    if abs(gain_db) < 1e-4:
        return np.array([[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]])

    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * center_hz / sr
    cos_w0 = np.cos(w0)
    sin_w0 = np.sin(w0)
    alpha = sin_w0 / 2.0 * np.sqrt(2.0)  # S = 1

    b0 = A * ((A + 1.0) + (A - 1.0) * cos_w0 + 2.0 * np.sqrt(A) * alpha)
    b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cos_w0)
    b2 = A * ((A + 1.0) + (A - 1.0) * cos_w0 - 2.0 * np.sqrt(A) * alpha)
    a0 = (A + 1.0) - (A - 1.0) * cos_w0 + 2.0 * np.sqrt(A) * alpha
    a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cos_w0)
    a2 = (A + 1.0) - (A - 1.0) * cos_w0 - 2.0 * np.sqrt(A) * alpha

    b = np.array([b0 / a0, b1 / a0, b2 / a0])
    a = np.array([1.0, a1 / a0, a2 / a0])
    return tf2sos(b, a)


def voice_eq(
    audio: np.ndarray,
    sr: int,
    *,
    clarity: float = 0.5,
    presence: float = 0.5,
    low_cut_hz: float = 85.0,
) -> np.ndarray:
    """Apply voice-tailored equalization chain.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        clarity: Clarity & air control [0.0, 1.0] (default 0.5).
                 Controls 320 Hz mud cut and 10 kHz air sheen.
        presence: Voice presence & intelligibility [0.0, 1.0] (default 0.5).
                  Controls 3.2 kHz presence boost and 180 Hz body support.
        low_cut_hz: Rumble highpass cutoff frequency in Hz (default 85.0 Hz, 24 dB/oct).

    Returns:
        Equalized audio array, same shape as input.
    """
    clarity = float(np.clip(clarity, 0.0, 1.0))
    presence = float(np.clip(presence, 0.0, 1.0))

    nyquist = sr / 2.0

    sos_stages = []

    # 1. Highpass Rumble filter (Butterworth 4th order, steep 24 dB/oct slope)
    if 20.0 < low_cut_hz < nyquist * 0.5:
        sos_hp = butter(4, low_cut_hz / nyquist, btype="highpass", output="sos")
        sos_stages.append(sos_hp)

    # 2. Mud reduction: -1.0 dB to -4.5 dB cut at 320 Hz based on clarity
    mud_cut_db = -3.5 * clarity
    if 320.0 < nyquist:
        sos_stages.append(_peaking_sos(320.0, mud_cut_db, q=1.2, sr=sr))

    # 3. Warmth support: gentle +0.5 to +1.5 dB at 180 Hz based on presence
    warmth_boost_db = 1.2 * presence
    if 180.0 < nyquist:
        sos_stages.append(_peaking_sos(180.0, warmth_boost_db, q=1.1, sr=sr))

    # 4. Speech Intelligibility & Presence: 0.0 to +4.5 dB at 3200 Hz based on presence
    presence_boost_db = 4.0 * presence
    if 3200.0 < nyquist:
        sos_stages.append(_peaking_sos(3200.0, presence_boost_db, q=1.3, sr=sr))

    # 5. Air sheen: 0.0 to +3.5 dB high-shelf at 10 kHz based on clarity
    air_boost_db = 3.0 * clarity
    if 10000.0 < nyquist:
        sos_stages.append(_high_shelf_sos(10000.0, air_boost_db, sr=sr))

    # 6. Sibilance control: subtle cut at 6500 Hz if presence and clarity are both elevated
    if presence > 0.4 and 6500.0 < nyquist:
        sibilance_cut_db = -1.5 * (presence * clarity)
        sos_stages.append(_peaking_sos(6500.0, sibilance_cut_db, q=2.0, sr=sr))

    out = audio.copy()
    for sos in sos_stages:
        if out.ndim == 2:
            for ch in range(out.shape[1]):
                out[:, ch] = sosfilt(sos, out[:, ch])
        else:
            out = sosfilt(sos, out)

    return out
