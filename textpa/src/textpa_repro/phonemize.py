from __future__ import annotations

from .errors import DependencyError, TextPAError


class EspeakCanonicalIpa:
    """Generate the canonical IPA sequence exactly as the author code does."""

    def __init__(self, language: str = "en-us") -> None:
        try:
            from phonemizer.backend import EspeakBackend
            from phonemizer.separator import Separator
        except ImportError as exc:
            raise DependencyError(
                "canonical IPA requires the 'phonemizer' extra and eSpeak NG"
            ) from exc

        try:
            self._backend = EspeakBackend(language)
        except RuntimeError as exc:
            raise DependencyError(
                "phonemizer could not find eSpeak; install the espeak-ng native package"
            ) from exc
        self._separator = Separator(phone=" ", word=None)

    def __call__(self, transcript: str) -> str:
        try:
            from phonemizer.punctuation import Punctuation
        except ImportError as exc:
            raise DependencyError("phonemizer is not installed") from exc

        sentence = Punctuation(';:,.!"?()-').remove(transcript.lower())
        results: list[str] = []
        for word in sentence.split(" "):
            if not word:
                continue
            phones = self._backend.phonemize(
                [word], separator=self._separator, strip=True
            )[0]
            if phones:
                results.append(phones)
        output = " ".join(results)
        if not output:
            raise TextPAError("eSpeak produced an empty canonical IPA sequence")
        return output
