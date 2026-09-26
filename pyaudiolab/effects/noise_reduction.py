"""
effects/noise_reduction.py — Spectral Subtraction Noise Reduction.

DSP Approach:
    Spectral subtraction estimates the noise power spectral density (PSD) from
    a "noise-only" region (first noise_duration_ms of the signal), then subtracts
    a scaled version of the noise spectrum from each analysis frame.

    Algorithm:
        1. Compute noise PSD: N(k) = mean(|FFT(noise_frames)|^2) over k frequency bins.
        2. For each analysis frame X(k):
               Y(k) = max(|X(k)|^2 - strength * N(k), floor * N(k))^0.5
           Apply subtraction in magnitude domain; preserve original phase.
        3. Reconstruct with overlap-add iSTFT.

Parameters:
    noise_duration_ms (float): Duration of the initial noise-only region used
                                to estimate the noise profile. Default 500 ms.
    strength (float):          Noise subtraction strength [0, 2]. Default 1.0.
                                Values > 1 over-subtract (aggressive; may distort).
    floor (float):             Spectral floor as a fraction of noise PSD. Default 0.002.
    frame_ms (float):          Analysis frame length in ms. Default 25.
    overlap (float):           Frame overlap fraction [0, 1). Default 0.75.
"""

from __future__ import annotations
import math
import logging
import numpy as np
from scipy.ndimage import minimum_filter1d
from scipy.signal import resample_poly

logger = logging.getLogger("pyaudiolab.noise_reduction")

# Initialize DeepFilterNet model once at module level
try:
    import torch
    from df.enhance import enhance, init_df
    _DF_MODEL, _DF_STATE, _ = init_df()
    _DF_SR = getattr(_DF_STATE, "sr", lambda: 48000)() if callable(getattr(_DF_STATE, "sr", None)) else 48000
except Exception as _df_init_err:
    _DF_MODEL, _DF_STATE, _DF_SR = None, None, 48000


def _spectral_subtraction_mono(
    x: np.ndarray,
    sr: int,
    noise_duration_ms: float,
    strength: float,
    floor: float,
    frame_ms: float,
    overlap: float,
) -> np.ndarray:
    """Spectral subtraction with aggressive over-subtraction scaling for a mono signal."""
    frame_len = max(256, int(sr * frame_ms / 1000.0))
    # Round up to next power of 2 for FFT efficiency
    n_fft = 1
    while n_fft < frame_len:
        n_fft *= 2

    hop = max(1, int(frame_len * (1.0 - overlap)))
    window = np.hanning(frame_len)

    # --- Step 1: Estimate noise PSD from initial region + minimum tracking ---
    noise_samples = min(int(sr * noise_duration_ms / 1000.0), len(x))
    noise_region = x[: max(frame_len, noise_samples)]

    noise_psds = []
    for start in range(0, max(1, len(noise_region) - frame_len + 1), hop):
        frame = noise_region[start : start + frame_len]
        if len(frame) < frame_len:
            frame = np.pad(frame, (0, frame_len - len(frame)))
        frame_win = frame * window
        spec = np.fft.rfft(frame_win, n=n_fft)
        noise_psds.append(np.abs(spec) ** 2)

    if not noise_psds:
        return x.copy()

    noise_psd = np.mean(noise_psds, axis=0)

    # Over-subtraction factor alpha
    alpha_sub = 1.0 + 1.5 * strength

    # --- Step 2: Process each frame ---
    n_total = len(x)
    out = np.zeros(n_total + frame_len, dtype=np.float64)
    norm_win = np.zeros(n_total + frame_len, dtype=np.float64)
    x_pad = np.pad(x, (0, frame_len))

    for start in range(0, n_total, hop):
        frame = x_pad[start : start + frame_len]
        if len(frame) < frame_len:
            frame = np.pad(frame, (0, frame_len - len(frame)))

        frame_win = frame * window
        spec = np.fft.rfft(frame_win, n=n_fft)

        mag_sq = np.abs(spec) ** 2
        phase = np.angle(spec)

        # Spectral subtraction with deep over-subtraction and lowered spectral floor
        mag_sq_clean = np.maximum(
            mag_sq - alpha_sub * noise_psd,
            floor * noise_psd,
        )
        mag_clean = np.sqrt(mag_sq_clean)
        spec_clean = mag_clean * np.exp(1j * phase)

        # iFFT and overlap-add with proper COLA normalization
        frame_out = np.fft.irfft(spec_clean, n=n_fft)[:frame_len]
        frame_out *= window

        end = start + frame_len
        out[start:end] += frame_out
        norm_win[start:end] += window ** 2

    # Normalise by OLA window sum
    norm_win = np.where(norm_win > 1e-8, norm_win, 1.0)
    out = out / norm_win
    return out[:n_total]


