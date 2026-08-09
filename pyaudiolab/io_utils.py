"""
io_utils.py — WAV file loading and saving.

All audio is represented internally as float64 in the range [-1.0, 1.0].
Stereo files have shape (N, 2); mono files have shape (N,).
"""

from __future__ import annotations

import numpy as np
import soundfile as sf


def load_wav(path: str) -> tuple[np.ndarray, int]:
    """Load a WAV file and return (audio_float64, sample_rate).

    The returned array is always float64 in [-1.0, 1.0].
    Stereo: shape (N, 2). Mono: shape (N,).
    """
    audio, sr = sf.read(path, dtype="float64", always_2d=False)
    # Clamp any out-of-range samples that might come from malformed files
    audio = np.clip(audio, -1.0, 1.0)
    return audio, sr


def save_wav(path: str, audio: np.ndarray, sr: int, bit_depth: int = 16) -> None:
    """Save a float64 audio array to a WAV file.

    Audio is clipped to [-1.0, 1.0] before writing.

    Args:
        path:      Output file path.
        audio:     float64 array, shape (N,) or (N, 2).
        sr:        Sample rate in Hz.
        bit_depth: 16 or 24 bit output (default 16).
    """
    audio = np.clip(audio, -1.0, 1.0)
    subtype = "PCM_16" if bit_depth == 16 else "PCM_24"
    sf.write(path, audio, sr, subtype=subtype)


def is_stereo(audio: np.ndarray) -> bool:
    """Return True if the audio array has 2 channels."""
    return audio.ndim == 2 and audio.shape[1] == 2


def to_mono(audio: np.ndarray) -> np.ndarray:
    """Mix stereo audio down to mono by averaging channels."""
    if is_stereo(audio):
        return audio.mean(axis=1)
    return audio


def ensure_float64(audio: np.ndarray) -> np.ndarray:
    """Convert audio to float64 if it is not already."""
    if audio.dtype != np.float64:
        return audio.astype(np.float64)
    return audio


def info(path: str) -> dict:
    """Return metadata about a WAV file without loading all samples."""
    info_obj = sf.info(path)
    return {
        "path": path,
        "sample_rate": info_obj.samplerate,
        "channels": info_obj.channels,
        "frames": info_obj.frames,
        "duration_s": info_obj.duration,
        "format": info_obj.format,
        "subtype": info_obj.subtype,
    }
