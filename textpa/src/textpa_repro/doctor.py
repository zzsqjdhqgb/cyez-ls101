from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import sys
from typing import Any


def _module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def diagnose(cache_dir: str | Path | None = None) -> dict[str, Any]:
    cache = Path(cache_dir).expanduser() if cache_dir else None
    return {
        "python": sys.version.split()[0],
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
        "espeak": bool(shutil.which("espeak-ng") or shutil.which("espeak")),
        "packages": {
            "numpy": _module("numpy"),
            "torch": _module("torch"),
            "transformers": _module("transformers"),
            "faster_whisper": _module("faster_whisper"),
            "phonemizer": _module("phonemizer"),
            "openai": _module("openai"),
        },
        "api": {
            "TEXTPA_API_KEY": bool(os.getenv("TEXTPA_API_KEY")),
            "OPENAI_API_KEY": bool(os.getenv("OPENAI_API_KEY")),
            "TEXTPA_BASE_URL": bool(os.getenv("TEXTPA_BASE_URL")),
        },
        "cache_dir": str(cache) if cache else None,
        "cache_exists": bool(cache and cache.exists()),
    }
