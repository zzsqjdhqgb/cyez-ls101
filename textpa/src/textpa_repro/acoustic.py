from __future__ import annotations

from dataclasses import dataclass
import math
import os
from pathlib import Path
import subprocess
from typing import Any, Iterable

from .alignment import format_cmu_with_pauses, frame_labels_to_alignment
from .errors import DependencyError, TextPAError
from .models import AlignmentSpan, TextCues


WHISPER_MODELS: dict[str, tuple[str, str]] = {
    "large-v3": (
        "Systran/faster-whisper-large-v3",
        "edaa852ec7e145841d8ffdb056a99866b5f0a478",
    ),
    "large-v3-turbo": (
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf",
    ),
}

IPA_MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"
IPA_REVISION = "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4"
CMU_MODEL = "charsiu/en_w2v2_fc_10ms"
CMU_REVISION = "e9bf8dd314313fc57f6e4d0b5425bde4bbeac80f"
CMU_TOKENIZER = "charsiu/tokenizer_en_cmu"
CMU_TOKENIZER_REVISION = "10507401aedf5e0aba164128535b49225ff95260"
DEFAULT_MAX_AUDIO_SECONDS = 30.0


def discover_audio(paths: Iterable[str | Path]) -> list[Path]:
    extensions = {".wav", ".flac", ".mp3", ".m4a", ".ogg", ".webm"}
    discovered: list[Path] = []
    for raw_path in paths:
        path = Path(raw_path).expanduser().resolve()
        if path.is_file():
            if path.suffix.lower() in extensions:
                discovered.append(path)
            continue
        if path.is_dir():
            discovered.extend(
                candidate
                for candidate in path.rglob("*")
                if candidate.is_file() and candidate.suffix.lower() in extensions
            )
            continue
        raise FileNotFoundError(path)
    return sorted(set(discovered))


def _validate_maximum_seconds(maximum_seconds: float | None) -> None:
    if maximum_seconds is not None and (
        not math.isfinite(maximum_seconds) or maximum_seconds <= 0
    ):
        raise ValueError("maximum audio duration must be positive and finite")


def load_audio_16khz(
    path: str | Path, maximum_seconds: float | None = None
) -> Any:
    """Decode arbitrary input to mono 16 kHz float32 using FFmpeg."""
    _validate_maximum_seconds(maximum_seconds)
    try:
        import numpy as np
    except ImportError as exc:
        raise DependencyError("audio extraction requires the 'acoustic' extra") from exc
    try:
        command = [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            os.fspath(path),
            "-ac",
            "1",
            "-ar",
            "16000",
        ]
        if maximum_seconds is not None:
            # Bound captured stdout even when container duration metadata is wrong.
            command.extend(["-t", f"{maximum_seconds + 1.0:.6f}"])
        command.extend(["-f", "f32le", "-"])
        completed = subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise DependencyError("FFmpeg is required to decode audio") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise TextPAError(f"FFmpeg failed to decode {path}: {detail}") from exc
    audio = np.frombuffer(completed.stdout, dtype=np.float32).copy()
    if audio.size == 0:
        raise TextPAError(f"decoded audio is empty: {path}")
    if maximum_seconds is not None and audio.size > int(maximum_seconds * 16000):
        raise TextPAError(
            f"decoded audio exceeds the configured {maximum_seconds:.2f}s limit: {path}"
        )
    return audio


def audio_duration_seconds(path: str | Path) -> float:
    """Read the container duration without decoding the complete recording."""
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                os.fspath(path),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        raise DependencyError("FFprobe is required to inspect audio") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip()
        raise TextPAError(f"FFprobe failed to inspect {path}: {detail}") from exc
    try:
        duration = float(completed.stdout.strip())
    except ValueError as exc:
        raise TextPAError(f"FFprobe returned no usable duration for {path}") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise TextPAError(f"audio duration must be positive and finite: {path}")
    return duration


def enforce_audio_duration(path: str | Path, maximum_seconds: float | None) -> float:
    _validate_maximum_seconds(maximum_seconds)
    duration = audio_duration_seconds(path)
    if maximum_seconds is not None and duration > maximum_seconds:
        raise TextPAError(
            f"audio is {duration:.2f}s but the configured limit is "
            f"{maximum_seconds:.2f}s: {path}"
        )
    return duration


