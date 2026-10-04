from __future__ import annotations

import json
import math
import re
from pathlib import Path

import cmudict
import numpy as np
import torch
from scipy.io import wavfile
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor, Wav2Vec2CTCTokenizer


ROOT = Path('/workspace/.gop-research')
MODEL_DIR = ROOT / 'model'
AUDIO = ROOT / 'exam' / 'recording-11.wav'
OUTPUT = ROOT / 'exam' / 'pronunciation-result.json'
TRANSCRIPT = (
    "I do believe that e-books overweigh paper books when, in terms of the "
    "preferences for reading. The three reasons include: the e-books large "
    "capacity of storage, its convenience, and also its easy access to any "
    "material worldwide, including both the latest papers in the top notch "
    "journals and also some of the best sellers. That hasn't been printed in "
    "paper books. But if you want me to say some advantages of paper books, I "
    "do believe that reading paper books is like sipping a cup of tea. Because "
    "if you have the leisure, if you have the convenience, and if you do have "
    "time, or if you just want to read one book, then you can take one and sit "
    "by the window and read it, enjoy it."
)


def words_and_phones(text: str):
    # Hyphens are word boundaries for CMUdict; apostrophes remain part of a word.
    surfaces = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)
    result = []
    dictionary = cmudict.dict()
    manual = {
        # ASR produced this uncommon spelling. Keep its acoustic hypothesis
        # explicit instead of silently replacing it with a semantic correction.
        'overweigh': [('OW', 'V', 'ER', 'W', 'EY')],
    }
    for surface in surfaces:
        key = surface.lower()
        variants = dictionary.get(key) or manual.get(key)
        if not variants and key.endswith('s'):
            base = dictionary.get(key[:-1])
            if base:
                variants = [tuple(item) + ('Z',) for item in base]
        if not variants:
            raise ValueError(f'CMUdict has no pronunciation for {surface!r}')
        # Use the first CMU variant as the canonical candidate. The result also
        # records all legal variants so a mismatch is not treated as definitive.
        cleaned = [[re.sub(r'\d$', '', phone) for phone in variant] for variant in variants]
        result.append({'word': surface, 'variants': cleaned, 'phones': cleaned[0]})
    return result


def log_softmax(values: np.ndarray) -> np.ndarray:
    maximum = values.max(axis=1, keepdims=True)
    shifted = values - maximum
    return shifted - np.log(np.exp(shifted).sum(axis=1, keepdims=True))