def reduce_noise(
    audio: np.ndarray,
    sr: int,
    *,
    noise_duration_ms: float = 500.0,
    strength: float = 1.0,
    floor: float = 0.0005,
    frame_ms: float = 25.0,
    overlap: float = 0.75,
) -> np.ndarray:
    """Reduce noise via FFT spectral subtraction with deep over-subtraction.

    Args:
        audio:             Input float64 array, shape (N,) or (N, 2).
        sr:                Sample rate in Hz.
        noise_duration_ms: Duration (ms) of noise-only region at start. Default 500.
        strength:          Subtraction strength [0, 2]. Default 1.0.
        floor:             Spectral floor fraction. Default 0.0005.
        frame_ms:          Analysis frame length in ms. Default 25.
        overlap:           Frame overlap fraction. Default 0.75.

    Returns:
        Noise-reduced float64 array, same shape as input.
    """
    strength = float(np.clip(strength, 0.0, 2.0))
    floor = float(np.clip(floor, 1e-6, 1.0))

    if audio.ndim == 2:
        left = _spectral_subtraction_mono(
            audio[:, 0], sr, noise_duration_ms, strength, floor, frame_ms, overlap
        )
        right = _spectral_subtraction_mono(
            audio[:, 1], sr, noise_duration_ms, strength, floor, frame_ms, overlap
        )
        n = min(len(left), len(right))
        return np.stack([left[:n], right[:n]], axis=1)
    else:
        return _spectral_subtraction_mono(
            audio, sr, noise_duration_ms, strength, floor, frame_ms, overlap
        )


