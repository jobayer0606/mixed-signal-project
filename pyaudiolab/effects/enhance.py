"""
effects/enhance.py — Master Professional Audio Enhancement Orchestrator.

Pipeline:
    Upload → Analyze → VAD / Speech Detection → Adaptive Noise Reduction →
    De-Reverb → Voice EQ → Dynamic Compression → Lookahead Limiter →
    Loudness Normalization (-16 LUFS) → Metrics Comparison.

Presets:
    - Voice Clean: Maximum noise reduction, moderate room reduction, balanced clarity.
    - Podcast: Studio broadcast balance, crisp presence, warmth, -16 LUFS mastering.
    - Video Dialogue: Intelligibility focus for dialogue cutting through music/SFX.
    - Room Recording: Deep de-reverberation & boxiness suppression for echoey rooms.
    - Lecture: High noise reduction and intelligibility boost for distant microphones.
    - Studio Voice: Gentle, transparent polish for already decent microphone recordings.
"""

from __future__ import annotations
from typing import Dict, Any, Tuple
import numpy as np

from pyaudiolab.effects.vad import detect_vad
from pyaudiolab.effects.noise_reduction import reduce_noise_deep
from pyaudiolab.effects.dereverb import dereverb
from pyaudiolab.effects.voice_eq import voice_eq
from pyaudiolab.effects.compressor import voice_compress
from pyaudiolab.effects.limiter import peak_limit
from pyaudiolab.effects.loudness import measure_loudness, normalize_loudness
from pyaudiolab.effects.neural_enhance import check_neural_available, neural_enhance

ENHANCE_PRESETS = {
    "voice_clean": {
        "name": "Voice Clean",
        "description": "High background noise reduction with gentle room dampening.",
        "noise_reduction": 0.90,
        "voice_clarity": 0.50,
        "room_reduction": 0.40,
        "voice_presence": 0.45,
        "loudness": -16.0,
    },
    "podcast": {
        "name": "Podcast",
        "description": "Classic broadcast warmth, enhanced articulation, and standard -16 LUFS loudness.",
        "noise_reduction": 0.75,
        "voice_clarity": 0.65,
        "room_reduction": 0.45,
        "voice_presence": 0.60,
        "loudness": -16.0,
    },
    "video_dialogue": {
        "name": "Video Dialogue",
        "description": "Crisp speech presence and controlled dynamics tailored for video mixes.",
        "noise_reduction": 0.70,
        "voice_clarity": 0.70,
        "room_reduction": 0.35,
        "voice_presence": 0.55,
        "loudness": -15.0,
    },
    "room_recording": {
        "name": "Room Recording",
        "description": "Heavy de-reverberation and boxiness suppression for echoey, untreated spaces.",
        "noise_reduction": 0.85,
        "voice_clarity": 0.50,
        "room_reduction": 0.85,
        "voice_presence": 0.45,
        "loudness": -16.0,
    },
    "lecture": {
        "name": "Lecture",
        "description": "Aggressive noise suppression and high presence boost for far-field recordings.",
        "noise_reduction": 0.95,
        "voice_clarity": 0.60,
        "room_reduction": 0.65,
        "voice_presence": 0.70,
        "loudness": -16.0,
    },
    "studio_voice": {
        "name": "Studio Voice",
        "description": "Subtle, transparent warming and leveling for quality microphones.",
        "noise_reduction": 0.40,
        "voice_clarity": 0.60,
        "room_reduction": 0.25,
        "voice_presence": 0.70,
        "loudness": -16.0,
    },
}


