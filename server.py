"""
server.py — FastAPI backend for PyAudioLab Web Audio Editor.

Endpoints:
    POST /api/upload          — Upload a WAV file, returns file_id and metadata.
    POST /api/effects/{name}  — Apply effect to file_id, returns new file_id + metadata.
    GET  /api/download/{file_id} — Stream/download WAV file.
    GET  /api/info/{file_id}   — Get metadata for file_id.
    GET  /api/effects         — List all available effects and their default parameters.
"""

from __future__ import annotations

import os
import time
import uuid
import asyncio
import logging
import tempfile
import shutil
from contextlib import asynccontextmanager
from typing import Dict, Any, List

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pyaudiolab.io_utils import load_wav, save_wav, info
from pyaudiolab.effects import EFFECT_REGISTRY
from pyaudiolab.effects.enhance import enhance_pipeline, ENHANCE_PRESETS
from pyaudiolab.spectral import compute_spectrum, compute_spectrogram
from pyaudiolab.labs import (
    calculate_beat_metrics,
    calculate_sampling_dsp,
    calculate_fourier_metrics,
    calculate_convolution_metrics,
    calculate_frequency_explorer_metrics,
)
from pyaudiolab.speed_pitch_dsp import (
    fft,
    analyzeMovingFrame,
    wsolaTimeStretch,
    computeResampledBuffer,
    evaluateAliasingState,
    generateSynthetic440,
)

logger = logging.getLogger("pyaudiolab.server")

# Session files older than this are deleted by the cleanup task.
SESSION_TTL_SECONDS = int(os.environ.get("PYAUDIOLAB_SESSION_TTL", 30 * 60))  # 30 min
CLEANUP_INTERVAL_SECONDS = int(os.environ.get("PYAUDIOLAB_CLEANUP_INTERVAL", 5 * 60))  # 5 min


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run one pass immediately so a restarted server doesn't wait a full
    # interval before clearing out files left over from a previous run.
    cleanup_expired_sessions()
    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()


app = FastAPI(title="PyAudioLab Web API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = os.path.join(tempfile.gettempdir(), "pyaudiolab_web")
os.makedirs(TEMP_DIR, exist_ok=True)


def cleanup_expired_sessions(ttl_seconds: int = SESSION_TTL_SECONDS) -> int:
    """Delete session WAV files in TEMP_DIR older than ttl_seconds.

    Every upload and every effect application writes a *new* WAV file (see
    apply_effect_endpoint), so without this the temp directory grows without
    bound on a long-running server. Returns the number of files removed.
    """
    removed = 0
    now = time.time()
    try:
        entries = os.listdir(TEMP_DIR)
    except FileNotFoundError:
        return 0

    for entry in entries:
        if not entry.endswith(".wav"):
            continue
        path = os.path.join(TEMP_DIR, entry)
        try:
            if now - os.path.getmtime(path) > ttl_seconds:
                os.remove(path)
                removed += 1
        except OSError as e:
            logger.warning("Failed to remove expired session file %s: %s", path, e)

    if removed:
        logger.info("Cleanup: removed %d expired session file(s) from %s", removed, TEMP_DIR)
    return removed


async def _cleanup_loop() -> None:
    """Background task: periodically purge expired session files."""
    while True:
        try:
            cleanup_expired_sessions()
        except Exception as e:
            logger.warning("Session cleanup pass failed: %s", e)
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)


class EffectRequest(BaseModel):
    file_id: str
    params: Dict[str, Any] = {}
    selection: Dict[str, float] | None = None  # {start_s: float, end_s: float}


class EnhanceRequest(BaseModel):
    file_id: str
    noise_reduction: float = 0.70
    voice_clarity: float = 0.50
    room_reduction: float = 0.45
    voice_presence: float = 0.50
    loudness: float = -16.0
    neural_mode: bool = False
    preset: str | None = None
    params: Dict[str, Any] | None = None



class FftRequest(BaseModel):
    file_id: str
    num_bars: int = 48
    fft_size: int = 2048


class StftRequest(BaseModel):
    file_id: str
    target_cols: int = 360
    target_rows: int = 160
    fft_size: int = 1024


def _get_file_path(file_id: str) -> str:
    path = os.path.join(TEMP_DIR, f"{file_id}.wav")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Audio session '{file_id}' not found")
    return path


