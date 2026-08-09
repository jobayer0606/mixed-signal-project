"""
effects/pitch_time.py — Speed change and pitch-preserving time stretching.

DSP Approach:

    change_speed:
        Resample to a different number of samples using scipy.signal.resample.
        Fewer samples = faster playback and higher pitch.
        More samples = slower playback and lower pitch.
        This is identical to varying tape speed — pitch and duration both change.

    time_stretch (OLA Phase Vocoder):
        Short-Time Fourier Transform (STFT) is computed on overlapping windows.
        The instantaneous phase of each bin is tracked and accumulated at the
        desired stretch rate, then inverted (iSTFT) to reconstruct the signal.
        This decouples duration from pitch, allowing tempo change without pitch shift.

        Algorithm steps:
            1. Compute STFT of input with hop_length H and window_size W.
            2. For each output frame, compute target phase from accumulated
               phase increments scaled by the stretch factor.
            3. Reconstruct via iSTFT with the same window/hop.

Parameters:
    change_speed: factor (float) — >1 speeds up (shortens), <1 slows down.
    time_stretch: factor (float) — >1 speeds up without pitch change, <1 slows.
                  window_size (int) — STFT window length, default 2048.
                  hop_length (int) — STFT hop size, default 512.
"""

from __future__ import annotations
import numpy as np
from scipy.signal import resample


def change_speed(
    audio: np.ndarray,
    sr: int,
    *,
    factor: float = 1.0,
) -> np.ndarray:
    """Change playback speed (and pitch) by resampling.

    Args:
        audio:  Input float64 array, shape (N,) or (N, 2).
        sr:     Sample rate in Hz (unused for this effect but kept for signature).
        factor: Speed multiplier. >1 = faster/shorter/higher-pitched,
                <1 = slower/longer/lower-pitched.

    Returns:
        Resampled float64 array. Shape changes along axis 0.
    """
    if factor <= 0:
        raise ValueError(f"factor must be > 0, got {factor}")
    if factor == 1.0:
        return audio.copy()

    n_orig = audio.shape[0]
    n_new = max(1, int(round(n_orig / factor)))

    if audio.ndim == 2:
        # Resample each channel independently
        ch_left = resample(audio[:, 0], n_new)
        ch_right = resample(audio[:, 1], n_new)
        return np.stack([ch_left, ch_right], axis=1)
    else:
        return resample(audio, n_new)


def _stft(
    x: np.ndarray,
    window_size: int,
    hop_length: int,
) -> np.ndarray:
    """Compute STFT, returns complex matrix of shape (n_fft//2+1, n_frames)."""
    window = np.hanning(window_size)
    n_fft = window_size
    n_frames = 1 + (len(x) - window_size) // hop_length
    # Pad
    x_pad = np.pad(x, (window_size // 2, window_size))

    stft_matrix = np.zeros((n_fft // 2 + 1, n_frames), dtype=np.complex128)
    for i in range(n_frames):
        start = i * hop_length
        frame = x_pad[start: start + window_size] * window
        stft_matrix[:, i] = np.fft.rfft(frame, n=n_fft)
    return stft_matrix


def _istft(
    stft_matrix: np.ndarray,
    window_size: int,
    hop_length: int,
    output_length: int,
) -> np.ndarray:
    """Invert STFT, returns real array of length output_length."""
    window = np.hanning(window_size)
    n_frames = stft_matrix.shape[1]
    out = np.zeros(output_length + window_size, dtype=np.float64)
    norm = np.zeros_like(out)

    for i in range(n_frames):
        start = i * hop_length
        frame = np.fft.irfft(stft_matrix[:, i], n=window_size)
        windowed = frame * window
        end = start + window_size
        out[start:end] += windowed
        norm[start:end] += window ** 2

    # Normalise by overlap-add window sum
    norm = np.where(norm > 1e-8, norm, 1.0)
    out = out / norm
    return out[window_size // 2: window_size // 2 + output_length]


def _time_stretch_mono(
    x: np.ndarray,
    factor: float,
    window_size: int,
    hop_length: int,
) -> np.ndarray:
    """Phase vocoder time-stretch for a mono signal."""
    stft = _stft(x, window_size, hop_length)
    n_fft = window_size
    n_frames_in = stft.shape[1]
    n_frames_out = max(1, int(np.round(n_frames_in / factor)))

    # Phase accumulator
    phase_acc = np.angle(stft[:, 0])
    out_stft = np.zeros((n_fft // 2 + 1, n_frames_out), dtype=np.complex128)
    out_stft[:, 0] = np.abs(stft[:, 0]) * np.exp(1j * phase_acc)

    # Expected phase advance per hop
    omega = 2.0 * np.pi * np.arange(n_fft // 2 + 1) * hop_length / n_fft

    for out_frame in range(1, n_frames_out):
        in_frame_f = out_frame * factor
        in_frame = min(int(in_frame_f), n_frames_in - 1)
        in_frame_prev = max(0, in_frame - 1)

        mag = np.abs(stft[:, in_frame])
        phase_in = np.angle(stft[:, in_frame])
        phase_prev = np.angle(stft[:, in_frame_prev])

        # True phase advance from adjacent input frames
        delta_phase = phase_in - phase_prev - omega
        # Wrap to [-π, π]
        delta_phase = delta_phase - 2.0 * np.pi * np.round(delta_phase / (2.0 * np.pi))
        true_freq = omega + delta_phase

        # Accumulate phase at output hop rate
        phase_acc = phase_acc + true_freq
        out_stft[:, out_frame] = mag * np.exp(1j * phase_acc)

    output_length = int(np.round(len(x) / factor))
    out_hop = hop_length  # output hop is the same
    return _istft(out_stft, window_size, out_hop, output_length)


def time_stretch(
    audio: np.ndarray,
    sr: int,
    *,
    factor: float = 1.0,
    window_size: int = 2048,
    hop_length: int = 512,
) -> np.ndarray:
    """Pitch-preserving time stretch using an OLA Phase Vocoder.

    Args:
        audio:       Input float64 array, shape (N,) or (N, 2).
        sr:          Sample rate (unused; kept for uniform signature).
        factor:      Stretch factor. >1 = faster/shorter, <1 = slower/longer.
        window_size: STFT analysis window size (default 2048).
        hop_length:  STFT hop length (default 512).

    Returns:
        Time-stretched float64 array. Pitch is preserved.
    """
    if factor <= 0:
        raise ValueError(f"factor must be > 0, got {factor}")
    if factor == 1.0:
        return audio.copy()

    if audio.ndim == 2:
        left = _time_stretch_mono(audio[:, 0], factor, window_size, hop_length)
        right = _time_stretch_mono(audio[:, 1], factor, window_size, hop_length)
        n = min(len(left), len(right))
        return np.stack([left[:n], right[:n]], axis=1)
    else:
        return _time_stretch_mono(audio, factor, window_size, hop_length)
