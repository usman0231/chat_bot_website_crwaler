"""faster-whisper STT — large-v3, GPU when CUDA libs are reachable.

Boot order matters: we add CUDA DLL directories to Python's search path
*before* CTranslate2 (faster-whisper's backend) tries to load cuBLAS. On
Windows this is the only reliable way to keep the DLLs out of PATH while
still letting CTranslate2 find them.

Device ladder:
    cuda + float16        (best speed/quality on RTX-class GPUs)
    cuda + int8_float16   (less VRAM, slightly slower)
    cpu  + int8           (universal fallback, slow on large-v3)

``WHISPER_MODEL`` / ``WHISPER_DEVICE`` / ``WHISPER_COMPUTE_TYPE`` in .env
still override the defaults, and any CUDA-load runtime error during
inference also falls back to CPU (see :func:`transcribe`).
"""

from __future__ import annotations

import logging
import os
import sys
import threading

import numpy as np

from core.config import settings

# --- nvidia pip-wheel DLL registration -----------------------------------
# faster-whisper / CTranslate2 needs more than cuBLAS to run on CUDA on
# Windows: it also needs cuDNN (`nvidia-cudnn-cu12`) and usually the CUDA
# runtime (`nvidia-cuda-runtime-cu12`, `nvidia-cuda-nvrtc-cu12`). Each pip
# wheel installs DLLs under `site-packages/nvidia/<name>/bin`. Scan that
# tree at import time and register every bin/ dir we find — cheap, ordered
# search, and avoids having to know in advance which wheels the user
# installed. cuBLAS alone is not enough; if cuDNN is missing CTranslate2
# loads cuBLAS fine then dies on the first encode with the same
# "Library cublas64_12.dll is not found or cannot be loaded" message.
import sys as _sys


def _register_nvidia_dll_dirs() -> tuple[bool, list[str], list[str]]:
    """Return (has_cublas, registered_dirs, missing_wheels).

    ``missing_wheels`` lists nvidia-* pip packages that faster-whisper
    typically needs on Windows but weren't found in site-packages.
    """
    if _sys.platform != "win32" or not hasattr(os, "add_dll_directory"):
        return False, [], []

    nvidia_root = os.path.normpath(
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "..",
            ".venv",
            "Lib",
            "site-packages",
            "nvidia",
        )
    )
    if not os.path.isdir(nvidia_root):
        # Probably not running from .venv — fall back to whatever sys.path
        # exposes. The system-level _setup_cuda_path() below still runs.
        return False, [], ["nvidia-cublas-cu12", "nvidia-cudnn-cu12"]

    registered: list[str] = []
    has_cublas = False
    has_cudnn = False
    for entry in sorted(os.listdir(nvidia_root)):
        bin_dir = os.path.join(nvidia_root, entry, "bin")
        if not os.path.isdir(bin_dir):
            continue
        dlls = [f for f in os.listdir(bin_dir) if f.lower().endswith(".dll")]
        if not dlls:
            continue
        try:
            os.add_dll_directory(bin_dir)
        except OSError as e:
            print(f"[STT] add_dll_directory failed for {bin_dir}: {e}")
            continue
        # CTranslate2's C++ code does LoadLibrary calls at *inference*
        # time that don't honour os.add_dll_directory. The Windows loader
        # falls back to the standard search order, which DOES include
        # PATH — so prepend each nvidia bin dir there too. Belt and
        # suspenders, but reliably fixes "DLL not found" at first encode.
        current_path = os.environ.get("PATH", "")
        if bin_dir not in current_path.split(os.pathsep):
            os.environ["PATH"] = bin_dir + os.pathsep + current_path
        registered.append(bin_dir)
        # Flag specific DLLs we care about, lowercased to match casing
        # variations from different wheel builds.
        lowered = {f.lower() for f in dlls}
        if "cublas64_12.dll" in lowered:
            has_cublas = True
        if any(name.startswith("cudnn") for name in lowered):
            has_cudnn = True

    missing: list[str] = []
    if not has_cublas:
        missing.append("nvidia-cublas-cu12")
    if not has_cudnn:
        missing.append("nvidia-cudnn-cu12")
    return has_cublas, registered, missing


_has_venv_cublas, _registered_nvidia_dirs, _missing_nvidia_wheels = (
    _register_nvidia_dll_dirs()
)
if _registered_nvidia_dirs:
    print(
        "[STT] Registered nvidia DLL dirs: "
        + ", ".join(os.path.basename(os.path.dirname(p)) for p in _registered_nvidia_dirs)
    )
if _missing_nvidia_wheels:
    _install_cmd = "pip install " + " ".join(_missing_nvidia_wheels)
    _banner = "!" * 78
    print("")
    print(_banner)
    print("[STT] GPU SETUP INCOMPLETE")
    print(
        "[STT] Missing nvidia pip wheels: "
        + ", ".join(_missing_nvidia_wheels)
    )
    print(
        "[STT] faster-whisper will load on CUDA but fail at first inference"
    )
    print("[STT] with: 'Library cublas64_12.dll is not found or cannot be loaded'")
    print("[STT] (the message lies - the real missing piece is cuDNN).")
    print("[STT] Fix:  " + _install_cmd)
    print(_banner)
    print("")
_venv_cublas_registered = _has_venv_cublas


