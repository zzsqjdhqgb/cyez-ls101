#!/usr/bin/env python3
"""Generate seeded VoiceDesign reference candidates for Qwen3-TTS Base."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ASSET_CONFIG = json.loads(Path(__file__).with_name("assets.json").read_text(encoding="utf-8"))
MODEL_ID = ASSET_CONFIG["voice"]["designModel"]
MODEL_REVISION = ASSET_CONFIG["voice"]["designModelRevision"]
DEFAULT_TEXT = (
    "Good morning. The library opens at eight thirty, and today's workshop begins "
    "just after nine. Please bring your notes, ask clear questions, and take your time."
)
DEFAULT_INSTRUCT = (
    "A native English-speaking adult woman with a neutral General American accent. "
    "Her voice is clear, warm, composed, and articulate, with natural conversational pacing, "
    "subtle expressiveness, and no theatrical or regional affectation. Studio-quality delivery."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate WAV candidates whose speaker embeddings can be used by Qwen3-TTS Base."
    )
    parser.add_argument("--output-dir", type=Path, default=Path("model-assets/qwen-tts/voice-design"))
    parser.add_argument("--text", default=DEFAULT_TEXT, help="English reference text to speak")
    parser.add_argument("--instruct", default=DEFAULT_INSTRUCT, help="VoiceDesign description")
    parser.add_argument("--language", default="English")
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260816, help="First candidate seed")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--dtype", choices=("auto", "float32", "bfloat16", "float16"), default="auto")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.count <= 32:
        parser.error("--count must be between 1 and 32")
    if not args.text.strip():
        parser.error("--text must not be empty")
    if not args.instruct.strip():
        parser.error("--instruct must not be empty")
    return args


def load_dependencies() -> tuple[Any, Any, Any, Any]:
    try:
        import numpy as np
        import soundfile as sf
        import torch
        from qwen_tts import Qwen3TTSModel
    except ImportError as error:
        raise SystemExit(
            "Missing VoiceDesign dependencies. Create a Python environment and install "
            "qwen-tts, torch, numpy, and soundfile."
        ) from error
    return np, sf, torch, Qwen3TTSModel


def resolve_runtime(args: argparse.Namespace, torch: Any) -> tuple[str, Any]:
    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("--device cuda was requested, but CUDA is not available")

    dtype_name = args.dtype
    if dtype_name == "auto":
        dtype_name = "bfloat16" if device == "cuda" else "float32"
    if device == "cpu" and dtype_name == "float16":
        raise SystemExit("float16 is not supported for this CPU workflow; use float32 or bfloat16")
    return device, getattr(torch, dtype_name)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    np, soundfile, torch, model_class = load_dependencies()
    device, dtype = resolve_runtime(args, torch)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    output_files = [args.output_dir / f"candidate-{args.seed + index}.wav" for index in range(args.count)]
    collisions = [path for path in output_files if path.exists()]
    manifest_path = args.output_dir / "manifest.json"
    if (collisions or manifest_path.exists()) and not args.overwrite:
        raise SystemExit(
            f"Output already exists under {args.output_dir}; pass --overwrite or choose another directory"
        )

    print(f"Loading {MODEL_ID}@{MODEL_REVISION} on {device} ({dtype})")
    model = model_class.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        device_map=device,
        dtype=dtype,
    )

    candidates = []
    for index, output_path in enumerate(output_files):
        seed = args.seed + index
        random.seed(seed)
        np.random.seed(seed % (2**32))
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        print(f"Generating candidate {index + 1}/{args.count} (seed {seed})")
        wavs, sample_rate = model.generate_voice_design(
            text=args.text,
            language=args.language,
            instruct=args.instruct,
        )
        if not wavs:
            raise RuntimeError("VoiceDesign returned no audio")
        waveform = np.asarray(wavs[0], dtype=np.float32).squeeze()
        if waveform.ndim != 1 or waveform.size == 0 or not np.isfinite(waveform).all():
            raise RuntimeError("VoiceDesign returned invalid audio")
        soundfile.write(output_path, waveform, sample_rate, subtype="PCM_16")
        candidates.append(
            {
                "file": output_path.name,
                "seed": seed,
                "sampleRate": int(sample_rate),
                "durationSeconds": round(float(waveform.size) / int(sample_rate), 6),
                "sha256": sha256(output_path),
            }
        )

    manifest = {
        "format": "ls101.qwen-tts-voice-design",
        "formatVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "model": {"id": MODEL_ID, "revision": MODEL_REVISION},
        "generation": {
            "language": args.language,
            "text": args.text,
            "instruct": args.instruct,
            "device": device,
            "dtype": str(dtype).removeprefix("torch."),
        },
        "candidates": candidates,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(candidates)} candidates and {manifest_path}")


if __name__ == "__main__":
    main()