def _adaptive_wiener_mono(
    x: np.ndarray,
    sr: int,
    strength: float = 0.7,
    floor: float = 0.0005,
    frame_ms: float = 25.0,
    overlap: float = 0.75,
    vad_result=None,
) -> np.ndarray:
    """Adaptive Wiener suppression with Martin minimum statistics tracking and deep isolation."""
    from pyaudiolab.effects.vad import detect_vad

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

    # STFT analysis
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

    # VAD detection
    if vad_result is None:
        vad_result = detect_vad(x, sr, frame_ms=frame_ms, hop_ms=(hop / sr) * 1000.0)

    vad_probs = vad_result.speech_probs
    if len(vad_probs) != n_frames:
        xp = np.linspace(0, 1, len(vad_probs))
        x_pts = np.linspace(0, 1, n_frames)
        vad_probs = np.interp(x_pts, xp, vad_probs)

    # 1. Martin Minimum Statistics continuous tracking
    p_smooth = np.zeros_like(power)
    p_smooth[:, 0] = power[:, 0]
    for i in range(1, n_frames):
        p_smooth[:, i] = 0.82 * p_smooth[:, i - 1] + 0.18 * power[:, i]

    # Running minimum over a 1.2s sliding window with bias compensation (B_min ~ 1.45)
    win_frames = max(12, int(1.2 * sr / hop))
    min_power = minimum_filter1d(
        p_smooth, size=win_frames, axis=1, mode="nearest", origin=-(win_frames // 4)
    )
    martin_noise_psd = min_power * 1.45

    # 2. Initial Noise PSD Estimation
    noise_indices = np.where(vad_probs < 0.25)[0]
    if len(noise_indices) >= 3:
        initial_noise = np.median(power[:, noise_indices], axis=1)
    else:
        # Fallback: lowest 20% energy frames
        frame_energies = np.sum(power, axis=0)
        low_energy_idx = np.argsort(frame_energies)[: max(3, int(n_frames * 0.20))]
        initial_noise = np.median(power[:, low_energy_idx], axis=1)

    # Blend initial noise estimate with minimum statistics baseline
    noise_psd = np.maximum(initial_noise, martin_noise_psd[:, 0])
    noise_psd = np.maximum(noise_psd, 1e-10)

    # Frequency-weighted over-subtraction (extra suppression at low rumble and high hiss)
    freq_weight = np.ones_like(freq_bins)
    freq_weight[freq_bins < 300.0] = 1.4
    freq_weight[freq_bins > 4500.0] = 1.3
    over_sub = (1.1 + 2.6 * strength) * freq_weight
    alpha_dd = 0.90   # Decision-Directed smoothing parameter
    beta_noise = 0.88 # Noise update rate during quiet frames

    clean_mag_prev = stft_mag[:, 0].copy()
    gains = np.ones((n_freqs, n_frames), dtype=np.float64)

    # Core voice formant band
    voice_band = (freq_bins >= 250.0) & (freq_bins <= 4000.0)

    for i in range(n_frames):
        p_frame = power[:, i]
        v_prob = vad_probs[i]
        m_floor = martin_noise_psd[:, i]

        # Continuous Noise Update:
        if v_prob < 0.25:
            noise_psd = beta_noise * noise_psd + (1.0 - beta_noise) * p_frame
        else:
            # Track stationary continuous noise floors (fans, hums, AC)
            noise_psd = np.where(
                m_floor > noise_psd,
                0.98 * noise_psd + 0.02 * m_floor,
                noise_psd
            )
            noise_psd = np.minimum(noise_psd, np.maximum(m_floor, 1e-10) * 1.3)

        noise_psd = np.maximum(noise_psd, 1e-10)

        # A posteriori SNR: gamma = |Y|^2 / N
        gamma = p_frame / noise_psd

        # A priori SNR: xi with deep over-subtraction scaling
        s_prev_ratio = (clean_mag_prev ** 2) / noise_psd
        xi_inst = np.maximum((gamma / over_sub) - 1.0, 0.0)
        xi = alpha_dd * s_prev_ratio + (1.0 - alpha_dd) * xi_inst
        xi = np.maximum(xi, 1e-6)

        # Wiener gain with aggressive suppression
        g_wiener = xi / (xi + over_sub)

        # Exponent scaling for deeper suppression
        scaled_gain = g_wiener ** max(0.6, 1.0 + strength * 1.5)

        # Dynamic frame floor: in speech pauses (v_prob < 0.35), drop floor down to near zero
        # to ensure pitch-black silence between words and eliminate residual hiss
        if v_prob > 0.45:
            speech_conf = (v_prob - 0.45) / 0.55
            snr_factor = np.clip(xi / (1.0 + xi), 0.0, 1.0)
            protect_gain = speech_conf * 0.45 * snr_factor
            scaled_gain[voice_band] = np.maximum(scaled_gain[voice_band], protect_gain[voice_band])
            frame_floor = floor
        elif v_prob < 0.35:
            # Non-speech gap downward expansion into digital blackness
            gate_factor = np.clip(v_prob / 0.35, 0.0, 1.0) ** (1.5 + strength * 1.5)
            scaled_gain = scaled_gain * gate_factor
            frame_floor = floor * gate_factor
        else:
            frame_floor = floor

        # Frequency smoothing (3-point moving average)
        smoothed_gain = np.convolve(scaled_gain, [0.12, 0.76, 0.12], mode="same")

        # Spectral floor (per-frame dynamic floor)
        gain_floored = np.maximum(smoothed_gain, frame_floor)
        gains[:, i] = gain_floored

        # Update clean_mag_prev for next frame's decision-directed SNR
        clean_mag_prev = gain_floored * stft_mag[:, i]

    # Inter-frame 5-point temporal smoothing to prevent flutter / musical noise
    temporal_kernel = np.array([0.08, 0.22, 0.40, 0.22, 0.08])
    for f in range(n_freqs):
        gains[f, :] = np.convolve(gains[f, :], temporal_kernel, mode="same")

    # Overlap-add synthesis
    out = np.zeros(len(x_pad) + frame_len, dtype=np.float64)
    norm_win = np.zeros_like(out)

    for i, start in enumerate(frame_starts):
        spec_clean = (stft_mag[:, i] * gains[:, i]) * np.exp(1j * stft_phase[:, i])
        frame_out = np.fft.irfft(spec_clean, n=n_fft)[:frame_len] * window
        end = start + frame_len
        out[start:end] += frame_out
        norm_win[start:end] += window ** 2

    norm_win = np.where(norm_win > 1e-6, norm_win, 1.0)
    out = out / norm_win
    return out[pad_len : pad_len + n_total]


def adaptive_noise_reduction(
    audio: np.ndarray,
    sr: int,
    *,
    strength: float = 0.7,
    floor: float = 0.0005,
    frame_ms: float = 25.0,
    overlap: float = 0.75,
    vad_result=None,
) -> np.ndarray:
    """Adaptive Noise Reduction using VAD, Minimum Statistics, and Decision-Directed Wiener filtering.

    Avoids aggressive spectral subtraction artifacts ('musical noise') while achieving
    maximum suppression (up to 30+ dB) of stationary background noise floors into near-total silence.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        strength: Reduction strength [0.0, 2.0] (default 0.7).
        floor: Minimum spectral floor fraction [0.00001, 0.1] (default 0.0005).
        frame_ms: STFT analysis frame length in ms (default 25ms).
        overlap: STFT overlap ratio [0.5, 0.875] (default 0.75).
        vad_result: Optional precomputed VADResult.

    Returns:
        Noise-reduced audio array of same shape as input.
    """
    strength = float(np.clip(strength, 0.0, 2.0))
    floor = float(np.clip(floor, 1e-6, 0.2))

    if audio.ndim == 2:
        left = _adaptive_wiener_mono(
            audio[:, 0], sr, strength=strength, floor=floor,
            frame_ms=frame_ms, overlap=overlap, vad_result=vad_result
        )
        right = _adaptive_wiener_mono(
            audio[:, 1], sr, strength=strength, floor=floor,
            frame_ms=frame_ms, overlap=overlap, vad_result=vad_result
        )
        n = min(len(left), len(right))
        return np.stack([left[:n], right[:n]], axis=1)
    else:
        return _adaptive_wiener_mono(
            audio, sr, strength=strength, floor=floor,
            frame_ms=frame_ms, overlap=overlap, vad_result=vad_result
        )


def _resample_channel(audio_channel: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """High-quality polyphase resampling between orig_sr and target_sr."""
    if orig_sr == target_sr:
        return audio_channel.copy()
    gcd = math.gcd(int(orig_sr), int(target_sr))
    up = int(target_sr) // gcd
    down = int(orig_sr) // gcd
    return resample_poly(audio_channel, up, down).astype(np.float32)


def reduce_noise_deep(
    audio: np.ndarray,
    sr: int,
    *,
    atten_lim_db: float = 100.0,
    **kwargs,
) -> np.ndarray:
    """DeepFilterNet Neural Speech Enhancement & Noise Reduction.

    Handles mono (N,) and stereo (N, 2) input:
    - Resamples internally to DeepFilterNet's required sample rate (48 kHz).
    - Runs DeepFilterNet enhancement with the pre-initialized module-level model.
    - Resamples output back to original sr.
    - Returns the exact same shape as input.

    Args:
        audio: Input audio numpy array, shape (N,) or (N, 2).
        sr: Original sample rate in Hz.
        atten_lim_db: Maximum attenuation limit in dB (default 100.0).

    Returns:
        Denoised audio array with the exact same shape (N,) or (N, 2) and sample rate.
    """
    orig_dtype = audio.dtype
    orig_length = audio.shape[0]
    is_stereo = (audio.ndim == 2 and audio.shape[1] == 2)
    target_sr = _DF_SR

    if _DF_MODEL is not None and _DF_STATE is not None:
        import torch
        if is_stereo:
            out_channels = []
            for ch_idx in range(2):
                ch_data = audio[:, ch_idx]
                # 1. Resample to DeepFilterNet required rate (48kHz)
                ch_resampled = _resample_channel(ch_data, sr, target_sr)
                # 2. Convert to PyTorch tensor (1, T)
                ch_tensor = torch.from_numpy(ch_resampled.astype(np.float32)).unsqueeze(0)
                # 3. Enhance with DeepFilterNet
                with torch.no_grad():
                    enhanced_tensor = enhance(_DF_MODEL, _DF_STATE, ch_tensor, atten_lim_db=atten_lim_db)
                enhanced_np = enhanced_tensor.squeeze(0).cpu().numpy()
                # 4. Resample back to original rate
                ch_out = _resample_channel(enhanced_np, target_sr, sr)
                if len(ch_out) > orig_length:
                    ch_out = ch_out[:orig_length]
                elif len(ch_out) < orig_length:
                    ch_out = np.pad(ch_out, (0, orig_length - len(ch_out)))
                out_channels.append(ch_out)
            result = np.stack(out_channels, axis=1)
        else:
            mono_data = audio.ravel()
            # 1. Resample to DeepFilterNet required rate (48kHz)
            mono_resampled = _resample_channel(mono_data, sr, target_sr)
            # 2. Convert to PyTorch tensor (1, T)
            mono_tensor = torch.from_numpy(mono_resampled.astype(np.float32)).unsqueeze(0)
            # 3. Enhance with DeepFilterNet
            with torch.no_grad():
                enhanced_tensor = enhance(_DF_MODEL, _DF_STATE, mono_tensor, atten_lim_db=atten_lim_db)
            enhanced_np = enhanced_tensor.squeeze(0).cpu().numpy()
            # 4. Resample back to original rate
            result = _resample_channel(enhanced_np, target_sr, sr)
            if len(result) > orig_length:
                result = result[:orig_length]
            elif len(result) < orig_length:
                result = np.pad(result, (0, orig_length - len(result)))

        return result.astype(orig_dtype)

    # Fallback to DSP adaptive noise reduction if DeepFilterNet model is not loaded
    kwargs.pop("noise_duration_ms", None)
    return adaptive_noise_reduction(audio, sr, **kwargs)


# Public aliases
_noise_reduction = reduce_noise_deep
noise_reduction = reduce_noise_deep




