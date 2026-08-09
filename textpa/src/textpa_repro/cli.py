from __future__ import annotations

import argparse
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
import json
import os
from pathlib import Path
import sys
from typing import Any, Callable, Sequence

from .acoustic import (
    CMU_MODEL,
    CMU_REVISION,
    CMU_TOKENIZER,
    CMU_TOKENIZER_REVISION,
    DEFAULT_MAX_AUDIO_SECONDS,
    IPA_MODEL,
    IPA_REVISION,
    WHISPER_MODELS,
    FasterWhisperTranscriber,
    PhonemeExtractor,
    discover_audio,
    enforce_audio_duration,
)
from .doctor import diagnose
from .errors import CalibrationError, SchemaError, TextPAError
from .io import (
    JsonlResumeWriter,
    read_jsonl,
    sha256_directory,
    sha256_file,
    write_jsonl_atomic,
)
from .llm import REASONING_EFFORTS, OpenAICompatibleAssessor
from .metrics import evaluate_multipa
from .models import Assessment, TextCues
from .phonemize import EspeakCanonicalIpa
from .prompting import render_prompt
from .reference import (
    download_multipa_audio,
    prepare_multipa_reference,
    verify_multipa_reference,
)
from .scoring import (
    deployment_accuracy,
    paper_cohort_fusion,
    paper_smith_waterman_similarity,
    phone_smith_waterman_similarity,
)


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _json_output(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def _id_for_audio(path: Path) -> str:
    return path.name


def _unique_records(
    records: list[dict[str, Any]], source: str | Path
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    for line_number, item in enumerate(records, start=1):
        utterance_id = item.get("id")
        if not isinstance(utterance_id, str) or not utterance_id:
            raise SchemaError(f"{source}:{line_number}: missing non-empty id")
        if utterance_id in seen:
            raise SchemaError(f"{source}:{line_number}: duplicate id '{utterance_id}'")
        seen.add(utterance_id)
    return records


def _file_identity(path: str | Path) -> dict[str, str]:
    resolved = Path(path).expanduser().resolve()
    return {"path": os.fspath(resolved), "sha256": sha256_file(resolved)}


def _run_manifest(
    stage: str, inputs: list[dict[str, Any]], config: dict[str, Any]
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "stage": stage,
        "inputs": inputs,
        "config": config,
    }


def _whisper_model_identity(model: str) -> dict[str, Any]:
    identity: dict[str, Any] = {"requested": model}
    if model in WHISPER_MODELS:
        identity.update(
            {
                "repository": WHISPER_MODELS[model][0],
                "revision": WHISPER_MODELS[model][1],
            }
        )
        return identity

    local_model = Path(model).expanduser().resolve()
    if not local_model.is_dir():
        raise SchemaError(
            "custom Whisper models must be a local model directory so their "
            "contents can be fingerprinted"
        )
    identity.update(
        {
            "local_path": os.fspath(local_model),
            "sha256": sha256_directory(local_model),
        }
    )
    return identity


def command_doctor(args: argparse.Namespace) -> int:
    _json_output(diagnose(args.cache_dir))
    return 0


def command_prepare_reference(args: argparse.Namespace) -> int:
    paths = prepare_multipa_reference(args.output_dir)
    if args.include_audio:
        cues = list(read_jsonl(paths["cues"]))
        download_multipa_audio(cues, Path(args.output_dir) / "wav")
    _json_output({name: str(path) for name, path in paths.items()})
    return 0


def command_verify_reference(args: argparse.Namespace) -> int:
    _json_output(verify_multipa_reference(args.output_dir))
    return 0


def command_transcribe(args: argparse.Namespace) -> int:
    audio_files = discover_audio(args.inputs)
    if not audio_files:
        raise SchemaError("no supported audio files were found")
    ids = [_id_for_audio(path) for path in audio_files]
    if len(ids) != len(set(ids)):
        raise SchemaError("audio inputs contain duplicate basenames")
    for path in audio_files:
        enforce_audio_duration(path, args.max_audio_seconds)
    model_identity = _whisper_model_identity(args.model)
    manifest = _run_manifest(
        "transcribe",
        [
            {"kind": "audio", "id": utterance_id, **_file_identity(path)}
            for utterance_id, path in zip(ids, audio_files)
        ],
        {
            "model": model_identity,
            "device": args.device,
            "compute_type": args.compute_type,
            "cpu_threads": args.cpu_threads,
            "max_audio_seconds": args.max_audio_seconds,
        },
    )
    transcriber: FasterWhisperTranscriber | None = None
    if args.overwrite:
        transcriber = FasterWhisperTranscriber(
            model=args.model,
            device=args.device,
            compute_type=args.compute_type,
            cache_dir=args.cache_dir,
            cpu_threads=args.cpu_threads,
            max_audio_seconds=args.max_audio_seconds,
        )
    with JsonlResumeWriter(
        args.output, overwrite=args.overwrite, manifest=manifest
    ) as writer:
        pending = [
            (utterance_id, path)
            for utterance_id, path in zip(ids, audio_files)
            if utterance_id not in writer.seen_ids
        ]
        if not pending:
            _log("all audio files are already transcribed")
            return 0
        if transcriber is None:
            transcriber = FasterWhisperTranscriber(
                model=args.model,
                device=args.device,
                compute_type=args.compute_type,
                cache_dir=args.cache_dir,
                cpu_threads=args.cpu_threads,
                max_audio_seconds=args.max_audio_seconds,
            )
        for index, (utterance_id, path) in enumerate(pending, start=1):
            _log(f"transcribe {index}/{len(pending)}: {utterance_id}")
            writer.write(
                {
                    "schema_version": 1,
                    "id": utterance_id,
                    "audio_path": os.fspath(path),
                    "transcript": transcriber.transcribe(path),
                    "asr_model": args.model,
                }
            )
    return 0


def command_extract_cues(args: argparse.Namespace) -> int:
    source = _unique_records(list(read_jsonl(args.input)), args.input)
    audio_inputs: list[dict[str, Any]] = []
    for line_number, item in enumerate(source, start=1):
        audio_path = item.get("audio_path")
        transcript = item.get("transcript")
        if not all(
            isinstance(value, str) and value
            for value in (audio_path, transcript)
        ):
            raise SchemaError(
                f"{args.input}:{line_number}: records require audio_path/transcript"
            )
        enforce_audio_duration(audio_path, args.max_audio_seconds)
        audio_inputs.append(
            {
                "kind": "audio",
                "id": item["id"],
                **_file_identity(audio_path),
            }
        )
    manifest = _run_manifest(
        "extract-cues",
        [{"kind": "transcripts", **_file_identity(args.input)}, *audio_inputs],
        {
            "device": args.device,
            "torch_threads": args.torch_threads,
            "max_audio_seconds": args.max_audio_seconds,
            "ipa_model": {"repository": IPA_MODEL, "revision": IPA_REVISION},
            "cmu_model": {"repository": CMU_MODEL, "revision": CMU_REVISION},
            "cmu_tokenizer": {
                "repository": CMU_TOKENIZER,
                "revision": CMU_TOKENIZER_REVISION,
            },
        },
    )
    extractor: PhonemeExtractor | None = None
    if args.overwrite:
        extractor = PhonemeExtractor(
            device=args.device,
            cache_dir=args.cache_dir,
            torch_threads=args.torch_threads,
            max_audio_seconds=args.max_audio_seconds,
        )
    with JsonlResumeWriter(
        args.output, overwrite=args.overwrite, manifest=manifest
    ) as writer:
        pending = [item for item in source if item.get("id") not in writer.seen_ids]
        if not pending:
            _log("all transcripts already have acoustic cues")
            return 0
        if extractor is None:
            extractor = PhonemeExtractor(
                device=args.device,
                cache_dir=args.cache_dir,
                torch_threads=args.torch_threads,
                max_audio_seconds=args.max_audio_seconds,
            )
        for index, item in enumerate(pending, start=1):
            utterance_id = item.get("id")
            audio_path = item.get("audio_path")
            transcript = item.get("transcript")
            if not all(isinstance(value, str) and value for value in (
                utterance_id, audio_path, transcript
            )):
                raise SchemaError("transcript records require id/audio_path/transcript")
            _log(f"phonemes {index}/{len(pending)}: {utterance_id}")
            cues = extractor.make_cues(utterance_id, audio_path, transcript)
            record = cues.to_dict()
            record["asr_model"] = item.get("asr_model")
            record["ipa_model"] = IPA_MODEL
            record["cmu_model"] = CMU_MODEL
            writer.write(record)
    return 0


def command_assess(args: argparse.Namespace) -> int:
    if (
        isinstance(args.concurrency, bool)
        or not isinstance(args.concurrency, int)
        or args.concurrency < 1
    ):
        raise ValueError("concurrency must be a positive integer")
    source = _unique_records(list(read_jsonl(args.input)), args.input)
    for item in source:
        TextCues.from_dict(item)
    resolved_base_url = args.base_url or os.getenv("TEXTPA_BASE_URL")
    manifest = _run_manifest(
        "assess",
        [_file_identity(args.input)],
        {
            "model": args.model,
            "base_url": resolved_base_url,
            "api_key_env": args.api_key_env,
            "api_style": args.api_style,
            "json_mode": args.json_mode,
            "json_input": args.json_input,
            "reasoning_effort": args.reasoning_effort,
            "retries": args.retries,
            "timeout": args.timeout,
        },
    )
    assessor: OpenAICompatibleAssessor | None = None
    if args.overwrite:
        assessor = OpenAICompatibleAssessor(
            args.model,
            base_url=args.base_url,
            api_key_env=args.api_key_env,
            api_style=args.api_style,
            json_mode=args.json_mode,
            reasoning_effort=args.reasoning_effort,
            retries=args.retries,
            timeout=args.timeout,
        )
    with JsonlResumeWriter(
        args.output, overwrite=args.overwrite, manifest=manifest
    ) as writer:
        pending = [item for item in source if item.get("id") not in writer.seen_ids]
        if not pending:
            _log("all cues are already assessed")
            return 0
        if assessor is None:
            assessor = OpenAICompatibleAssessor(
                args.model,
                base_url=args.base_url,
                api_key_env=args.api_key_env,
                api_style=args.api_style,
                json_mode=args.json_mode,
                reasoning_effort=args.reasoning_effort,
                retries=args.retries,
                timeout=args.timeout,
            )
        executor = ThreadPoolExecutor(max_workers=args.concurrency)
        queued = iter(enumerate(pending, start=1))
        in_flight: dict[Future[Assessment], tuple[int, dict[str, Any], TextCues]] = {}

        def submit_next() -> bool:
            try:
                index, item = next(queued)
            except StopIteration:
                return False
            cues = TextCues.from_dict(item)
            _log(f"assess start {index}/{len(pending)}: {cues.utterance_id}")
            future = executor.submit(
                assessor.assess,
                render_prompt(cues, paper_compat=not args.json_input),
            )
            in_flight[future] = (index, item, cues)
            return True

        for _ in range(min(args.concurrency, len(pending))):
            submit_next()

        try:
            while in_flight:
                completed, _ = wait(in_flight, return_when=FIRST_COMPLETED)
                for future in completed:
                    index, item, cues = in_flight.pop(future)
                    assessment = future.result()
                    record = dict(item)
                    record.update(
                        {
                            "assessment": assessment.to_dict(),
                            "provider": "openai-compatible",
                            "llm_model": args.model,
                            "prompt_mode": "json" if args.json_input else "paper",
                        }
                    )
                    if args.reasoning_effort is not None:
                        record["reasoning_effort"] = args.reasoning_effort
                    writer.write(record)
                    _log(f"assess done {index}/{len(pending)}: {cues.utterance_id}")
                    submit_next()
        except BaseException:
            for future in in_flight:
                future.cancel()
            executor.shutdown(wait=True, cancel_futures=True)
            raise
        else:
            executor.shutdown(wait=True)
    return 0


def command_finalize(args: argparse.Namespace) -> int:
    source = _unique_records(list(read_jsonl(args.input)), args.input)
    phonemizer: EspeakCanonicalIpa | None = None
    enriched: list[dict[str, Any]] = []
    for item in source:
        cues = TextCues.from_dict(item)
        assessment_value = item.get("assessment")
        if not isinstance(assessment_value, dict):
            raise SchemaError(f"{cues.utterance_id}: missing assessment")
        assessment = Assessment.from_dict(assessment_value)
        canonical_value = item.get("canonical_ipa")
        if canonical_value is None:
            if phonemizer is None:
                phonemizer = EspeakCanonicalIpa()
            canonical = phonemizer(cues.transcript)
        elif not isinstance(canonical_value, str) or not canonical_value.strip():
            raise SchemaError(f"{cues.utterance_id}: canonical_ipa must be non-empty")
        else:
            canonical = canonical_value
        paper_similarity = paper_smith_waterman_similarity(
            cues.phonemes_ipa, canonical
        )
        phone_similarity = phone_smith_waterman_similarity(
            cues.phonemes_ipa, canonical
        )
        record = dict(item)
        record["canonical_ipa"] = canonical
        record["scores"] = {
            "ipa_similarity_paper_char": paper_similarity,
            "ipa_similarity_phone": phone_similarity,
            "deployment_accuracy_1_5": deployment_accuracy(
                assessment.accuracy, phone_similarity
            ),
        }
        enriched.append(record)

    try:
        llm_normalized, ipa_normalized, paper_accuracy = paper_cohort_fusion(
            [Assessment.from_dict(item["assessment"]).accuracy for item in enriched],
            [item["scores"]["ipa_similarity_paper_char"] for item in enriched],
        )
    except CalibrationError as exc:
        _log(f"paper cohort score omitted: {exc}")
    else:
        for item, llm_value, ipa_value, final_value in zip(
            enriched, llm_normalized, ipa_normalized, paper_accuracy
        ):
            item["scores"].update(
                {
                    "paper_llm_accuracy_normalized": llm_value,
                    "paper_ipa_similarity_normalized": ipa_value,
                    "paper_cohort_accuracy": final_value,
                }
            )
    write_jsonl_atomic(args.output, enriched)
    return 0


def command_evaluate(args: argparse.Namespace) -> int:
    result = evaluate_multipa(
        read_jsonl(args.input),
        args.annotations,
        accuracy_field=args.accuracy_field,
        fluency_field=args.fluency_field,
        allow_subset=args.allow_subset,
    )
    _json_output(result)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="textpa")
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="report runtime prerequisites")
    doctor.add_argument("--cache-dir")
    doctor.set_defaults(handler=command_doctor)

    prepare = subparsers.add_parser(
        "prepare-reference", help="download pinned MultiPA cues and paper outputs"
    )
    prepare.add_argument("--output-dir", default="artifacts/multipa-reference")
    prepare.add_argument("--include-audio", action="store_true")
    prepare.set_defaults(handler=command_prepare_reference)

    verify = subparsers.add_parser(
        "verify-reference", help="recompute paper LLM-only MultiPA correlations"
    )
    verify.add_argument("--output-dir", default="artifacts/multipa-reference")
    verify.set_defaults(handler=command_verify_reference)

    transcribe = subparsers.add_parser("transcribe", help="run CPU Whisper ASR")
    transcribe.add_argument("inputs", nargs="+")
    transcribe.add_argument("-o", "--output", required=True)
    transcribe.add_argument("--model", default="large-v3")
    transcribe.add_argument("--device", default="cpu")
    transcribe.add_argument("--compute-type", default="int8")
    transcribe.add_argument("--cpu-threads", type=int, default=0)
    transcribe.add_argument(
        "--max-audio-seconds", type=float, default=DEFAULT_MAX_AUDIO_SECONDS
    )
    transcribe.add_argument("--cache-dir")
    transcribe.add_argument("--overwrite", action="store_true")
    transcribe.set_defaults(handler=command_transcribe)

    cues = subparsers.add_parser(
        "extract-cues", help="extract recognized IPA and CMU/pause cues"
    )
    cues.add_argument("input")
    cues.add_argument("-o", "--output", required=True)
    cues.add_argument("--device", default="cpu")
    cues.add_argument("--torch-threads", type=int)
    cues.add_argument(
        "--max-audio-seconds", type=float, default=DEFAULT_MAX_AUDIO_SECONDS
    )
    cues.add_argument("--cache-dir")
    cues.add_argument("--overwrite", action="store_true")
    cues.set_defaults(handler=command_extract_cues)

    assess = subparsers.add_parser("assess", help="score text cues with an LLM")
    assess.add_argument("input")
    assess.add_argument("-o", "--output", required=True)
    assess.add_argument("--model", required=True)
    assess.add_argument("--base-url")
    assess.add_argument("--api-key-env", default="TEXTPA_API_KEY")
    assess.add_argument("--api-style", choices=("chat", "responses"), default="chat")
    assess.add_argument("--json-mode", action="store_true")
    assess.add_argument("--json-input", action="store_true")
    assess.add_argument("--reasoning-effort", choices=REASONING_EFFORTS)
    assess.add_argument("--retries", type=int, default=3)
    assess.add_argument("--timeout", type=float, default=120.0)
    assess.add_argument("--concurrency", type=int, default=1)
    assess.add_argument("--overwrite", action="store_true")
    assess.set_defaults(handler=command_assess)

    finalize = subparsers.add_parser(
        "finalize", help="add canonical IPA and fused accuracy scores"
    )
    finalize.add_argument("input")
    finalize.add_argument("-o", "--output", required=True)
    finalize.set_defaults(handler=command_finalize)

    evaluate = subparsers.add_parser(
        "evaluate-multipa", help="compute PCC against MultiPA annotations"
    )
    evaluate.add_argument("input")
    evaluate.add_argument("--annotations", required=True)
    evaluate.add_argument("--accuracy-field", default="assessment.accuracy")
    evaluate.add_argument("--fluency-field", default="assessment.fluency")
    evaluate.add_argument("--allow-subset", action="store_true")
    evaluate.set_defaults(handler=command_evaluate)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler: Callable[[argparse.Namespace], int] = args.handler
    try:
        return handler(args)
    except (TextPAError, FileNotFoundError, ValueError) as exc:
        parser.exit(2, f"textpa: error: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
