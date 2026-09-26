"""
effects/freq_filter.py — FFT Frequency Range Explorer & Filter DSP.

DSP Approach:
    Provides precise, high-performance frequency filtering (Low-pass, High-pass,
    Band-pass, Band-stop / Notch) using SciPy Butterworth IIR filters in
    second-order sections (SOS) format for maximal numerical stability and zero distortion.

    Features:
    - Low-pass: Keeps frequencies below cutoff (passes bass/mids, cuts highs)
    - High-pass: Keeps frequencies above cutoff (removes mud/rumble, isolates highs)
    - Band-pass: Isolates specific frequency window [f_low, f_high] (e.g. phone band 300-3400Hz, sub-bass 20-120Hz)
    - Band-stop: Removes a specific frequency notch / window
    - Auto-makeup / headroom scaling to ensure isolated frequency bands are clearly audible
      and produce an instantly noticeable listening experience.
"""

from __future__ import annotations
import numpy as np
from scipy.signal import butter, sosfiltfilt, sosfilt


def frequency_filter(
    audio: np.ndarray,
    sr: int,
    *,
    filter_type: str = "bandpass",
    low_freq: float = 300.0,
    high_freq: float = 3000.0,
    order: int = 8,
    gain_db: float = 0.0,
    zero_phase: bool = False,
    normalize_audio: bool = True,
    **kwargs,
) -> np.ndarray:
    """Apply frequency range filtering (Low-pass, High-pass, Band-pass, Band-stop).

    Args:
        audio:           Input float array, shape (N,) or (N, C).
        sr:              Sampling rate in Hz.
        filter_type:     "bandpass" | "lowpass" | "highpass" | "bandstop" (or "notch").
        low_freq:        Lower cutoff frequency in Hz (used for bandpass, highpass, bandstop; default 300.0).
        high_freq:       Upper cutoff frequency in Hz (used for bandpass, lowpass, bandstop; default 3000.0).
        order:           Filter order (default: 8 for 8th order Butterworth filter).
        gain_db:         Optional makeup gain in dB applied to the filtered output.
        zero_phase:      If True, uses bidirectional sosfiltfilt; otherwise causal sosfilt.
        normalize_audio: If True, peak normalizes the output audio to 0.95 for maximum clarity.

    Returns:
        Filtered audio array with same shape and type as input.
    """
    if audio.size == 0:
        return audio.copy()

    nyquist = sr / 2.0
    # Clamp bounds safely within [10 Hz, Nyquist - 10 Hz]
    min_hz = 10.0
    max_hz = max(min_hz + 10.0, nyquist - 10.0)

    f_type = str(filter_type).strip().lower()
    if f_type in ("band_pass", "bp", "band-pass", "band"):
        f_type = "bandpass"
    elif f_type in ("low_pass", "lp", "low-pass", "low"):
        f_type = "lowpass"
    elif f_type in ("high_pass", "hp", "high-pass", "high"):
        f_type = "highpass"
    elif f_type in ("band_stop", "notch", "band-stop", "bs"):
        f_type = "bandstop"

    # Filter order clamping (must be positive integer, between 1 and 12)
    filt_order = max(1, min(12, int(order)))
    # If using zero_phase with sosfiltfilt, effective order is doubled
    design_order = max(1, filt_order // 2 if zero_phase else filt_order)

    # Sanitize cutoff frequencies
    l_freq = max(min_hz, min(max_hz, float(low_freq)))
    h_freq = max(min_hz, min(max_hz, float(high_freq)))

    if f_type == "bandpass" or f_type == "bandstop":
        if l_freq >= h_freq:
            l_freq, h_freq = min(l_freq, h_freq), max(l_freq, h_freq)
        if h_freq - l_freq < 10.0:
            h_freq = min(max_hz, l_freq + 10.0)
            l_freq = max(min_hz, h_freq - 10.0)

        wn = [l_freq / nyquist, h_freq / nyquist]
        sos = butter(design_order, wn, btype=f_type, output="sos")

    elif f_type == "lowpass":
        cutoff = max(min_hz, min(max_hz, float(l_freq if l_freq < max_hz else h_freq)))
        # If low_freq was passed or default low_freq 300Hz:
        # Use low_freq if specified, otherwise high_freq if smaller
        if "low_freq" in kwargs or low_freq < h_freq:
            cutoff = l_freq
        else:
            cutoff = h_freq
        cutoff = max(min_hz, min(max_hz, cutoff))
        wn = cutoff / nyquist
        sos = butter(design_order, wn, btype="lowpass", output="sos")

    elif f_type == "highpass":
        cutoff = max(min_hz, min(max_hz, float(h_freq if h_freq > min_hz else l_freq)))
        # If high_freq was specified (e.g. 3000Hz default) or low_freq
        if "high_freq" in kwargs or high_freq > l_freq:
            cutoff = h_freq
        else:
            cutoff = l_freq
        cutoff = max(min_hz, min(max_hz, cutoff))
        wn = cutoff / nyquist
        sos = butter(design_order, wn, btype="highpass", output="sos")

    else:
        raise ValueError(f"Unsupported filter_type '{filter_type}'. Expected 'bandpass', 'lowpass', 'highpass', or 'bandstop'.")

    # Apply filter across channels using sosfilt
    out = np.zeros_like(audio, dtype=np.float64)
    filter_func = sosfiltfilt if zero_phase else sosfilt

    if audio.ndim == 1:
        out = filter_func(sos, audio.astype(np.float64))
    else:
        for ch in range(audio.shape[1]):
            out[:, ch] = filter_func(sos, audio[:, ch].astype(np.float64))

    # Apply gain if specified
    if abs(gain_db) > 1e-5:
        out *= 10.0 ** (gain_db / 20.0)

    # Normalize output audio if requested for clear listening
    if normalize_audio:
        peak = np.max(np.abs(out))
        if peak > 1e-6:
            out = (out / peak) * 0.95
    else:
        peak = np.max(np.abs(out))
        if peak > 1.0:
            out = out / peak * 0.999

    return out.astype(audio.dtype)

