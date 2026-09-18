# Logger follow-up

The first logger integration intentionally only adds the shared logger, the main-process file sink, the preload bridge, and renderer/global process error forwarding. The following work is intentionally deferred so it does not become a broad business-logic refactor:

- Wrap every `ipcMain.handle` and `ipcMain.on` entry point with operation names, durations, and normalized error logging.
- Replace feature-level `console.*` calls with the shared logger and add request IDs to long-running AI, import, export, and grading operations.
- Add logging at storage and repository boundaries, including suppressed fallback errors that currently become `null`, `false`, or an empty collection.
- Define and enforce redaction for API keys, prompts, submission content, and user file paths before persistent logging.
- Add a user-facing diagnostics export flow and make retention settings configurable if needed.
- Expand tests to cover file-write failures after startup and browser-global error forwarding.
