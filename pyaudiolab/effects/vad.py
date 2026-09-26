"""
effects/vad.py — Multi-feature Voice Activity Detection & Speech Preservation.

DSP Approach:
    Accurate speech detection without heavy neural models requires combining
    complementary acoustic features:
    1. Short-Time Log Energy & RMS: distinguishes loud speech from low-level noise.
    2. Spectral Flatness Measure (SFM):
           SFM = exp(mean(log(P + eps))) / (mean(P) + eps)
       Harmonic speech (vowels) has low SFM (peaky spectrum); broadband noise has
       high SFM (flat spectrum).
    3. Spectral Centroid: concentrates in 300–3500 Hz for human speech.
    4. Zero Crossing Rate (ZCR): helps identify unvoiced consonants (fricatives like /s/, /t/).
    5. Adaptive Noise Floor Tracking: dynamically adjusts the detection threshold
       based on the minimum energy observed over a running window.
    6. Hangover & Hangbefore smoothing: preserves weak consonant onsets and trailing
       word decays to prevent clipping or stuttering on speech boundaries.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import List, Tuple
import numpy as np


@dataclass
class VADResult:
    """Result of Voice Activity Detection analysis."""
    speech_mask: np.ndarray        # Boolean array per frame (True = speech)
    speech_probs: np.ndarray       # Probability [0.0, 1.0] per frame
    frame_times: np.ndarray        # Time in seconds per frame
    speech_ratio: float            # Fraction of frames containing speech (0.0 to 1.0)
    snr_estimate_db: float         # Estimated speech-to-noise ratio in dB
    noise_floor_dbfs: float        # Estimated noise floor level in dBFS
    speech_peak_dbfs: float        # Peak speech level in dBFS
    active_regions: List[Tuple[float, float]]  # List of (start_s, end_s) intervals


def detect_vad(
    audio: np.ndarray,
    sr: int,
    *,
    frame_ms: float = 25.0,
    hop_ms: float = 10.0,
    energy_threshold_db: float | None = None,
    hangover_ms: float = 120.0,
    hangbefore_ms: float = 40.0,
) -> VADResult:
    """Detect voice activity across audio frames.

    Args:
        audio: Input signal, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        frame_ms: Analysis frame length in milliseconds (default 25ms).
        hop_ms: Frame hop length in milliseconds (default 10ms).
        energy_threshold_db: Optional fixed energy threshold in dB. If None,
                             adaptive threshold based on noise floor is used.
        hangover_ms: Post-speech hangover duration in ms to protect word tails.
        hangbefore_ms: Pre-speech lead-in duration in ms to protect onsets.

    Returns:
        VADResult dataclass with speech mask, probabilities, and statistics.
    """
    # Use mono signal for detection
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    n_samples = len(mono)

    frame_len = max(64, int(sr * frame_ms / 1000.0))
    hop_len = max(32, int(sr * hop_ms / 1000.0))

    if n_samples < frame_len:
        # Signal too short for framing
        return VADResult(
            speech_mask=np.ones(1, dtype=bool),
            speech_probs=np.ones(1, dtype=np.float64),
            frame_times=np.array([0.0]),
            speech_ratio=1.0,
            snr_estimate_db=20.0,
            noise_floor_dbfs=-60.0,
            speech_peak_dbfs=-6.0,
            active_regions=[(0.0, max(0.001, n_samples / sr))],
        )

    # Frame the signal
    n_frames = 1 + (n_samples - frame_len) // hop_len
    window = np.hanning(frame_len)

    energies = np.zeros(n_frames, dtype=np.float64)
    sfms = np.zeros(n_frames, dtype=np.float64)
    zcrs = np.zeros(n_frames, dtype=np.float64)
    centroids = np.zeros(n_frames, dtype=np.float64)

    # Next power of 2 for FFT
    n_fft = 1
    while n_fft < frame_len:
        n_fft *= 2

    freq_bins = np.fft.rfftfreq(n_fft, d=1.0 / sr)
    # Focus spectral analysis on voice frequency band: 100 Hz to 5000 Hz
    voice_band = (freq_bins >= 100.0) & (freq_bins <= 5000.0)
    if not np.any(voice_band):
        voice_band = np.ones(len(freq_bins), dtype=bool)

    eps = 1e-12

    for i in range(n_frames):
        start = i * hop_len
        frame = mono[start : start + frame_len]

        # 1. Short-Time RMS Energy
        rms = np.sqrt(np.mean(frame ** 2) + eps)
        energies[i] = rms

        # 2. Zero Crossing Rate
        zero_crossings = np.sum(np.abs(np.diff(np.signbit(frame))))
        zcrs[i] = zero_crossings / frame_len

        # 3. FFT for Spectral Flatness & Centroid
        win_frame = frame * window
        spec = np.abs(np.fft.rfft(win_frame, n=n_fft))
        power = spec ** 2 + eps

        # Spectral Flatness on voice band
        p_band = power[voice_band]
        geo_mean = np.exp(np.mean(np.log(p_band)))
        arith_mean = np.mean(p_band)
        sfms[i] = float(geo_mean / (arith_mean + eps))

        # Spectral Centroid
        p_sum = np.sum(power)
        centroids[i] = float(np.sum(freq_bins * power) / (p_sum + eps))

    # Convert energy to dBFS
    energy_db = 20.0 * np.log10(np.maximum(energies, 1e-6))

    # Adaptive noise floor estimation: 10th percentile of energy distribution
    noise_floor_db = float(np.percentile(energy_db, 10))
    speech_peak_db = float(np.percentile(energy_db, 95))

    # SNR estimate
    snr_est = max(0.0, speech_peak_db - noise_floor_db)

    # Determine energy threshold
    if energy_threshold_db is not None:
        thresh = energy_threshold_db
    else:
        # Dynamic threshold: sits above the noise floor
        margin = min(14.0, max(5.0, snr_est * 0.35))
        thresh = noise_floor_db + margin

    # Multi-feature voice score [0, 1]
    # Energy contribution: steep sigmoid around threshold
    e_score = 1.0 / (1.0 + np.exp(-(energy_db - thresh) / 2.5))

    # Tonal contribution: lower SFM (<0.35) = more harmonic speech; flat noise (>0.45) = 0
    sfm_score = np.clip(1.0 - (sfms / 0.45), 0.0, 1.0)

    # Centroid score: human speech fundamental & formants typically in 250 - 3500 Hz
    centroid_score = np.where((centroids >= 250) & (centroids <= 3500), 1.0, 0.2)

    # Combined frame probability with heavy weight on energy and harmonicity
    raw_probs = 0.60 * e_score + 0.30 * sfm_score + 0.10 * centroid_score
    # Penalize flat/broadband noise when energy is moderate
    raw_probs = np.where(sfms > 0.50, raw_probs * 0.5, raw_probs)
    raw_probs = np.clip(raw_probs, 0.0, 1.0)

    # Raw mask
    raw_mask = (raw_probs > 0.45) & (energy_db > (thresh - 1.0))

    # Hangover / hangbefore temporal smoothing
    hangover_frames = int(round(hangover_ms / hop_ms))
    hangbefore_frames = int(round(hangbefore_ms / hop_ms))

    smoothed_mask = raw_mask.copy()
    # Apply hangbefore (expand backward)
    for i in range(len(smoothed_mask)):
        if raw_mask[i]:
            start_f = max(0, i - hangbefore_frames)
            smoothed_mask[start_f : i] = True

    # Apply hangover (expand forward)
    counter = 0
    for i in range(len(smoothed_mask)):
        if smoothed_mask[i]:
            counter = hangover_frames
        elif counter > 0:
            smoothed_mask[i] = True
            counter -= 1

    # Probability after smoothing: clear contrast between speech and noise floors
    smoothed_probs = np.where(smoothed_mask, np.maximum(raw_probs, 0.75), raw_probs * 0.2)

    frame_times = np.arange(n_frames) * (hop_len / sr)

    # Active regions
    active_regions: List[Tuple[float, float]] = []
    in_region = False
    region_start = 0.0

    for i, active in enumerate(smoothed_mask):
        t = frame_times[i]
        if active and not in_region:
            in_region = True
            region_start = t
        elif not active and in_region:
            in_region = False
            active_regions.append((float(region_start), float(t)))

    if in_region:
        active_regions.append((float(region_start), float(n_samples / sr)))

    speech_ratio = float(np.mean(smoothed_mask))

    return VADResult(
        speech_mask=smoothed_mask,
        speech_probs=smoothed_probs,
        frame_times=frame_times,
        speech_ratio=speech_ratio,
        snr_estimate_db=float(snr_est),
        noise_floor_dbfs=float(noise_floor_db),
        speech_peak_dbfs=float(speech_peak_db),
        active_regions=active_regions,
    )


def compute_speech_preservation_mask(
    spec_mag: np.ndarray,
    vad_probs: np.ndarray,
    sr: int,
    freq_bins: np.ndarray,
) -> np.ndarray:
    """Compute 2D time-frequency speech preservation gain mask.

    Protects critical voice formant frequencies (250 Hz - 3.5 kHz) and high-frequency
    speech consonants (fricatives) when speech probability is elevated.

    Args:
        spec_mag: 2D magnitude spectrum, shape (n_freqs, n_frames).
        vad_probs: 1D speech probability array, shape (n_frames,).
        sr: Sample rate in Hz.
        freq_bins: 1D array of frequency values for bins, shape (n_freqs,).

    Returns:
        2D float64 mask in [0.0, 1.0], shape (n_freqs, n_frames).
    """
    n_freqs, n_frames = spec_mag.shape
    mask = np.zeros((n_freqs, n_frames), dtype=np.float64)

    # Core speech band (formants): 250 Hz - 3500 Hz
    voice_band = (freq_bins >= 250.0) & (freq_bins <= 3500.0)
    # Consonant sheen band: 3500 Hz - 8000 Hz
    consonant_band = (freq_bins > 3500.0) & (freq_bins <= 8000.0)

    # Interpolate vad_probs to match n_frames if needed
    if len(vad_probs) != n_frames:
        xp = np.linspace(0, 1, len(vad_probs))
        x = np.linspace(0, 1, n_frames)
        p = np.interp(x, xp, vad_probs)
    else:
        p = vad_probs

    # During high speech probability, protect speech frequencies
    for f in range(n_freqs):
        if voice_band[f]:
            mask[f, :] = p * 0.95
        elif consonant_band[f]:
            mask[f, :] = p * 0.80
        else:
            mask[f, :] = p * 0.40

    return mask
