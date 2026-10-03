"""Run the upstream CTC-GOP Viterbi alignment variant on the cached utterance."""
from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

import cmudict
import torch

ROOT = Path("/workspace/.gop-research")
UPSTREAM = Path("/tmp/ctc-gop-research/is24/generate-GOP/gop_ctc_align.py")
MODEL_DIR = ROOT / "model"
TEXT = (
    "The rapid development of artificial intelligence has raised important "
    "questions about the future of employment and the skills that young people "
    "need to acquire."
)


def load_upstream():
    # The upstream module imports matplotlib for its optional plotting path;
    # alignment itself does not need it.
    sys.modules.setdefault("matplotlib", types.ModuleType("matplotlib"))
    sys.modules.setdefault("matplotlib.pyplot", types.ModuleType("matplotlib.pyplot"))
    spec = importlib.util.spec_from_file_location("ctc_align_upstream", UPSTREAM)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load upstream aligner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    up = load_upstream()
    state = torch.load(ROOT / "logits.pt", map_location="cpu", weights_only=False)
    post = state["post"].contiguous()
    tokenizer = up.Wav2Vec2CTCTokenizer.from_pretrained(
        str(MODEL_DIR), local_files_only=True
    )
    words = TEXT.replace(".", "").lower().split()
    word_phones = []
    for word in words:
        variants = cmudict.dict()[word]
        word_phones.append([p.rstrip("012") for p in variants[0]])
    phones = [p for values in word_phones for p in values]
    ids = torch.tensor(tokenizer.convert_tokens_to_ids(phones), dtype=torch.int32)
    pointers = up.viterbi_ctc(post, ids, blank=0)
    path = up.get_backtrace_path(pointers)[:-1]
    path.reverse()
    # The upstream script averages posterior over the frames in each token state.
    rows = []
    last_state = 0
    post_count = 0
    post_total = torch.tensor(0.0, dtype=torch.float64)
    start = 0
    for frame, state_id in enumerate(path):
        previous_label = int((last_state - 1) / 2)
        current_label = int((state_id - 1) / 2)
        if state_id != last_state and post_count:
            rows.append(
                {
                    "index": len(rows),
                    "phone": phones[previous_label],
                    "start_frame": start,
                    "end_frame": frame,
                    "gop_log_p": float(torch.log(post_total / post_count)),
                }
            )
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
        rows.append(
            {
                "index": len(rows),
                "phone": phones[label],
                "start_frame": start,
                "end_frame": len(path),
                "gop_log_p": float(torch.log(post_total / post_count)),
            }
        )
    output = {
        "source": "frank613/CTC-based-GOP is24/generate-GOP/gop_ctc_align.py",
        "reference": TEXT,
        "ctc_frames": int(post.shape[1]),
        "phone_count": len(phones),
        "rows": rows,
        "decode": state.get("decode", ""),
    }
    out = ROOT / "ctc-viterbi-gop-result.json"
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {out}; rows={len(rows)}")
    for row in rows:
        print(
            f"{row['index']:3d} {row['phone']:<3} "
            f"{row['start_frame']:4d}-{row['end_frame']:4d} "
            f"{row['gop_log_p']: .5f}"
        )


if __name__ == "__main__":
    main()
