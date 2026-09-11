"""
PyAudioLab — Lightweight Python Audio Effects Editor
"""

from pyaudiolab.io_utils import load_wav, save_wav
from pyaudiolab.effects import EFFECT_REGISTRY
from pyaudiolab.spectral import compute_spectrum, compute_spectrogram

__version__ = "0.1.0"
__all__ = ["load_wav", "save_wav", "EFFECT_REGISTRY", "compute_spectrum", "compute_spectrogram"]
