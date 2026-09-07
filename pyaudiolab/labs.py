"""
pyaudiolab/labs.py — DSP calculation engines for Signal Labs experiments.

Provides Python implementations for:
1. Wave Interference & Beat Frequency
2. Sampling, Aliasing & Nyquist Foldback
3. Fourier Series Harmonic Decomposition & Error Analysis
4. Discrete Linear Convolution & Mathematical Step Derivation
"""

from __future__ import annotations

import math
from typing import Dict, Any, List, Optional
import numpy as np


def eval_waveform(phase: float, shape: str) -> float:
    """Evaluate standard waveforms at a continuous phase."""
    p = phase % (2.0 * math.pi)
    if p < 0.0:
        p += 2.0 * math.pi

    if shape == "sine":
        return math.sin(p)
    elif shape == "square":
        return 1.0 if p < math.pi else -1.0
    elif shape == "triangle":
        return (2.0 * p / math.pi) - 1.0 if p < math.pi else 3.0 - (2.0 * p / math.pi)
    elif shape == "sawtooth":
        return 1.0 - (p / math.pi)
    else:
        return math.sin(p)


def calculate_beat_metrics(
    f1: float,
    f2: float,
    a1: float = 0.8,
    a2: float = 0.8,
    shape1: str = "sine",
    shape2: str = "sine",
    time_window_ms: float = 25.0,
) -> Dict[str, Any]:
    """Calculate wave interference, beat frequency, and envelope metrics."""
    beat_freq = abs(f1 - f2)
    avg_carrier = (f1 + f2) / 2.0
    beat_period = (1.0 / beat_freq) if beat_freq > 0.001 else None

    if beat_freq == 0:
        state_title = "Unison State"
        state_sub = "Perfect constructive phase"
    elif beat_freq <= 15:
        state_title = "Acoustic Beat Pulse"
        state_sub = "Clear periodic envelope swell"
    elif beat_freq <= 30:
        state_title = "Fast Flutter"
        state_sub = "Rapid amplitude flutter"
    else:
        state_title = "Dual Tone"
        state_sub = "Perceived as 2 separate pitches"

    is_sine1 = shape1 == "sine"
    is_sine2 = shape2 == "sine"
    is_equal_amp = abs(a1 - a2) < 0.05
    is_valid_envelope = is_sine1 and is_sine2 and is_equal_amp and beat_freq > 0.01

    mod_freq = beat_freq / 2.0
    env_amp = a1 + a2

    return {
        "beat_freq": round(beat_freq, 3),
        "carrier_freq": round(avg_carrier, 3),
        "beat_period": round(beat_period, 4) if beat_period is not None else None,
        "state_title": state_title,
        "state_sub": state_sub,
        "is_valid_envelope": is_valid_envelope,
        "mod_freq": round(mod_freq, 3),
        "env_amp": round(env_amp, 3),
    }


def calculate_sampling_dsp(
    f: float,
    fs: float,
    amp: float = 0.8,
    shape: str = "sine",
    time_window_ms: float = 15.0,
) -> Dict[str, Any]:
    """Calculate Nyquist limit, folded alias frequency, and sampling state."""
    nyquist = fs / 2.0
    ratio = fs / f if f != 0 else float("inf")
    signed_folded = ((f + nyquist) % fs) - nyquist
    alias_freq = abs(signed_folded)

    if abs(f - nyquist) < 0.5:
        status = "NYQUIST LIMIT"
        status_sub = "f = Fs/2 (Boundary)"
        status_class = "badge-nyquist"
    elif f > nyquist:
        status = "ALIASING"
        status_sub = f"f > Fs/2 (Folded to {alias_freq:.1f} Hz)"
        status_class = "badge-aliasing"
    else:
        status = "SAFE"
        status_sub = "f < Fs/2 (No aliasing)"
        status_class = "badge-safe"

    return {
        "nyquist": round(nyquist, 3),
        "ratio": round(ratio, 4),
        "alias_freq": round(alias_freq, 3),
        "signed_folded": round(signed_folded, 3),
        "status": status,
        "status_sub": status_sub,
        "status_class": status_class,
    }


def get_harmonic_coefficients(
    shape: str, n_terms: int, amp: float = 0.8
) -> tuple[List[Dict[str, Any]], int]:
    """Compute Fourier series harmonic coefficients for standard waveforms."""
    coeffs: List[Dict[str, Any]] = []
    highest_harmonic = 1

    if shape == "square":
        factor = (4.0 * amp) / math.pi
        for k in range(1, n_terms + 1):
            n = 2 * k - 1
            coeffs.append({"n": n, "amp": round(factor / n, 6)})
            highest_harmonic = n
    elif shape == "triangle":
        factor = (8.0 * amp) / (math.pi * math.pi)
        for k in range(1, n_terms + 1):
            n = 2 * k - 1
            sign = 1.0 if (k % 2 == 1) else -1.0
            coeffs.append({"n": n, "amp": round(sign * factor / (n * n), 6)})
            highest_harmonic = n
    elif shape == "sawtooth":
        factor = (2.0 * amp) / math.pi
        for n in range(1, n_terms + 1):
            sign = 1.0 if (n % 2 == 1) else -1.0
            coeffs.append({"n": n, "amp": round(sign * factor / n, 6)})
            highest_harmonic = n

    return coeffs, highest_harmonic


