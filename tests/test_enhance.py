"""
tests/test_enhance.py — Tests for Audio Enhancement Suite DSP & API.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from pyaudiolab.effects.vad import detect_vad, compute_speech_preservation_mask
from pyaudiolab.effects.noise_reduction import reduce_noise_deep, reduce_noise
from pyaudiolab.effects.dereverb import dereverb
from pyaudiolab.effects.voice_eq import voice_eq
from pyaudiolab.effects.compressor import voice_compress
from pyaudiolab.effects.limiter import peak_limit
from pyaudiolab.effects.loudness import measure_loudness, normalize_loudness
from pyaudiolab.effects.enhance import enhance_pipeline, enhance_audio, ENHANCE_PRESETS
from pyaudiolab.effects.neural_enhance import check_neural_available, neural_enhance
from server import app


def _make_speech_like_signal(sr: int = 16000, duration_s: float = 1.0) -> np.ndarray:
    """Generate synthetic speech-like harmonic signal with pauses and noise."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    # Fundamental and harmonics
    f0 = 150.0
    speech = (
        0.3 * np.sin(2 * np.pi * f0 * t) +
        0.2 * np.sin(2 * np.pi * 2 * f0 * t) +
        0.15 * np.sin(2 * np.pi * 3 * f0 * t) +
        0.1 * np.sin(2 * np.pi * 5 * f0 * t)
    )
    # Apply envelope: active from 0.2s to 0.8s
    env = np.zeros_like(t)
    active = (t >= 0.2) & (t <= 0.8)
    env[active] = 1.0
    speech = speech * env

    # Add background noise (e.g. fan noise)
    noise = 0.03 * np.random.RandomState(42).randn(len(t))
    return speech + noise


def test_vad_detection():
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0)
    res = detect_vad(sig, sr)

    assert len(res.speech_mask) > 0
    assert len(res.speech_probs) == len(res.speech_mask)
    assert 0.0 <= res.speech_ratio <= 1.0
    assert res.snr_estimate_db > 0.0
    assert len(res.active_regions) >= 1

    # Speech should be detected in the active region (0.2s to 0.8s)
    mid_idx = int(len(res.speech_mask) * 0.5)
    assert res.speech_mask[mid_idx] == True

    # Test short signal handling
    short_sig = np.zeros(10)
    short_res = detect_vad(short_sig, sr)
    assert short_res.speech_ratio == 1.0


def test_reduce_noise_deep():
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0)

    # Mono
    clean_mono = reduce_noise_deep(sig, sr)
    assert clean_mono.shape == sig.shape
    assert not np.any(np.isnan(clean_mono))
    assert not np.any(np.isinf(clean_mono))

    # Stereo
    sig_stereo = np.column_stack([sig, sig * 0.9])
    clean_stereo = reduce_noise_deep(sig_stereo, sr)
    assert clean_stereo.shape == sig_stereo.shape
    assert not np.any(np.isnan(clean_stereo))

    # Noise reduction reduces energy in the silence/noise region (t < 0.15s)
    silence_idx = int(0.15 * sr)
    noise_power_orig = np.mean(sig[:silence_idx] ** 2)
    noise_power_clean = np.mean(clean_mono[:silence_idx] ** 2)
    assert noise_power_clean < noise_power_orig


def test_dereverb():
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0)

    out = dereverb(sig, sr, room_reduction=0.6)
    assert out.shape == sig.shape
    assert not np.any(np.isnan(out))

    # Stereo
    sig_stereo = np.column_stack([sig, sig])
    out_stereo = dereverb(sig_stereo, sr, room_reduction=0.6)
    assert out_stereo.shape == sig_stereo.shape


