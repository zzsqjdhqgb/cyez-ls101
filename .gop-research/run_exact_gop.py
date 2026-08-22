"""Run the upstream CTC-GOP scalar implementation on one cached utterance.

The GOP dynamic-programming functions are imported verbatim from the cloned
frank613/CTC-based-GOP repository.  This file only supplies CMUdict labels,
parallelizes independent phone-denominator calculations, and formats output.
"""
from __future__ import annotations

import concurrent.futures
import importlib.util
import json
import multiprocessing as mp
from pathlib import Path

import cmudict
import torch


ROOT = Path("/workspace/.gop-research")
MODEL_DIR = ROOT / "model"
LOGITS_PATH = ROOT / "logits.pt"
UPSTREAM = Path("/tmp/ctc-gop-research/is24/generate-GOP/gop-ctc-af-S.py")
TEXT = (
    "The rapid development of artificial intelligence has raised important "
    "questions about the future of employment and the skills that young people "
    "need to acquire."
)


def load_upstream():
    spec = importlib.util.spec_from_file_location("ctc_gop_upstream", UPSTREAM)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load upstream module: {UPSTREAM}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def labels_from_text(tokenizer):
    words = [w.lower() for w in TEXT.replace(".", "").split()]
    word_phones: list[tuple[str, list[str]]] = []
    for word in words:
        variants = cmudict.dict().get(word)
        if not variants:
            raise ValueError(f"CMUdict has no pronunciation for {word!r}")
        phones = [phone.rstrip("012") for phone in variants[0]]
        word_phones.append((word, phones))
    phones = [phone for _, values in word_phones for phone in values]
    ids = tokenizer.convert_tokens_to_ids(phones)
    if any(value is None or value == tokenizer.unk_token_id for value in ids):
        raise ValueError("CMUdict phone is missing from the 40-phone checkpoint")
    return words, word_phones, torch.tensor(ids, dtype=torch.int32)


# Child processes inherit these read-only tensors through fork.
POST = None
IDS = None


def denominator(phone_index: int) -> tuple[int, float]:
    assert POST is not None and IDS is not None
    torch.set_num_threads(1)
    value = UP.ctc_loss_denom(POST, IDS, phone_index, blank=0)
    return phone_index, float(value)


def main() -> None:
    global UP, POST, IDS
    UP = load_upstream()
    state = torch.load(LOGITS_PATH, map_location="cpu", weights_only=False)
    POST = state["post"].contiguous()
    tokenizer = UP.Wav2Vec2CTCTokenizer.from_pretrained(
        str(MODEL_DIR), local_files_only=True
    )
    words, word_phones, IDS = labels_from_text(tokenizer)
    torch.set_num_threads(1)
    self_loss = float(UP.ctc_loss(POST, IDS, blank=0))

    context = mp.get_context("fork")
    with concurrent.futures.ProcessPoolExecutor(
        max_workers=4, mp_context=context
    ) as pool:
        values = dict(pool.map(denominator, range(len(IDS))))

    phones = [phone for _, values in word_phones for phone in values]
    rows = []
    for index, (word, phone) in enumerate(
        (pair for word, values in word_phones for pair in [(word, phone) for phone in values])
    ):
        denominator_loss = values[index]
        rows.append(
            {
                "index": index,
                "word": word,
                "phone": phone,
                "token_id": int(IDS[index]),
                "gop": self_loss * -1.0 + denominator_loss,
            }
        )

    result = {
        "source": "frank613/CTC-based-GOP is24/generate-GOP/gop-ctc-af-S.py",
        "model": str(MODEL_DIR),
        "reference": TEXT,
        "ctc_frames": int(POST.shape[1]),
        "phone_count": len(rows),
        "canonical_log_likelihood_loss": self_loss,
        "phones": rows,
        "decode": state.get("decode", ""),
    }
    output = ROOT / "ctc-gop-s-result.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {output}")
    for row in rows:
        print(f"{row['index']:3d} {row['word']:<14} {row['phone']:<3} {row['gop']: .6f}")


if __name__ == "__main__":
    main()
