"""Benchmark the upstream CTC-GOP-SD denominator on the cached utterance."""
from __future__ import annotations

import concurrent.futures
import importlib.util
import json
import multiprocessing as mp
from pathlib import Path

import cmudict
import torch

ROOT = Path("/workspace/.gop-research")
UPSTREAM = Path("/tmp/ctc-gop-research/is24/generate-GOP/gop-ctc-af-SD.py")
MODEL_DIR = ROOT / "model"
TEXT = (
    "The rapid development of artificial intelligence has raised important "
    "questions about the future of employment and the skills that young people "
    "need to acquire."
)
UP = None
POST = None
IDS = None


def load_upstream():
    spec = importlib.util.spec_from_file_location("ctc_gop_sd", UPSTREAM)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load upstream SD module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def denominator(index: int):
    torch.set_num_threads(1)
    value = UP.ctc_loss_denom(POST, IDS, index, blank=0)
    # The released is24 SD script returns only the denominator loss (unlike
    # the later taslpro26 variant, which also returns an occupancy scalar).
    return index, float(value.item())


def main():
    global UP, POST, IDS
    UP = load_upstream()
    state = torch.load(ROOT / "logits.pt", map_location="cpu", weights_only=False)
    POST = state["post"].contiguous()
    tokenizer = UP.Wav2Vec2CTCTokenizer.from_pretrained(
        str(MODEL_DIR), local_files_only=True
    )
    words = TEXT.replace(".", "").lower().split()
    word_phones = []
    for word in words:
        word_phones.append([p.rstrip("012") for p in cmudict.dict()[word][0]])
    phones = [p for values in word_phones for p in values]
    IDS = torch.tensor(tokenizer.convert_tokens_to_ids(phones), dtype=torch.int32)
    torch.set_num_threads(1)
    self_loss = float(UP.ctc_loss(POST, IDS, blank=0))
    context = mp.get_context("fork")
    with concurrent.futures.ProcessPoolExecutor(max_workers=8, mp_context=context) as pool:
        values = dict(pool.map(denominator, range(len(IDS))))
    rows = []
    index = 0
    for word, values_for_word in zip(words, word_phones):
        for phone in values_for_word:
            loss = values[index]
            rows.append({
                "index": index,
                "word": word,
                "phone": phone,
                "token_id": int(IDS[index]),
                "gop": -self_loss + loss,
            })
            index += 1
    result = {
        "source": "frank613/CTC-based-GOP is24/generate-GOP/gop-ctc-af-SD.py",
        "reference": TEXT,
        "ctc_frames": int(POST.shape[1]),
        "phone_count": len(rows),
        "canonical_log_likelihood_loss": self_loss,
        "phones": rows,
        "decode": state.get("decode", ""),
    }
    out = ROOT / "ctc-gop-sd-result.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {out}")
    for row in sorted(rows, key=lambda item: item["gop"])[:25]:
        print(f"{row['index']:3d} {row['word']:<14} {row['phone']:<3} {row['gop']: .6f}")


if __name__ == "__main__":
    main()
