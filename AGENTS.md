# Agent Development Notes

- When developing inside the container, use `yarn dev:docker` to start and test the Electron application.
- Use this command for runtime smoke tests after changes to the renderer, preload, or main process.
- The application has not been released to users yet. Unless the user explicitly requests it, data and configuration schema changes do not need backward-compatible migrations.
- Do not run `git add` or `git commit`. Provide the exact commands for the user to run instead.
