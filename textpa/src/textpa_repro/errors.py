class TextPAError(Exception):
    """Base error for expected pipeline failures."""


class DependencyError(TextPAError):
    """A required optional dependency or native command is unavailable."""


class SchemaError(TextPAError):
    """An input or model response does not satisfy the pipeline schema."""


class CalibrationError(TextPAError):
    """A score cannot be calibrated with the supplied cohort."""

