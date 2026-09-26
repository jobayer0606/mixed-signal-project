"""
pyaudiolab/speed_pitch_dsp.py — Pure Python/NumPy Audio Speed, Pitch & Resampling DSP Module.

Ported directly from the JavaScript DSP visualizer engine:
- fft(re, im): In-place Radix-2 Cooley-Tukey FFT
- analyzeMovingFrame(buffer, timeSec, ...): Moving-frame short-time FFT + 64-bar analyzer
- wsolaTimeStretch(inputData, speedFactor, sampleRate): WSOLA pitch-preserving time-stretch
- computeResampledBuffer(origBuffer, speedFactor, targetFs, resampleMode, sampleRate):
    Naive varispeed vs. Smart WSOLA with Zero-Order Hold downsampling
- evaluateAliasingState(origPeakFreq, procPeakFreq, targetFs, speedFactor, resampleMode):
    Nyquist boundary detection & folded alias calculation
- generateSynthetic440(sampleRate, duration): 2-second 440 Hz + 880 Hz reference tone
"""

from __future__ import annotations

import math
from typing import Dict, Any, List, Optional, Union
import numpy as np


def fft(
    re: Union[List[float], np.ndarray],
    im: Union[List[float], np.ndarray],
) -> None:
    """In-place Radix-2 Cooley-Tukey Decimation-in-Time FFT.

    Mutates `re` and `im` arrays in-place.
    `len(re)` and `len(im)` must be equal powers of 2.
    """
    n = len(re)
    if n <= 1:
        return

    # Bit-reversal permutation
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]

    # Cooley-Tukey butterfly stages
    length = 2
    while length <= n:
        ang = (-2.0 * math.pi) / length
        wr = math.cos(ang)
        wi = math.sin(ang)
        half_len = length // 2
        for i in range(0, n, length):
            cwr = 1.0
            cwi = 0.0
            for k in range(half_len):
                ur = re[i + k]
                ui = im[i + k]
                vr = re[i + k + half_len] * cwr - im[i + k + half_len] * cwi
                vi = re[i + k + half_len] * cwi + im[i + k + half_len] * cwr

                re[i + k] = ur + vr
                im[i + k] = ui + vi
                re[i + k + half_len] = ur - vr
                im[i + k + half_len] = ui - vi

                nwr = cwr * wr - cwi * wi
                nwi = cwr * wi + cwi * wr
                cwr = nwr
                cwi = nwi
        length <<= 1


