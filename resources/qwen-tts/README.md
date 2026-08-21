# Qwen TTS runtime

Platform-specific `ls101-qwen-tts-helper` binaries are generated here by:

```bash
yarn qwen-tts:build-runtime
```

The generated binaries are intentionally not committed. The `Qwen TTS Bundle` GitHub workflow
builds the helpers and model package from the versions pinned in `scripts/qwen-tts/assets.json`.

See `docs/engineering/qwen-tts.md` for the complete model conversion, VoiceDesign, speaker
extraction, and package import workflow.
