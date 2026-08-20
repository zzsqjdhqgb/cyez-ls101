#!/usr/bin/env python3
"""Evidence-constrained pronunciation correction demo.

The demo combines:

* CTC forced alignment over the application's quantized phoneme model; and
* pause events from TextPA's published Charsiu frame alignment.

For MultiPA free-speech samples, the published Whisper transcript is only a
provisional reference. The LLM prompt is explicit about that limitation.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import subprocess
import sys
import time
import unicodedata
from typing import Any, Callable, Iterable, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from zipfile import ZipFile


TEXTPA_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = TEXTPA_ROOT.parent
DEFAULT_CUES = TEXTPA_ROOT / "benchmark-data/multipa-reference/paper_cues.jsonl"
DEFAULT_SOURCE_ZIP = (
    TEXTPA_ROOT / "benchmark-data/multipa-reference/downloads/multiPA.zip"
)
DEFAULT_MODEL_DIR = (
    WORKSPACE_ROOT
    / "externals/ai/pronunciation/model/facebook-wav2vec2-lv-60-espeak-cv-ft-int8"
)
DEFAULT_DICTIONARY = WORKSPACE_ROOT / "node_modules/cmu-pronouncing-dictionary/index.js"
DEFAULT_OUTPUT = (
    TEXTPA_ROOT
    / "benchmark-data/ctc-pause-correction-demo/run-seed-20260820"
)
MULTIPA_REVISION = "ff1e3c79bfb1d113d887a0b7b05fe2900c095264"
SAMPLE_RATE = 16_000
MAX_REFERENCE_CANDIDATES = 32
ALIGNMENT_REFERENCE_CANDIDATES = 8
HIGH_CONFIDENCE_SCORE = 40
HIGH_CONFIDENCE_MIN = 0.35

BILLING_WORDS = (
    "insufficient balance",
    "insufficient credit",
    "insufficient funds",
    "insufficient_quota",
    "balance is insufficient",
    "credit balance",
    "billing",
    "payment required",
    "out of credit",
    "no credit",
    "余额不足",
    "余额",
    "欠费",
    "充值",
    "付费",
)
RETRYABLE_HTTP = {408, 429, 500, 502, 503, 504, 520, 522, 524}


ARPABET_TO_IPA: dict[str, str] = {
    "AA": "ɑː",
    "AE": "æ",
    "AH0": "ə",
    "AH1": "ʌ",
    "AH2": "ʌ",
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
STRESS_SENSITIVE_ARPABET_TO_IPA = {
    "IY0": "i",
    "IY1": "iː",
    "IY2": "iː",
    "UW0": "u",
    "UW1": "uː",
    "UW2": "uː",
}


class BillingError(RuntimeError):
    """A provider explicitly reported exhausted credit or billing failure."""


@dataclass(frozen=True)
class ReferenceWord:
    text: str
    phones: tuple[str, ...]


@dataclass(frozen=True)
class PronunciationReference:
    text: str
    words: tuple[ReferenceWord, ...]

    @property
    def phones(self) -> tuple[str, ...]:
        return tuple(phone for word in self.words for phone in word.phones)


@dataclass(frozen=True)
class CtcAlignment:
    path_score: float
    states: Any
    spans: tuple[tuple[int, int], ...]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    temporary.replace(path)


def load_env(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: expected a JSON object")
            records.append(value)
    return records


def load_cmu_dictionary(path: Path) -> dict[str, str]:
    """Read the repository's generated JS dictionary without executing JavaScript."""
    dictionary: dict[str, str] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped.startswith('"') or '": "' not in stripped:
                continue
            try:
                item = json.loads("{" + stripped.removesuffix(",") + "}")
            except json.JSONDecodeError:
                continue
            if len(item) == 1:
                word, pronunciation = next(iter(item.items()))
                dictionary[str(word)] = str(pronunciation)
    if not dictionary:
        raise ValueError(f"CMU dictionary could not be read: {path}")
    return dictionary


def arpabet_to_ipa(phone: str) -> str:
    if phone in STRESS_SENSITIVE_ARPABET_TO_IPA:
        return STRESS_SENSITIVE_ARPABET_TO_IPA[phone]
    if phone in ARPABET_TO_IPA:
        return ARPABET_TO_IPA[phone]
    base = re.sub(r"[012]$", "", phone)
    if base not in ARPABET_TO_IPA:
        raise ValueError(f"unsupported ARPAbet phone: {phone}")
    return ARPABET_TO_IPA[base]


def plural_suffix(pronunciation: str) -> str:
    final_phone = re.sub(r"[012]$", "", pronunciation.split()[-1])
    if final_phone in {"S", "Z", "SH", "ZH", "CH", "JH"}:
        return "IH0 Z"
    if final_phone in {"P", "T", "K", "F", "TH"}:
        return "S"
    return "Z"


def raw_dictionary_pronunciations(word: str, dictionary: dict[str, str]) -> list[str]:
    values: list[str] = []
    if word in dictionary:
        values.append(dictionary[word])
    for index in range(1, 21):
        value = dictionary.get(f"{word}({index})")
        if value:
            values.append(value)
    return values


def dictionary_pronunciations(word: str, dictionary: dict[str, str]) -> list[tuple[str, ...]]:
    values = raw_dictionary_pronunciations(word, dictionary)
    if not values and word.endswith("y"):
        values.extend(
            f"{value} IY0"
            for value in raw_dictionary_pronunciations(word[:-1], dictionary)
        )
    if not values and word.endswith("'s"):
        values.extend(
            f"{value} Z"
            for value in raw_dictionary_pronunciations(word[:-2], dictionary)
        )
    if not values and word.endswith("s"):
        values.extend(
            f"{value} {plural_suffix(value)}"
            for value in raw_dictionary_pronunciations(word[:-1], dictionary)
        )
    unique: dict[tuple[str, ...], None] = {}
    for value in values:
        phones = tuple(arpabet_to_ipa(phone) for phone in value.split())
        unique.setdefault(phones, None)
    return list(unique)


