"""
PyAudioLab — Lightweight Python Audio Effects Editor
"""

from pyaudiolab.io_utils import load_wav, save_wav
from pyaudiolab.effects import EFFECT_REGISTRY
from pyaudiolab.spectral import compute_spectrum, compute_spectrogram
from pyaudiolab.labs import (
    calculate_beat_metrics,
    calculate_sampling_dsp,
    calculate_fourier_metrics,
    calculate_convolution_metrics,
)
from pyaudiolab.speed_pitch_dsp import (
    fft,
    analyzeMovingFrame,
    wsolaTimeStretch,
    computeResampledBuffer,
    evaluateAliasingState,
    generateSynthetic440,
    analyze_moving_frame,
    wsola_time_stretch,
    compute_resampled_buffer,
    evaluate_aliasing_state,
    generate_synthetic_440,
)

__version__ = "0.1.0"
__all__ = [
    "load_wav",
    "save_wav",
    "EFFECT_REGISTRY",
    "compute_spectrum",
    "compute_spectrogram",
    "calculate_beat_metrics",
    "calculate_sampling_dsp",
    "calculate_fourier_metrics",
    "calculate_convolution_metrics",
    "fft",
    "analyzeMovingFrame",
    "wsolaTimeStretch",
    "computeResampledBuffer",
    "evaluateAliasingState",
    "generateSynthetic440",
    "analyze_moving_frame",
    "wsola_time_stretch",
    "compute_resampled_buffer",
    "evaluate_aliasing_state",
    "generate_synthetic_440",
]

