<!-- 此文件由 Playwright 测试发现结果自动生成，请勿手工编辑。 -->

# Playwright 技术测试清单

本页只提供技术回归测试的当前盘点和源码入口，不重复维护操作步骤与断言说明。

## Electron 集成测试

打包应用中的 renderer、preload、main、IPC 和持久化跨层回归。当前共 74 条测试。

### [airouter.spec.ts](../../../tests/integration/airouter.spec.ts)

- AR-01 navigates through AI engine settings categories
- AR-02 exposes the text empty state and default manual image provider
- AR-03 creates and reloads an OpenAI-compatible provider through the UI
- AR-04 creates and reloads an Anthropic provider through the UI
- AR-05 loads, replaces and clears a text provider API key
- AR-06 manages manual text models, enabled state, deduplication and removal
- AR-07 discovers, sorts and merges text models with the draft
- AR-08 tests an unsaved OpenAI-compatible draft without persisting it
- AR-09 tests an unsaved Anthropic draft with its own protocol and headers
- AR-10 edits and deletes a text provider with its secret without affecting others
- AR-11 streams OpenAI-compatible output across HTTP, main, IPC and preload
- AR-12 streams Anthropic reasoning and output through the common chunk contract
- AR-13 cancels text generation, closes HTTP work and allows a subsequent request
- AR-14 reports both provider protocols, stream failures and truncation
- AR-15 imports and cancels manual image generation through the global dialog
- AR-16 saves and reloads an image provider with isolated config and secret scopes
- AR-17 discovers image models and previews an unsaved connection test
- AR-18 generates an API image end to end with prompt and dimensions
- AR-19 reports image failures and suppresses results after cancellation
- AR-20 deletes image providers and restores the manual fallback with secret cleanup
- AR-21 edits image models and completes the image API key lifecycle
- AR-22 reports failed text and image draft connection tests without persisting them
- AR-23 rejects invalid image prompts and dimensions before issuing HTTP requests
- AR-24 reports model discovery failures without persisting drafts
- AR-25 closes an unsaved provider draft without persisting it
- AR-26 constrains save and busy states in the provider editor
- AR-27 cancels text generation after partial output and reuses the pipeline
- AR-28 manages a local TTS model package and its Provider lifecycle
- AR-29 configures and tests an online TTS Provider through the UI
- AR-30 routes speech roles, merges adjacent segments, and returns requested formats
- AR-31 reports speech failures, cancels slow synthesis, and reuses the pipeline
- AR-32 executes the real Pocket TTS model package through the Electron stack
- AR-32c executes Qwen3 ASR without external buffers in Electron
- AR-32d imports and executes the required pronunciation extension in Electron
- AR-33 rejects invalid text and speech selections before making HTTP requests
- AR-32b executes Qwen3 TTS through the Electron stack

### [data-directory.spec.ts](../../../tests/integration/data-directory.spec.ts)

- copies business data, switches directories after restart and retains the source
- resets a custom data directory to the validated default location

### [electron-app.spec.ts](../../../tests/integration/electron-app.spec.ts)

- starts a hardened application window and exposes every preload bridge
- round-trips data through file, config, asset protocol, AI and clipboard IPC
- navigates through every primary application area
- exports a submission containing a large resource through the renderer ZIP worker
- guides microphone setup through recording and playback before the exam
- persists appearance settings through the renderer and config store
- creates, edits and reloads a persisted template
- opens and copies bundled Shanghai speaking templates
- exports a persisted formal Schema through the native save dialog
- routes window controls through preload to the owning BrowserWindow

### [interface-editor.spec.ts](../../../tests/integration/interface-editor.spec.ts)

- IE-01 generates and saves an instance through the real AIRouter pipeline
- IE-02 generates text and images atomically through the real pipelines
- IE-02b retries a failed image step without regenerating completed text
- IE-03 reports invalid AI output and supports cancellation without saving
- IE-04 creates, edits and persists a draft through the real UI
- IE-05 validates and publishes a draft through the real UI
- IE-06 deletes drafts and guards unsaved changes on leave
- IE-07 edits and saves an instance and guards unsaved changes
- IE-08 replaces instance values from JSON and reports invalid JSON
- IE-08b generates image fields from JSON without selecting a text model
- IE-09 deletes an instance through the real UI
- IE-10 copies a published interface to a draft
- IE-11 exports and re-imports an interface with its instances
- IE-12 manages draft field groups, image type and node deletion
- IE-13 drives the instance image field buttons end to end
- IE-14 covers list and details page action buttons
- IE-15 drives the standalone AI image task dialog end to end
- IE-16 installs all bundled Shanghai Interfaces on first launch
- IE-17 manages a bundled instance and copies the builtin to a draft
- IE-18 generates and persists an image in a bundled picture field
- IE-23 generates all four bundled story pictures through the AI pipeline
- IE-19 keeps bundled Interface installation idempotent across restarts
- IE-20 migrates bundled instances, assets and template references after restart
- IE-21 can keep the previous bundled version as a published Interface
- IE-22 refuses a bundled update that changes its variable contract

### [template-preview.spec.ts](../../../tests/integration/template-preview.spec.ts)

- previews a selected node tree as a vertical timeline filmstrip

## Renderer 组件测试

浏览器环境中的组件语义、键盘、焦点、响应式布局和可见状态。当前共 9 条测试。

### [renderer-components.spec.tsx](../../../tests/components/renderer-components.spec.tsx)

- FE-01 buttons expose semantic defaults and keyboard activation
- FE-02 icon buttons remain discoverable through focus and tooltips
- FE-03 confirmation modal requires an explicit action and restores focus
- FE-04 shared modal blocks Escape and outside clicks until explicit close
- FE-05 resizable split responds to keyboard resizing without leaving its bounds
- FE-06 model selector groups providers and reports selection and refresh
- FE-07 application shell keeps navigation usable while changing layouts
- FE-08 settings rows remain usable in a narrow component viewport
- FE-09 page compositions retain a heading and empty-state reading order

合计：83 条 Playwright 技术回归测试。
