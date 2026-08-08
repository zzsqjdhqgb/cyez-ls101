from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile

from .io import write_jsonl_atomic
from .metrics import evaluate_multipa
from .models import Assessment, TextCues
from .prompting import render_prompt


TEXT_PA_COMMIT = "e429201f2f8a7dbdb594e637bf0139c458256aad"
MULTIPA_REVISION = "ff1e3c79bfb1d113d887a0b7b05fe2900c095264"
RESULTS_URL = (
    "https://raw.githubusercontent.com/yuwchen/TextPA/"
    f"{TEXT_PA_COMMIT}/results/multiPA.zip"
)
RESULTS_SHA256 = "9a019a2ac12b653c4411daf7caeba70631d4bf0721d8748b81ffa05a87c117d1"
ANNOTATIONS_URL = (
    "https://huggingface.co/yuwchen/multipa/resolve/"
    f"{MULTIPA_REVISION}/annotation.csv"
)
ANNOTATIONS_SHA256 = "6bfc68431c83fa61134fcf3cb5d69c3d515a14ff2188c516ca9c208914db7b67"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_verified(url: str, destination: Path, expected_sha256: str | None) -> None:
    if destination.exists() and (
        expected_sha256 is None or _sha256(destination) == expected_sha256
    ):
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "textpa-repro/0.1"})
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        try:
            with urlopen(request, timeout=120) as response:
                shutil.copyfileobj(response, temporary)
        except BaseException:
            temporary_path.unlink(missing_ok=True)
            raise
    if expected_sha256 is not None and _sha256(temporary_path) != expected_sha256:
        temporary_path.unlink(missing_ok=True)
        raise ValueError(f"checksum mismatch while downloading {url}")
    temporary_path.replace(destination)


def _paper_record(raw: dict[str, Any], provider: str, model: str) -> dict[str, Any]:
    input_text = raw["input_content"].rsplit("Input:", 1)[1].strip()
    payload = ast.literal_eval(input_text)
    cues = TextCues(
        utterance_id=raw["wavname"],
        transcript=payload["Transcript"],
        phonemes_cmu=payload["Phonemes_CMU"],
        phonemes_ipa=payload["Phonemes_IPA"],
    )
    if render_prompt(cues, paper_compat=True) != raw["input_content"]:
        raise ValueError("local prompt rendering differs from the official result")
    assessment = Assessment.from_dict(raw)
    result = cues.to_dict()
    result.update(
        {
            "assessment": assessment.to_dict(),
            "provider": provider,
            "llm_model": model,
            "source": f"yuwchen/TextPA@{TEXT_PA_COMMIT}",
        }
    )
    return result


def prepare_multipa_reference(output_dir: str | Path) -> dict[str, Path]:
    destination = Path(output_dir)
    downloads = destination / "downloads"
    results_zip = downloads / "multiPA.zip"
    annotations = destination / "annotation.csv"
    download_verified(RESULTS_URL, results_zip, RESULTS_SHA256)
    download_verified(ANNOTATIONS_URL, annotations, ANNOTATIONS_SHA256)

    groups = {
        "gpt4omini": ("openai", "gpt-4o-mini"),
        "gemini-2.0-flash": ("google", "gemini-2.0-flash"),
    }
    records_by_group: dict[str, list[dict[str, Any]]] = {name: [] for name in groups}
    with zipfile.ZipFile(results_zip) as archive:
        for member in archive.namelist():
            if not member.endswith(".json") or member.startswith("__MACOSX/"):
                continue
            for group, (provider, model) in groups.items():
                marker = f"multiPA/{group}/"
                if member.startswith(marker):
                    raw = json.loads(archive.read(member).decode("utf-8"))
                    records_by_group[group].append(_paper_record(raw, provider, model))
                    break

    for records in records_by_group.values():
        records.sort(key=lambda item: item["id"])
    gpt_records = records_by_group["gpt4omini"]
    gemini_records = records_by_group["gemini-2.0-flash"]
    if len(gpt_records) != 50 or len(gemini_records) != 50:
        raise ValueError("official MultiPA result archive does not contain 50+50 records")

    gpt_cues = [
        {key: value for key, value in item.items() if key not in {
            "assessment", "provider", "llm_model", "source"
        }}
        for item in gpt_records
    ]
    gemini_cues = [
        {key: value for key, value in item.items() if key not in {
            "assessment", "provider", "llm_model", "source"
        }}
        for item in gemini_records
    ]
    if gpt_cues != gemini_cues:
        raise ValueError("official GPT and Gemini archives contain different acoustic cues")

    paths = {
        "cues": destination / "paper_cues.jsonl",
        "gpt": destination / "paper_gpt4omini.jsonl",
        "gemini": destination / "paper_gemini_2_flash.jsonl",
        "annotations": annotations,
    }
    write_jsonl_atomic(paths["cues"], gpt_cues)
    write_jsonl_atomic(paths["gpt"], gpt_records)
    write_jsonl_atomic(paths["gemini"], gemini_records)
    return paths


def download_multipa_audio(cues: list[dict[str, Any]], output_dir: str | Path) -> None:
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    for cue in cues:
        filename = str(cue["id"])
        url = (
            "https://huggingface.co/yuwchen/multipa/resolve/"
            f"{MULTIPA_REVISION}/wav/{quote(filename)}"
        )
        download_verified(url, destination / filename, None)


def verify_multipa_reference(output_dir: str | Path) -> dict[str, Any]:
    from .io import read_jsonl

    paths = prepare_multipa_reference(output_dir)
    gpt = evaluate_multipa(read_jsonl(paths["gpt"]), paths["annotations"])
    gemini = evaluate_multipa(read_jsonl(paths["gemini"]), paths["annotations"])
    expected = {
        "gpt": {"accuracy_pcc": 0.642977334476, "fluency_pcc": 0.650691975799},
        "gemini": {"accuracy_pcc": 0.554004469887, "fluency_pcc": 0.556739503914},
    }
    for name, actual in (("gpt", gpt), ("gemini", gemini)):
        for metric, target in expected[name].items():
            if abs(float(actual[metric]) - target) > 1e-10:
                raise ValueError(f"reference verification failed for {name}.{metric}")
    return {"gpt": gpt, "gemini": gemini, "verified": True}