def normalized_reference_words(reference_text: str) -> tuple[str, list[str]]:
    normalized = (
        unicodedata.normalize("NFKC", reference_text)
        .replace("‘", "'")
        .replace("’", "'")
    )
    surface_words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)*", normalized)
    if not surface_words:
        raise ValueError("reference text contains no English words")
    return normalized, surface_words


def reference_word_variants(
    reference_text: str, dictionary: dict[str, str]
) -> tuple[str, list[list[ReferenceWord]]]:
    normalized, surface_words = normalized_reference_words(reference_text)
    variants_by_word: list[list[ReferenceWord]] = []
    for surface_word in surface_words:
        variants = dictionary_pronunciations(surface_word.lower(), dictionary)
        if not variants:
            raise ValueError(f"CMUdict has no pronunciation for {surface_word!r}")
        variants_by_word.append(
            [ReferenceWord(text=surface_word, phones=phones) for phones in variants]
        )
    return normalized, variants_by_word


def create_phonemized_reference(
    reference_text: str, phonemize_word: Callable[[str], str]
) -> PronunciationReference:
    normalized, surface_words = normalized_reference_words(reference_text)
    words: list[ReferenceWord] = []
    for surface_word in surface_words:
        phones = tuple(phonemize_word(surface_word).split())
        if not phones:
            raise ValueError(f"phonemizer produced no phones for {surface_word!r}")
        words.append(ReferenceWord(text=surface_word, phones=phones))
    return PronunciationReference(text=normalized, words=tuple(words))


def create_pronunciation_references(
    reference_text: str, dictionary: dict[str, str], max_candidates: int = MAX_REFERENCE_CANDIDATES
) -> list[PronunciationReference]:
    normalized, variants_by_word = reference_word_variants(reference_text, dictionary)
    candidates: list[tuple[ReferenceWord, ...]] = [()]
    for variants in variants_by_word:
        next_candidates: list[tuple[ReferenceWord, ...]] = []
        for candidate in candidates:
            for variant in variants:
                next_candidates.append(candidate + (variant,))
                if len(next_candidates) >= max_candidates:
                    break
            if len(next_candidates) >= max_candidates:
                break
        candidates = next_candidates
    return [PronunciationReference(text=normalized, words=words) for words in candidates]


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


def align_phone_sequences(expected: Sequence[str], observed: Sequence[str]) -> list[list[int]]:
    import numpy as np

    columns = len(observed) + 1
    scores = np.zeros((len(expected) + 1, columns), dtype=np.int32)
    operations = np.zeros_like(scores, dtype=np.uint8)
    scores[:, 0] = np.arange(len(expected) + 1)
    scores[0, :] = np.arange(columns)
    operations[1:, 0] = 1
    operations[0, 1:] = 2
    for expected_index in range(1, len(expected) + 1):
        for observed_index in range(1, len(observed) + 1):
            diagonal = scores[expected_index - 1, observed_index - 1] + int(
                expected[expected_index - 1] != observed[observed_index - 1]
            )
            deletion = scores[expected_index - 1, observed_index] + 1
            insertion = scores[expected_index, observed_index - 1] + 1
            if diagonal <= deletion and diagonal <= insertion:
                scores[expected_index, observed_index] = diagonal
                operations[expected_index, observed_index] = 0
            elif deletion <= insertion:
                scores[expected_index, observed_index] = deletion
                operations[expected_index, observed_index] = 1
            else:
                scores[expected_index, observed_index] = insertion
                operations[expected_index, observed_index] = 2

    observed_by_expected: list[list[int]] = [[] for _ in expected]
    expected_index = len(expected)
    observed_index = len(observed)
    while expected_index > 0 or observed_index > 0:
        operation = int(operations[expected_index, observed_index])
        if operation == 0 and expected_index > 0 and observed_index > 0:
            observed_by_expected[expected_index - 1].append(observed_index - 1)
            expected_index -= 1
            observed_index -= 1
        elif operation == 1 and expected_index > 0:
            expected_index -= 1
        elif observed_index > 0:
            attachment = min(len(expected) - 1, max(0, expected_index - 1))
            if observed_by_expected:
                observed_by_expected[attachment].append(observed_index - 1)
            observed_index -= 1
        else:
            break
    return observed_by_expected


