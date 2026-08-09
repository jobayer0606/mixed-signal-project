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
from pyaudiolab.effects.noise_reduction import reduce_noise

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
    "distort": distort,
    "reverb": schroeder_reverb,
    "noise_reduction": reduce_noise,
}

__all__ = ["EFFECT_REGISTRY"]
