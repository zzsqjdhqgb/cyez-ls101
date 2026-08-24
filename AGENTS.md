# Agent Development Notes

- After changes to the renderer, preload, or main process, use `xvfb-run -a yarn test:smoke` as the default runtime smoke test inside the container. This command rebuilds the packaged application and runs `tests/integration/electron-app.spec.ts`.
- Run additional targeted Electron integration specs when the changed behavior is outside the smoke suite. Run the complete integration suite for broad cross-cutting changes or final verification.
- Use `yarn dev:docker` for manual runtime testing only when changes affect visual layout, development-mode startup, operating-system dialogs or window-manager behavior, or behavior that the automated Electron tests cannot assert.
- The application has not been released to users yet. Unless the user explicitly requests it, data and configuration schema changes do not need backward-compatible migrations.
- Do not run `git add` or `git commit`. Provide the exact commands for the user to run instead.
- If `node_modules` is read-only, `dist` or a required build output path under it cannot be written, or a required native tool is only available as a Windows `.exe`, stop work immediately and ask the user to repair the environment. Do not install temporary replacements, redirect build output to another directory, or attempt other workarounds.