def _setup_cuda_path() -> bool:
    """Add CUDA DLL directories so CTranslate2 can find cuBLAS / cuDNN.

    Tries a few common locations on Windows. Returns True if a directory
    containing ``cublas64_12.dll`` was registered, False otherwise. Silent
    no-op on non-Windows platforms.
    """
    if sys.platform != "win32":
        return False
    if not hasattr(os, "add_dll_directory"):  # Python <3.8, shouldn't happen
        return False

    candidate_paths = [
        # Ollama bundles a CUDA runtime in its install dir.
        os.path.join(
            os.environ.get("LOCALAPPDATA", ""), "Programs", "Ollama"
        ),
        os.path.join(
            os.environ.get("LOCALAPPDATA", ""), "Programs", "Ollama", "lib"
        ),
        # NVIDIA CUDA Toolkit defaults.
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.5\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2\bin",
        # Custom override.
        os.environ.get("CUDA_DLL_PATH", ""),
    ]

    found = False
    for path in candidate_paths:
        if not path or not os.path.isdir(path):
            continue
        cublas = os.path.join(path, "cublas64_12.dll")
        if not os.path.isfile(cublas):
            continue
        try:
            os.add_dll_directory(path)
            print(f"[STT] Found CUDA DLLs at: {path}")
            found = True
            # First match is enough — don't add multiple PATHs.
            break
        except (OSError, FileNotFoundError) as e:
            print(f"[STT] add_dll_directory failed for {path}: {e}")

    if not found:
        print("[STT] cublas64_12.dll not found in common locations.")
    return found


# Either the venv-installed CUDA pip wheel or a system CUDA install is fine
# — both register a DLL directory that CTranslate2 will pick up. Flip the
# flag if *any* of the two paths succeeded.
_cuda_available: bool = _venv_cublas_registered or _setup_cuda_path()


log = logging.getLogger(__name__)

_model = None
_model_device: str | None = None
_model_lock = threading.Lock()

# Substrings that identify CUDA / cuDNN library-loading failures coming up
# from CTranslate2 at *inference* time (the constructor sometimes succeeds
# and only the first encode reveals the missing DLL).
_CUDA_LOAD_HINTS = (
    "cublas",
    "cudnn",
    "cuda",
    "cudart",
    "is not found",
    "cannot be loaded",
)


def _looks_like_cuda_load_failure(err: BaseException) -> bool:
    msg = str(err).lower()
    return any(h in msg for h in _CUDA_LOAD_HINTS)


def _load(device: str, compute_type: str, *, cpu_threads: int = 0, num_workers: int = 1):
    from faster_whisper import WhisperModel

    log.info(
        "Loading faster-whisper model=%s device=%s compute_type=%s",
        settings.whisper_model,
        device,
        compute_type,
    )
    kwargs: dict = {"device": device, "compute_type": compute_type}
    if device == "cpu":
        kwargs["cpu_threads"] = cpu_threads or 8
        kwargs["num_workers"] = num_workers or 2
    return WhisperModel(settings.whisper_model, **kwargs)


def get_whisper():
    """Return a loaded WhisperModel, walking the GPU→CPU ladder on failure."""
    global _model, _model_device
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        # Honour explicit config overrides first.
        configured_device = settings.whisper_device.lower()
        configured_compute = settings.whisper_compute_type

        if configured_device == "cuda" and _cuda_available:
            for compute_type in (configured_compute, "int8_float16"):
                try:
                    _model = _load("cuda", compute_type)
                    _model_device = "cuda"
                    print(f"[STT] Whisper running on GPU ({compute_type})")
                    return _model
                except Exception as e:
                    log.warning(
                        "faster-whisper cuda+%s load failed: %s", compute_type, e
                    )
            print("[STT] GPU init failed; falling back to CPU")
        elif configured_device == "cuda" and not _cuda_available:
            print("[STT] CUDA configured but DLLs not found; using CPU")

        _model = _load(
            "cpu", "int8" if configured_device == "cuda" else configured_compute,
            cpu_threads=8, num_workers=2,
        )
        _model_device = "cpu"
        print("[STT] Whisper running on CPU (int8, 8 threads)")
        return _model


def _fallback_to_cpu(reason: BaseException) -> None:
    """Discard the CUDA model and reload on CPU. Called when CUDA inference
    dies after the model itself loaded — happens when WhisperModel resolves
    the device lazily and only blows up on first encode.
    """
    global _model, _model_device
    with _model_lock:
        if _model_device == "cpu":
            return
        log.warning(
            "faster-whisper CUDA inference failed (%s); reloading on CPU+int8",
            reason,
        )
        _model = _load("cpu", "int8", cpu_threads=8, num_workers=2)
        _model_device = "cpu"


def transcribe(audio_bytes: bytes) -> dict:
    """Transcribe raw PCM float32 audio (16kHz, mono).

    Returns {text, language, confidence}. Language is auto-detected;
    expect "en" or "ur" for the configured voices but any whisper-supported
    code may come back.
    """
    model = get_whisper()
    audio_array = np.frombuffer(audio_bytes, dtype=np.float32)
    if audio_array.size == 0:
        return {"text": "", "language": "en", "confidence": 0.0}

    def _run(m):
        segments, info = m.transcribe(
            audio_array,
            language=None,
            task="transcribe",
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 400,
            },
            beam_size=5,
            best_of=5,
            temperature=0.0,
            condition_on_previous_text=True,
            initial_prompt=settings.whisper_initial_prompt or None,
            word_timestamps=False,
        )
        text = " ".join(s.text for s in segments).strip()
        return {
            "text": text,
            "language": info.language,
            "confidence": float(info.language_probability),
        }

    try:
        return _run(model)
    except RuntimeError as e:
        if _model_device != "cpu" and _looks_like_cuda_load_failure(e):
            _fallback_to_cpu(e)
            return _run(get_whisper())
        raise
