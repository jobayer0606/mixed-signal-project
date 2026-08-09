"""tests/test_server.py — FastAPI endpoint unit tests"""

import os
import pytest
from fastapi.testclient import TestClient
from server import app, TEMP_DIR

client = TestClient(app)


def test_list_effects():
    res = client.get("/api/effects")
    assert res.status_code == 200
    data = res.json()
    assert "gain" in data
    assert "normalize" in data
    assert "reverb" in data


def test_upload_and_process_effect(tmp_path):
    # Load sample mono sine wave from pyaudiolab generator
    import numpy as np
    from pyaudiolab.io_utils import save_wav

    sr = 44100
    t = np.linspace(0, 1.0, sr, endpoint=False)
    audio = 0.5 * np.sin(2 * np.pi * 440 * t)

    test_wav_path = str(tmp_path / "test.wav")
    save_wav(test_wav_path, audio, sr)

    with open(test_wav_path, "rb") as f:
        response = client.post("/api/upload", files={"file": ("test.wav", f, "audio/wav")})

    assert response.status_code == 200
    upload_data = response.json()
    assert "file_id" in upload_data
    file_id = upload_data["file_id"]

    # Test Info endpoint
    info_res = client.get(f"/api/info/{file_id}")
    assert info_res.status_code == 200

    # Test Gain Effect
    effect_res = client.post(
        "/api/effects/gain",
        json={"file_id": file_id, "params": {"gain_db": 6.0}}
    )
    assert effect_res.status_code == 200
    proc_data = effect_res.json()
    assert "file_id" in proc_data
    proc_file_id = proc_data["file_id"]

    # Test Download endpoint
    dl_res = client.get(f"/api/download/{proc_file_id}")
    assert dl_res.status_code == 200
    assert dl_res.headers["content-type"] == "audio/wav"
