#!/usr/bin/env python3
r"""Run a local, CMUdict-based pronunciation correction demo.

The command is intentionally self-contained.  It accepts one audio file and
one provisional transcript, runs the local CMU-phone wav2vec2 model, performs
CTC alignment, computes a Viterbi GOP-style log posterior ratio, and writes a
conservative pronunciation-only report.

The transcript is an explicit input rather than an implicit semantic repair:
for free speech it may come from ASR, but an ASR word mismatch is never
reported as a pronunciation error by this script.

Examples::

    python textpa/scripts/run_pronunciation_gop_demo.py \
      --audio recording.webm \
      --text-file transcript.txt \
      --model-dir .gop-research/model \
      --pronunciation "overweigh=OW V ER W EY" \
      --output-dir .gop-research/demo-output \
      --overwrite

The exact CTC-GOP denominator used by the early research scripts is available
with ``--gop-method exact`` for short utterances.  ``auto`` (the default) uses
it only below the configured work limit and otherwise uses the bounded
Viterbi-GOP method so a long recording remains a practical demo.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any, Mapping, Sequence
import unicodedata


SAMPLE_RATE = 16_000
DEFAULT_MAX_SECONDS = 180.0
DEFAULT_MAX_CANDIDATES = 32
DEFAULT_ALIGNMENT_CANDIDATES = 8
DEFAULT_EXACT_WORK_LIMIT = 2_000_000
DEFAULT_MODEL_DIR = (
    Path(__file__).resolve().parents[2] / ".gop-research" / "model"
)
DEFAULT_DICTIONARY = (
    Path(__file__).resolve().parents[2]
    / "node_modules"
    / "cmu-pronouncing-dictionary"
    / "index.js"
)
DEFAULT_ASR_ASSETS = (
    Path(__file__).resolve().parents[2] / "externals" / "ai" / "stt" / "model"
)
DEFAULT_ASR_RUNNER = Path(__file__).resolve().parents[2] / "scripts" / "test-stt.js"


ARPABET_TO_IPA: dict[str, str] = {
    "AA": "ɑː",
    "AE": "æ",
    "AH": "ʌ",
    "AO": "ɔː",
    "AW": "aʊ",
    "AY": "aɪ",
    "B": "b",
    "CH": "tʃ",
    "D": "d",
    "DH": "ð",
    "EH": "ɛ",
    "ER": "ɚ",
    "EY": "eɪ",
    "F": "f",
    "G": "ɡ",
    "HH": "h",
    "IH": "ɪ",
    "IY": "iː",
    "JH": "dʒ",
    "K": "k",
    "L": "l",
    "M": "m",
    "N": "n",
    "NG": "ŋ",
    "OW": "oʊ",
    "OY": "ɔɪ",
    "P": "p",
    "R": "ɹ",
    "S": "s",
    "SH": "ʃ",
    "T": "t",
    "TH": "θ",
    "UH": "ʊ",
    "UW": "uː",
    "V": "v",
    "W": "w",
    "Y": "j",
    "Z": "z",
    "ZH": "ʒ",
}
STRESS_SENSITIVE_IPA: dict[str, str] = {
    "IY0": "i",
    "IY1": "iː",
    "IY2": "iː",
    "UW0": "u",
    "UW1": "uː",
    "UW2": "uː",
}
SPECIAL_TOKENS = {"<pad>", "<s>", "</s>", "<unk>", "|"}
CONSONANTS = {
    "B",
    "CH",
    "D",
    "DH",
    "F",
    "G",
    "HH",
    "JH",
    "K",
    "L",
    "M",
    "N",
    "NG",
    "P",
    "R",
    "S",
    "SH",
    "T",
    "TH",
    "V",
    "W",
    "Y",
    "Z",
    "ZH",
}


class DemoError(RuntimeError):
    """A user-actionable demo failure."""


@dataclass(frozen=True)
class Variant:
    raw: tuple[str, ...]
    tokens: tuple[str, ...]
    ipa: tuple[str, ...]


@dataclass(frozen=True)
class WordReference:
    text: str
    variants: tuple[Variant, ...]

    @property
    def selected(self) -> Variant:
        return self.variants[0]


@dataclass(frozen=True)
class Reference:
    text: str
    words: tuple[WordReference, ...]
    selected_variants: tuple[Variant, ...]

    @property
    def phones(self) -> tuple[str, ...]:
        return tuple(phone for variant in self.selected_variants for phone in variant.tokens)


@dataclass(frozen=True)
class CtcAlignment:
    path_score: float
    states: Any
    spans: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class Runtime:
    np: Any
    torch: Any
    processor_class: Any
    tokenizer_class: Any
    model_class: Any


_runtime_cache: Runtime | None = None


def runtime() -> Runtime:
    """Load optional numerical dependencies, including the local research site."""
    global _runtime_cache
    if _runtime_cache is not None:
        return _runtime_cache
    try:
        import numpy as np
        import torch
        from transformers import (
            Wav2Vec2CTCTokenizer,
            Wav2Vec2ForCTC,
            Wav2Vec2Processor,
        )
    except ModuleNotFoundError as first_error:
        # The workspace keeps a reproducible CPU site directory ignored from git.
        # Use it only as a local fallback; normal installations use their venv.
        site = Path(__file__).resolve().parents[2] / ".gop-research" / "site"
        if site.is_dir() and os.fspath(site) not in sys.path:
            sys.path.insert(0, os.fspath(site))
        try:
            import numpy as np
            import torch
            from transformers import (
                Wav2Vec2CTCTokenizer,
                Wav2Vec2ForCTC,
                Wav2Vec2Processor,
            )
        except ModuleNotFoundError as second_error:
            raise DemoError(
                "缺少 Python 依赖。请安装 textpa/requirements-lock.txt，或在当前工作区 "
                "使用 PYTHONPATH=.gop-research/site。"
            ) from second_error
        del first_error
    _runtime_cache = Runtime(
        np=np,
        torch=torch,
        processor_class=Wav2Vec2Processor,
        tokenizer_class=Wav2Vec2CTCTokenizer,
        model_class=Wav2Vec2ForCTC,
    )
    return _runtime_cache


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def normalize_text(text: str) -> tuple[str, list[str]]:
    normalized = (
        unicodedata.normalize("NFKC", text)
        .replace("‘", "'")
        .replace("’", "'")
    )
    words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)*", normalized)
    if not words:
        raise DemoError("参考文本中没有可评测的英文单词")
    return normalized, words


def parse_dictionary_value(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        result: list[str] = []
        for item in value:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, (list, tuple)) and all(
                isinstance(phone, str) for phone in item
            ):
                result.append(" ".join(item))
        return result
    return []


def load_dictionary(path: Path | None) -> tuple[dict[str, list[str]], str]:
    """Load CMUdict from the repository JS export or the Python package."""
    if path is not None:
        if not path.is_file():
            raise DemoError(f"CMUdict 文件不存在：{path}")
        dictionary: dict[str, list[str]] = {}
        if path.suffix.lower() == ".json":
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise DemoError(f"无法读取 CMUdict JSON：{path}") from exc
            if not isinstance(value, dict):
                raise DemoError("CMUdict JSON 必须是对象")
            for word, pronunciations in value.items():
                values = parse_dictionary_value(pronunciations)
                if values:
                    dictionary[str(word).lower()] = values
        else:
            # cmu-pronouncing-dictionary/index.js stores one JSON-like entry per line.
            entry = re.compile(
                r'^\s*("(?:\\.|[^"\\])*")\s*:\s*'
                r'("(?:\\.|[^"\\])*")\s*,?\s*(?://.*)?$'
            )
            for line in path.read_text(encoding="utf-8").splitlines():
                match = entry.match(line)
                if not match:
                    continue
                try:
                    word = json.loads(match.group(1))
                    pronunciation = json.loads(match.group(2))
                except json.JSONDecodeError:
                    continue
                dictionary.setdefault(str(word).lower(), []).append(str(pronunciation))
        if not dictionary:
            raise DemoError(f"CMUdict 未读取到词条：{path}")
        return dictionary, os.fspath(path.resolve())

    try:
        import cmudict  # type: ignore

        return {
            str(word).lower(): [" ".join(item) for item in values]
            for word, values in cmudict.dict().items()
        }, "python:cmudict"
    except ModuleNotFoundError:
        default = DEFAULT_DICTIONARY
        if default.is_file():
            return load_dictionary(default)
        raise DemoError(
            "找不到 CMUdict。请安装 cmudict，或通过 --dictionary 指定 "
            "cmu-pronouncing-dictionary/index.js。"
        )


def strip_stress(phone: str) -> str:
    return re.sub(r"[012]$", "", phone.upper())


def phone_to_ipa(phone: str) -> str:
    if phone in STRESS_SENSITIVE_IPA:
        return STRESS_SENSITIVE_IPA[phone]
    base = strip_stress(phone)
    if base not in ARPABET_TO_IPA:
        raise DemoError(f"CMUdict 含有未支持的 ARPAbet 音素：{phone}")
    return ARPABET_TO_IPA[base]


def plural_suffix(pronunciation: str) -> str:
    final = strip_stress(pronunciation.split()[-1])
    if final in {"S", "Z", "SH", "ZH", "CH", "JH"}:
        return "IH0 Z"
    if final in {"P", "T", "K", "F", "TH"}:
        return "S"
    return "Z"


def raw_pronunciations(word: str, dictionary: Mapping[str, Sequence[str]]) -> list[str]:
    values = list(dictionary.get(word, ()))
    for index in range(1, 21):
        values.extend(dictionary.get(f"{word}({index})", ()))
    return values


def make_variants(
    word: str,
    dictionary: Mapping[str, Sequence[str]],
    manual: Mapping[str, Sequence[str]],
) -> tuple[Variant, ...]:
    key = word.lower()
    raw = list(manual.get(key, ())) or raw_pronunciations(key, dictionary)
    if not raw and key.endswith("y"):
        raw = [f"{value} IY0" for value in raw_pronunciations(key[:-1], dictionary)]
    if not raw and key.endswith("'s"):
        raw = [f"{value} Z" for value in raw_pronunciations(key[:-2], dictionary)]
    if not raw and key.endswith("s"):
        raw = [
            f"{value} {plural_suffix(value)}"
            for value in raw_pronunciations(key[:-1], dictionary)
        ]
    variants: list[Variant] = []
    seen: set[tuple[str, ...]] = set()
    for value in raw:
        raw_tokens = tuple(value.split())
        tokens = tuple(strip_stress(phone) for phone in raw_tokens)
        if not tokens or tokens in seen:
            continue
        seen.add(tokens)
        variants.append(
            Variant(
                raw=raw_tokens,
                tokens=tokens,
                ipa=tuple(phone_to_ipa(phone) for phone in raw_tokens),
            )
        )
    return tuple(variants)


def parse_manual_pronunciations(values: Sequence[str]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for item in values:
        word, separator, pronunciation = item.partition("=")
        if not separator or not word.strip() or not pronunciation.strip():
            raise DemoError(
                f"--pronunciation 格式应为 word=ARPABET ARPABET，例如 overweigh=OW V ER W EY：{item}"
            )
        key = word.strip().lower()
        result.setdefault(key, []).append(pronunciation.strip())
    return result


def build_word_references(
    text: str,
    dictionary: Mapping[str, Sequence[str]],
    manual: Mapping[str, Sequence[str]],
) -> tuple[str, tuple[WordReference, ...]]:
    normalized, words = normalize_text(text)
    references: list[WordReference] = []
    for word in words:
        variants = make_variants(word, dictionary, manual)
        if not variants:
            raise DemoError(
                f"CMUdict 中没有“{word}”。请确认 ASR 词形，或增加 "
                f"--pronunciation {word}=...；不会自动改写该词。"
            )
        references.append(WordReference(text=word, variants=variants))
    return normalized, tuple(references)


def reference_from_variants(
    text: str, words: Sequence[WordReference], selected: Sequence[Variant]
) -> Reference:
    if len(words) != len(selected):
        raise DemoError("参考文本词数与发音变体数量不一致")
    return Reference(text=text, words=tuple(words), selected_variants=tuple(selected))


def phone_edit_distance(left: Sequence[str], right: Sequence[str]) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_phone in enumerate(left):
        current = [left_index + 1]
        for right_index, right_phone in enumerate(right):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index + 1] + 1,
                    previous[right_index] + int(left_phone != right_phone),
                )
            )
        previous = current
    return previous[-1]


def align_phone_sequences(
    expected: Sequence[str], observed: Sequence[str]
) -> list[list[int]]:
    """Return observed indexes associated with each expected phone."""
    columns = len(observed) + 1
    scores = [[0] * columns for _ in range(len(expected) + 1)]
    operations = [[0] * columns for _ in range(len(expected) + 1)]
    for index in range(1, len(expected) + 1):
        scores[index][0] = index
        operations[index][0] = 1
    for index in range(1, len(observed) + 1):
        scores[0][index] = index
        operations[0][index] = 2
    for left_index in range(1, len(expected) + 1):
        for right_index in range(1, len(observed) + 1):
            diagonal = scores[left_index - 1][right_index - 1] + int(
                expected[left_index - 1] != observed[right_index - 1]
            )
            deletion = scores[left_index - 1][right_index] + 1
            insertion = scores[left_index][right_index - 1] + 1
            if diagonal <= deletion and diagonal <= insertion:
                scores[left_index][right_index] = diagonal
                operations[left_index][right_index] = 0
            elif deletion <= insertion:
                scores[left_index][right_index] = deletion
                operations[left_index][right_index] = 1
            else:
                scores[left_index][right_index] = insertion
                operations[left_index][right_index] = 2

    associated: list[list[int]] = [[] for _ in expected]
    left_index, right_index = len(expected), len(observed)
    while left_index or right_index:
        operation = operations[left_index][right_index]
        if operation == 0 and left_index and right_index:
            associated[left_index - 1].append(right_index - 1)
            left_index -= 1
            right_index -= 1
        elif operation == 1 and left_index:
            left_index -= 1
        elif right_index:
            attachment = min(len(expected) - 1, max(0, left_index - 1))
            if associated:
                associated[attachment].append(right_index - 1)
            right_index -= 1
        else:
            break
    return associated


def evidence_selected_reference(
    text: str,
    words: Sequence[WordReference],
    recognized: Sequence[str],
) -> Reference:
    primary = [word.selected for word in words]
    primary_phones = [phone for variant in primary for phone in variant.tokens]
    associations = align_phone_sequences(primary_phones, recognized)
    offset = 0
    selected: list[Variant] = []
    for word in words:
        length = len(word.selected.tokens)
        indexes = sorted(
            index for group in associations[offset : offset + length] for index in group
        )
        offset += length
        if not indexes:
            selected.append(word.selected)
            continue
        observed_slice = recognized[indexes[0] : indexes[-1] + 1]
        selected.append(
            min(word.variants, key=lambda item: phone_edit_distance(item.tokens, observed_slice))
        )
    return reference_from_variants(text, words, selected)


def candidate_references(
    text: str,
    words: Sequence[WordReference],
    evidence_reference: Reference,
    max_candidates: int,
) -> list[Reference]:
    candidates: list[tuple[Variant, ...]] = [()]
    for word in words:
        next_candidates: list[tuple[Variant, ...]] = []
        for candidate in candidates:
            for variant in word.variants:
                next_candidates.append(candidate + (variant,))
                if len(next_candidates) >= max_candidates:
                    break
            if len(next_candidates) >= max_candidates:
                break
        candidates = next_candidates
    result = [evidence_reference]
    seen = {evidence_reference.phones}
    for selected in candidates:
        reference = reference_from_variants(text, words, selected)
        if reference.phones not in seen:
            result.append(reference)
            seen.add(reference.phones)
    return result


def log_softmax(logits: Any) -> Any:
    rt = runtime()
    maximum = logits.max(axis=1, keepdims=True)
    shifted = logits - maximum
    return shifted - rt.np.log(rt.np.exp(shifted).sum(axis=1, keepdims=True))


def greedy_decode(logits: Any, token_by_id: Sequence[str], blank: int) -> list[str]:
    result: list[str] = []
    previous = -1
    for token_id in logits.argmax(axis=1).tolist():
        if token_id != previous and token_id != blank:
            token = token_by_id[token_id] if 0 <= token_id < len(token_by_id) else ""
            if token and token not in SPECIAL_TOKENS:
                result.append(token)
        previous = token_id
    return result


def align_ctc(log_probabilities: Any, token_ids: Sequence[int], blank: int) -> CtcAlignment | None:
    """Log-space CTC Viterbi alignment with per-phone spans."""
    np = runtime().np
    frame_count = int(log_probabilities.shape[0])
    if not token_ids or frame_count <= 0:
        return None
    state_count = len(token_ids) * 2 + 1
    back = np.full((frame_count, state_count), -1, dtype=np.int32)
    previous = np.full(state_count, -np.inf, dtype=np.float64)
    previous[0] = float(log_probabilities[0, blank])
    previous[1] = float(log_probabilities[0, token_ids[0]])
    for frame in range(1, frame_count):
        current = np.full(state_count, -np.inf, dtype=np.float64)
        for state in range(state_count):
            best_state = state
            best_score = previous[state]
            if state > 0 and previous[state - 1] > best_score:
                best_state, best_score = state - 1, previous[state - 1]
            if (
                state > 1
                and state % 2 == 1
                and token_ids[(state - 1) // 2] != token_ids[(state - 3) // 2]
                and previous[state - 2] > best_score
            ):
                best_state, best_score = state - 2, previous[state - 2]
            if math.isfinite(float(best_score)):
                token = blank if state % 2 == 0 else token_ids[(state - 1) // 2]
                current[state] = best_score + log_probabilities[frame, token]
                back[frame, state] = best_state
        previous = current
    state = state_count - 1
    if state_count > 1 and previous[state_count - 2] > previous[state]:
        state = state_count - 2
    final_score = float(previous[state])
    if not math.isfinite(final_score):
        return None
    states = np.empty(frame_count, dtype=np.int32)
    states[-1] = state
    for frame in range(frame_count - 1, 0, -1):
        state = int(back[frame, state])
        if state < 0:
            return None
        states[frame - 1] = state
    spans: list[tuple[int, int]] = []
    for index in range(len(token_ids)):
        matching = np.flatnonzero(states == index * 2 + 1)
        if matching.size == 0:
            return None
        spans.append((int(matching[0]), int(matching[-1]) + 1))
    return CtcAlignment(
        path_score=final_score / frame_count,
        states=states,
        spans=tuple(spans),
    )


def resolve_reference(
    logits: Any,
    vocabulary: Mapping[str, int],
    text: str,
    words: Sequence[WordReference],
    max_candidates: int,
    alignment_candidates: int,
) -> tuple[Reference, CtcAlignment, list[str]]:
    frame_count = int(logits.shape[0])
    blank = int(vocabulary.get("<pad>", 0))
    token_by_id = [""] * (max(int(value) for value in vocabulary.values()) + 1)
    for token, token_id in vocabulary.items():
        if 0 <= int(token_id) < len(token_by_id):
            token_by_id[int(token_id)] = token
    recognized = greedy_decode(logits, token_by_id, blank)
    evidence = evidence_selected_reference(text, words, recognized)
    references = candidate_references(text, words, evidence, max_candidates)
    references.sort(key=lambda item: phone_edit_distance(item.phones, recognized))
    log_probabilities = log_softmax(logits)
    best_reference: Reference | None = None
    best_alignment: CtcAlignment | None = None
    for reference in references[:alignment_candidates]:
        try:
            ids = [int(vocabulary[phone]) for phone in reference.phones]
        except KeyError as exc:
            raise DemoError(
                f"音素模型词表中没有 CMUdict 音素 {exc.args[0]!r}；请使用兼容的 CMU 音素模型。"
            ) from exc
        if len(ids) > frame_count:
            continue
        alignment = align_ctc(log_probabilities, ids, blank)
        if alignment and (
            best_alignment is None or alignment.path_score > best_alignment.path_score
        ):
            best_reference, best_alignment = reference, alignment
    if best_reference is None or best_alignment is None:
        raise DemoError("音频帧数不足，无法对齐参考文本")
    return best_reference, best_alignment, recognized


def decode_audio(path: Path, maximum_seconds: float) -> tuple[Any, float]:
    if not path.is_file():
        raise DemoError(f"音频文件不存在：{path}")
    if maximum_seconds <= 0 or not math.isfinite(maximum_seconds):
        raise DemoError("--max-seconds 必须是正数")
    try:
        completed = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-i",
                os.fspath(path),
                "-t",
                f"{maximum_seconds + 1.0:.6f}",
                "-ar",
                str(SAMPLE_RATE),
                "-ac",
                "1",
                "-c:a",
                "pcm_f32le",
                "-f",
                "f32le",
                "-",
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise DemoError("需要 FFmpeg，请先安装 ffmpeg") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise DemoError(f"FFmpeg 解码失败：{detail}") from exc
    np = runtime().np
    samples = np.frombuffer(completed.stdout, dtype=np.float32).copy()
    if samples.size == 0:
        raise DemoError(f"音频解码后为空：{path}")
    if samples.size > int(maximum_seconds * SAMPLE_RATE):
        raise DemoError(
            f"音频超过 --max-seconds {maximum_seconds:.1f} 的限制；请先切分或提高限制"
        )
    return samples, samples.size / SAMPLE_RATE * 1000.0


def infer_logits(
    samples: Any,
    model_dir: Path,
    device: str,
    threads: int,
) -> tuple[Any, dict[str, int], str]:
    if not model_dir.is_dir():
        raise DemoError(f"CMU 音素模型目录不存在：{model_dir}")
    if threads <= 0:
        raise DemoError("--threads 必须为正整数")
    rt = runtime()
    torch = rt.torch
    try:
        torch.set_num_threads(threads)
        processor = rt.processor_class.from_pretrained(model_dir, local_files_only=True)
        tokenizer = rt.tokenizer_class.from_pretrained(model_dir, local_files_only=True)
        model = rt.model_class.from_pretrained(model_dir, local_files_only=True)
    except (OSError, ValueError) as exc:
        raise DemoError(f"无法从本地目录加载 CMU 音素模型：{model_dir}") from exc
    if device != "cpu":
        raise DemoError("当前 demo 只支持 --device cpu")
    model.to(torch.device("cpu"))
    model.eval()
    with torch.inference_mode():
        values = processor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_values
        logits = model(values).logits.squeeze(0).detach().cpu().numpy().astype(rt.np.float64)
    if logits.ndim != 2 or logits.shape[0] <= 0:
        raise DemoError(f"模型输出形状无效：{logits.shape}")
    vocabulary = {str(token): int(token_id) for token, token_id in tokenizer.get_vocab().items()}
    decoded = tokenizer.batch_decode(logits.argmax(axis=1)[None, :])[0].strip()
    return logits, vocabulary, decoded


def logsumexp(values: Any) -> float:
    np = runtime().np
    maximum = float(np.max(values))
    return maximum + math.log(float(np.exp(values - maximum).sum()))


def phone_rows(
    logits: Any,
    vocabulary: Mapping[str, int],
    reference: Reference,
    alignment: CtcAlignment,
    duration_ms: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    log_probabilities = log_softmax(logits)
    blank = int(vocabulary.get("<pad>", 0))
    token_by_id = [""] * (max(int(value) for value in vocabulary.values()) + 1)
    for token, token_id in vocabulary.items():
        if 0 <= int(token_id) < len(token_by_id):
            token_by_id[int(token_id)] = token
    valid_ids = [
        token_id
        for token_id, token in enumerate(token_by_id)
        if token_id != blank and token and token not in SPECIAL_TOKENS
    ]
    flat_phones = reference.phones
    ids = [int(vocabulary[phone]) for phone in flat_phones]
    word_for_phone: list[tuple[int, int, WordReference, Variant]] = []
    for word_index, (word, variant) in enumerate(
        zip(reference.words, reference.selected_variants)
    ):
        for phone_index in range(len(variant.tokens)):
            word_for_phone.append((word_index, phone_index, word, variant))
    if len(word_for_phone) != len(alignment.spans):
        raise DemoError("内部错误：音素与对齐跨度数量不一致")
    frame_ms = duration_ms / int(logits.shape[0])
    rows: list[dict[str, Any]] = []
    for index, ((start, end), expected, expected_id) in enumerate(
        zip(alignment.spans, flat_phones, ids)
    ):
        word_index, phone_index, word, variant = word_for_phone[index]
        segment = log_probabilities[start:end]
        if segment.shape[0] <= 0:
            raise DemoError(f"音素 {index} 没有对齐帧")
        means = segment.mean(axis=0)
        acoustic_id = max(valid_ids, key=lambda token_id: float(means[token_id]))
        alternatives = [token_id for token_id in valid_ids if token_id != expected_id]
        alternative_id = max(alternatives, key=lambda token_id: float(means[token_id]))
        expected_logp = float(means[expected_id])
        alternative_logp = float(means[alternative_id])
        competing_logp = logsumexp(means[alternatives]) if alternatives else -math.inf
        gop = expected_logp - competing_logp
        rows.append(
            {
                "index": index,
                "word_index": word_index,
                "phone_index": phone_index,
                "word": word.text,
                "expected": expected,
                "expected_ipa": phone_to_ipa(expected),
                "acoustic_winner": token_by_id[acoustic_id],
                "acoustic_winner_ipa": phone_to_ipa(token_by_id[acoustic_id]),
                "best_alternative": token_by_id[alternative_id],
                "best_alternative_ipa": phone_to_ipa(token_by_id[alternative_id]),
                "expected_log_p": round(expected_logp, 6),
                "alternative_log_p": round(alternative_logp, 6),
                "gop_log_ratio": round(gop, 6),
                "confidence": round(min(1.0, abs(gop) / 4.0), 3),
                "start_ms": round(start * frame_ms),
                "end_ms": round(end * frame_ms),
            }
        )
    words: list[dict[str, Any]] = []
    offset = 0
    for word_index, (word, variant) in enumerate(
        zip(reference.words, reference.selected_variants)
    ):
        values = rows[offset : offset + len(variant.tokens)]
        offset += len(variant.tokens)
        words.append(
            {
                "word_index": word_index,
                "text": word.text,
                "expected_arpabet": list(variant.tokens),
                "expected_ipa": list(variant.ipa),
                "start_ms": values[0]["start_ms"] if values else 0,
                "end_ms": values[-1]["end_ms"] if values else 0,
                "phones": values,
            }
        )
    return rows, words


def choose_gop_method(
    requested: str,
    frame_count: int,
    phone_count: int,
    work_limit: int,
) -> tuple[str, str]:
    estimated = frame_count * max(1, phone_count) * max(1, phone_count) * 2
    if requested == "viterbi":
        return "viterbi", "explicitly requested"
    if requested == "exact":
        if estimated > work_limit:
            raise DemoError(
                f"exact GOP 估算工作量 {estimated:,} 超过限制 {work_limit:,}；"
                "请使用 --gop-method viterbi 或提高 --exact-work-limit。"
            )
        return "exact", "explicitly requested"
    if estimated <= work_limit:
        return "exact", f"auto: estimated work {estimated:,} <= {work_limit:,}"
    return "viterbi", f"auto fallback: estimated work {estimated:,} > {work_limit:,}"


def _ctc_loss_normalized(posteriors: Any, labels: Any, blank: int = 0) -> Any:
    """Numerically stable CTC negative log likelihood used by CTC-GOP-S."""
    torch = runtime().torch
    sequence_length = int(labels.shape[0])
    frame_count = int(posteriors.shape[1])
    state_count = 2 * sequence_length + 1
    alpha = torch.zeros((state_count, frame_count), dtype=torch.float64)
    alpha_bar = torch.zeros(frame_count, dtype=torch.float64)
    alpha[0, 0] = posteriors[blank, 0]
    alpha[1, 0] = posteriors[labels[0], 0]
    alpha_bar[0] = alpha[:, 0].sum()
    alpha[:, 0] /= alpha_bar[0]
    for frame in range(1, frame_count):
        start = max(0, state_count - 2 * (frame_count - frame))
        for state in range(start, state_count):
            label_index = (state - 1) // 2
            if state % 2 == 0:
                if state == 0:
                    alpha[state, frame] = alpha[state, frame - 1] * posteriors[blank, frame]
                else:
                    alpha[state, frame] = (
                        alpha[state, frame - 1] + alpha[state - 1, frame - 1]
                    ) * posteriors[blank, frame]
            elif state == 1 or labels[label_index] == labels[label_index - 1]:
                alpha[state, frame] = (
                    alpha[state, frame - 1] + alpha[state - 1, frame - 1]
                ) * posteriors[labels[label_index], frame]
            else:
                alpha[state, frame] = (
                    alpha[state, frame - 1]
                    + alpha[state - 1, frame - 1]
                    + alpha[state - 2, frame - 1]
                ) * posteriors[labels[label_index], frame]
        alpha_bar[frame] = alpha[:, frame].sum()
        alpha[:, frame] /= alpha_bar[frame]
    return -torch.log(alpha_bar).sum()


def _arbitrary_sum(values: Any, excluded: Sequence[int] = ()) -> Any:
    torch = runtime().torch
    if torch.count_nonzero(values) <= 1:
        return False
    mask = torch.ones_like(values, dtype=torch.bool)
    for index in excluded:
        mask[index] = False
    return values[mask].sum()


def _denominator_alpha_bar(alpha: Any, frame: int, blank: int, position: int) -> Any:
    arbitrary_state = 2 * position + 1
    ordinary = (
        alpha[:arbitrary_state, frame, blank].sum()
        + alpha[arbitrary_state + 1 :, frame, blank].sum()
    )
    mask = runtime().torch.ones_like(alpha[arbitrary_state, frame], dtype=runtime().torch.bool)
    mask[blank] = False
    return ordinary + alpha[arbitrary_state, frame, mask].sum()


def _ctc_loss_denominator(posteriors: Any, labels: Any, position: int, blank: int = 0) -> Any:
    """CTC-GOP-S wildcard denominator for one target phone.

    This is a bounded research path copied into the demo so it does not rely on
    a deleted checkout under /tmp.  The wildcard state tracks all non-canonical
    token identities; the normalised forward recursion avoids probability
    underflow.  It is intentionally only called for small utterances.
    """
    torch = runtime().torch
    sequence_length = int(labels.shape[0])
    state_count = 2 * sequence_length + 1
    frame_count = int(posteriors.shape[1])
    vocabulary_size = int(posteriors.shape[0])
    mask_insert = torch.eye(vocabulary_size, dtype=torch.float64)
    alpha = torch.zeros((state_count, frame_count, vocabulary_size), dtype=torch.float64)
    alpha_bar = torch.zeros(frame_count, dtype=torch.float64)

    if position == 0:
        alpha[0, 0, blank] = posteriors[blank, 0]
        alpha[1, 0] = posteriors[:, 0]
        alpha[1, 0, blank] = 0
    else:
        alpha[0, 0, blank] = posteriors[blank, 0]
        alpha[1, 0, blank] = posteriors[labels[0], 0]
    alpha_bar[0] = _denominator_alpha_bar(alpha, 0, blank, position)
    if not bool(alpha_bar[0] > 0):
        raise DemoError("exact CTC-GOP 初始概率为零")
    alpha[:, 0] /= alpha_bar[0]

    for frame in range(1, frame_count):
        start = max(0, state_count - 2 * (frame_count - frame))
        for state in range(start, state_count):
            label_index = (state - 1) // 2
            if state % 2 == 0:
                if state == 0:
                    alpha[state, frame, blank] = alpha[state, frame - 1, blank] * posteriors[blank, frame]
                else:
                    arbitrary = _arbitrary_sum(alpha[state - 1, frame - 1], (blank,))
                    incoming = (
                        alpha[state, frame - 1, blank] + arbitrary
                        if arbitrary is not False
                        else alpha[state, frame - 1, blank] + alpha[state - 1, frame - 1, blank]
                    )
                    alpha[state, frame, blank] = incoming * posteriors[blank, frame]
            elif position != label_index and position != label_index - 1:
                if state == 1 or labels[label_index] == labels[label_index - 1]:
                    alpha[state, frame, blank] = (
                        alpha[state, frame - 1, blank] + alpha[state - 1, frame - 1, blank]
                    ) * posteriors[labels[label_index], frame]
                else:
                    alpha[state, frame, blank] = (
                        alpha[state, frame - 1, blank]
                        + alpha[state - 1, frame - 1, blank]
                        + alpha[state - 2, frame - 1, blank]
                    ) * posteriors[labels[label_index], frame]
            elif position == label_index - 1:
                arbitrary = _arbitrary_sum(
                    alpha[state - 2, frame - 1], (blank, int(labels[label_index]))
                )
                extra = 0 if arbitrary is False else arbitrary
                alpha[state, frame, blank] = (
                    alpha[state, frame - 1, blank]
                    + alpha[state - 1, frame - 1, blank]
                    + extra
                ) * posteriors[labels[label_index], frame]
            else:
                if state == 1:
                    empty = alpha[state - 1, frame - 1, blank] * posteriors[:, frame]
                    empty[blank] = 0
                    alpha[state, frame] = (
                        alpha[state, frame - 1].view(1, -1)
                        * posteriors[:, frame].view(-1, 1)
                        * mask_insert
                    ).sum(-1) + empty
                else:
                    skip = alpha[state - 2, frame - 1, blank] * posteriors[:, frame]
                    skip[int(labels[label_index - 1])] = 0
                    skip[blank] = 0
                    empty = alpha[state - 1, frame - 1, blank] * posteriors[:, frame]
                    empty[blank] = 0
                    alpha[state, frame] = (
                        alpha[state, frame - 1].view(1, -1)
                        * posteriors[:, frame].view(-1, 1)
                        * mask_insert
                    ).sum(-1) + skip + empty
        alpha_bar[frame] = _denominator_alpha_bar(alpha, frame, blank, position)
        if not bool(alpha_bar[frame] > 0):
            return torch.tensor(float("inf"), dtype=torch.float64)
        alpha[:, frame] /= alpha_bar[frame]
    return -torch.log(alpha_bar).sum()


def exact_gop_scores(posteriors: Any, labels: Sequence[int]) -> list[float]:
    """Return exact CTC-GOP-S log ratios for a bounded utterance."""
    torch = runtime().torch
    label_tensor = torch.as_tensor(labels, dtype=torch.int64).clone().detach()
    previous_threads = torch.get_num_threads()
    try:
        torch.set_num_threads(1)
        numerator = _ctc_loss_normalized(posteriors, label_tensor)
        scores: list[float] = []
        for position in range(len(labels)):
            denominator = _ctc_loss_denominator(posteriors, label_tensor, position)
            scores.append(float(-numerator + denominator))
        return scores
    finally:
        torch.set_num_threads(previous_threads)


def conservative_diagnostics(
    rows: Sequence[Mapping[str, Any]],
    *,
    include_generic: bool = False,
) -> list[dict[str, Any]]:
    """Aggregate repeated consonant substitutions into learner-facing items."""
    eligible = [
        row
        for row in rows
        if row["acoustic_winner"] != row["expected"]
        and row["gop_log_ratio"] <= -0.35
        and row["confidence"] >= 0.35
        and row["expected"] in CONSONANTS
        and row["acoustic_winner"] in CONSONANTS
    ]

    def group(predicate: Any) -> list[Mapping[str, Any]]:
        return [row for row in eligible if predicate(row)]

    rules: list[tuple[str, str, str, str, list[Mapping[str, Any]], str]] = [
        (
            "voiced-dental-fricative",
            "齿间浊擦音 /ð/",
            "中等证据，建议复听",
            "可能把 /ð/ 读得更接近 /t/；需要确认齿间摩擦和声带振动是否不足。",
            group(lambda row: row["expected"] == "DH" and row["acoustic_winner"] == "T"),
            "舌尖轻放在上下齿之间，保持声带振动并持续摩擦，再对比短促无摩擦的 /t/。",
        ),
        (
            "voiceless-dental-fricative",
            "齿间清擦音 /θ/",
            "较强重复证据，建议复听",
            "可能把 /θ/ 读成 /s/、/t/ 或塞擦化音；需要确认气流是否真正从齿间通过。",
            group(
                lambda row: row["expected"] == "TH"
                and row["acoustic_winner"] in {"S", "T", "CH"}
            ),
            "舌尖略露出齿间，持续送气且不振动；避免先形成 /t/ 闭塞或变成 /s/。",
        ),
        (
            "final-z-devoicing",
            "词尾浊音 /z/",
            "较强重复模式，建议复听",
            "多个词尾 /z/ 的声学证据更接近 /s/，存在词尾浊音清化的可能。",
            group(
                lambda row: row["expected"] == "Z"
                and row["acoustic_winner"] == "S"
                and row["phone_index"] >= 0
            ),
            "词尾先延长有声的 /z/ 再收尾；交替练习 /s/-/z/，用手触摸喉部确认振动。",
        ),
        (
            "initial-b-devoicing",
            "词首浊塞音 /b/",
            "较弱证据，仅作待确认复听项",
            "部分词首 /b/ 更接近 /p/；同一模型可能有系统性混淆，因此不能直接断言。",
            group(
                lambda row: row["expected"] == "B"
                and row["acoustic_winner"] == "P"
                and int(row["phone_index"]) == 0
            ),
            "双唇先闭合、随后带声释放；避免像 /p/ 一样出现明显送气。",
        ),
    ]
    diagnostics: list[dict[str, Any]] = []
    for identifier, title, strength, finding, evidence, practice in rules:
        distinct_words = {str(row["word"]).lower() for row in evidence}
        minimum = 2 if identifier == "voiceless-dental-fricative" else 3
        if identifier == "initial-b-devoicing":
            minimum = 2
        if len(evidence) < minimum and len(distinct_words) < minimum:
            continue
        if identifier == "final-z-devoicing":
            # Only a word-final Z is relevant; CMUdict can contain internal Zs.
            evidence = [
                row
                for row in evidence
                if int(row["phone_index"]) == _word_phone_count(rows, row) - 1
            ]
            distinct_words = {str(row["word"]).lower() for row in evidence}
            if len(distinct_words) < 3:
                continue
        evidence = sorted(evidence, key=lambda row: int(row["start_ms"]))[:12]
        diagnostics.append(
            {
                "id": identifier,
                "title": title,
                "strength": strength,
                "finding": finding,
                "practice": practice,
                "evidence": [
                    {
                        "word": row["word"],
                        "time": f"{format_time(row['start_ms'])}-{format_time(row['end_ms'])}",
                        "start_ms": row["start_ms"],
                        "end_ms": row["end_ms"],
                        "expected": row["expected"],
                        "observed": row["acoustic_winner"],
                        "expected_ipa": row["expected_ipa"],
                        "observed_ipa": row["acoustic_winner_ipa"],
                        "gop_log_ratio": row["gop_log_ratio"],
                        "confidence": row["confidence"],
                    }
                    for row in evidence
                ],
            }
        )

    if include_generic:
        grouped: dict[tuple[str, str], list[Mapping[str, Any]]] = {}
        for row in eligible:
            key = (str(row["expected"]), str(row["acoustic_winner"]))
            grouped.setdefault(key, []).append(row)
        known = {
            ("DH", "T"),
            ("TH", "S"),
            ("TH", "T"),
            ("TH", "CH"),
            ("Z", "S"),
            ("B", "P"),
        }
        for (expected, observed), evidence in sorted(grouped.items()):
            distinct = {str(row["word"]).lower() for row in evidence}
            if (expected, observed) in known or len(distinct) < 3:
                continue
            evidence = sorted(evidence, key=lambda row: int(row["start_ms"]))[:8]
            diagnostics.append(
                {
                    "id": f"repeated-{expected.lower()}-{observed.lower()}",
                    "title": f"重复辅音混淆 /{phone_to_ipa(expected)}/",
                    "strength": "待确认复听",
                    "finding": (
                        f"多个词中目标 /{phone_to_ipa(expected)}/ 的声学峰值更接近 "
                        f"/{phone_to_ipa(observed)}/；仅作为复听线索。"
                    ),
                    "practice": "先用慢速最小对练习这两个音，再回听原句确认是否确实发生替代。",
                    "evidence": [
                        {
                            "word": row["word"],
                            "time": f"{format_time(row['start_ms'])}-{format_time(row['end_ms'])}",
                            "start_ms": row["start_ms"],
                            "end_ms": row["end_ms"],
                            "expected": row["expected"],
                            "observed": row["acoustic_winner"],
                            "expected_ipa": row["expected_ipa"],
                            "observed_ipa": row["acoustic_winner_ipa"],
                            "gop_log_ratio": row["gop_log_ratio"],
                            "confidence": row["confidence"],
                        }
                        for row in evidence
                    ],
                }
            )
    return diagnostics


def _word_phone_count(rows: Sequence[Mapping[str, Any]], row: Mapping[str, Any]) -> int:
    word_index = int(row["word_index"])
    return sum(1 for item in rows if int(item["word_index"]) == word_index)


def format_time(milliseconds: int | float) -> str:
    seconds = float(milliseconds) / 1000.0
    minutes = int(seconds // 60)
    remainder = seconds - minutes * 60
    return f"{minutes:02d}:{remainder:05.2f}"


def render_report(result: Mapping[str, Any]) -> str:
    lines = [
        "# 发音纠错 Demo（CMUdict + CTC GOP）",
        "",
        f"音频：`{result['audio_path']}`",
        f"参考文本来源：{result['transcript_source']}",
        "",
        "> 本报告只讨论音素发音，不分析语法、措辞、内容、停顿或总分。声学证据需要结合原音频复听，不能单独视为人工判定。",
        "",
        "## 发音疑点",
        "",
    ]
    diagnostics = result["diagnostics"]
    if not diagnostics:
        lines.append("未达到保守筛选条件的重复辅音混淆；这不等于所有音素都已被人工确认正确。")
    for diagnosis in diagnostics:
        lines.extend(
            [
                f"### {diagnosis['title']} · {diagnosis['strength']}",
                "",
                diagnosis["finding"],
                "",
                "证据：",
            ]
        )
        for row in diagnosis["evidence"]:
            lines.append(
                f"- `{row['word']}` {row['time']}：/{row['expected_ipa']}/ → "
                f"/{row['observed_ipa']}/（GOP 对数比 {row['gop_log_ratio']}，置信度 {row['confidence']}）"
            )
        lines.extend(["", f"练习方向：{diagnosis['practice']}", ""])
    lines.extend(
        [
            "",
            "## 方法与限制",
            "",
            f"- 音素模型：`{result['model_dir']}`",
            f"- 对齐方法：CTC Viterbi；GOP 方法：`{result['gop_method']}`（{result['gop_method_reason']}）",
            f"- CMUdict：`{result['dictionary_source']}`",
            f"- 参考词数：{len(result['words'])}；对齐音素数：{len(result['phones'])}",
            "- ASR 转写只是临时对齐文本；未知词、错词和合法读音变体不会被自动改写成发音错误。",
            "- `i5` 等多语内部 token 不会出现在此 CMU 音素模型的反馈中。",
        ]
    )
    return "\n".join(lines) + "\n"


def run_qwen3_asr(
    audio: Path,
    assets_dir: Path,
    runner: Path,
    node_command: str,
) -> str:
    """Run the workspace's local Qwen3 ASR and collect its chunk transcripts."""
    if not assets_dir.is_dir():
        raise DemoError(f"Qwen3 ASR 资产目录不存在：{assets_dir}")
    if not runner.is_file():
        raise DemoError(f"Qwen3 ASR runner 不存在：{runner}")
    try:
        completed = subprocess.run(
            [
                node_command,
                os.fspath(runner),
                "--model-dir",
                os.fspath(assets_dir),
                os.fspath(audio),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        raise DemoError(f"找不到 Node.js 命令：{node_command}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout).strip()
        raise DemoError(f"Qwen3 ASR 失败：{detail[-2000:]}") from exc
    chunk = re.compile(r'^\[ASR\] chunk #\d+:.*? "(.*)"\s*$')
    texts = [
        match.group(1).strip()
        for line in completed.stdout.splitlines()
        if (match := chunk.match(line.strip())) and match.group(1).strip()
    ]
    transcript = " ".join(texts).strip()
    if not transcript:
        raise DemoError("Qwen3 ASR 没有输出英文文本")
    return transcript


def read_text_argument(args: argparse.Namespace) -> tuple[str, str]:
    sources = sum(
        value is not None and value is not False
        for value in (args.text, args.text_file, args.asr)
    )
    if sources != 1:
        raise DemoError("必须且只能提供 --text、--text-file 或 --asr qwen3")
    if args.text is not None:
        return (sys.stdin.read() if args.text == "-" else args.text), "explicit text"
    if args.text_file is not None:
        try:
            value = args.text_file.read_text(encoding="utf-8")
        except OSError as exc:
            raise DemoError(f"无法读取 transcript 文件：{args.text_file}") from exc
        return value, os.fspath(args.text_file.resolve())
    return (
        run_qwen3_asr(
            args.audio.resolve(),
            args.asr_assets.resolve(),
            args.asr_runner.resolve(),
            args.node,
        ),
        f"local Qwen3 ASR via {args.asr_runner.resolve()}",
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--audio", type=Path, required=True, help="输入音频（wav/webm/mp3 等）")
    text_group = parser.add_mutually_exclusive_group(required=True)
    text_group.add_argument("--text", help="临时参考文本；传 '-' 从 stdin 读取")
    text_group.add_argument("--text-file", type=Path, help="UTF-8 临时参考文本文件")
    text_group.add_argument("--asr", choices=["qwen3"], help="直接用本地 Qwen3 ASR 生成临时参考文本")
    parser.add_argument("--asr-assets", type=Path, default=DEFAULT_ASR_ASSETS, help="Qwen3 ASR 资产根目录")
    parser.add_argument("--asr-runner", type=Path, default=DEFAULT_ASR_RUNNER, help="工作区 Qwen3 ASR Node runner")
    parser.add_argument("--node", default="node", help="Node.js 命令")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--dictionary", type=Path, default=None, help="CMUdict JS/JSON；省略时优先使用 Python cmudict")
    parser.add_argument("--pronunciation", action="append", default=[], metavar="WORD=PHONES", help="为 CMUdict 缺失词提供读音，可重复")
    parser.add_argument("--output-dir", type=Path, help="输出目录；默认在音频旁生成 .gop-demo")
    parser.add_argument("--overwrite", action="store_true", help="允许覆盖已有 result.json/report.md")
    parser.add_argument("--device", choices=["cpu"], default="cpu")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--max-seconds", type=float, default=DEFAULT_MAX_SECONDS)
    parser.add_argument("--max-candidates", type=int, default=DEFAULT_MAX_CANDIDATES)
    parser.add_argument("--alignment-candidates", type=int, default=DEFAULT_ALIGNMENT_CANDIDATES)
    parser.add_argument("--gop-method", choices=["auto", "viterbi", "exact"], default="auto")
    parser.add_argument("--exact-work-limit", type=int, default=DEFAULT_EXACT_WORK_LIMIT)
    parser.add_argument("--include-generic", action="store_true", help="同时报告未内置的重复辅音混淆；默认更保守")
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.max_candidates <= 0 or args.alignment_candidates <= 0:
        raise DemoError("候选数量必须为正整数")
    if args.exact_work_limit <= 0:
        raise DemoError("--exact-work-limit 必须为正整数")
    audio_path = args.audio.resolve()
    model_dir = args.model_dir.resolve()
    output_dir = (
        args.output_dir.resolve()
        if args.output_dir is not None
        else audio_path.parent / f"{audio_path.stem}.gop-demo"
    )
    result_path = output_dir / "result.json"
    report_path = output_dir / "report.md"
    if not args.overwrite and (result_path.exists() or report_path.exists()):
        raise DemoError(f"输出已存在：{output_dir}；如需覆盖请明确传 --overwrite")
    if not audio_path.is_file():
        raise DemoError(f"音频文件不存在：{audio_path}")
    if not model_dir.is_dir():
        raise DemoError(f"CMU 音素模型目录不存在：{model_dir}")

    text, transcript_source = read_text_argument(args)
    dictionary, dictionary_source = load_dictionary(args.dictionary)
    manual = parse_manual_pronunciations(args.pronunciation)
    normalized, words = build_word_references(text, dictionary, manual)
    samples, duration_ms = decode_audio(audio_path, args.max_seconds)
    logits, vocabulary, decoded = infer_logits(
        samples, model_dir, args.device, args.threads
    )
    reference, alignment, recognized = resolve_reference(
        logits,
        vocabulary,
        normalized,
        words,
        args.max_candidates,
        args.alignment_candidates,
    )
    rows, word_rows = phone_rows(logits, vocabulary, reference, alignment, duration_ms)
    method, method_reason = choose_gop_method(
        args.gop_method,
        int(logits.shape[0]),
        len(rows),
        args.exact_work_limit,
    )
    if method == "exact":
        torch = runtime().torch
        posteriors = torch.from_numpy(logits).softmax(-1).double().transpose(0, 1).contiguous()
        label_ids = [int(vocabulary[phone]) for phone in reference.phones]
        exact_scores = exact_gop_scores(posteriors, label_ids)
        for row, score in zip(rows, exact_scores):
            row["viterbi_gop_log_ratio"] = row["gop_log_ratio"]
            row["gop_log_ratio"] = round(score, 6)
            row["confidence"] = round(min(1.0, abs(score) / 4.0), 3)
        # Word rows contain the same dictionaries as the flat list, so the exact
        # score update is already visible there.
    diagnostics = conservative_diagnostics(rows, include_generic=args.include_generic)
    result: dict[str, Any] = {
        "schema_version": 1,
        "audio_path": os.fspath(audio_path),
        "audio_duration_ms": round(duration_ms),
        "transcript": normalized,
        "transcript_source": transcript_source,
        "reference_source": "CMUdict; selected legal variant using acoustic evidence",
        "dictionary_source": dictionary_source,
        "model_dir": os.fspath(model_dir),
        "model_decode": decoded,
        "recognized_phones": recognized,
        "gop_method": method,
        "gop_method_reason": method_reason,
        "frame_count": int(logits.shape[0]),
        "alignment_path_score": round(alignment.path_score, 6),
        "phones": rows,
        "words": word_rows,
        "diagnostics": diagnostics,
        "limitations": [
            "CTC Viterbi GOP is acoustic evidence, not a human error label.",
            "The provisional transcript may contain ASR word errors; those are not pronunciation findings.",
            "Connected speech, lawful CMUdict variants, and forced-alignment boundary shifts require listening.",
        ],
    }
    result["output_dir"] = os.fspath(output_dir)
    atomic_write(result_path, json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    atomic_write(report_path, render_report(result))
    result["result_path"] = os.fspath(result_path)
    result["report_path"] = os.fspath(report_path)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = run(args)
    except (DemoError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "result": result["result_path"],
                "report": result["report_path"],
                "diagnostics": len(result["diagnostics"]),
                "phones": len(result["phones"]),
                "gop_method": result["gop_method"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