def enhance_pipeline(
    audio: np.ndarray,
    sr: int,
    *,
    noise_reduction: float = 0.75,
    voice_clarity: float = 0.50,
    room_reduction: float = 0.45,
    voice_presence: float = 0.50,
    loudness: float = -16.0,
    neural_mode: bool = False,
    preset: str | None = None,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Master enhancement orchestrator executing the full DSP mastering chain.

    Returns:
        Tuple of (enhanced_audio_array, detailed_analysis_dict).
    """
    # Apply preset overrides if specified
    if preset and preset in ENHANCE_PRESETS:
        p_cfg = ENHANCE_PRESETS[preset]
        noise_reduction = p_cfg.get("noise_reduction", noise_reduction)
        voice_clarity = p_cfg.get("voice_clarity", voice_clarity)
        room_reduction = p_cfg.get("room_reduction", room_reduction)
        voice_presence = p_cfg.get("voice_presence", voice_presence)
        loudness = p_cfg.get("loudness", loudness)

    noise_reduction = float(np.clip(noise_reduction, 0.0, 1.0))
    voice_clarity = float(np.clip(voice_clarity, 0.0, 1.0))
    room_reduction = float(np.clip(room_reduction, 0.0, 1.0))
    voice_presence = float(np.clip(voice_presence, 0.0, 1.0))
    loudness = float(np.clip(loudness, -24.0, -10.0))

    stages_executed = []

    # 1. Analyze input audio & VAD
    stages_executed.append("Analyzing audio")
    vad_res = detect_vad(audio, sr)
    in_loudness = measure_loudness(audio, sr)

    input_metrics = {
        "lufs": in_loudness["lufs"],
        "peak_dbfs": in_loudness["peak_dbfs"],
        "rms_dbfs": in_loudness["rms_dbfs"],
        "snr_db": round(vad_res.snr_estimate_db, 1),
        "noise_floor_dbfs": round(vad_res.noise_floor_dbfs, 1),
        "speech_ratio": round(vad_res.speech_ratio * 100.0, 1),
    }

    current = audio.copy()

    # 2. Optional Neural Enhancement pass
    neural_status = check_neural_available()
    if neural_mode and neural_status["available"]:
        stages_executed.append("Neural spectral enhancement")
        current, _ = neural_enhance(current, sr)

    # 3. Detecting speech & Estimating noise
    stages_executed.append("Detecting speech & noise")

    # 4. Neural / Deep Noise Reduction
    if noise_reduction > 0.01:
        stages_executed.append("Removing noise (DeepFilterNet)")
        current = reduce_noise_deep(current, sr)

    # 5. Room De-Reverberation
    if room_reduction > 0.01:
        stages_executed.append("Reducing room reverberation")
        current = dereverb(
            current, sr, room_reduction=room_reduction, boxiness_cut=voice_clarity * 0.5
        )

    # 6. Voice EQ (with 85 Hz 24 dB/oct highpass rumble elimination)
    if voice_clarity > 0.01 or voice_presence > 0.01:
        stages_executed.append("Enhancing voice timbre & presence")
        current = voice_eq(
            current, sr, clarity=voice_clarity, presence=voice_presence, low_cut_hz=85.0
        )

    # 7. Voice Dynamic Compression
    stages_executed.append("Compressing dynamic range")
    # Subtle compression (2.5:1 to 3.5:1 ratio, 12ms attack)
    comp_ratio = 2.5 + 1.0 * voice_presence
    current = voice_compress(
        current, sr, threshold_db=-18.0, ratio=comp_ratio, attack_ms=12.0, release_ms=100.0
    )

    # 8. Loudness Normalization & Peak Protection (normalize_loudness performs true-peak limiting internally)
    stages_executed.append("Normalizing loudness to target LUFS")
    out_audio = normalize_loudness(current, sr, target_lufs=loudness)
    stages_executed.append("Peak limiting (-1.0 dBFS true peak)")

    # 9. Compute enhanced metrics
    out_loudness = measure_loudness(out_audio, sr)
    out_vad = detect_vad(out_audio, sr)

    # Compute actual noise reduction improvement
    noise_red_achieved_db = max(0.0, round(out_vad.snr_estimate_db - vad_res.snr_estimate_db, 1))

    output_metrics = {
        "lufs": out_loudness["lufs"],
        "peak_dbfs": out_loudness["peak_dbfs"],
        "rms_dbfs": out_loudness["rms_dbfs"],
        "snr_db": round(out_vad.snr_estimate_db, 1),
        "noise_floor_dbfs": round(out_vad.noise_floor_dbfs, 1),
        "snr_improvement_db": noise_red_achieved_db,
    }

    report = {
        "success": True,
        "input_metrics": input_metrics,
        "output_metrics": output_metrics,
        "parameters": {
            "noise_reduction": noise_reduction,
            "voice_clarity": voice_clarity,
            "room_reduction": room_reduction,
            "voice_presence": voice_presence,
            "loudness": loudness,
            "preset": preset,
            "neural_mode": neural_mode,
        },
        "neural_engine": neural_status,
        "stages": stages_executed,
    }

    return out_audio, report


def enhance_audio(
    audio: np.ndarray,
    sr: int,
    *,
    noise_reduction: float = 0.70,
    voice_clarity: float = 0.50,
    room_reduction: float = 0.45,
    voice_presence: float = 0.50,
    loudness: float = -16.0,
    neural_mode: bool = False,
    preset: str | None = None,
) -> np.ndarray:
    """Standard EFFECT_REGISTRY-compatible entrypoint returning only processed audio."""
    out_audio, _ = enhance_pipeline(
        audio,
        sr,
        noise_reduction=noise_reduction,
        voice_clarity=voice_clarity,
        room_reduction=room_reduction,
        voice_presence=voice_presence,
        loudness=loudness,
        neural_mode=neural_mode,
        preset=preset,
    )
    return out_audio
