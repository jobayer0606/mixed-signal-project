"""
generate_test_wav.py — Generate synthetic test WAV files for manual verification.

Produces:
    test_sine_mono.wav    — 3-second 440 Hz sine wave, mono, 44100 Hz
    test_sine_stereo.wav  — 3-second 440/880 Hz sine waves, stereo, 44100 Hz
    test_noise.wav        — 3-second white noise, mono, 44100 Hz
    test_silence.wav      — 1-second silence + 1-second tone + 1-second silence

Usage:
    python -m pyaudiolab.generate_test_wav
    python -m pyaudiolab.generate_test_wav --out_dir my_test_files/
"""

from __future__ import annotations

import argparse
import os
import numpy as np
from pyaudiolab.io_utils import save_wav


def generate_all(out_dir: str = ".", sr: int = 44100) -> None:
    os.makedirs(out_dir, exist_ok=True)
    duration = 3.0
    n = int(sr * duration)
    t = np.linspace(0, duration, n, endpoint=False)

    # 1. Mono sine 440 Hz
    mono_sine = 0.5 * np.sin(2 * np.pi * 440 * t)
    save_wav(os.path.join(out_dir, "test_sine_mono.wav"), mono_sine, sr)
    print(f"  Saved: test_sine_mono.wav  ({duration}s, mono, 440 Hz)")

    # 2. Stereo sine 440 Hz left / 880 Hz right
    left = 0.5 * np.sin(2 * np.pi * 440 * t)
    right = 0.5 * np.sin(2 * np.pi * 880 * t)
    stereo_sine = np.stack([left, right], axis=1)
    save_wav(os.path.join(out_dir, "test_sine_stereo.wav"), stereo_sine, sr)
    print(f"  Saved: test_sine_stereo.wav ({duration}s, stereo, L=440/R=880 Hz)")

    # 3. White noise
    rng = np.random.default_rng(42)
    noise = rng.uniform(-0.3, 0.3, n)
    save_wav(os.path.join(out_dir, "test_noise.wav"), noise, sr)
    print(f"  Saved: test_noise.wav      ({duration}s, mono, white noise)")

    # 4. Silence + tone + silence (for trim_silence test)
    silence_s = 1.0
    tone_s = 1.0
    n_silence = int(sr * silence_s)
    n_tone = int(sr * tone_s)
    silent_region = np.zeros(n_silence)
    tone_region = 0.5 * np.sin(2 * np.pi * 440 * np.linspace(0, tone_s, n_tone, endpoint=False))
    combined = np.concatenate([silent_region, tone_region, silent_region])
    save_wav(os.path.join(out_dir, "test_silence.wav"), combined, sr)
    print(f"  Saved: test_silence.wav    ({silence_s+tone_s+silence_s}s, mono, silence-tone-silence)")

    # 5. Quiet then loud (for compressor test)
    quiet = 0.05 * np.sin(2 * np.pi * 440 * t[:n//2])
    loud = 0.9 * np.sin(2 * np.pi * 440 * t[:n//2])
    dyn_range = np.concatenate([quiet, loud])
    save_wav(os.path.join(out_dir, "test_dynamic.wav"), dyn_range, sr)
    print(f"  Saved: test_dynamic.wav    ({duration}s, mono, quiet->loud)")


def main():
    parser = argparse.ArgumentParser(description="Generate PyAudioLab test WAV files")
    parser.add_argument("--out_dir", default=".", help="Output directory (default: current dir)")
    parser.add_argument("--sr", type=int, default=44100, help="Sample rate (default 44100)")
    args = parser.parse_args()

    print(f"[pyaudiolab] Generating test WAV files in: {os.path.abspath(args.out_dir)}")
    generate_all(args.out_dir, args.sr)
    print("[pyaudiolab] Done.")


if __name__ == "__main__":
    main()
