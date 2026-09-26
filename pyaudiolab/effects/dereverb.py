"""
effects/dereverb.py — Room De-Reverberation & Acoustic Reflection Suppression.

DSP Approach:
    Reverberation consists of early reflections and a diffuse late reverberant tail.
    In the time-frequency domain, late reverberant energy can be modeled as an
    exponentially decaying accumulator of preceding spectral power:

        Lambda_rev(k, t) = gamma(k) * Lambda_rev(k, t-1) + (1 - gamma(k)) * |X(k, t - D)|^2

    where:
        - D is the late reverb onset delay (~35ms or 3-4 STFT frames).
        - gamma(k) is the frequency-dependent reverberation decay factor computed from
          the estimated RT60 (reverberation time to -60 dB).
        - Room modes and 'boxiness' typically linger longest in the 200–800 Hz region.

    The spectral suppression gain is computed via soft Wiener-like de-reverberation:
        G_rev(k, t) = max(1.0 - room_reduction * sqrt(Lambda_rev(k, t)) / (|X(k, t)| + eps), floor)

    Temporal and spectral smoothing ensures clean, natural voice decay without metallic
    flanging, robotic artifacts, or phase dispersion.
"""

from __future__ import annotations
import numpy as np


def _dereverb_mono(
    x: np.ndarray,
    sr: int,
    room_reduction: float = 0.5,
    rt60_s: float = 0.4,
    boxiness_cut: float = 0.3,
    frame_ms: float = 32.0,
    overlap: float = 0.75,
) -> np.ndarray:
    """De-reverberate a mono signal using spectral decay modeling."""
    frame_len = max(256, int(sr * frame_ms / 1000.0))
    n_fft = 1
    while n_fft < frame_len:
        n_fft *= 2

    hop = max(1, int(frame_len * (1.0 - overlap)))
    window = np.hanning(frame_len)
    freq_bins = np.fft.rfftfreq(n_fft, d=1.0 / sr)
    n_freqs = len(freq_bins)

    n_total = len(x)
    pad_len = frame_len
    x_pad = np.pad(x, (pad_len, pad_len))

    frame_starts = list(range(0, len(x_pad) - frame_len + 1, hop))
    n_frames = len(frame_starts)

    stft_mag = np.zeros((n_freqs, n_frames), dtype=np.float64)
    stft_phase = np.zeros((n_freqs, n_frames), dtype=np.float64)

    for i, start in enumerate(frame_starts):
        frame = x_pad[start : start + frame_len]
        spec = np.fft.rfft(frame * window, n=n_fft)
        stft_mag[:, i] = np.abs(spec)
        stft_phase[:, i] = np.angle(spec)

    power = stft_mag ** 2 + 1e-12

    # Late reverberation delay D in frames (approx 35 ms)
    delay_frames = max(1, int(round(0.035 / (hop / sr))))

    # Frequency-dependent decay factor gamma(k)
    # Lower frequencies (room resonances 150-600 Hz) typically have longer RT60
    base_rt60 = max(0.1, min(1.5, rt60_s))
    rt60_profile = np.full(n_freqs, base_rt60, dtype=np.float64)

    # Elongate decay in boxy room resonance band (200 - 800 Hz) to target lingering boom
    boxy_band = (freq_bins >= 180.0) & (freq_bins <= 800.0)
    rt60_profile[boxy_band] *= (1.0 + boxiness_cut * 0.5)

    hop_s = hop / sr
    gamma = 10.0 ** (-3.0 * hop_s / np.maximum(rt60_profile, 0.05))
    gamma = np.clip(gamma, 0.70, 0.98)[:, np.newaxis]

    # Recursive late reverberation power tracking
    reverb_psd = np.zeros((n_freqs, n_frames), dtype=np.float64)
    r_prev = np.zeros((n_freqs, 1), dtype=np.float64)

    for t in range(n_frames):
        src_t = max(0, t - delay_frames)
        src_power = power[:, src_t : src_t + 1]
        r_current = gamma * r_prev + (1.0 - gamma) * src_power
        reverb_psd[:, t : t + 1] = r_current
        r_prev = r_current

    # Gain calculation
    reverb_mag = np.sqrt(np.maximum(reverb_psd, 0.0))
    eps = 1e-8

    # Suppression factor: room_reduction in [0.0, 1.0]
    suppression = float(np.clip(room_reduction * 1.3, 0.0, 1.5))
    floor = max(0.15, 1.0 - suppression * 0.85)

    gains = 1.0 - suppression * (reverb_mag / (stft_mag + eps))
    gains = np.clip(gains, floor, 1.0)

    # Smooth gains across frequency to prevent comb-filtering
    for t in range(n_frames):
        gains[:, t] = np.convolve(gains[:, t], [0.15, 0.70, 0.15], mode="same")

    # Smooth gains across time
    for f in range(n_freqs):
        gains[f, :] = np.convolve(gains[f, :], [0.2, 0.6, 0.2], mode="same")

    # Overlap-add reconstruction
    out = np.zeros(len(x_pad) + frame_len, dtype=np.float64)
    norm_win = np.zeros_like(out)

    for i, start in enumerate(frame_starts):
        clean_spec = (stft_mag[:, i] * gains[:, i]) * np.exp(1j * stft_phase[:, i])
        frame_out = np.fft.irfft(clean_spec, n=n_fft)[:frame_len] * window
        end = start + frame_len
        out[start:end] += frame_out
        norm_win[start:end] += window ** 2

    norm_win = np.where(norm_win > 1e-6, norm_win, 1.0)
    out = out / norm_win
    return out[pad_len : pad_len + n_total]


def dereverb(
    audio: np.ndarray,
    sr: int,
    *,
    room_reduction: float = 0.5,
    rt60_s: float = 0.4,
    boxiness_cut: float = 0.3,
    frame_ms: float = 32.0,
    overlap: float = 0.75,
) -> np.ndarray:
    """Reduce room reverberation and hollow echo using spectral decay suppression.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        room_reduction: De-reverberation intensity [0.0, 1.0] (default 0.5).
        rt60_s: Estimated room RT60 in seconds [0.1, 1.5] (default 0.4).
        boxiness_cut: Extra suppression for 200–800 Hz room modes [0.0, 1.0] (default 0.3).
        frame_ms: Analysis frame size in ms (default 32ms).
        overlap: STFT overlap fraction (default 0.75).

    Returns:
        De-reverberated audio array, same shape as input.
    """
    if room_reduction <= 0.001:
        return audio.copy()

    room_reduction = float(np.clip(room_reduction, 0.0, 1.0))
    rt60_s = float(np.clip(rt60_s, 0.1, 1.5))
    boxiness_cut = float(np.clip(boxiness_cut, 0.0, 1.0))

    if audio.ndim == 2:
        left = _dereverb_mono(
            audio[:, 0], sr, room_reduction=room_reduction, rt60_s=rt60_s,
            boxiness_cut=boxiness_cut, frame_ms=frame_ms, overlap=overlap
        )
        right = _dereverb_mono(
            audio[:, 1], sr, room_reduction=room_reduction, rt60_s=rt60_s,
            boxiness_cut=boxiness_cut, frame_ms=frame_ms, overlap=overlap
        )
        n = min(len(left), len(right))
        return np.stack([left[:n], right[:n]], axis=1)
    else:
        return _dereverb_mono(
            audio, sr, room_reduction=room_reduction, rt60_s=rt60_s,
            boxiness_cut=boxiness_cut, frame_ms=frame_ms, overlap=overlap
        )
