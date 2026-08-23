from __future__ import annotations

import concurrent.futures
import importlib.util
import json
import multiprocessing as mp
import sys
import types
from pathlib import Path

import cmudict
import torch

ROOT = Path('/workspace/.gop-research')
MODEL_DIR = ROOT / 'model'
LOGITS_PATH = ROOT / 'exam' / 'logits.pt'
OUTPUT = ROOT / 'exam' / 'ctc-gop-result.json'
REFERENCE = "Despite the challenges of modern life, maintaining a balance between work and personal interests remains essential for one's overall well-being."
UPSTREAM_DIR = Path('/tmp')


def load_module(path: Path, name: str, *, alignment: bool = False):
    if alignment:
        sys.modules.setdefault('matplotlib', types.ModuleType('matplotlib'))
        sys.modules.setdefault('matplotlib.pyplot', types.ModuleType('matplotlib.pyplot'))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'cannot load {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def labels_from_text(tokenizer):
    words = [
        word.lower()
        for word in REFERENCE.replace('.', '').replace(',', '').replace("'", '').split()
    ]
    word_phones = []
    for word in words:
        variants = cmudict.dict().get(word)
        if not variants:
            raise ValueError(f'CMUdict has no pronunciation for {word!r}')
        word_phones.append([phone.rstrip('012') for phone in variants[0]])
    phones = [phone for values in word_phones for phone in values]
    ids = tokenizer.convert_tokens_to_ids(phones)
    if any(value is None or value == tokenizer.unk_token_id for value in ids):
        raise ValueError('CMUdict phone is missing from the checkpoint vocabulary')
    return words, word_phones, phones, torch.tensor(ids, dtype=torch.int32)


G_UP = None
G_POST = None
G_IDS = None


def denominator(index: int):
    torch.set_num_threads(1)
    value = G_UP.ctc_loss_denom(G_POST, G_IDS, index, blank=0)
    return index, float(value.item() if hasattr(value, 'item') else value)


def run_scalar(name, module, post, ids, words, word_phones):
    global G_UP, G_POST, G_IDS
    G_UP, G_POST, G_IDS = module, post, ids
    torch.set_num_threads(1)
    self_loss = float(module.ctc_loss(post, ids, blank=0))
    with concurrent.futures.ProcessPoolExecutor(
        max_workers=4, mp_context=mp.get_context('fork')
    ) as pool:
        values = dict(pool.map(denominator, range(len(ids))))
    rows = []
    index = 0
    for word, phones_for_word in zip(words, word_phones):
        for phone in phones_for_word:
            rows.append({
                'index': index,
                'word': word,
                'phone': phone,
                'token_id': int(ids[index]),
                'gop': -self_loss + values[index],
            })
            index += 1
    return {'algorithm': name, 'canonical_log_likelihood_loss': self_loss, 'phones': rows}


def run_viterbi(module, post, ids, phones, words, word_phones):
    word_for_phone = [word for word, values in zip(words, word_phones) for _ in values]
    pointers = module.viterbi_ctc(post, ids, blank=0)
    path = module.get_backtrace_path(pointers)[:-1]
    path.reverse()
    rows = []
    last_state = 0
    post_count = 0
    post_total = torch.tensor(0.0, dtype=torch.float64)
    start = 0
    for frame, state_id in enumerate(path):
        previous_label = int((last_state - 1) / 2)
        current_label = int((state_id - 1) / 2)
        if state_id != last_state and post_count:
            rows.append({
                'index': len(rows),
                'phone': phones[previous_label],
                'start_frame': start,
                'end_frame': frame,
                'gop_log_p': float(torch.log(post_total / post_count)),
            })
            post_count = 0
            post_total = torch.tensor(0.0, dtype=torch.float64)
            start = frame
        if state_id % 2:
            if post_count == 0:
                start = frame
            post_count += 1
            post_total += post[ids[current_label], frame]
        last_state = state_id
    if post_count:
        label = int((last_state - 1) / 2)
        rows.append({
            'index': len(rows),
            'phone': phones[label],
            'start_frame': start,
            'end_frame': len(path),
            'gop_log_p': float(torch.log(post_total / post_count)),
        })
    for row in rows:
        row['word'] = word_for_phone[row['index']]
    return {'algorithm': 'viterbi', 'rows': rows}


def main():
    state = torch.load(LOGITS_PATH, map_location='cpu', weights_only=False)
    post = state['post'].contiguous()
    s_module = load_module(UPSTREAM_DIR / 'gop-ctc-af-S.py', 'exam_gop_s')
    sd_module = load_module(UPSTREAM_DIR / 'gop-ctc-af-SD.py', 'exam_gop_sd')
    align_module = load_module(UPSTREAM_DIR / 'gop_ctc_align.py', 'exam_gop_align', alignment=True)
    tokenizer = s_module.Wav2Vec2CTCTokenizer.from_pretrained(
        str(MODEL_DIR), local_files_only=True
    )
    words, word_phones, phones, ids = labels_from_text(tokenizer)
    result = {
        'reference': REFERENCE,
        'ctc_frames': int(post.shape[1]),
        'phone_count': len(phones),
        'decode': state.get('decode', ''),
        'words': words,
        'word_phones': dict(zip(words, word_phones)),
        's': run_scalar('s', s_module, post, ids, words, word_phones),
        'sd': run_scalar('sd', sd_module, post, ids, words, word_phones),
        'viterbi': run_viterbi(align_module, post, ids, phones, words, word_phones),
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'wrote {OUTPUT}')
    for key in ('s', 'sd'):
        print(f'--- {key.upper()} lowest ---')
        for row in sorted(result[key]['phones'], key=lambda item: item['gop'])[:20]:
            print(f"{row['index']:3d} {row['word']:<14} {row['phone']:<3} {row['gop']: .6f}")
    print('--- VITERBI lowest ---')
    for row in sorted(result['viterbi']['rows'], key=lambda item: item['gop_log_p'])[:20]:
        print(f"{row['index']:3d} {row['word']:<14} {row['phone']:<3} {row['start_frame']:4d}-{row['end_frame']:4d} {row['gop_log_p']: .6f}")


if __name__ == '__main__':
    main()