@app.post("/api/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload a WAV or MP3 file and store it in temporary session storage as WAV."""
    file_id = str(uuid.uuid4())
    save_path = os.path.join(TEMP_DIR, f"{file_id}.wav")

    filename_lower = (file.filename or "").lower()

    if filename_lower.endswith(".mp3"):
        # Convert MP3 to WAV using pydub
        try:
            from pydub import AudioSegment
        except ModuleNotFoundError as e:
            missing = getattr(e, "name", "") or str(e)
            if missing == "pydub":
                detail = (
                    "MP3 support requires the 'pydub' package. "
                    "Run: pip install pydub"
                )
            elif missing in ("audioop", "pyaudioop"):
                detail = (
                    "MP3 support needs the 'audioop' module, which was removed from "
                    "Python's standard library in 3.13+. On Python 3.13+, run: "
                    "pip install audioop-lts"
                )
            else:
                detail = f"MP3 support is missing a dependency: {missing}"
            raise HTTPException(status_code=400, detail=detail)

        try:
            audio_segment = AudioSegment.from_file(file.file, format="mp3")
            audio_segment.export(save_path, format="wav")
        except Exception as e:
            if os.path.exists(save_path):
                os.remove(save_path)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Failed to decode MP3 file: {str(e)}. This usually means "
                    f"ffmpeg is not installed or not on your PATH — pydub shells "
                    f"out to ffmpeg to decode MP3 audio. Install ffmpeg and make "
                    f"sure it's on PATH, then restart the server."
                ),
            )
    else:
        # Standard WAV save
        with open(save_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

    try:
        audio, sr = load_wav(save_path)
    except Exception as e:
        if os.path.exists(save_path):
            os.remove(save_path)
        raise HTTPException(status_code=400, detail=f"Failed to parse audio file: {str(e)}")

    duration_s = audio.shape[0] / sr
    channels = 2 if audio.ndim == 2 else 1

    return {
        "file_id": file_id,
        "filename": file.filename,
        "sample_rate": sr,
        "channels": channels,
        "frames": audio.shape[0],
        "duration_s": duration_s,
    }


@app.get("/api/info/{file_id}")
async def get_info(file_id: str):
    """Retrieve metadata for an audio session."""
    path = _get_file_path(file_id)
    return info(path)


@app.get("/api/download/{file_id}")
async def download_audio(file_id: str):
    """Download/Stream processed WAV file."""
    path = _get_file_path(file_id)
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=f"pyaudiolab_{file_id[:8]}.wav",
        headers={"Accept-Ranges": "bytes"}
    )


