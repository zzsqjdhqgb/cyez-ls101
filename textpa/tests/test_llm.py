import builtins
import math
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