def create_contextual_phonemized_reference(
    reference_text: str,
    phonemize_word: Callable[[str], str],
    phonemize_utterance: Callable[[str], str],
    phonemize_utterance_groups: Callable[
        [str], Sequence[Sequence[str]]
    ]
    | None = None,
) -> PronunciationReference:
    independent = create_phonemized_reference(reference_text, phonemize_word)
    contextual_boundaries: set[int] = set()
    if phonemize_utterance_groups is None:
        contextual_phones = tuple(phonemize_utterance(reference_text).split())
    else:
        groups = [tuple(group) for group in phonemize_utterance_groups(reference_text)]
        contextual_phones = tuple(phone for group in groups for phone in group)
        cursor = 0
        for group in groups:
            cursor += len(group)
            contextual_boundaries.add(cursor)
    if not contextual_phones:
        raise ValueError("utterance phonemizer produced no phones")
    if len(contextual_phones) < len(independent.words):
        raise ValueError("utterance phonemizer produced fewer phones than reference words")

    total_independent_phones = len(independent.phones)
    expected_cumulative = 0
    # State: consumed phones -> edit, length, missed source boundary, drift, ends.
    states: dict[int, tuple[int, int, int, int, tuple[int, ...]]] = {
        0: (0, 0, 0, 0, ())
    }
    for word_index, word in enumerate(independent.words):
        expected_cumulative += len(word.phones)
        remaining_words = len(independent.words) - word_index - 1
        next_states: dict[int, tuple[int, int, int, int, tuple[int, ...]]] = {}
        for start, previous in states.items():
            maximum_end = len(contextual_phones) - remaining_words
            for end in range(start + 1, maximum_end + 1):
                segment = contextual_phones[start:end]
                candidate = (
                    previous[0] + phone_edit_distance(word.phones, segment),
                    previous[1] + abs(len(word.phones) - len(segment)),
                    previous[2]
                    + int(
                        bool(contextual_boundaries)
                        and remaining_words > 0
                        and end not in contextual_boundaries
                    ),
                    previous[3]
                    + abs(
                        end * total_independent_phones
                        - expected_cumulative * len(contextual_phones)
                    ),
                    previous[4] + (end,),
                )
                current = next_states.get(end)
                if current is None or candidate[:4] < current[:4]:
                    next_states[end] = candidate
        states = next_states

    final = states.get(len(contextual_phones))
    if final is None:
        raise ValueError("could not partition contextual eSpeak phones by reference word")
    starts = (0, *final[4][:-1])
    contextual_words = [
        ReferenceWord(
            text=word.text,
            phones=contextual_phones[start:end],
        )
        for word, start, end in zip(independent.words, starts, final[4])
    ]
    return PronunciationReference(
        text=independent.text,
        words=tuple(contextual_words),
    )


def evidence_selected_reference(
    reference_text: str, recognized: Sequence[str], dictionary: dict[str, str]
) -> PronunciationReference:
    normalized, variants_by_word = reference_word_variants(reference_text, dictionary)
    primary_words = [variants[0] for variants in variants_by_word]
    primary_phones = [phone for word in primary_words for phone in word.phones]
    observed_by_expected = align_phone_sequences(primary_phones, recognized)
    offset = 0
    selected: list[ReferenceWord] = []
    for variants in variants_by_word:
        primary_length = len(variants[0].phones)
        indexes = sorted(
            index
            for group in observed_by_expected[offset : offset + primary_length]
            for index in group
        )
        offset += primary_length
        if not indexes:
            selected.append(variants[0])
            continue
        observed_slice = recognized[indexes[0] : indexes[-1] + 1]
        selected.append(
            min(variants, key=lambda variant: phone_edit_distance(variant.phones, observed_slice))
        )
    return PronunciationReference(text=normalized, words=tuple(selected))


def greedy_decode(
    logits: Any, token_by_id: Sequence[str], blank_token_id: int
) -> list[str]:
    best_ids = logits.argmax(axis=1).tolist()
    result: list[str] = []
    previous = -1
    for best_id in best_ids:
        if best_id != previous and best_id != blank_token_id:
            token = token_by_id[best_id] if 0 <= best_id < len(token_by_id) else ""
            if token and not token.startswith("<"):
                result.append(token)
        previous = best_id
    return result


def log_softmax(logits: Any) -> Any:
    import numpy as np

    maximum = logits.max(axis=1, keepdims=True)
    shifted = logits - maximum
    return shifted - np.log(np.exp(shifted).sum(axis=1, keepdims=True))


