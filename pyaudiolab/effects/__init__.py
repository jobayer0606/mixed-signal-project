"""
effects/__init__.py — Effect registry mapping CLI names to callables.

Every effect function has the signature:
    effect_fn(audio: np.ndarray, sr: int, **kwargs) -> np.ndarray
"""

from pyaudiolab.effects.gain import apply_gain
from pyaudiolab.effects.fades import fade_in, fade_out
from pyaudiolab.effects.normalize import normalize
from pyaudiolab.effects.basic import reverse, invert, trim_silence
from pyaudiolab.effects.dynamics import hard_limit, soft_clip, compress
from pyaudiolab.effects.delay import apply_delay
from pyaudiolab.effects.pitch_time import change_speed, time_stretch
from pyaudiolab.effects.eq import graphic_eq
from pyaudiolab.effects.distortion import distort
from pyaudiolab.effects.reverb import schroeder_reverb
from pyaudiolab.effects.noise_reduction import (
    reduce_noise,
    adaptive_noise_reduction,
    _noise_reduction,
    noise_reduction,
    reduce_noise_deep,
)
from pyaudiolab.effects.dereverb import dereverb
from pyaudiolab.effects.voice_eq import voice_eq
from pyaudiolab.effects.compressor import voice_compress
from pyaudiolab.effects.limiter import peak_limit
from pyaudiolab.effects.loudness import normalize_loudness
from pyaudiolab.effects.enhance import enhance_audio, enhance_pipeline
from pyaudiolab.effects.freq_filter import frequency_filter

# Maps CLI --effect names to functions
EFFECT_REGISTRY: dict = {
    # Tier 1
    "gain": apply_gain,
    "fade_in": fade_in,
    "fade_out": fade_out,
    "normalize": normalize,
    "reverse": reverse,
    "invert": invert,
    "trim_silence": trim_silence,
    # Tier 2
    "hard_limit": hard_limit,
    "soft_clip": soft_clip,
    "compress": compress,
    "delay": apply_delay,
    "change_speed": change_speed,
    "time_stretch": time_stretch,
    # Tier 3
    "eq": graphic_eq,
    "freq_filter": frequency_filter,
    "frequency_filter": frequency_filter,
    "distort": distort,
    "reverb": schroeder_reverb,
    "noise_reduction": reduce_noise_deep,
    # Professional Enhancement Suite
    "reduce_noise_deep": reduce_noise_deep,
    "adaptive_noise_reduction": reduce_noise_deep,
    "dereverb": dereverb,
    "voice_eq": voice_eq,
    "voice_compress": voice_compress,
    "peak_limit": peak_limit,
    "loudness": normalize_loudness,
    "enhance": enhance_audio,
}

__all__ = [
    "EFFECT_REGISTRY",
    "frequency_filter",
    "adaptive_noise_reduction",
    "dereverb",
    "voice_eq",
    "voice_compress",
    "peak_limit",
    "normalize_loudness",
    "enhance_audio",
    "enhance_pipeline",
]