def forced_align(logp: np.ndarray, token_ids: list[int], blank: int):
    """Log-space CTC Viterbi alignment; returns state path and score."""
    frames = int(logp.shape[0])
    states = len(token_ids) * 2 + 1
    prev = np.full(states, -np.inf, dtype=np.float64)
    prev[0] = logp[0, blank]
    if token_ids:
        prev[1] = logp[0, token_ids[0]]
    back = np.full((frames, states), -1, dtype=np.int32)
    for frame in range(1, frames):
        cur = np.full(states, -np.inf, dtype=np.float64)
        for state in range(states):
            best_state = state
            best = prev[state]
            if state > 0 and prev[state - 1] > best:
                best_state, best = state - 1, prev[state - 1]
            if (
                state > 1
                and state % 2 == 1
                and token_ids[(state - 1) // 2] != token_ids[(state - 3) // 2]
                and prev[state - 2] > best
            ):
                best_state, best = state - 2, prev[state - 2]
            if math.isfinite(float(best)):
                token = blank if state % 2 == 0 else token_ids[(state - 1) // 2]
                cur[state] = best + logp[frame, token]
                back[frame, state] = best_state
        prev = cur
    state = states - 1
    if states > 1 and prev[states - 2] > prev[state]:
        state -= 1
    if not math.isfinite(float(prev[state])):
        raise RuntimeError('CTC target cannot be aligned to this audio')
    path = np.empty(frames, dtype=np.int32)
    path[-1] = state
    for frame in range(frames - 1, 0, -1):
        state = int(back[frame, state])
        if state < 0:
            raise RuntimeError('incomplete CTC backtrace')
        path[frame - 1] = state
    spans = []
    for index in range(len(token_ids)):
        matching = np.flatnonzero(path == index * 2 + 1)
        if matching.size == 0:
            raise RuntimeError(f'phone {index} received no CTC frames')
        spans.append((int(matching[0]), int(matching[-1]) + 1))
    return path, spans, float(prev[state]) / frames


def greedy_decode(logits: np.ndarray, tokenizer: Wav2Vec2CTCTokenizer) -> list[str]:
    ids = logits.argmax(axis=1).tolist()
    blank = int(tokenizer.convert_tokens_to_ids('<pad>'))
    output = []
    previous = -1
    for token_id in ids:
        if token_id != previous and token_id != blank:
            token = tokenizer.convert_ids_to_tokens(int(token_id))
            if token and not token.startswith('<'):
                output.append(token)
        previous = token_id
    return output


def edit_alignment(expected: list[str], observed: list[str]):
    rows = [[0] * (len(observed) + 1) for _ in range(len(expected) + 1)]
    op = [[None] * (len(observed) + 1) for _ in range(len(expected) + 1)]
    for i in range(1, len(expected) + 1):
        rows[i][0] = i
        op[i][0] = 'delete'
    for j in range(1, len(observed) + 1):
        rows[0][j] = j
        op[0][j] = 'insert'
    for i in range(1, len(expected) + 1):
        for j in range(1, len(observed) + 1):
            diagonal = rows[i - 1][j - 1] + int(expected[i - 1] != observed[j - 1])
            delete = rows[i - 1][j] + 1
            insert = rows[i][j - 1] + 1
            best = min(diagonal, delete, insert)
            rows[i][j] = best
            # Prefer a diagonal match/substitution, then deletion, then insertion.
            op[i][j] = 'match' if best == diagonal else ('delete' if best == delete else 'insert')
    result = []
    i, j = len(expected), len(observed)
    while i or j:
        action = op[i][j]
        if action in {'match'}:
            result.append((i - 1, j - 1, expected[i - 1], observed[j - 1], expected[i - 1] == observed[j - 1]))
            i -= 1
            j -= 1
        elif action == 'delete':
            result.append((i - 1, None, expected[i - 1], None, False))
            i -= 1
        else:
            result.append((None, j - 1, None, observed[j - 1], False))
            j -= 1
    return list(reversed(result)), rows[-1][-1]


def main() -> None:
    torch.set_num_threads(4)
    rate, audio = wavfile.read(AUDIO)
    if rate != 16000:
        raise ValueError(f'expected 16 kHz audio, got {rate}')
    samples = audio.astype(np.float32) / 32768.0
    processor = Wav2Vec2Processor.from_pretrained(MODEL_DIR, local_files_only=True)
    tokenizer = Wav2Vec2CTCTokenizer.from_pretrained(MODEL_DIR, local_files_only=True)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL_DIR, local_files_only=True).eval()
    with torch.inference_mode():
        input_values = processor(samples, sampling_rate=16000, return_tensors='pt').input_values
        logits_t = model(input_values).logits.squeeze(0)
    logits = logits_t.detach().cpu().numpy().astype(np.float64)
    logp = log_softmax(logits)
    words = words_and_phones(TRANSCRIPT)
    phones = [phone for word in words for phone in word['phones']]
    vocab = tokenizer.get_vocab()
    token_by_id = [''] * (max(int(value) for value in vocab.values()) + 1)
    for token, token_id in vocab.items():
        token_by_id[int(token_id)] = token
    ids = [int(vocab[phone]) for phone in phones]
    blank = int(vocab['<pad>'])
    path, spans, path_score = forced_align(logp, ids, blank)
    recognized = greedy_decode(logits, tokenizer)
    edits, edit_distance = edit_alignment(phones, recognized)
    frame_ms = len(samples) / 16000 * 1000 / logits.shape[0]

    phone_rows = []
    cursor = 0
    for word_index, word in enumerate(words):
        word['word_index'] = word_index
        word['phone_start'] = cursor
        word['phone_end'] = cursor + len(word['phones'])
        cursor = word['phone_end']
    word_by_phone = {}
    for word in words:
        for index in range(word['phone_start'], word['phone_end']):
            word_by_phone[index] = word
    for index, (phone, (start, end)) in enumerate(zip(phones, spans)):
        expected_id = ids[index]
        segment = logits[start:end]
        mean_logits = segment.mean(axis=0)
        alternatives = [
            token_id for token_id, token in enumerate(token_by_id)
            if token_id != blank and token and not token.startswith('<') and token_id != expected_id
        ]
        alternative_id = max(alternatives, key=lambda token_id: float(mean_logits[token_id]))
        expected_logit = float(mean_logits[expected_id])
        alternative_logit = float(mean_logits[alternative_id])
        phone_rows.append({
            'index': index,
            'word': word_by_phone[index]['word'],
            'expected': phone,
            'acoustic_winner': token_by_id[int(segment.mean(axis=0).argmax())],
            'best_alternative': token_by_id[int(alternative_id)],
            'expected_minus_alternative_logit': round(expected_logit - alternative_logit, 4),
            'expected_mean_posterior': round(float(np.exp(log_softmax(segment).mean(axis=0)[expected_id])), 4),
            'alternative_mean_posterior': round(float(np.exp(log_softmax(segment).mean(axis=0)[alternative_id])), 4),
            'start_ms': round(start * frame_ms),
            'end_ms': round(end * frame_ms),
        })

    # Attach independent phone edit operations to words for diagnosis. This is
    # evidence only: a CTC greedy substitution is not automatically an error.
    edit_rows = []
    for expected_index, observed_index, expected, observed, match in edits:
        row = {'expected_index': expected_index, 'observed_index': observed_index,
               'expected': expected, 'observed': observed, 'match': match}
        if expected_index is not None:
            row['word'] = word_by_phone[expected_index]['word']
            row['start_ms'] = phone_rows[expected_index]['start_ms']
            row['end_ms'] = phone_rows[expected_index]['end_ms']
        edit_rows.append(row)

    result = {
        'audio': str(AUDIO),
        'transcript_source': 'local Qwen3 ASR',
        'transcript': TRANSCRIPT,
        'reference_source': 'CMUdict first pronunciation variant; no semantic/grammar correction',
        'model': str(MODEL_DIR),
        'frame_count': int(logits.shape[0]),
        'duration_ms': round(len(samples) / 16000 * 1000),
        'forced_path_score': round(path_score, 6),
        'recognized_phones': recognized,
        'phone_edit_distance': edit_distance,
        'phone_edit_alignment': edit_rows,
        'phones': phone_rows,
        'words': words,
        'limitations': [
            'ASR transcript is provisional; a word-level difference may be ASR uncertainty rather than pronunciation error.',
            'Acoustic winner and CTC forced alignment are evidence, not human-labeled error truth.',
            'CMUdict variants and connected-speech reductions can shift phone boundaries.',
        ],
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'wrote {OUTPUT}')
    print(f'frames={logits.shape[0]} phones={len(phones)} edit_distance={edit_distance} path_score={path_score:.4f}')
    print('greedy phones:', ' '.join(recognized))
    print('substitutions/deletions:')
    for row in edit_rows:
        if not row['match']:
            print(row)
    print('lowest posterior/margin phones:')
    for row in sorted(phone_rows, key=lambda item: item['expected_minus_alternative_logit'])[:30]:
        print(row)


if __name__ == '__main__':
    main()