def calculate_fourier_metrics(
    shape: str = "square",
    n_terms: int = 5,
    amp: float = 0.8,
    f0: float = 100.0,
    time_window_ms: float = 20.0,
) -> Dict[str, Any]:
    """Calculate harmonic expansion, MSE/RMSE error, and Gibbs phenomenon status."""
    coeffs, highest_harmonic = get_harmonic_coefficients(shape, n_terms, amp)
    latest_harmonic = coeffs[-1] if coeffs else {"n": 1, "amp": amp}
    latest_harmonic_info = {
        "n": latest_harmonic["n"],
        "amp": latest_harmonic["amp"],
        "freq": round(latest_harmonic["n"] * f0, 2),
    }

    num_samples = 200
    period_sec = 1.0 / f0 if f0 > 0 else 0.01
    t_vals = np.linspace(0, period_sec, num_samples, endpoint=False)

    # Vectorized computation of target and Fourier sum
    target_vals = np.array([amp * eval_waveform(2.0 * math.pi * f0 * t, shape) for t in t_vals])

    omega0 = 2.0 * math.pi * f0
    fourier_vals = np.zeros(num_samples)
    for c in coeffs:
        fourier_vals += c["amp"] * np.sin(c["n"] * omega0 * t_vals)

    errors = target_vals - fourier_vals
    mse = float(np.mean(errors ** 2))
    rmse = math.sqrt(mse)
    rmse_percent = (rmse / amp * 100.0) if amp > 0 else 0.0

    if shape == "triangle":
        status = "Smooth Decay (1/n²)"
        status_sub = "Rapid convergence, minimal ringing"
        status_color = "var(--ok)"
    elif n_terms >= 5:
        status = "Gibbs Ringing Active"
        status_sub = "~9% overshoot near jump discontinuity"
        status_color = "var(--warn)"
    else:
        status = "Coarse Approximation"
        status_sub = "Low harmonic terms count"
        status_color = "var(--trace-a)"

    return {
        "coeffs": coeffs,
        "highest_harmonic": highest_harmonic,
        "highestHarmonic": highest_harmonic,
        "latest_harmonic": latest_harmonic_info,
        "latestHarmonic": latest_harmonic_info,
        "mse": round(mse, 6),
        "rmse": round(rmse, 6),
        "rmse_percent": round(rmse_percent, 2),
        "rmsePercent": round(rmse_percent, 2),
        "status": status,
        "status_sub": status_sub,
        "statusSub": status_sub,
        "status_color": status_color,
        "statusColor": status_color,
    }


def compute_discrete_convolution(x_seq: List[float], h_seq: List[float]) -> List[float]:
    """Compute exact discrete linear convolution y[n] = x[n] * h[n]."""
    x_arr = np.array(x_seq, dtype=float)
    h_arr = np.array(h_seq, dtype=float)
    y_conv = np.convolve(x_arr, h_arr)
    return [round(float(v), 3) for v in y_conv]


def compute_step_math_string(
    x_seq: List[float], h_seq: List[float], n_index: int
) -> tuple[str, int, List[Dict[str, Any]]]:
    """Compute step-by-step mathematical derivation string for convolution at index n."""
    lx = len(x_seq)
    lh = len(h_seq)
    ly = lx + lh - 1

    if n_index < 0 or n_index >= ly:
        return f"y[{n_index}] = 0 (Outside output range)", 0, []

    terms = []
    total_sum = 0.0

    for k in range(lx):
        h_idx = n_index - k
        if 0 <= h_idx < lh:
            val_x = x_seq[k]
            val_h = h_seq[h_idx]
            prod = val_x * val_h
            total_sum += prod
            terms.append({
                "k": k,
                "h_idx": h_idx,
                "val_x": val_x,
                "val_h": val_h,
                "prod": round(prod, 3),
            })

    if not terms:
        return f"y[{n_index}] = 0 (No overlapping samples)", 0, []

    def fmt_num(v: float) -> str:
        if isinstance(v, (int, float)) and float(v).is_integer():
            return str(int(v))
        return f"{v:.3g}"

    exp_str = " + ".join([f"x[{t['k']}]h[{n_index - t['k']}]" for t in terms])
    val_str = " + ".join([f"{fmt_num(t['val_x'])}×{fmt_num(t['val_h'])}" for t in terms])
    rounded_sum = round(total_sum, 3)
    sum_str = fmt_num(rounded_sum)

    equation_str = f"y[{n_index}] = {exp_str} = {val_str} = {sum_str}"
    return equation_str, len(terms), terms


def calculate_convolution_metrics(
    x_seq: List[float],
    h_seq: List[float],
    n_index: int = 2,
    mode: str = "discrete",
) -> Dict[str, Any]:
    """Calculate full discrete convolution, math derivation, and overlap metrics."""
    y_seq = compute_discrete_convolution(x_seq, h_seq)
    lx = len(x_seq)
    lh = len(h_seq)
    ly = lx + lh - 1

    current_y = y_seq[n_index] if (0 <= n_index < ly) else 0.0
    math_str, overlap_count, terms = compute_step_math_string(x_seq, h_seq, n_index)

    return {
        "x": x_seq,
        "h": h_seq,
        "y": y_seq,
        "lx": lx,
        "lh": lh,
        "ly": ly,
        "n_index": n_index,
        "current_y": current_y,
        "math_str": math_str,
        "overlap_count": overlap_count,
        "terms": terms,
    }
