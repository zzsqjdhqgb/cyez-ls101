import builtins
import math
import unittest
from unittest.mock import Mock, patch

from textpa_repro.errors import SchemaError
from textpa_repro.llm import OpenAICompatibleAssessor, parse_assessment


class LlmParsingTests(unittest.TestCase):
    def test_parses_paper_style_json(self) -> None:
        result = parse_assessment(
            '{"Accuracy": 4, "Fluency": 3, "Reasoning": "Clear but hesitant."}'
        )
        self.assertEqual(result.accuracy, 4.0)
        self.assertEqual(result.fluency, 3.0)

    def test_parses_fenced_json(self) -> None:
        result = parse_assessment(
            '```json\n{"Accuracy": 5, "Fluency": 5, "Reasoning": "Natural."}\n```'
        )
        self.assertEqual(result.accuracy, 5.0)

    def test_rejects_out_of_range_score(self) -> None:
        with self.assertRaises(SchemaError):
            parse_assessment(
                '{"Accuracy": 8, "Fluency": 3, "Reasoning": "Invalid."}'
            )


class LlmConfigurationTests(unittest.TestCase):
    def _assert_rejected_before_openai_import(self, **kwargs: object) -> None:
        original_import = builtins.__import__
        attempted_openai_imports: list[str] = []

        def guarded_import(name: str, *args: object, **import_kwargs: object):
            if name == "openai":
                attempted_openai_imports.append(name)
                raise AssertionError("OpenAI was imported before argument validation")
            return original_import(name, *args, **import_kwargs)

        with patch("builtins.__import__", side_effect=guarded_import):
            with self.assertRaises(ValueError):
                OpenAICompatibleAssessor("test-model", api_key="unused", **kwargs)

        self.assertEqual(attempted_openai_imports, [])

    def test_retries_below_one_are_rejected_before_openai_import(self) -> None:
        for retries in (0, -1):
            with self.subTest(retries=retries):
                self._assert_rejected_before_openai_import(retries=retries)

    def test_invalid_timeouts_are_rejected_before_openai_import(self) -> None:
        for timeout in (0.0, -1.0, math.nan):
            with self.subTest(timeout=timeout):
                self._assert_rejected_before_openai_import(timeout=timeout)

    def test_invalid_reasoning_effort_is_rejected_before_openai_import(self) -> None:
        self._assert_rejected_before_openai_import(reasoning_effort="extreme")

    def test_responses_api_sends_reasoning_effort(self) -> None:
        client = Mock()
        client.responses.create.return_value.output_text = (
            '{"Accuracy": 4, "Fluency": 3, "Reasoning": "Clear."}'
        )
        with patch("openai.OpenAI", return_value=client):
            assessor = OpenAICompatibleAssessor(
                "test-model",
                api_key="unused",
                api_style="responses",
                reasoning_effort="max",
            )

        assessor.assess("test prompt")

        client.responses.create.assert_called_once_with(
            model="test-model",
            input="test prompt",
            reasoning={"effort": "max"},
        )

    def test_chat_api_sends_reasoning_effort(self) -> None:
        client = Mock()
        client.chat.completions.create.return_value.choices = [
            Mock(
                message=Mock(
                    content=(
                        '{"Accuracy": 4, "Fluency": 3, "Reasoning": "Clear."}'
                    )
                )
            )
        ]
        with patch("openai.OpenAI", return_value=client):
            assessor = OpenAICompatibleAssessor(
                "test-model",
                api_key="unused",
                api_style="chat",
                reasoning_effort="high",
            )

        assessor.assess("test prompt")

        client.chat.completions.create.assert_called_once_with(
            model="test-model",
            messages=[{"role": "user", "content": "test prompt"}],
            reasoning_effort="high",
        )

    def test_omitted_reasoning_effort_preserves_request_shape(self) -> None:
        client = Mock()
        client.responses.create.return_value.output_text = (
            '{"Accuracy": 4, "Fluency": 3, "Reasoning": "Clear."}'
        )
        with patch("openai.OpenAI", return_value=client):
            assessor = OpenAICompatibleAssessor(
                "test-model", api_key="unused", api_style="responses"
            )

        assessor.assess("test prompt")

        client.responses.create.assert_called_once_with(
            model="test-model", input="test prompt"
        )

        chat_client = Mock()
        chat_client.chat.completions.create.return_value.choices = [
            Mock(
                message=Mock(
                    content=(
                        '{"Accuracy": 4, "Fluency": 3, "Reasoning": "Clear."}'
                    )
                )
            )
        ]
        with patch("openai.OpenAI", return_value=chat_client):
            chat_assessor = OpenAICompatibleAssessor(
                "test-model", api_key="unused", api_style="chat"
            )

        chat_assessor.assess("test prompt")

        chat_client.chat.completions.create.assert_called_once_with(
            model="test-model",
            messages=[{"role": "user", "content": "test prompt"}],
        )


if __name__ == "__main__":
    unittest.main()