@app.get("/api/fft/{file_id}")
async def get_fft_spectrum(file_id: str, num_bars: int = 48, fft_size: int = 2048):
    """Compute FFT log-magnitude spectrum for an audio session."""
    path = _get_file_path(file_id)
    try:
        audio, sr = load_wav(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading audio: {str(e)}")
    return compute_spectrum(audio, sr, num_bars=num_bars, fft_size=fft_size)


@app.post("/api/fft")
async def post_fft_spectrum(req: FftRequest):
    """Compute FFT log-magnitude spectrum for an audio session (POST)."""
    return await get_fft_spectrum(req.file_id, req.num_bars, req.fft_size)


@app.get("/api/stft/{file_id}")
async def get_stft_spectrogram(
    file_id: str,
    target_cols: int = 360,
    target_rows: int = 160,
    fft_size: int = 1024,
):
    """Compute STFT spectrogram for an audio session."""
    path = _get_file_path(file_id)
    try:
        audio, sr = load_wav(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading audio: {str(e)}")
    return compute_spectrogram(
        audio,
        sr,
        target_cols=target_cols,
        target_rows=target_rows,
        fft_size=fft_size,
    )


@app.post("/api/stft")
async def post_stft_spectrogram(req: StftRequest):
    """Compute STFT spectrogram for an audio session (POST)."""
    return await get_stft_spectrogram(
        req.file_id,
        req.target_cols,
        req.target_rows,
        req.fft_size,
    )


@app.get("/api/effects")
async def list_effects():
    """List available DSP effects and metadata."""
    effects_info = {
        "gain": {"name": "Gain", "category": "Tier 1 — Basic", "params": {"gain_db": 3.0}},
        "fade_in": {"name": "Fade In", "category": "Tier 1 — Basic", "params": {"duration_ms": 500.0, "curve": "linear"}},
        "fade_out": {"name": "Fade Out", "category": "Tier 1 — Basic", "params": {"duration_ms": 500.0, "curve": "linear"}},
        "normalize": {"name": "Normalize", "category": "Tier 1 — Basic", "params": {"target_db": -1.0, "mode": "peak"}},
        "reverse": {"name": "Reverse", "category": "Tier 1 — Basic", "params": {}},
        "invert": {"name": "Invert Phase", "category": "Tier 1 — Basic", "params": {}},
        "trim_silence": {"name": "Trim Silence", "category": "Tier 1 — Basic", "params": {"threshold_db": -40.0, "window_ms": 20.0}},
        "hard_limit": {"name": "Hard Limiter", "category": "Tier 2 — Intermediate", "params": {"threshold_db": -6.0}},
        "soft_clip": {"name": "Soft Clipper", "category": "Tier 2 — Intermediate", "params": {"threshold_db": -6.0}},
        "compress": {"name": "Compressor", "category": "Tier 2 — Intermediate", "params": {"threshold_db": -20.0, "ratio": 4.0, "attack_ms": 10.0, "release_ms": 100.0, "makeup_db": 0.0}},
        "delay": {"name": "Delay / Echo", "category": "Tier 2 — Intermediate", "params": {"delay_ms": 250.0, "feedback": 0.4, "mix": 0.5}},
        "change_speed": {"name": "Speed / Rate", "category": "Tier 2 — Intermediate", "params": {"factor": 1.25}},
        "time_stretch": {"name": "Time Stretch (Pitch Preserved)", "category": "Tier 3 — Stretch Goals", "params": {"factor": 1.25, "window_size": 2048, "hop_length": 512}},
        "eq": {"name": "10-Band Graphic EQ", "category": "Tier 3 — Stretch Goals", "params": {"gains_db": [0.0]*10}},
        "freq_filter": {"name": "FFT Frequency Explorer", "category": "Tier 3 — Stretch Goals", "params": {"filter_type": "bandpass", "low_freq": 300.0, "high_freq": 3000.0, "order": 8, "gain_db": 0.0, "normalize_audio": True}},
        "distort": {"name": "Distortion", "category": "Tier 3 — Stretch Goals", "params": {"drive_db": 12.0, "mode": "soft", "mix": 1.0}},
        "reverb": {"name": "Schroeder Reverb", "category": "Tier 3 — Stretch Goals", "params": {"room_size": 0.5, "damping": 0.5, "mix": 0.3}},
        "noise_reduction": {"name": "Noise Reduction (FFT)", "category": "Tier 3 — Stretch Goals", "params": {"noise_duration_ms": 500.0, "strength": 1.0, "floor": 0.002}},
        "enhance": {
            "name": "Audio Enhancement Studio",
            "category": "Mastering Suite",
            "params": {
                "noise_reduction": 0.70,
                "voice_clarity": 0.50,
                "room_reduction": 0.45,
                "voice_presence": 0.50,
                "loudness": -16.0,
                "neural_mode": False,
                "preset": "podcast",
            },
        },
    }
    return effects_info


@app.post("/api/effects/enhance")
async def enhance_endpoint(req: EnhanceRequest):
    """Full-stack mastering audio enhancement endpoint."""
    in_path = _get_file_path(req.file_id)

    try:
        audio, sr = load_wav(in_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading audio: {str(e)}")

    # Unpack parameters, allowing req.params dictionary to take precedence if provided
    params = req.params or {}
    noise_reduction = float(params.get("noise_reduction", req.noise_reduction))
    voice_clarity = float(params.get("voice_clarity", req.voice_clarity))
    room_reduction = float(params.get("room_reduction", req.room_reduction))
    voice_presence = float(params.get("voice_presence", req.voice_presence))
    loudness = float(params.get("loudness", req.loudness))
    neural_mode = bool(params.get("neural_mode", req.neural_mode))
    preset = params.get("preset", req.preset)

    try:
        enhanced_audio, report = enhance_pipeline(
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
    except Exception as e:
        logger.exception("Enhancement pipeline failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {str(e)}")

    new_file_id = str(uuid.uuid4())
    out_path = os.path.join(TEMP_DIR, f"{new_file_id}.wav")

    try:
        save_wav(out_path, enhanced_audio, sr)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving enhanced audio: {str(e)}")

    duration_s = enhanced_audio.shape[0] / sr
    channels = 2 if enhanced_audio.ndim == 2 else 1

    return {
        "file_id": req.file_id,
        "enhanced_file_id": new_file_id,
        "sample_rate": sr,
        "channels": channels,
        "frames": enhanced_audio.shape[0],
        "duration_s": duration_s,
        "input_metrics": report["input_metrics"],
        "output_metrics": report["output_metrics"],
        "parameters": report["parameters"],
        "neural_engine": report["neural_engine"],
        "stages": report["stages"],
        "success": True,
    }


@app.post("/api/effects/{name}")
async def apply_effect_endpoint(name: str, req: EffectRequest):
    """Apply DSP effect to audio file."""
    if name not in EFFECT_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Effect '{name}' is not supported")

    in_path = _get_file_path(req.file_id)
    effect_fn = EFFECT_REGISTRY[name]

    try:
        audio, sr = load_wav(in_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading audio: {str(e)}")

    params = req.params.copy()

    # Handle selection region if specified
    if req.selection and "start_s" in req.selection and "end_s" in req.selection:
        start_idx = max(0, int(req.selection["start_s"] * sr))
        end_idx = min(audio.shape[0], int(req.selection["end_s"] * sr))
        if start_idx < end_idx:
            selected_audio = audio[start_idx:end_idx]
            try:
                processed_selection = effect_fn(selected_audio, sr, **params)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Effect {name} failed: {str(e)}")

            # Stitch processed region back into full audio
            is_stereo = audio.ndim == 2
            p_is_stereo = processed_selection.ndim == 2

            if is_stereo == p_is_stereo:
                audio_out = np.concatenate([
                    audio[:start_idx],
                    processed_selection,
                    audio[end_idx:]
                ], axis=0)
            else:
                # Effect changed the channel layout of the selection (e.g. mono->stereo),
                # so it can't be stitched back into the surrounding audio. Fail loudly
                # instead of silently reprocessing the whole file with a different
                # scope than the user asked for.
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Effect '{name}' changed the channel layout of the selection "
                        f"(input {'stereo' if is_stereo else 'mono'} -> "
                        f"output {'stereo' if p_is_stereo else 'mono'}) and cannot be "
                        f"stitched back into the full track. Apply this effect without "
                        f"a selection instead."
                    ),
                )
        else:
            audio_out = effect_fn(audio, sr, **params)
    else:
        try:
            audio_out = effect_fn(audio, sr, **params)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Effect {name} failed: {str(e)}")

    new_file_id = str(uuid.uuid4())
    out_path = os.path.join(TEMP_DIR, f"{new_file_id}.wav")

    try:
        save_wav(out_path, audio_out, sr)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving processed audio: {str(e)}")

    duration_s = audio_out.shape[0] / sr
    channels = 2 if audio_out.ndim == 2 else 1

    return {
        "file_id": new_file_id,
        "sample_rate": sr,
        "channels": channels,
        "frames": audio_out.shape[0],
        "duration_s": duration_s,
    }


# =========================================================================
# Signal Labs API Endpoints (Pure Python DSP Calculations)
# =========================================================================

class BeatLabRequest(BaseModel):
    f1: float = 440.0
    f2: float = 444.0
    a1: float = 0.8
    a2: float = 0.8
    shape1: str = "sine"
    shape2: str = "sine"
    time_window_ms: float = 25.0


class SamplingLabRequest(BaseModel):
    f: float = 700.0
    fs: float = 1000.0
    amp: float = 0.8
    shape: str = "sine"
    time_window_ms: float = 15.0


class FourierLabRequest(BaseModel):
    shape: str = "square"
    n_terms: int = 5
    amp: float = 0.8
    f0: float = 100.0
    time_window_ms: float = 20.0


class ConvolutionLabRequest(BaseModel):
    x: List[float] = [1.0, 2.0, 1.0]
    h: List[float] = [1.0, 1.0]
    n_index: int = 2
    mode: str = "discrete"


@app.post("/api/labs/beat")
async def api_labs_beat(req: BeatLabRequest):
    """Calculate wave interference & beat frequency metrics."""
    return calculate_beat_metrics(
        f1=req.f1,
        f2=req.f2,
        a1=req.a1,
        a2=req.a2,
        shape1=req.shape1,
        shape2=req.shape2,
        time_window_ms=req.time_window_ms,
    )


@app.post("/api/labs/sampling")
async def api_labs_sampling(req: SamplingLabRequest):
    """Calculate sampling, aliasing & Nyquist metrics."""
    return calculate_sampling_dsp(
        f=req.f,
        fs=req.fs,
        amp=req.amp,
        shape=req.shape,
        time_window_ms=req.time_window_ms,
    )


@app.post("/api/labs/fourier")
async def api_labs_fourier(req: FourierLabRequest):
    """Calculate Fourier series harmonic expansion & error metrics."""
    return calculate_fourier_metrics(
        shape=req.shape,
        n_terms=req.n_terms,
        amp=req.amp,
        f0=req.f0,
        time_window_ms=req.time_window_ms,
    )


@app.post("/api/labs/convolution")
async def api_labs_convolution(req: ConvolutionLabRequest):
    """Calculate discrete linear convolution and step mathematical derivation."""
    return calculate_convolution_metrics(
        x_seq=req.x,
        h_seq=req.h,
        n_index=req.n_index,
        mode=req.mode,
    )


class FreqFilterLabRequest(BaseModel):
    file_id: str
    filter_type: str = "bandpass"
    low_freq: float = 300.0
    high_freq: float = 3000.0
    order: int = 8
    normalize_audio: bool = True
    num_bars: int = 64


@app.post("/api/labs/freq_filter")
async def api_labs_freq_filter(req: FreqFilterLabRequest):
    """Calculate Frequency Range Explorer FFT spectra and filtered audio for playback."""
    in_path = _get_file_path(req.file_id)
    try:
        audio, sr = load_wav(in_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading audio: {str(e)}")

    try:
        metrics = calculate_frequency_explorer_metrics(
            audio,
            sr,
            filter_type=req.filter_type,
            low_freq=req.low_freq,
            high_freq=req.high_freq,
            order=req.order,
            normalize_audio=req.normalize_audio,
            num_bars=req.num_bars,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Filtering failed: {str(e)}")

    filtered_audio = metrics.pop("filtered_audio")
    filtered_file_id = str(uuid.uuid4())
    out_path = os.path.join(TEMP_DIR, f"{filtered_file_id}.wav")

    try:
        save_wav(out_path, filtered_audio, sr)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving filtered audio: {str(e)}")

    return {
        "file_id": req.file_id,
        "filtered_file_id": filtered_file_id,
        **metrics,
    }


class SpeedPitchLabRequest(BaseModel):
    file_id: Optional[str] = None
    speed_factor: float = 1.0
    target_fs: Optional[float] = None
    resample_mode: str = "naive"  # "naive" | "smart"
    time_sec: float = 0.5


@app.post("/api/labs/speed_pitch")
async def api_labs_speed_pitch(req: SpeedPitchLabRequest):
    """Calculate speed, pitch, resampling, FFT spectra and aliasing status."""
    if req.file_id:
        in_path = _get_file_path(req.file_id)
        try:
            audio, sr = load_wav(in_path)
            if audio.ndim > 1:
                audio = audio[:, 0]
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error reading audio: {str(e)}")
    else:
        sr = 44100
        audio = generateSynthetic440(sampleRate=sr, duration=2.0)

    try:
        resampled = computeResampledBuffer(
            audio,
            speedFactor=req.speed_factor,
            targetFs=req.target_fs,
            resampleMode=req.resample_mode,
            sampleRate=sr,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Resampling failed: {str(e)}")

    orig_spec = analyzeMovingFrame(audio, req.time_sec, sampleRate=sr)
    proc_spec = analyzeMovingFrame(resampled, req.time_sec, sampleRate=sr)

    aliasing = evaluateAliasingState(
        origPeakFreq=orig_spec["peakFreq"],
        procPeakFreq=proc_spec["peakFreq"],
        targetFs=req.target_fs or sr,
        speedFactor=req.speed_factor,
        resampleMode=req.resample_mode,
    )

    proc_file_id = str(uuid.uuid4())
    out_path = os.path.join(TEMP_DIR, f"{proc_file_id}.wav")
    try:
        save_wav(out_path, resampled, sr)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving resampled audio: {str(e)}")

    return {
        "file_id": req.file_id,
        "processed_file_id": proc_file_id,
        "orig_duration": len(audio) / sr,
        "proc_duration": len(resampled) / sr,
        "orig_spec": orig_spec,
        "proc_spec": proc_spec,
        "aliasing": aliasing,
    }


# Mount sample_wavs so the frontend's "Samples" menu can fetch bundled demo

# files directly (e.g. GET /sample_wavs/test_sine_mono.wav). Must be mounted
# before the catch-all "/" static mount below.
sample_wavs_dir = os.path.join(os.path.dirname(__file__), "sample_wavs")
if os.path.isdir(sample_wavs_dir):
    app.mount("/sample_wavs", StaticFiles(directory=sample_wavs_dir), name="sample_wavs")

# Mount static directory for frontend
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
