"""
visualize.py — Before/after waveform plots for each DSP effect.

Usage:
    from pyaudiolab.visualize import plot_before_after
    plot_before_after(original, processed, sr, "gain", "plots/gain.png")
"""

from __future__ import annotations

import os
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker


def _time_axis(audio: np.ndarray, sr: int) -> np.ndarray:
    """Return a time axis array in seconds."""
    n = audio.shape[0]
    return np.linspace(0, n / sr, n, endpoint=False)


def plot_before_after(
    original: np.ndarray,
    processed: np.ndarray,
    sr: int,
    effect_name: str,
    out_path: str,
    *,
    figsize: tuple[int, int] = (12, 6),
) -> str:
    """Save a before/after waveform comparison PNG.

    Args:
        original:    Raw input audio (float64).
        processed:   Effect-processed audio (float64).
        sr:          Sample rate in Hz.
        effect_name: Label shown in the plot title.
        out_path:    Destination file path for the PNG.
        figsize:     Matplotlib figure size tuple.

    Returns:
        Absolute path to the saved PNG.
    """
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    # Collapse stereo to mono for display only
    def _display(audio: np.ndarray) -> np.ndarray:
        if audio.ndim == 2:
            return audio.mean(axis=1)
        return audio

    orig_display = _display(original)
    proc_display = _display(processed)

    t_orig = _time_axis(orig_display, sr)
    t_proc = _time_axis(proc_display, sr)

    fig, axes = plt.subplots(2, 1, figsize=figsize, sharex=False)
    fig.suptitle(f"PyAudioLab — Effect: {effect_name.replace('_', ' ').title()}", fontsize=14, fontweight="bold")

    # Before
    axes[0].plot(t_orig, orig_display, color="#4C72B0", linewidth=0.6, alpha=0.85)
    axes[0].set_title("Before", fontsize=11)
    axes[0].set_ylabel("Amplitude")
    axes[0].set_ylim(-1.05, 1.05)
    axes[0].axhline(0, color="gray", linewidth=0.4, linestyle="--")
    axes[0].xaxis.set_major_formatter(ticker.FormatStrFormatter("%.2f s"))
    axes[0].grid(True, alpha=0.3)

    # After
    axes[1].plot(t_proc, proc_display, color="#DD8452", linewidth=0.6, alpha=0.85)
    axes[1].set_title("After", fontsize=11)
    axes[1].set_ylabel("Amplitude")
    axes[1].set_xlabel("Time (s)")
    axes[1].set_ylim(-1.05, 1.05)
    axes[1].axhline(0, color="gray", linewidth=0.4, linestyle="--")
    axes[1].xaxis.set_major_formatter(ticker.FormatStrFormatter("%.2f s"))
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return os.path.abspath(out_path)


def plot_spectrum(
    original: np.ndarray,
    processed: np.ndarray,
    sr: int,
    effect_name: str,
    out_path: str,
    *,
    figsize: tuple[int, int] = (12, 5),
) -> str:
    """Save a frequency-domain magnitude spectrum comparison PNG."""
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    def _mono(audio: np.ndarray) -> np.ndarray:
        return audio.mean(axis=1) if audio.ndim == 2 else audio

    def _spectrum(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        n = len(audio)
        freqs = np.fft.rfftfreq(n, d=1.0 / sr)
        mag = np.abs(np.fft.rfft(audio)) / n
        mag_db = 20 * np.log10(np.maximum(mag, 1e-10))
        return freqs, mag_db

    fig, ax = plt.subplots(figsize=figsize)
    fig.suptitle(f"PyAudioLab — Spectrum: {effect_name.replace('_', ' ').title()}", fontsize=13, fontweight="bold")

    freqs_o, mag_o = _spectrum(_mono(original))
    freqs_p, mag_p = _spectrum(_mono(processed))

    ax.plot(freqs_o, mag_o, color="#4C72B0", linewidth=1.0, alpha=0.8, label="Before")
    ax.plot(freqs_p, mag_p, color="#DD8452", linewidth=1.0, alpha=0.8, label="After")
    ax.set_xscale("log")
    ax.set_xlim(20, sr // 2)
    ax.set_xlabel("Frequency (Hz)")
    ax.set_ylabel("Magnitude (dBFS)")
    ax.legend()
    ax.grid(True, which="both", alpha=0.3)

    plt.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return os.path.abspath(out_path)
