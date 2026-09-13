"""
effects/eq.py — 10-band Graphic Equalizer.

DSP Approach:
    A graphic EQ is a bank of peak (bell) filters, one per frequency band.
    Each filter is a 2nd-order IIR (biquad) peaking filter implemented with
    scipy.signal.iirpeak, which returns (b, a) coefficients.

    Bands are tuned to the standard 10-band graphic EQ centers (ISO 266):
        31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz

    All filters are applied sequentially via sosfilt (second-order sections),
    which provides better numerical stability than direct-form filtering.

    Each band has a configurable gain in dB.
    Q factor defaults to 1.41 (~2/3 octave bandwidth) for musical overlap.

Parameters:
    gains_db (list[float]): 10 gain values in dB, one per band.
                            0 dB = no change; positive = boost; negative = cut.
    q_factor (float):       Filter Q factor. Default 1.41.
"""

from __future__ import annotations
import numpy as np
from scipy.signal import iirpeak, sosfilt, tf2sos

# Standard 10-band ISO 266 center frequencies (Hz)
EQ_BAND_CENTERS = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0]



def _peaking_sos_cookbook(
    center_hz: float,
    gain_db: float,
    q: float,
    sr: int,
) -> np.ndarray:
    """Audio EQ Cookbook peaking filter (boost and cut)."""
    if abs(gain_db) < 1e-6:
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


def graphic_eq(
    audio: np.ndarray,
    sr: int,
    *,
    gains_db: list[float] | None = None,
    q_factor: float = 1.41,
) -> np.ndarray:
    """Apply a 10-band graphic equalizer.

    Args:
        audio:     Input float64 array, shape (N,) or (N, 2).
        sr:        Sample rate in Hz.
        gains_db:  List of 10 gain values in dB. Default all zeros (flat).
        q_factor:  Filter Q for all bands. Default 1.41 (~2/3 octave).

    Returns:
        Equalized float64 array, same shape as input.
    """
    if gains_db is None:
        gains_db = [0.0] * 10

    if len(gains_db) != 10:
        raise ValueError(f"gains_db must have exactly 10 values, got {len(gains_db)}")

    out = audio.copy()

    for center, gain_db in zip(EQ_BAND_CENTERS, gains_db):
        if center >= sr / 2.0:
            continue  # Skip bands above Nyquist
        sos = _peaking_sos_cookbook(center, gain_db, q_factor, sr)
        if out.ndim == 2:
            for ch in range(out.shape[1]):
                out[:, ch] = sosfilt(sos, out[:, ch])
        else:
            out = sosfilt(sos, out)

    return out
