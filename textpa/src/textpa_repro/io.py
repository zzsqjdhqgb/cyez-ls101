from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import warnings
from typing import Any, Iterable, Iterator, Mapping

from .errors import SchemaError


def read_jsonl(path: str | Path) -> Iterator[dict[str, Any]]:
    source = Path(path)
    with source.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SchemaError(f"{source}:{line_number}: invalid JSON") from exc
            if not isinstance(value, dict):
                raise SchemaError(f"{source}:{line_number}: expected a JSON object")
            yield value


def write_jsonl_atomic(path: str | Path, records: Iterable[Mapping[str, Any]]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
                handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def write_json_atomic(path: str | Path, value: Mapping[str, Any]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_directory(path: str | Path) -> str:
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"model path is not a directory: {root}")
    digest = hashlib.sha256()
    for candidate in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = candidate.relative_to(root).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        with candidate.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def _recover_incomplete_jsonl_tail(path: Path) -> None:
    """Discard only an unterminated, invalid final line left by an interrupted write."""
    with path.open("rb+") as handle:
        file_size = path.stat().st_size
        line_number = 0
        while True:
            line_start = handle.tell()
            line = handle.readline()
            if not line:
                return
            line_number += 1
            if not line.strip():
                continue
            try:
                value = json.loads(line.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                is_incomplete_tail = (
                    handle.tell() == file_size and not line.endswith(b"\n")
                )
                if not is_incomplete_tail:
                    raise SchemaError(f"{path}:{line_number}: invalid JSON") from exc
                handle.seek(line_start)
                handle.truncate()
                handle.flush()
                os.fsync(handle.fileno())
                warnings.warn(
                    f"recovered {path} by discarding its incomplete final JSONL line",
                    RuntimeWarning,
                    stacklevel=2,
                )
                return
            if not isinstance(value, dict):
                raise SchemaError(f"{path}:{line_number}: expected a JSON object")
            if handle.tell() == file_size and not line.endswith(b"\n"):
                handle.write(b"\n")
                handle.flush()
                os.fsync(handle.fileno())
                return


class JsonlResumeWriter:
    """Append durable per-utterance results while skipping completed IDs."""

    def __init__(
        self,
        path: str | Path,
        *,
        overwrite: bool = False,
        manifest: Mapping[str, Any] | None = None,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.seen_ids: set[str] = set()
        path_existed = self.path.exists()
        manifest_path = Path(f"{self.path}.manifest.json")
        expected_manifest = dict(manifest) if manifest is not None else None

        if path_existed and not overwrite:
            if expected_manifest is not None:
                if not manifest_path.exists():
                    raise SchemaError(
                        f"{self.path}: missing run manifest; use --overwrite"
                    )
                try:
                    with manifest_path.open("r", encoding="utf-8") as handle:
                        actual_manifest = json.load(handle)
                except (OSError, json.JSONDecodeError) as exc:
                    raise SchemaError(f"{manifest_path}: invalid run manifest") from exc
                if actual_manifest != expected_manifest:
                    raise SchemaError(
                        f"{self.path}: run parameters or input changed; use --overwrite"
                    )
            _recover_incomplete_jsonl_tail(self.path)
            for record in read_jsonl(self.path):
                utterance_id = record.get("id")
                if not isinstance(utterance_id, str) or not utterance_id:
                    raise SchemaError(f"{self.path}: output record has an invalid id")
                if utterance_id in self.seen_ids:
                    raise SchemaError(f"{self.path}: duplicate id '{utterance_id}'")
                self.seen_ids.add(utterance_id)

        if overwrite:
            self._handle = self.path.open("w", encoding="utf-8")
            self._handle.flush()
            os.fsync(self._handle.fileno())
            try:
                if expected_manifest is not None:
                    write_json_atomic(manifest_path, expected_manifest)
            except BaseException:
                self._handle.close()
                raise
        else:
            if expected_manifest is not None and not path_existed:
                write_json_atomic(manifest_path, expected_manifest)
            self._handle = self.path.open("a", encoding="utf-8")

    def write(self, record: Mapping[str, Any]) -> None:
        utterance_id = record.get("id")
        if not isinstance(utterance_id, str) or not utterance_id:
            raise SchemaError("output record must contain a non-empty id")
        if utterance_id in self.seen_ids:
            raise SchemaError(f"output already contains id '{utterance_id}'")
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        self._handle.write(line)
        self._handle.flush()
        os.fsync(self._handle.fileno())
        self.seen_ids.add(utterance_id)

    def close(self) -> None:
        self._handle.close()

    def __enter__(self) -> "JsonlResumeWriter":
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.close()
