"""
cli.py — PyAudioLab command-line interface.

Usage:
    python -m pyaudiolab.cli input.wav output.wav --effect gain --gain_db 6
    python -m pyaudiolab.cli input.wav output.wav --effect gain,normalize,fade_out \\
        --gain_db 3 --target_db -1 --fade_out_ms 1000 --plot

Effect chain:
    Pass comma-separated effect names to --effect. They are applied left-to-right.
    Effect parameters are passed as flat keyword arguments on the CLI.

Supported effects and their parameters:
    gain            --gain_db (float, default 0)
    fade_in         --fade_in_ms (float) --fade_curve (linear|exponential)
    fade_out        --fade_out_ms (float) --fade_curve (linear|exponential)
    normalize       --target_db (float) --norm_mode (peak|rms)
    reverse         (no params)
    invert          (no params)
    trim_silence    --threshold_db (float) --window_ms (float)
    hard_limit      --threshold_db (float)
    soft_clip       --threshold_db (float)
    compress        --threshold_db --ratio --attack_ms --release_ms --makeup_db
    delay           --delay_ms --feedback --delay_mix
    change_speed    --speed_factor
    time_stretch    --stretch_factor --window_size --hop_length
    eq              --eq_gains (10 comma-separated dB values, e.g. "0,0,3,0,-3,0,0,0,0,0")
    distort         --drive_db --distort_mode (soft|hard) --distort_mix
    reverb          --room_size --damping --reverb_mix
    noise_reduction --noise_dur_ms --nr_strength --nr_floor
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np

from pyaudiolab.io_utils import load_wav, save_wav
from pyaudiolab.effects import EFFECT_REGISTRY
from pyaudiolab.visualize import plot_before_after, plot_spectrum


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pyaudiolab",
        description="PyAudioLab — Lightweight Python Audio Effects Editor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("input", help="Input WAV file path")
    p.add_argument("output", help="Output WAV file path")
    p.add_argument(
        "--effect",
        required=True,
        help="Comma-separated effect chain, e.g. gain,normalize,fade_out",
    )
    p.add_argument("--plot", action="store_true", help="Save before/after waveform PNGs to ./plots/")
    p.add_argument("--plot_dir", default="plots", help="Directory for plot output (default: plots/)")

    # --- Gain ---
    p.add_argument("--gain_db", type=float, default=0.0, help="Gain in dB (default 0)")

    # --- Fades ---
    p.add_argument("--fade_in_ms", type=float, default=500.0, help="Fade-in duration in ms (default 500)")
    p.add_argument("--fade_out_ms", type=float, default=500.0, help="Fade-out duration in ms (default 500)")
    p.add_argument("--fade_curve", choices=["linear", "exponential"], default="linear",
                   help="Fade curve shape (default linear)")

    # --- Normalize ---
    p.add_argument("--target_db", type=float, default=-1.0, help="Normalize target in dBFS (default -1)")
    p.add_argument("--norm_mode", choices=["peak", "rms"], default="peak",
                   help="Normalize mode: peak or rms (default peak)")

    # --- Trim Silence ---
    p.add_argument("--threshold_db", type=float, default=-40.0,
                   help="Silence threshold dBFS for trim/limit (default -40)")
    p.add_argument("--window_ms", type=float, default=20.0,
                   help="Analysis window ms for silence trim (default 20)")

    # --- Dynamics ---
    p.add_argument("--ratio", type=float, default=4.0, help="Compressor ratio (default 4)")
    p.add_argument("--attack_ms", type=float, default=10.0, help="Compressor attack ms (default 10)")
    p.add_argument("--release_ms", type=float, default=100.0, help="Compressor release ms (default 100)")
    p.add_argument("--makeup_db", type=float, default=0.0, help="Compressor make-up gain dB (default 0)")

    # --- Delay ---
    p.add_argument("--delay_ms", type=float, default=250.0, help="Delay time ms (default 250)")
    p.add_argument("--feedback", type=float, default=0.4, help="Delay feedback [0,0.95] (default 0.4)")
    p.add_argument("--delay_mix", type=float, default=0.5, help="Delay wet/dry mix [0,1] (default 0.5)")

    # --- Speed / Time Stretch ---
    p.add_argument("--speed_factor", type=float, default=1.0, help="Speed change factor (default 1)")
    p.add_argument("--stretch_factor", type=float, default=1.0, help="Time-stretch factor (default 1)")
    p.add_argument("--window_size", type=int, default=2048, help="STFT window size for time-stretch (default 2048)")
    p.add_argument("--hop_length", type=int, default=512, help="STFT hop for time-stretch (default 512)")

    # --- EQ ---
    p.add_argument("--eq_gains",
                   default="0,0,0,0,0,0,0,0,0,0",
                   help="10 comma-separated EQ gains in dB (default all 0)")

    # --- Distortion ---
    p.add_argument("--drive_db", type=float, default=12.0, help="Distortion drive in dB (default 12)")
    p.add_argument("--distort_mode", choices=["soft", "hard"], default="soft",
                   help="Distortion mode: soft|hard (default soft)")
    p.add_argument("--distort_mix", type=float, default=1.0, help="Distortion wet/dry mix (default 1)")

    # --- Reverb ---
    p.add_argument("--room_size", type=float, default=0.5, help="Reverb room size [0.1,1.0] (default 0.5)")
    p.add_argument("--damping", type=float, default=0.5, help="Reverb damping [0,1] (default 0.5)")
    p.add_argument("--reverb_mix", type=float, default=0.3, help="Reverb wet/dry mix (default 0.3)")

    # --- Noise Reduction ---
    p.add_argument("--noise_dur_ms", type=float, default=500.0,
                   help="Noise profile estimation duration ms (default 500)")
    p.add_argument("--nr_strength", type=float, default=1.0, help="Noise reduction strength (default 1)")
    p.add_argument("--nr_floor", type=float, default=0.002, help="Spectral floor fraction (default 0.002)")

    return p


def _build_effect_kwargs(effect_name: str, args: argparse.Namespace) -> dict:
    """Map parsed CLI args to the correct kwargs for each effect."""
    mapping = {
        "gain": {"gain_db": args.gain_db},
        "fade_in": {"duration_ms": args.fade_in_ms, "curve": args.fade_curve},
        "fade_out": {"duration_ms": args.fade_out_ms, "curve": args.fade_curve},
        "normalize": {"target_db": args.target_db, "mode": args.norm_mode},
        "reverse": {},
        "invert": {},
        "trim_silence": {"threshold_db": args.threshold_db, "window_ms": args.window_ms},
        "hard_limit": {"threshold_db": args.threshold_db},
        "soft_clip": {"threshold_db": args.threshold_db},
        "compress": {
            "threshold_db": args.threshold_db,
            "ratio": args.ratio,
            "attack_ms": args.attack_ms,
            "release_ms": args.release_ms,
            "makeup_db": args.makeup_db,
        },
        "delay": {"delay_ms": args.delay_ms, "feedback": args.feedback, "mix": args.delay_mix},
        "change_speed": {"factor": args.speed_factor},
        "time_stretch": {
            "factor": args.stretch_factor,
            "window_size": args.window_size,
            "hop_length": args.hop_length,
        },
        "eq": {"gains_db": [float(x) for x in args.eq_gains.split(",")]},
        "distort": {
            "drive_db": args.drive_db,
            "mode": args.distort_mode,
            "mix": args.distort_mix,
        },
        "reverb": {"room_size": args.room_size, "damping": args.damping, "mix": args.reverb_mix},
        "noise_reduction": {
            "noise_duration_ms": args.noise_dur_ms,
            "strength": args.nr_strength,
            "floor": args.nr_floor,
        },
    }
    if effect_name not in mapping:
        raise ValueError(f"Unknown effect: {effect_name!r}. Available: {list(EFFECT_REGISTRY.keys())}")
    return mapping[effect_name]


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    # --- Load ---
    print(f"[pyaudiolab] Loading: {args.input}")
    try:
        audio, sr = load_wav(args.input)
    except Exception as exc:
        print(f"[ERROR] Could not load {args.input!r}: {exc}", file=sys.stderr)
        return 1

    original = audio.copy()
    print(f"  Channels: {'stereo' if audio.ndim == 2 else 'mono'}, "
          f"Sample rate: {sr} Hz, "
          f"Duration: {audio.shape[0] / sr:.3f} s")

    # --- Effect chain ---
    effects = [e.strip() for e in args.effect.split(",") if e.strip()]
    print(f"[pyaudiolab] Applying effect chain: {' -> '.join(effects)}")

    for effect_name in effects:
        if effect_name not in EFFECT_REGISTRY:
            print(f"[ERROR] Unknown effect: {effect_name!r}", file=sys.stderr)
            return 1

        effect_fn = EFFECT_REGISTRY[effect_name]
        kwargs = _build_effect_kwargs(effect_name, args)
        print(f"  Applying: {effect_name}({', '.join(f'{k}={v}' for k, v in kwargs.items())})")

        try:
            audio = effect_fn(audio, sr, **kwargs)
        except Exception as exc:
            print(f"[ERROR] Effect {effect_name!r} failed: {exc}", file=sys.stderr)
            return 1

    # --- Save ---
    print(f"[pyaudiolab] Saving: {args.output}")
    try:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        save_wav(args.output, audio, sr)
    except Exception as exc:
        print(f"[ERROR] Could not save {args.output!r}: {exc}", file=sys.stderr)
        return 1

    print(f"  Done. Output duration: {audio.shape[0] / sr:.3f} s")

    # --- Plot ---
    if args.plot:
        os.makedirs(args.plot_dir, exist_ok=True)
        chain_label = "_".join(effects)

        # Waveform plot
        wav_path = os.path.join(args.plot_dir, f"{chain_label}_waveform.png")
        plot_before_after(original, audio, sr, chain_label, wav_path)
        print(f"[pyaudiolab] Waveform plot saved: {wav_path}")

        # Spectrum plot
        spec_path = os.path.join(args.plot_dir, f"{chain_label}_spectrum.png")
        plot_spectrum(original, audio, sr, chain_label, spec_path)
        print(f"[pyaudiolab] Spectrum plot saved: {spec_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