def align_ctc(
    log_probabilities: Any, token_ids: Sequence[int], blank_token_id: int
) -> CtcAlignment | None:
    import numpy as np

    frame_count = int(log_probabilities.shape[0])
    state_count = len(token_ids) * 2 + 1
    back_pointers = np.full((frame_count, state_count), -1, dtype=np.int32)
    previous = np.full(state_count, -np.inf, dtype=np.float64)
    previous[0] = float(log_probabilities[0, blank_token_id])
    if token_ids:
        previous[1] = float(log_probabilities[0, token_ids[0]])

    for frame in range(1, frame_count):
        current = np.full(state_count, -np.inf, dtype=np.float64)
        for state in range(state_count):
            best_state = state
            best_score = previous[state]
            if state > 0 and previous[state - 1] > best_score:
                best_state = state - 1
                best_score = previous[state - 1]
            if (
                state > 1
                and state % 2 == 1
                and token_ids[(state - 1) // 2] != token_ids[(state - 3) // 2]
                and previous[state - 2] > best_score
            ):
                best_state = state - 2
                best_score = previous[state - 2]
            if not math.isfinite(float(best_score)):
                continue
            token_id = blank_token_id if state % 2 == 0 else token_ids[(state - 1) // 2]
            current[state] = best_score + float(log_probabilities[frame, token_id])
            back_pointers[frame, state] = best_state
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
        state = int(back_pointers[frame, state])
        if state < 0:
            return None
        states[frame - 1] = state

    spans: list[tuple[int, int]] = []
    for token_index in range(len(token_ids)):
        target_state = token_index * 2 + 1
        matching = np.flatnonzero(states == target_state)
        if matching.size == 0:
            return None
        spans.append((int(matching[0]), int(matching[-1]) + 1))
    return CtcAlignment(
        path_score=final_score / frame_count,
        states=states,
        spans=tuple(spans),
    )


def js_round(value: float) -> int:
    return math.floor(value + 0.5)


def sigmoid(value: float) -> float:
    if value >= 0:
        factor = math.exp(-value)
        return 1.0 / (1.0 + factor)
    factor = math.exp(value)
    return factor / (1.0 + factor)


def rounded_average(values: Iterable[int]) -> int:
    data = list(values)
    return js_round(sum(data) / len(data)) if data else 0


def assess_ctc_pronunciation(
    logits: Any,
    vocabulary: dict[str, int],
    reference_text: str,
    duration_ms: float,
    dictionary: dict[str, str],
    *,
    candidate_references: Sequence[PronunciationReference] | None = None,
    reference_source: str = "published Whisper ASR hypothesis; not a known script",
) -> dict[str, Any]:
    import numpy as np

    if logits.ndim != 2:
        raise ValueError(f"expected [frames, vocabulary] logits, got {logits.shape}")
    frame_count, vocabulary_size = map(int, logits.shape)
    blank_token_id = int(vocabulary.get("<pad>", 0))
    token_by_id = [""] * vocabulary_size
    for token, token_id in vocabulary.items():
        if 0 <= int(token_id) < vocabulary_size:
            token_by_id[int(token_id)] = token
    recognized = greedy_decode(logits, token_by_id, blank_token_id)
    if candidate_references is None:
        evidence_reference = evidence_selected_reference(reference_text, recognized, dictionary)
        references = [
            evidence_reference,
            *create_pronunciation_references(reference_text, dictionary),
        ]
    else:
        references = list(candidate_references)
        if not references:
            raise ValueError("candidate references must not be empty")
    references = sorted(
        references, key=lambda reference: phone_edit_distance(reference.phones, recognized)
    )[:ALIGNMENT_REFERENCE_CANDIDATES]
    log_probabilities = log_softmax(logits)

    best_reference: PronunciationReference | None = None
    best_alignment: CtcAlignment | None = None
    for reference in references:
        try:
            token_ids = [int(vocabulary[phone]) for phone in reference.phones]
        except KeyError as exc:
            raise ValueError(f"phoneme model vocabulary lacks {exc.args[0]!r}") from exc
        if len(token_ids) > frame_count:
            continue
        alignment = align_ctc(log_probabilities, token_ids, blank_token_id)
        if alignment and (
            best_alignment is None or alignment.path_score > best_alignment.path_score
        ):
            best_reference = reference
            best_alignment = alignment
    if best_reference is None or best_alignment is None:
        raise ValueError("audio frames are insufficient for the provisional reference")

    frame_duration_ms = duration_ms / frame_count
    token_ids = [int(vocabulary[phone]) for phone in best_reference.phones]
    phone_results: list[dict[str, Any]] = []
    for index, (start_frame, end_frame) in enumerate(best_alignment.spans):
        expected_id = token_ids[index]
        mean_logits = logits[start_frame:end_frame].mean(axis=0)
        alternative_ids = [
            token_id
            for token_id, token in enumerate(token_by_id)
            if token_id not in {blank_token_id, expected_id}
            and token
            and not token.startswith("<")
        ]
        observed_id = max(alternative_ids, key=lambda token_id: float(mean_logits[token_id]))
        margin = float(mean_logits[expected_id] - mean_logits[observed_id])
        score = js_round(sigmoid(margin) * 100)
        confidence = round(min(1.0, abs(margin) / 4.0), 3)
        phone_results.append(
            {
                "expected": best_reference.phones[index],
                **(
                    {"observed": token_by_id[observed_id]}
                    if observed_id != expected_id and margin < 0
                    else {}
                ),
                "score": score,
                "confidence": confidence,
                "start_ms": js_round(start_frame * frame_duration_ms),
                "end_ms": js_round(end_frame * frame_duration_ms),
            }
        )

    words: list[dict[str, Any]] = []
    offset = 0
    for word_index, word in enumerate(best_reference.words):
        word_phones = phone_results[offset : offset + len(word.phones)]
        offset += len(word.phones)
        words.append(
            {
                "word_index": word_index,
                "text": word.text,
                "expected_phones": list(word.phones),
                "score": rounded_average(phone["score"] for phone in word_phones),
                "start_ms": word_phones[0]["start_ms"] if word_phones else 0,
                "end_ms": word_phones[-1]["end_ms"] if word_phones else 0,
                "phones": word_phones,
            }
        )
    return {
        "reference_text": best_reference.text,
        "reference_source": reference_source,
        "recognized_phones": recognized,
        "overall_score": rounded_average(phone["score"] for phone in phone_results),
        "alignment_path_score": round(best_alignment.path_score, 6),
        "frame_count": frame_count,
        "duration_ms": js_round(duration_ms),
        "words": words,
    }


def decode_audio(path: Path) -> Any:
    import numpy as np

    completed = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            os.fspath(path),
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
    samples = np.frombuffer(completed.stdout, dtype=np.float32).copy()
    if samples.size == 0:
        raise ValueError(f"decoded audio is empty: {path}")
    mean = float(samples.mean())
    variance = float(((samples - mean) ** 2).mean())
    samples -= mean
    samples /= math.sqrt(variance + 1e-7)
    return samples


def create_onnx_session(model_path: Path) -> Any:
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    return ort.InferenceSession(
        os.fspath(model_path), sess_options=options, providers=["CPUExecutionProvider"]
    )


def infer_logits(session: Any, samples: Any) -> Any:
    import numpy as np

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: samples[np.newaxis, :]})
    logits = next((output for output in outputs if getattr(output, "ndim", 0) == 3), None)
    if logits is None or logits.shape[0] != 1:
        raise ValueError("ONNX model did not return [1, frames, vocabulary] logits")
    return np.asarray(logits[0], dtype=np.float32)


def load_textpa_alignments(path: Path) -> dict[str, list[list[Any]]]:
    results: dict[str, list[list[Any]]] = {}
    with ZipFile(path) as archive:
        for name in archive.namelist():
            if (
                not name.startswith("multiPA/gpt4omini/")
                or not name.endswith(".json")
                or "/._" in name
            ):
                continue
            value = json.loads(archive.read(name))
            results[str(value["wavname"])] = value["alignment"]
    if len(results) != 50:
        raise ValueError(f"expected 50 TextPA alignments, found {len(results)}")
    return results