class FasterWhisperTranscriber:
    def __init__(
        self,
        model: str = "large-v3",
        *,
        device: str = "cpu",
        compute_type: str = "int8",
        cache_dir: str | Path | None = None,
        cpu_threads: int = 0,
        max_audio_seconds: float | None = DEFAULT_MAX_AUDIO_SECONDS,
    ) -> None:
        _validate_maximum_seconds(max_audio_seconds)
        try:
            from faster_whisper import WhisperModel
            from huggingface_hub import snapshot_download
        except ImportError as exc:
            raise DependencyError("transcription requires the 'acoustic' extra") from exc

        model_path = model
        if model in WHISPER_MODELS:
            repository, revision = WHISPER_MODELS[model]
            model_path = snapshot_download(
                repository,
                revision=revision,
                cache_dir=os.fspath(cache_dir) if cache_dir else None,
            )
        self.model_name = model
        self.max_audio_seconds = max_audio_seconds
        self._model = WhisperModel(
            model_path,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
        )

    def transcribe(self, audio_path: str | Path) -> str:
        enforce_audio_duration(audio_path, self.max_audio_seconds)
        audio = load_audio_16khz(audio_path, self.max_audio_seconds)
        segments, _ = self._model.transcribe(
            audio, language="en", beam_size=5, vad_filter=False
        )
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        if not transcript:
            raise TextPAError(f"Whisper produced an empty transcript for {audio_path}")
        return transcript


@dataclass(frozen=True)
class PhonemeOutput:
    ipa: str
    cmu: str
    alignment: tuple[AlignmentSpan, ...]


class PhonemeExtractor:
    """Run the paper's IPA recognizer and Charsiu frame classifier directly."""

    def __init__(
        self,
        *,
        device: str = "cpu",
        cache_dir: str | Path | None = None,
        torch_threads: int | None = None,
        max_audio_seconds: float | None = DEFAULT_MAX_AUDIO_SECONDS,
    ) -> None:
        _validate_maximum_seconds(max_audio_seconds)
        try:
            import torch
            from transformers import (
                Wav2Vec2CTCTokenizer,
                Wav2Vec2FeatureExtractor,
                Wav2Vec2ForCTC,
                Wav2Vec2Processor,
            )
        except ImportError as exc:
            raise DependencyError(
                "phoneme extraction requires CPU PyTorch and the 'acoustic' extra"
            ) from exc

        if torch_threads is not None:
            torch.set_num_threads(torch_threads)
        cache = os.fspath(cache_dir) if cache_dir else None
        self._torch = torch
        self._device = torch.device(device)
        self.max_audio_seconds = max_audio_seconds

        self._ipa_processor = Wav2Vec2Processor.from_pretrained(
            IPA_MODEL, revision=IPA_REVISION, cache_dir=cache
        )
        self._ipa_model = Wav2Vec2ForCTC.from_pretrained(
            IPA_MODEL, revision=IPA_REVISION, cache_dir=cache
        ).to(self._device)
        self._ipa_model.eval()

        self._cmu_tokenizer = Wav2Vec2CTCTokenizer.from_pretrained(
            CMU_TOKENIZER, revision=CMU_TOKENIZER_REVISION, cache_dir=cache
        )
        feature_extractor = Wav2Vec2FeatureExtractor(
            feature_size=1,
            sampling_rate=16000,
            padding_value=0.0,
            do_normalize=True,
            return_attention_mask=False,
        )
        self._cmu_processor = Wav2Vec2Processor(
            feature_extractor=feature_extractor, tokenizer=self._cmu_tokenizer
        )
        # The Charsiu class only overrides forward(); its weights match Wav2Vec2ForCTC.
        self._cmu_model = Wav2Vec2ForCTC.from_pretrained(
            CMU_MODEL, revision=CMU_REVISION, cache_dir=cache
        ).to(self._device)
        self._cmu_model.eval()

    def extract(self, audio_path: str | Path) -> PhonemeOutput:
        enforce_audio_duration(audio_path, self.max_audio_seconds)
        audio = load_audio_16khz(audio_path, self.max_audio_seconds)
        torch = self._torch

        ipa_values = self._ipa_processor(
            audio, sampling_rate=16000, return_tensors="pt"
        ).input_values.to(self._device)
        with torch.inference_mode():
            ipa_logits = self._ipa_model(ipa_values).logits
        ipa_ids = torch.argmax(ipa_logits, dim=-1)
        ipa = self._ipa_processor.batch_decode(ipa_ids)[0].strip()

        cmu_values = self._cmu_processor(
            audio, sampling_rate=16000, return_tensors="pt"
        ).input_values.to(self._device)
        with torch.inference_mode():
            cmu_logits = self._cmu_model(cmu_values).logits.squeeze(0)
        cmu_ids = torch.argmax(cmu_logits, dim=-1).detach().cpu().tolist()
        frame_labels = [
            self._cmu_tokenizer.convert_ids_to_tokens(int(index)) for index in cmu_ids
        ]
        alignment = frame_labels_to_alignment(frame_labels, resolution_seconds=0.01)
        cmu = format_cmu_with_pauses(alignment)

        if not ipa or not cmu:
            raise TextPAError(f"phoneme extraction produced empty cues for {audio_path}")
        return PhonemeOutput(ipa=ipa, cmu=cmu, alignment=alignment)

    def make_cues(
        self, utterance_id: str, audio_path: str, transcript: str
    ) -> TextCues:
        output = self.extract(audio_path)
        return TextCues(
            utterance_id=utterance_id,
            audio_path=audio_path,
            transcript=transcript,
            phonemes_cmu=output.cmu,
            phonemes_ipa=output.ipa,
            alignment=output.alignment,
        )