def analyzeMovingFrame(
    buffer: Union[List[float], np.ndarray],
    timeSec: float,
    sampleRate: int = 44100,
    fft_size: int = 2048,
    num_bars: int = 64,
) -> Dict[str, Any]:
    """Applies Hann window + FFT to a moving frame centered at timeSec.

    Returns:
        {
            "barMags": List[float],
            "peakFreq": float,
            "maxBarMag": float,
            "sampleRate": int,
        }
    """
    if buffer is None or len(buffer) == 0:
        return {
            "barMags": [0.0] * num_bars,
            "peakFreq": 440.0,
            "maxBarMag": 1.0,
            "sampleRate": sampleRate,
        }

    data = np.asarray(buffer, dtype=np.float64)
    if data.ndim > 1:
        data = data[:, 0]
    total_samples = len(data)

    center_sample = int(math.floor(timeSec * sampleRate))
    if center_sample < 0:
        center_sample = 0
    if total_samples > 0 and center_sample >= total_samples:
        center_sample = center_sample % total_samples

    start_sample = center_sample - (fft_size // 2)

    re_buf = np.zeros(fft_size, dtype=np.float64)
    im_buf = np.zeros(fft_size, dtype=np.float64)

    for i in range(fft_size):
        s_idx = start_sample + i
        s_val = float(data[s_idx]) if (0 <= s_idx < total_samples) else 0.0
        hann_w = 0.5 * (1.0 - math.cos((2.0 * math.pi * i) / (fft_size - 1)))
        re_buf[i] = s_val * hann_w
        im_buf[i] = 0.0

    fft(re_buf, im_buf)

    half = fft_size // 2
    bar_mags = [0.0] * num_bars
    max_bar_mag = 0.0001
    max_bin_mag = 0.0
    peak_bin = 1

    bins_per_bar = half // num_bars

    for b in range(num_bars):
        bar_sum = 0.0
        start_bin = b * bins_per_bar
        end_bin = min(start_bin + bins_per_bar, half)

        for k in range(start_bin, end_bin):
            if k == 0:
                continue  # ignore DC
            mag = math.hypot(re_buf[k], im_buf[k]) / (fft_size / 2.0)
            bar_sum += mag
            if mag > max_bin_mag and k >= 2:
                max_bin_mag = mag
                peak_bin = k

        count = max(end_bin - start_bin, 1)
        avg_mag = bar_sum / count
        bar_mags[b] = float(avg_mag)
        if avg_mag > max_bar_mag:
            max_bar_mag = float(avg_mag)

    peak_freq = float((peak_bin * sampleRate) / fft_size) if max_bin_mag > 0.001 else 440.0

    return {
        "barMags": bar_mags,
        "peakFreq": round(peak_freq, 2),
        "maxBarMag": round(max_bar_mag, 6),
        "sampleRate": sampleRate,
    }


def wsolaTimeStretch(
    inputData: Union[List[float], np.ndarray],
    speedFactor: float,
    sampleRate: int = 44100,
) -> np.ndarray:
    """WSOLA (Waveform Similarity Overlap-Add) Pitch-Preserving Time-Stretching."""
    data = np.asarray(inputData, dtype=np.float32)
    if abs(speedFactor - 1.0) < 0.005:
        return data.copy()

    input_len = len(data)
    output_len = max(int(math.floor(input_len / speedFactor)), 1)
    output_data = np.zeros(output_len, dtype=np.float32)
    norm_buffer = np.zeros(output_len, dtype=np.float32)

    win_size = min(2048, max(256, int(math.floor(sampleRate * 0.03))))
    hop_size = win_size // 4
    search_range = win_size // 2

    # Hann window
    win = (0.5 * (1.0 - np.cos((2.0 * np.pi * np.arange(win_size)) / (win_size - 1)))).astype(np.float32)

    out_pos = 0
    while out_pos < output_len:
        target_in_pos = int(math.floor(out_pos * speedFactor))
        best_offset = 0

        if out_pos > 0:
            max_corr = -float("inf")
            start_search = max(0, target_in_pos - search_range)
            end_search = min(input_len - win_size, target_in_pos + search_range)

            for cand in range(start_search, end_search + 1, 2):
                cand_slice = data[cand : cand + win_size : 4]
                out_slice = output_data[out_pos : out_pos + len(cand_slice) * 4 : 4]
                min_len = min(len(cand_slice), len(out_slice))
                if min_len > 0:
                    corr = float(np.dot(cand_slice[:min_len], out_slice[:min_len]))
                    if corr > max_corr:
                        max_corr = corr
                        best_offset = cand - target_in_pos

        actual_in_pos = max(0, min(input_len - win_size, target_in_pos + best_offset))
        copy_len = min(win_size, output_len - out_pos, input_len - actual_in_pos)

        if copy_len > 0:
            w_slice = win[:copy_len]
            output_data[out_pos : out_pos + copy_len] += data[actual_in_pos : actual_in_pos + copy_len] * w_slice
            norm_buffer[out_pos : out_pos + copy_len] += w_slice

        out_pos += hop_size

    mask = norm_buffer > 1e-4
    output_data[mask] /= norm_buffer[mask]

    return output_data


def computeResampledBuffer(
    origBuffer: Union[List[float], np.ndarray],
    speedFactor: float = 1.0,
    targetFs: Optional[float] = None,
    resampleMode: str = "naive",
    sampleRate: int = 44100,
) -> np.ndarray:
    """Resample buffer using Naive Varispeed or Smart WSOLA, with Zero-Order Hold downsampling."""
    data = np.asarray(origBuffer, dtype=np.float32)
    orig_length = len(data)
    orig_sample_rate = sampleRate

    new_length = max(int(math.floor(orig_length / speedFactor)), 1)
    effective_fs = targetFs if (targetFs and 0 < targetFs < orig_sample_rate) else orig_sample_rate
    downsample_ratio = effective_fs / orig_sample_rate

    dst_data = np.zeros(new_length, dtype=np.float32)

    intermediate_stretched = None
    if resampleMode == "smart":
        intermediate_stretched = wsolaTimeStretch(data, speedFactor, orig_sample_rate)

    for j in range(new_length):
        sample_time_in_output_sec = j / orig_sample_rate
        if downsample_ratio < 1.0:
            k_hold = math.floor(sample_time_in_output_sec * effective_fs)
            sample_time_in_output_sec = k_hold / effective_fs

        if resampleMode == "smart" and intermediate_stretched is not None:
            stretch_idx_float = sample_time_in_output_sec * orig_sample_rate
            idx0 = int(math.floor(stretch_idx_float))
            max_idx = len(intermediate_stretched) - 1
            idx1 = min(idx0 + 1, max_idx)
            frac = stretch_idx_float - idx0
            if 0 <= idx0 <= max_idx:
                dst_data[j] = (1.0 - frac) * intermediate_stretched[idx0] + frac * intermediate_stretched[idx1]
            else:
                dst_data[j] = 0.0
        else:
            src_idx_float = sample_time_in_output_sec * speedFactor * orig_sample_rate
            idx0 = int(math.floor(src_idx_float))
            idx1 = min(idx0 + 1, orig_length - 1)
            frac = src_idx_float - idx0
            if 0 <= idx0 < orig_length:
                dst_data[j] = (1.0 - frac) * data[idx0] + frac * data[idx1]
            else:
                dst_data[j] = 0.0

    return dst_data


def evaluateAliasingState(
    origPeakFreq: float = 440.0,
    procPeakFreq: Optional[float] = None,
    targetFs: float = 44100.0,
    speedFactor: float = 1.0,
    resampleMode: str = "naive",
) -> Dict[str, Any]:
    """Evaluates Nyquist threshold and calculates spectral foldback alias frequency."""
    if not targetFs or targetFs <= 0:
        targetFs = 44100.0
    nyquist = targetFs / 2.0

    if resampleMode == "smart":
        active_freq = origPeakFreq if origPeakFreq else 440.0
    else:
        active_freq = (
            procPeakFreq
            if (procPeakFreq is not None and procPeakFreq > 0)
            else (origPeakFreq * speedFactor if origPeakFreq else 440.0 * speedFactor)
        )

    if active_freq > nyquist:
        signed_folded = ((active_freq + nyquist) % targetFs) - nyquist
        alias_freq = abs(signed_folded)
        status = "ALIASING"
    elif active_freq >= 0.88 * nyquist:
        alias_freq = None
        status = "NEAR NYQUIST"
    else:
        alias_freq = None
        status = "SAFE"

    return {
        "status": status,
        "nyquist": round(nyquist, 2),
        "aliasFreq": round(alias_freq, 2) if alias_freq is not None else None,
    }


def generateSynthetic440(sampleRate: int = 44100, duration: float = 2.0) -> np.ndarray:
    """Generates a 2-second 440 Hz + 880 Hz sine buffer at sampleRate with a smooth envelope."""
    num_samples = int(math.floor(sampleRate * duration))
    t = np.arange(num_samples, dtype=np.float32) / sampleRate
    env = np.sin(np.pi * t / duration)
    f0 = 440.0
    f1 = 880.0
    data = env * (0.7 * np.sin(2.0 * np.pi * f0 * t) + 0.25 * np.sin(2.0 * np.pi * f1 * t))
    return data.astype(np.float32)


# Pythonic aliases (snake_case)
analyze_moving_frame = analyzeMovingFrame
wsola_time_stretch = wsolaTimeStretch
compute_resampled_buffer = computeResampledBuffer
evaluate_aliasing_state = evaluateAliasingState
generate_synthetic_440 = generateSynthetic440