def map_pause_to_words(
    start_ms: int, end_ms: int, words: Sequence[dict[str, Any]]
) -> tuple[str | None, str | None]:
    midpoint = (start_ms + end_ms) / 2
    previous = [word for word in words if word["end_ms"] <= midpoint]
    following = [word for word in words if word["start_ms"] >= midpoint]
    after_word = previous[-1]["text"] if previous else None
    before_word = following[0]["text"] if following else None
    return after_word, before_word


def textpa_pause_events(
    raw_alignment: Sequence[Sequence[Any]], words: Sequence[dict[str, Any]]
) -> dict[str, Any]:
    normalized: list[tuple[float, str]] = []
    for item in raw_alignment:
        if len(item) != 2 or float(item[0]) < 0 or not isinstance(item[1], str):
            raise ValueError("invalid TextPA alignment entry")
        normalized.append((float(item[0]), item[1]))
    cursor_ms = 0
    events: list[dict[str, Any]] = []
    for index, (duration_seconds, token) in enumerate(normalized):
        start_ms = cursor_ms
        end_ms = cursor_ms + js_round(duration_seconds * 1000)
        cursor_ms = end_ms
        if token != "[SIL]":
            continue
        previous_phone = next(
            (normalized[position][1] for position in range(index - 1, -1, -1) if normalized[position][1] != "[SIL]"),
            None,
        )
        next_phone = next(
            (normalized[position][1] for position in range(index + 1, len(normalized)) if normalized[position][1] != "[SIL]"),
            None,
        )
        if previous_phone is None or next_phone is None:
            continue
        after_word, before_word = map_pause_to_words(start_ms, end_ms, words)
        duration_ms = end_ms - start_ms
        if duration_ms >= 600:
            salience = "long"
        elif duration_ms >= 250:
            salience = "noticeable"
        else:
            salience = "short"
        events.append(
            {
                "evidence_id": f"F-{len(events) + 1:03d}",
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": duration_ms,
                "salience": salience,
                "previous_cmu_phone": previous_phone,
                "next_cmu_phone": next_phone,
                "after_word_approx": after_word,
                "before_word_approx": before_word,
            }
        )
    return {
        "source": "published TextPA Charsiu 10 ms CMU frame alignment",
        "word_mapping": "approximate mapping through independent CTC word timestamps",
        "alignment_duration_ms": cursor_ms,
        "events": events,
    }


