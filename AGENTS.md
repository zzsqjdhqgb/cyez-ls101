# Agent Development Notes

- After changes to the renderer, preload, or main process, use `xvfb-run -a yarn test:smoke` as the default runtime smoke test inside the container. This command rebuilds the packaged application and runs `tests/integration/electron-app.spec.ts`.
- Run additional targeted Electron integration specs when the changed behavior is outside the smoke suite. Run the complete integration suite for broad cross-cutting changes or final verification.
- Use `yarn dev:docker` for manual runtime testing only when changes affect visual layout, development-mode startup, operating-system dialogs or window-manager behavior, or behavior that the automated Electron tests cannot assert.
- The application has not been released to users yet. Unless the user explicitly requests it, data and configuration schema changes do not need backward-compatible migrations.
- Do not run `git add` or `git commit`. Provide the exact commands for the user to run instead.
- If `node_modules` is read-only, `dist` or a required build output path under it cannot be written, or a required native tool is only available as a Windows `.exe`, stop work immediately and ask the user to repair the environment. Do not install temporary replacements, redirect build output to another directory, or attempt other workarounds.
- When CI results (GitHub Actions logs, run/job status, release state) are needed: this container has no `gh` CLI, no `GH_TOKEN`, and its direct network path to GitHub is unreliable. **Do not improvise your own fetching** (curl against the API, `web_fetch`, scraping HTML pages, probing anonymous log endpoints — all waste time and hit rate limits or 404s). Instead, ask the user and hand them the complete, ready-to-run `gh` command with the run ID filled in, writing to the workspace root:
  ```powershell
  gh run view <RUN_ID> --repo zzsqjdhqgb/cyez-ls101 --log-failed > index-tts-run-logs.txt
  ```
  Then read the file the user drops in the workspace root. If the run ID is unknown, give the auto-fetch variant (`$rid = gh run list --repo zzsqjdhqgb/cyez-ls101 --workflow <wf>.yml --limit 1 --json databaseId --jq '.[0].databaseId'; gh run view $rid ...`). The file is large (~68 MB), untracked, and must never be committed.

---

# Remote GPU Server (RTX 5080) — Pointer Only

This workspace has a remote GPU test server, accessed via MCP tools prefixed `mcp__ssh5080__`.

**Before doing anything on it, read the full guide on the server itself:**
`mcp__ssh5080__read-file` with `remotePath: /home/dsh/agents.md`

One-line positioning so you don't get it wrong: this is the owner's **explicitly designated free-play testing ground** (mess around freely / experiment boldly). Default to action, not permission-asking. Hard rules are short: `dsh` has no sudo, don't touch `/home/chanmao`, no globally destructive ops. Everything else is in the remote guide.

If MCP tools are unavailable, local fallback driver: `/root/.dsh/ssh-mcp/ssh-exec.sh '<command>'`