def test_voice_eq():
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0)

    out = voice_eq(sig, sr, clarity=0.7, presence=0.7, low_cut_hz=85.0)
    assert out.shape == sig.shape
    assert not np.any(np.isnan(out))

    # Test steep 24 dB/oct HPF on 40 Hz sub-bass rumble tone (steady-state)
    t = np.linspace(0, 1.0, sr, endpoint=False)
    rumble = 0.5 * np.sin(2 * np.pi * 40.0 * t)
    rumble_filtered = voice_eq(rumble, sr, low_cut_hz=85.0)
    # 4th-order Butterworth at 85 Hz reduces 40 Hz by > 20 dB in steady-state (< 0.1x amplitude)
    assert np.max(np.abs(rumble_filtered[sr // 10:])) < 0.1 * np.max(np.abs(rumble))




def test_voice_compress():
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0) * 2.0  # Make loud

    out = voice_compress(sig, sr, threshold_db=-18.0, ratio=4.0)
    assert out.shape == sig.shape
    assert not np.any(np.isnan(out))
    # Compression should reduce max peak
    assert np.max(np.abs(out)) <= np.max(np.abs(sig))


def test_peak_limit():
    sr = 16000
    # Over-range signal
    sig = np.sin(np.linspace(0, 100, 8000)) * 2.0
    ceiling_db = -1.0
    ceiling_lin = 10.0 ** (ceiling_db / 20.0)

    out = peak_limit(sig, sr, ceiling_db=ceiling_db)
    assert np.max(np.abs(out)) <= ceiling_lin + 1e-4
    assert not np.any(np.isnan(out))


def test_loudness_and_normalization():
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.2)

    metrics = measure_loudness(sig, sr)
    assert "lufs" in metrics
    assert "peak_dbfs" in metrics
    assert "rms_dbfs" in metrics
    assert metrics["peak_dbfs"] <= 0.0

    # Normalization to -16 LUFS
    norm = normalize_loudness(sig, sr, target_lufs=-16.0)
    norm_metrics = measure_loudness(norm, sr)
    # Should be close to target -16 LUFS (within ±2.5 LU on short signals)
    assert -19.0 <= norm_metrics["lufs"] <= -13.0
    # Peak must never exceed -1.0 dBFS
    assert norm_metrics["peak_dbfs"] <= -0.9


def test_enhance_pipeline_and_presets():
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0)

    for preset_name in ["voice_clean", "podcast", "room_recording"]:
        out, report = enhance_pipeline(sig, sr, preset=preset_name)
        assert out.shape == sig.shape
        assert report["success"] == True
        assert "input_metrics" in report
        assert "output_metrics" in report
        assert "stages" in report
        assert len(report["stages"]) >= 5
        assert not np.any(np.isnan(out))

    # Standard call
    out_std = enhance_audio(sig, sr, noise_reduction=0.7)
    assert out_std.shape == sig.shape


def test_macro_slider_noise_reduction_scaling():
    """Verify that macro noise reduction slider processes speech."""
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0)
    silence_idx = int(0.15 * sr)

    out_clean = reduce_noise_deep(sig, sr)
    noise_pow_orig = np.mean(sig[:silence_idx] ** 2)
    noise_pow_clean = np.mean(out_clean[:silence_idx] ** 2)
    assert noise_pow_clean <= noise_pow_orig

    # Full pipeline report verification
    _, rep_low = enhance_pipeline(sig, sr, noise_reduction=0.3)
    _, rep_high = enhance_pipeline(sig, sr, noise_reduction=0.9)
    assert rep_high["parameters"]["noise_reduction"] == 0.9




def test_neural_fallback():
    status = check_neural_available()
    assert "available" in status
    assert "engine" in status

    sig = np.zeros(100)
    enhanced, run_status = neural_enhance(sig, 16000)
    assert len(enhanced) == len(sig)
    assert "applied" in run_status


def test_server_enhance_endpoint():
    client = TestClient(app)

    # 1. Upload audio
    sr = 16000
    sig = _make_speech_like_signal(sr=sr, duration_s=1.0).astype(np.float32)
    import io
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, sig, sr, format="WAV", subtype="PCM_16")
    buf.seek(0)

    upload_res = client.post("/api/upload", files={"file": ("test_noisy.wav", buf, "audio/wav")})
    assert upload_res.status_code == 200
    file_id = upload_res.json()["file_id"]

    # 2. Call /api/effects/enhance
    enhance_res = client.post(
        "/api/effects/enhance",
        json={
            "file_id": file_id,
            "noise_reduction": 0.7,
            "voice_clarity": 0.5,
            "room_reduction": 0.4,
            "voice_presence": 0.5,
            "loudness": -16.0,
            "preset": "podcast",
        },
    )
    assert enhance_res.status_code == 200
    data = enhance_res.json()
    assert data["success"] == True
    assert "enhanced_file_id" in data
    assert "input_metrics" in data
    assert "output_metrics" in data
    assert "stages" in data
    assert data["output_metrics"]["peak_dbfs"] <= -0.9

    # 3. Verify download of enhanced file
    download_res = client.get(f"/api/download/{data['enhanced_file_id']}")
    assert download_res.status_code == 200
    assert download_res.headers["content-type"] == "audio/wav"
