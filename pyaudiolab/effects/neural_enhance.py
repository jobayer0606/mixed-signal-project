"""
effects/neural_enhance.py — Optional Neural Enhancement Interface (DeepFilterNet / ONNX).

Design:
    Provides an extensible interface for deep-learning speech enhancement models
    (such as DeepFilterNet3 or ONNX Runtime speech denoisers) with zero hard dependencies.

    If a neural model / runtime is installed and compatible with the environment,
    it executes neural spectral enhancement. If not installed (or if running on Python
    versions where wheels are not yet distributed), it gracefully reports status and
    falls back to the Studio DSP enhancement chain without interruption.
"""

from __future__ import annotations
import logging
from typing import Tuple, Dict, Any
import numpy as np

logger = logging.getLogger("pyaudiolab.neural")


def check_neural_available() -> Dict[str, Any]:
    """Check if a neural speech enhancement engine is available in the current environment."""
    # 1. Try DeepFilterNet
    try:
        import df
        return {
            "available": True,
            "engine": "DeepFilterNet",
            "version": getattr(df, "__version__", "unknown"),
            "details": "DeepFilterNet neural speech enhancement available",
        }
    except Exception:
        pass

    # 2. Try ONNX Runtime
    try:
        import onnxruntime as ort
        return {
            "available": True,
            "engine": "ONNXRuntime",
            "version": ort.__version__,
            "details": "ONNX Runtime available for neural acoustic models",
        }
    except Exception:
        pass

    # 3. Try PyTorch
    try:
        import torch
        return {
            "available": True,
            "engine": "PyTorch",
            "version": torch.__version__,
            "details": "PyTorch runtime available",
        }
    except Exception:
        pass

    return {
        "available": False,
        "engine": "DSP Studio Fallback",
        "version": "native",
        "details": "Neural runtime (DeepFilterNet/PyTorch) not present; Studio DSP engine active",
    }


def neural_enhance(
    audio: np.ndarray,
    sr: int,
    *,
    atten_lim_db: float = 100.0,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Enhance speech using a neural model if available, otherwise return status.

    Args:
        audio: Input audio array, shape (N,) or (N, 2).
        sr: Sample rate in Hz.
        atten_lim_db: Maximum attenuation limit in dB.

    Returns:
        Tuple of (enhanced_audio, status_dict).
    """
    status = check_neural_available()

    if not status["available"]:
        # Fallback indicated in status
        return audio, {
            "applied": False,
            "engine": status["engine"],
            "reason": status["details"],
        }

    # Attempt DeepFilterNet execution if installed
    try:
        import df
        from df.enhance import enhance, init_df
        model, df_state, _ = init_df()
        # DeepFilterNet expects torch tensor in [-1, 1] at 48kHz
        import torch
        audio_tensor = torch.from_numpy(audio.astype(np.float32))
        if audio_tensor.ndim == 1:
            audio_tensor = audio_tensor.unsqueeze(0)
        enhanced_tensor = enhance(model, df_state, audio_tensor, atten_lim_db=atten_lim_db)
        enhanced_np = enhanced_tensor.squeeze().cpu().numpy().astype(np.float64)
        return enhanced_np, {"applied": True, "engine": "DeepFilterNet"}
    except Exception as e:
        logger.warning("Neural enhancement failed to run: %s. Using DSP engine.", e)
        return audio, {
            "applied": False,
            "engine": "DSP Fallback",
            "reason": f"Neural model execution exception: {str(e)}",
        }
