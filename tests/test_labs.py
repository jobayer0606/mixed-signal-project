"""
tests/test_labs.py — Tests for Signal Labs DSP calculations and API endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from server import app
from pyaudiolab.labs import (
    eval_waveform,
    calculate_beat_metrics,
    calculate_sampling_dsp,
    calculate_fourier_metrics,
    calculate_convolution_metrics,
    compute_discrete_convolution,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_eval_waveform():
    assert eval_waveform(0.0, "sine") == pytest.approx(0.0)
    assert eval_waveform(0.0, "square") == 1.0
    assert eval_waveform(3.5, "square") == -1.0
    assert eval_waveform(0.0, "triangle") == -1.0


def test_beat_metrics():
    res = calculate_beat_metrics(440.0, 444.0, 0.8, 0.8, "sine", "sine")
    assert res["beat_freq"] == 4.0
    assert res["carrier_freq"] == 442.0
    assert res["beat_period"] == 0.25
    assert res["state_title"] == "Acoustic Beat Pulse"
    assert res["is_valid_envelope"] is True


def test_sampling_dsp():
    safe_res = calculate_sampling_dsp(100.0, 1000.0)
    assert safe_res["status"] == "SAFE"
    assert safe_res["nyquist"] == 500.0

    alias_res = calculate_sampling_dsp(700.0, 1000.0)
    assert alias_res["status"] == "ALIASING"
    assert alias_res["alias_freq"] == 300.0


def test_fourier_metrics():
    res = calculate_fourier_metrics("square", 5, 0.8, 100.0)
    assert len(res["coeffs"]) == 5
    assert res["highest_harmonic"] == 9
    assert res["mse"] > 0
    assert res["status"] == "Gibbs Ringing Active"


def test_convolution_metrics():
    x = [1.0, 2.0, 1.0]
    h = [1.0, 1.0]
    res = calculate_convolution_metrics(x, h, 2)
    assert res["y"] == [1.0, 3.0, 3.0, 1.0]
    assert res["current_y"] == 3.0
    assert res["overlap_count"] == 2
    assert "y[2]" in res["math_str"]


def test_api_labs_endpoints(client):
    # 1. Beat endpoint
    r1 = client.post("/api/labs/beat", json={"f1": 440, "f2": 444, "a1": 0.8, "a2": 0.8})
    assert r1.status_code == 200
    assert r1.json()["beat_freq"] == 4.0

    # 2. Sampling endpoint
    r2 = client.post("/api/labs/sampling", json={"f": 700, "fs": 1000})
    assert r2.status_code == 200
    assert r2.json()["alias_freq"] == 300.0

    # 3. Fourier endpoint
    r3 = client.post("/api/labs/fourier", json={"shape": "square", "n_terms": 5, "amp": 0.8, "f0": 100})
    assert r3.status_code == 200
    assert r3.json()["highest_harmonic"] == 9

    # 4. Convolution endpoint
    r4 = client.post("/api/labs/convolution", json={"x": [1, 2, 1], "h": [1, 1], "n_index": 2})
    assert r4.status_code == 200
    assert r4.json()["current_y"] == 3.0


def test_frequency_explorer_metrics_and_api(client, tmp_path):
    import io
    import numpy as np
    from scipy.io import wavfile
    from pyaudiolab.labs import calculate_frequency_explorer_metrics

    sr = 44100
    t = np.linspace(0, 0.5, int(sr * 0.5), endpoint=False)
    # 200 Hz tone + 4000 Hz tone
    sig = 0.5 * np.sin(2 * np.pi * 200 * t) + 0.5 * np.sin(2 * np.pi * 4000 * t)
    sig_int16 = (sig * 32767).astype(np.int16)

    # Unit test DSP calculation
    metrics = calculate_frequency_explorer_metrics(
        sig, sr, filter_type="lowpass", low_freq=300.0, high_freq=3000.0, order=8
    )
    assert "spectrum_before" in metrics
    assert "spectrum_after" in metrics
    assert "response_curve" in metrics
    assert metrics["order"] == 8
    assert metrics["low_freq"] == 300.0

    # Test via API with uploaded audio
    buf = io.BytesIO()
    wavfile.write(buf, sr, sig_int16)
    buf.seek(0)

    upload_res = client.post(
        "/api/upload",
        files={"file": ("test_signal.wav", buf, "audio/wav")}
    )
    assert upload_res.status_code == 200
    file_id = upload_res.json()["file_id"]

    filt_res = client.post(
        "/api/labs/freq_filter",
        json={
            "file_id": file_id,
            "filter_type": "bandpass",
            "low_freq": 300.0,
            "high_freq": 3000.0,
            "order": 8,
            "normalize_audio": True,
        }
    )
    assert filt_res.status_code == 200
    data = filt_res.json()
    assert data["file_id"] == file_id
    assert "filtered_file_id" in data
    assert len(data["spectrum_before"]["bars"]) > 0
    assert len(data["spectrum_after"]["bars"]) > 0

    # Verify download of filtered file
    dl_res = client.get(f"/api/download/{data['filtered_file_id']}")
    assert dl_res.status_code == 200

