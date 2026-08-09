from __future__ import annotations

import json
import math
import os
import time
from typing import Any

from .errors import DependencyError, SchemaError
from .models import Assessment


REASONING_EFFORTS = (
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
)


def _is_rate_limit_error(error: Exception) -> bool:
    if getattr(error, "status_code", None) == 429:
        return True
    response = getattr(error, "response", None)
    return getattr(response, "status_code", None) == 429


def parse_assessment(text: str) -> Assessment:
    candidate = text.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        candidate = "\n".join(lines).strip()

    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start < 0 or end <= start:
            raise SchemaError("model response does not contain a JSON object")
        try:
            payload = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError as exc:
            raise SchemaError("model response contains invalid JSON") from exc
    if not isinstance(payload, dict):
        raise SchemaError("model response must be a JSON object")
    return Assessment.from_dict(payload)


class OpenAICompatibleAssessor:
    """Text assessor for OpenAI and OpenAI-compatible chat endpoints."""

    def __init__(
        self,
        model: str,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        api_key_env: str = "TEXTPA_API_KEY",
        api_style: str = "chat",
        json_mode: bool = False,
        reasoning_effort: str | None = None,
        retries: int = 3,
        timeout: float = 120.0,
    ) -> None:
        if not isinstance(model, str) or not model.strip():
            raise ValueError("model must be a non-empty string")
        if api_style not in {"chat", "responses"}:
            raise ValueError("api_style must be 'chat' or 'responses'")
        if reasoning_effort is not None and reasoning_effort not in REASONING_EFFORTS:
            choices = ", ".join(REASONING_EFFORTS)
            raise ValueError(f"reasoning_effort must be one of: {choices}")
        if isinstance(retries, bool) or not isinstance(retries, int) or retries < 1:
            raise ValueError("retries must be a positive integer")
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout)
            or timeout <= 0
        ):
            raise ValueError("timeout must be positive and finite")
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise DependencyError("LLM assessment requires the 'llm' extra") from exc

        resolved_key = api_key or os.getenv(api_key_env) or os.getenv("OPENAI_API_KEY")
        if not resolved_key:
            raise DependencyError(
                f"missing API key: set {api_key_env} or OPENAI_API_KEY"
            )
        resolved_url = base_url or os.getenv("TEXTPA_BASE_URL")
        kwargs: dict[str, Any] = {
            "api_key": resolved_key,
            "timeout": timeout,
            "max_retries": 2,
        }
        if resolved_url:
            kwargs["base_url"] = resolved_url
        self._client = OpenAI(**kwargs)
        self.model = model
        self.api_style = api_style
        self.json_mode = json_mode
        self.reasoning_effort = reasoning_effort
        self.retries = retries

    def _call(self, prompt: str) -> str:
        if self.api_style == "chat":
            kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
            }
            if self.json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            if self.reasoning_effort is not None:
                kwargs["reasoning_effort"] = self.reasoning_effort
            response = self._client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content
            if not isinstance(content, str):
                raise SchemaError("chat endpoint returned no text content")
            return content

        if self.api_style == "responses":
            kwargs = {"model": self.model, "input": prompt}
            if self.json_mode:
                kwargs["text"] = {"format": {"type": "json_object"}}
            if self.reasoning_effort is not None:
                kwargs["reasoning"] = {"effort": self.reasoning_effort}
            response = self._client.responses.create(**kwargs)
            content = response.output_text
            if not isinstance(content, str):
                raise SchemaError("Responses endpoint returned no text content")
            return content

        raise ValueError("api_style must be 'chat' or 'responses'")

    def assess(self, prompt: str) -> Assessment:
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                return parse_assessment(self._call(prompt))
            except (SchemaError, json.JSONDecodeError) as exc:
                last_error = exc
            except Exception as exc:
                if not _is_rate_limit_error(exc):
                    raise
                last_error = exc
            if attempt + 1 < self.retries:
                time.sleep(min(2**attempt, 4))
        assert last_error is not None
        if _is_rate_limit_error(last_error):
            raise last_error
        raise SchemaError(
            f"model did not return a valid assessment after {self.retries} attempts"
        ) from last_error