def pronunciation_candidates(ctc: dict[str, Any]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for word in ctc["words"]:
        for phone_index, phone in enumerate(word["phones"]):
            if "observed" not in phone:
                continue
            high_confidence = (
                phone["score"] < HIGH_CONFIDENCE_SCORE
                and phone["confidence"] >= HIGH_CONFIDENCE_MIN
            )
            if not high_confidence and phone["confidence"] < 0.15:
                continue
            candidates.append(
                {
                    "evidence_id": f"P-W{word['word_index'] + 1:03d}-P{phone_index + 1:02d}",
                    "strength": "high" if high_confidence else "tentative",
                    "word": word["text"],
                    "word_index": word["word_index"],
                    "expected_phone": phone["expected"],
                    "observed_phone": phone["observed"],
                    "match_score": phone["score"],
                    "confidence": phone["confidence"],
                    "start_ms": phone["start_ms"],
                    "end_ms": phone["end_ms"],
                }
            )
    candidates.sort(
        key=lambda item: (
            item["strength"] != "high",
            item["match_score"],
            -item["confidence"],
            item["start_ms"],
        )
    )
    selected = candidates[:12]
    return {
        "threshold_policy": {
            "high": f"score < {HIGH_CONFIDENCE_SCORE} and confidence >= {HIGH_CONFIDENCE_MIN}",
            "tentative": "alternative phone is stronger, but evidence does not meet the high threshold",
        },
        "candidates": selected,
        "omitted_candidate_count": max(0, len(candidates) - len(selected)),
    }


def llm_evidence(record: dict[str, Any]) -> dict[str, Any]:
    ctc = record["ctc"]
    pauses = record["textpa_pauses"]
    return {
        "sample_id": record["id"],
        "provisional_reference": {
            "text": record["transcript"],
            "source": "published Whisper ASR hypothesis",
            "is_ground_truth": False,
        },
        "ctc_forced_alignment": {
            "model": "facebook/wav2vec2-lv-60-espeak-cv-ft ONNX INT8",
            "overall_match_score_experimental": ctc["overall_score"],
            **record["pronunciation_candidates"],
        },
        "textpa_pause_analysis": pauses,
    }


SYSTEM_PROMPT = """You are an evidence-constrained English pronunciation feedback editor.
You do not hear the audio. You may only restate implications supported by the supplied CTC
and TextPA pause evidence. Never invent pitch, loudness, stress, intonation, emotion, accent,
grammar, or content observations. Return strict JSON only."""


def render_prompt(evidence: dict[str, Any]) -> str:
    return """请根据下面的结构化声学证据生成中文语音纠错，不要评分。

证据边界：
1. 这是自由表达录音；reference 是 Whisper ASR 假设，不是题目给定原文。ASR 可能错误。
2. CTC 强制对齐会把 reference 的全部音素压到音频上。因此不得把它用于断言漏词、错词或
   语法错误；只能描述列出的 expected/observed 音素冲突。
3. strength=high 的 P 证据可以写成“较可能”；strength=tentative 只能写成“建议复听确认”。
4. TextPA 的 F 证据来自独立 Charsiu [SIL] 检测。short 停顿不要单独报错；noticeable 只有
   在明显影响节奏时才可温和提示；long 可以作为长停顿反馈。相邻词映射是近似的。
5. 每条问题必须引用存在的 evidence_id。不要从 overall score 推导等级或总评。
6. 没有足够证据时宁可输出空问题列表。练习建议必须针对证据里的具体音素或停顿。
7. pronunciation_issues 最多 6 条，fluency_issues 最多 4 条；同一个词的多个 P 证据应尽量
   合并为一条，不要把候选列表机械复述一遍。

严格输出以下 JSON 对象，不要 Markdown 代码块，不要增加字段：
{
  "summary": "一句简短、保守的总结",
  "pronunciation_issues": [
    {
      "evidence_ids": ["P-..."],
      "certainty": "high 或 tentative",
      "location": "词和大致时间",
      "finding": "证据支持的发现",
      "practice": "具体练习建议"
    }
  ],
  "fluency_issues": [
    {
      "evidence_ids": ["F-..."],
      "certainty": "high 或 tentative",
      "location": "相邻词和大致时间",
      "finding": "证据支持的发现",
      "practice": "具体练习建议"
    }
  ],
  "positive_observations": ["仅限证据直接支持的保守观察"],
  "limitations": ["本条结果需要人工复听时应说明原因"]
}

声学证据 JSON：
""" + json.dumps(evidence, ensure_ascii=False, indent=2)


def is_billing(status: int, body: str) -> bool:
    lowered = body.lower()
    return status == 402 or any(word in lowered for word in BILLING_WORDS)


def retry_after_seconds(headers: Any, attempt: int, status: int) -> float:
    raw = headers.get("Retry-After") if headers else None
    try:
        explicit = float(raw) if raw else 0.0
    except ValueError:
        explicit = 0.0
    if status == 429:
        return max(explicit, 30.0)
    return max(explicit, min(5.0 * (2**attempt), 60.0))


def parse_json_response(content: str) -> dict[str, Any]:
    candidate = content.strip().removeprefix("\ufeff")
    if candidate.startswith("```"):
        lines = candidate.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines.pop()
        candidate = "\n".join(lines).strip()
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("LLM response does not contain a JSON object")
        value = json.loads(candidate[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("LLM response is not a JSON object")
    return value


def validate_feedback(value: dict[str, Any], evidence: dict[str, Any]) -> None:
    expected_keys = {
        "summary",
        "pronunciation_issues",
        "fluency_issues",
        "positive_observations",
        "limitations",
    }
    if set(value) != expected_keys:
        raise ValueError(f"LLM response keys differ from the contract: {sorted(value)}")
    if not isinstance(value["summary"], str):
        raise ValueError("LLM summary must be a string")
    for key in ("pronunciation_issues", "fluency_issues", "positive_observations", "limitations"):
        if not isinstance(value[key], list):
            raise ValueError(f"LLM field {key} must be a list")
    valid_pronunciation = {
        item["evidence_id"]
        for item in evidence["ctc_forced_alignment"]["candidates"]
    }
    valid_fluency = {
        item["evidence_id"] for item in evidence["textpa_pause_analysis"]["events"]
    }
    for field, valid_ids in (
        ("pronunciation_issues", valid_pronunciation),
        ("fluency_issues", valid_fluency),
    ):
        for issue in value[field]:
            if not isinstance(issue, dict) or set(issue) != {
                "evidence_ids",
                "certainty",
                "location",
                "finding",
                "practice",
            }:
                raise ValueError(f"LLM {field} item differs from the contract")
            ids = issue["evidence_ids"]
            if not isinstance(ids, list) or not ids or not all(item in valid_ids for item in ids):
                raise ValueError(f"LLM {field} cites missing or invalid evidence IDs: {ids}")
            if issue["certainty"] not in {"high", "tentative"}:
                raise ValueError(f"LLM {field} uses an invalid certainty")
            if not all(isinstance(issue[key], str) for key in ("location", "finding", "practice")):
                raise ValueError(f"LLM {field} text fields must be strings")
    if not all(isinstance(item, str) for item in value["positive_observations"]):
        raise ValueError("LLM positive observations must be strings")
    if not all(isinstance(item, str) for item in value["limitations"]):
        raise ValueError("LLM limitations must be strings")


def call_llm(
    prompt: str,
    *,
    endpoint: str,
    api_key: str,
    model: str,
    max_tokens: int,
    temperature: float,
    thinking: bool,
    timeout: float,
    retries: int,
) -> dict[str, Any]:
    request_body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if thinking:
        request_body["chat_template_kwargs"] = {"enable_thinking": True}
    encoded = json.dumps(request_body, ensure_ascii=False).encode("utf-8")
    last_error = ""
    for attempt in range(retries):
        request = Request(
            endpoint,
            data=encoded,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8", errors="replace")
                status = int(response.status)
                headers = response.headers
            if status != 200:
                if is_billing(status, raw):
                    raise BillingError(f"provider billing error HTTP {status}: {raw[:500]}")
                if status in RETRYABLE_HTTP and attempt + 1 < retries:
                    time.sleep(retry_after_seconds(headers, attempt, status))
                    continue
                raise RuntimeError(f"LLM HTTP {status}: {raw[:1000]}")
            payload = json.loads(raw)
            content = payload["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("LLM response contains no text content")
            return {"api_response": payload, "content": content}
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            last_error = f"HTTP {exc.code}: {raw[:1000]}"
            if is_billing(exc.code, raw):
                raise BillingError(f"provider billing error {last_error}") from exc
            if exc.code in RETRYABLE_HTTP and attempt + 1 < retries:
                time.sleep(retry_after_seconds(exc.headers, attempt, exc.code))
                continue
            raise RuntimeError(last_error) from exc
        except BillingError:
            raise
        except (URLError, TimeoutError) as exc:
            last_error = f"network error: {exc}"
            if attempt + 1 < retries:
                time.sleep(min(5.0 * (2**attempt), 60.0))
                continue
            raise RuntimeError(last_error) from exc
    raise RuntimeError(last_error or "LLM request failed")


def download_audio(filename: str, destination: Path) -> None:
    local_reference = TEXTPA_ROOT / "benchmark-data/multipa-reference/wav" / filename
    if destination.exists() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    if local_reference.exists():
        destination.write_bytes(local_reference.read_bytes())
        return
    url = (
        "https://huggingface.co/yuwchen/multipa/resolve/"
        f"{MULTIPA_REVISION}/wav/{quote(filename)}"
    )
    temporary = destination.with_suffix(destination.suffix + ".part")
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "textpa-ctc-pause-demo/0.1"})
            with urlopen(request, timeout=120) as response:
                temporary.write_bytes(response.read())
            if temporary.stat().st_size == 0:
                raise ValueError("downloaded audio is empty")
            temporary.replace(destination)
            return
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def select_records(
    cues: Sequence[dict[str, Any]],
    dictionary: dict[str, str],
    *,
    seed: int,
    count: int,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    shuffled = list(cues)
    random.Random(seed).shuffle(shuffled)
    selected: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for cue in shuffled:
        try:
            create_pronunciation_references(str(cue["transcript"]), dictionary, 1)
        except Exception as exc:
            skipped.append({"id": str(cue.get("id")), "reason": str(exc)})
            continue
        selected.append(cue)
        if len(selected) == count:
            break
    if len(selected) != count:
        raise ValueError(f"only {len(selected)} randomly ordered samples support CMUdict")
    return selected, skipped


def feedback_markdown(feedback: dict[str, Any]) -> str:
    lines = [feedback["summary"], ""]
    lines.append("### 发音")
    if feedback["pronunciation_issues"]:
        for issue in feedback["pronunciation_issues"]:
            evidence = ", ".join(issue["evidence_ids"])
            lines.extend(
                [
                    f"- **{issue['location']}**（{issue['certainty']}；{evidence}）：{issue['finding']}",
                    f"  练习：{issue['practice']}",
                ]
            )
    else:
        lines.append("- 没有输出证据充分的具体发音问题。")
    lines.extend(["", "### 流利度"])
    if feedback["fluency_issues"]:
        for issue in feedback["fluency_issues"]:
            evidence = ", ".join(issue["evidence_ids"])
            lines.extend(
                [
                    f"- **{issue['location']}**（{issue['certainty']}；{evidence}）：{issue['finding']}",
                    f"  练习：{issue['practice']}",
                ]
            )
    else:
        lines.append("- 没有输出证据充分的停顿问题。")
    if feedback["positive_observations"]:
        lines.extend(["", "### 保守的正面观察"])
        lines.extend(f"- {item}" for item in feedback["positive_observations"])
    if feedback["limitations"]:
        lines.extend(["", "### 限制"])
        lines.extend(f"- {item}" for item in feedback["limitations"])
    return "\n".join(lines)


def build_report(results: Sequence[dict[str, Any]], output_dir: Path) -> str:
    lines = [
        "# CTC + TextPA pause correction demo",
        "",
        "这三条是固定种子随机样本。参考文本来自 Whisper ASR，而不是题目原文；请一边试听",
        "一边核对具体音素和停顿反馈。`high` 也只表示声学模型内部证据较强，不等同人工真值。",
        "",
    ]
    for index, result in enumerate(results, 1):
        filename = Path(result["audio_path"]).name
        lines.extend(
            [
                f"## 样本 {index}",
                "",
                f"- ID：`{result['id']}`",
                f"- 音频：[试听](audio/{filename})",
                f"- CTC 实验性整体匹配度：`{result['ctc_overall_score']}/100`",
                f"- TextPA 内部停顿数：`{result['textpa_pause_count']}`",
                "",
                "**Whisper 临时参考文本**",
                "",
                result["transcript"].strip(),
                "",
                feedback_markdown(result["feedback"]),
                "",
                f"完整证据：[JSON](samples/{result['id']}.evidence.json)",
                "",
            ]
        )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--seed", type=int, default=20260820)
    parser.add_argument("--cues", type=Path, default=DEFAULT_CUES)
    parser.add_argument("--source-zip", type=Path, default=DEFAULT_SOURCE_ZIP)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--dictionary", type=Path, default=DEFAULT_DICTIONARY)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--env", type=Path, default=TEXTPA_ROOT / ".env.local")
    parser.add_argument("--evidence-only", action="store_true")
    parser.add_argument("--overwrite-llm", action="store_true")
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--thinking", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--retries", type=int, default=4)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 2 <= args.count <= 3:
        raise ValueError("demo count must be 2 or 3")
    if args.retries < 1:
        raise ValueError("retries must be positive")
    output_dir = args.output_dir.resolve()
    samples_dir = output_dir / "samples"
    audio_dir = output_dir / "audio"
    output_dir.mkdir(parents=True, exist_ok=True)
    samples_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    print("loading CMUdict and selecting samples", flush=True)
    dictionary = load_cmu_dictionary(args.dictionary)
    cues = read_jsonl(args.cues)
    selected, skipped = select_records(cues, dictionary, seed=args.seed, count=args.count)
    alignments = load_textpa_alignments(args.source_zip)
    selection = {
        "seed": args.seed,
        "requested_count": args.count,
        "population": "50 published MultiPA cues, filtered only for product-compatible CMUdict coverage",
        "selected_ids": [str(record["id"]) for record in selected],
        "skipped_before_selection": skipped,
    }
    write_json(output_dir / "selection.json", selection)

    model_path = args.model_dir / "onnx/model_quantized.onnx"
    vocabulary = json.loads((args.model_dir / "vocab.json").read_text(encoding="utf-8"))
    print("initializing ONNX Runtime", flush=True)
    session = create_onnx_session(model_path)
    evidence_records: list[dict[str, Any]] = []
    for index, cue in enumerate(selected, 1):
        sample_id = str(cue["id"])
        print(f"[{index}/{len(selected)}] preparing {sample_id}", flush=True)
        audio_path = audio_dir / sample_id
        download_audio(sample_id, audio_path)
        samples = decode_audio(audio_path)
        print(f"[{index}/{len(selected)}] ONNX + CTC alignment", flush=True)
        logits = infer_logits(session, samples)
        ctc = assess_ctc_pronunciation(
            logits,
            {str(key): int(value) for key, value in vocabulary.items()},
            str(cue["transcript"]),
            samples.size / SAMPLE_RATE * 1000,
            dictionary,
        )
        pauses = textpa_pause_events(alignments[sample_id], ctc["words"])
        record = {
            "schema_version": 1,
            "id": sample_id,
            "audio_path": f"audio/{sample_id}",
            "audio_sha256": sha256_file(audio_path),
            "transcript": str(cue["transcript"]),
            "transcript_source": "published MultiPA Whisper large-v3 output",
            "ctc": ctc,
            "pronunciation_candidates": pronunciation_candidates(ctc),
            "textpa_phonemes_cmu": cue["phonemes_cmu"],
            "textpa_pauses": pauses,
        }
        evidence_records.append(record)
        write_json(samples_dir / f"{sample_id}.evidence.json", record)

    write_json(output_dir / "evidence-summary.json", evidence_records)
    if args.evidence_only:
        print(f"evidence complete: {output_dir}", flush=True)
        return 0

    load_env(args.env)
    api_key = os.environ.get("TEXTPA_API_KEY")
    if not api_key:
        raise ValueError("TEXTPA_API_KEY is missing")
    if os.environ.get("TEXTPA_API_STYLE", "chat") != "chat":
        raise ValueError("this demo currently requires the chat completions API")
    base_url = os.environ.get("TEXTPA_BASE_URL", "").rstrip("/")
    endpoint = base_url + "/chat/completions"
    model = os.environ.get("TEXTPA_MODEL", "agnes-2.5-flash")
    max_tokens = int(os.environ.get("TEXTPA_MAX_TOKENS", "65535"))
    results: list[dict[str, Any]] = []
    for index, record in enumerate(evidence_records, 1):
        sample_id = record["id"]
        evidence = llm_evidence(record)
        prompt = render_prompt(evidence)
        prompt_path = samples_dir / f"{sample_id}.prompt.txt"
        response_path = samples_dir / f"{sample_id}.response.json"
        write_text(prompt_path, prompt)
        prompt_sha256 = sha256_bytes(prompt.encode("utf-8"))
        if response_path.exists() and not args.overwrite_llm:
            wrapper = json.loads(response_path.read_text(encoding="utf-8"))
            if wrapper.get("prompt_sha256") != prompt_sha256:
                raise ValueError(
                    f"saved response prompt differs for {sample_id}; use --overwrite-llm intentionally"
                )
            feedback = wrapper["feedback"]
            validate_feedback(feedback, evidence)
            print(f"[{index}/{len(evidence_records)}] reusing saved LLM response", flush=True)
        else:
            print(f"[{index}/{len(evidence_records)}] requesting {model}", flush=True)
            response = call_llm(
                prompt,
                endpoint=endpoint,
                api_key=api_key,
                model=model,
                max_tokens=max_tokens,
                temperature=args.temperature,
                thinking=args.thinking,
                timeout=args.timeout,
                retries=args.retries,
            )
            feedback = parse_json_response(response["content"])
            validate_feedback(feedback, evidence)
            wrapper = {
                "schema_version": 1,
                "id": sample_id,
                "prompt_sha256": prompt_sha256,
                "request_config": {
                    "endpoint": endpoint,
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": args.temperature,
                    "thinking": args.thinking,
                },
                "api_response": response["api_response"],
                "feedback": feedback,
            }
            write_json(response_path, wrapper)
        results.append(
            {
                "schema_version": 1,
                "id": sample_id,
                "audio_path": record["audio_path"],
                "transcript": record["transcript"],
                "ctc_overall_score": record["ctc"]["overall_score"],
                "pronunciation_candidate_count": len(
                    record["pronunciation_candidates"]["candidates"]
                ),
                "textpa_pause_count": len(record["textpa_pauses"]["events"]),
                "feedback": feedback,
            }
        )

    write_text(
        output_dir / "results.jsonl",
        "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in results),
    )
    write_text(output_dir / "report.md", build_report(results, output_dir))
    write_json(
        output_dir / "manifest.json",
        {
            "schema_version": 1,
            "completed_at": utc_now(),
            "selection": selection,
            "sources": {
                "cues": {"path": str(args.cues), "sha256": sha256_file(args.cues)},
                "textpa_results_zip": {
                    "path": str(args.source_zip),
                    "sha256": sha256_file(args.source_zip),
                },
                "ctc_model": {
                    "path": str(model_path),
                    "sha256": sha256_file(model_path),
                },
                "vocabulary": {
                    "path": str(args.model_dir / "vocab.json"),
                    "sha256": sha256_file(args.model_dir / "vocab.json"),
                },
                "script": {
                    "path": str(Path(__file__).resolve()),
                    "sha256": sha256_file(Path(__file__).resolve()),
                },
            },
            "llm": {
                "endpoint": endpoint,
                "model": model,
                "max_tokens": max_tokens,
                "temperature": args.temperature,
                "thinking": args.thinking,
            },
            "result_count": len(results),
        },
    )
    print(f"demo complete: {output_dir / 'report.md'}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BillingError as exc:
        print(f"STOPPED: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(2) from exc
