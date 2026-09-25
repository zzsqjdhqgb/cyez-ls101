<!--
status: draft
product-version: 0.4.1
audience: engineer
owner: renderer
-->

# Renderer 可用性与语义待修

本文件承接 `docs/renderer-component-review.md`（一次性审查记录，已归档）中**尚未修复**的项目。
已处理的焦点管理、图片弹窗模态语义与 Tooltip 描述关系不再重复；原始证据与对照见
[`../../archive/renderer-component-review.md`](../../archive/renderer-component-review.md)。

## P2：辅助语义与状态反馈

### toast 溢出提示不可操作

- 位置：`packages/renderer/src/components/ui/toast*`
- 现象：提示内容过长时只做视觉溢出，用户无法展开或复制完整文本。
- 建议：给提示设置最大宽度并提供可展开/可复制的完整文本，或限制调用方传入的消息长度。

### `SettingsRow` 的 label 没有通用关联契约

- 位置：`packages/renderer/src/components/ui/SettingsRow.tsx`
- 现象：label 与内部控件没有统一的 `htmlFor` / `aria-labelledby` 关联，各页自行用 `aria-label` 补，容易漏。
- 建议：在组件层建立关联契约（接受 `htmlFor` 或包裹控件并生成 id），再逐页去掉重复的 `aria-label`。

### `ResizableSplit` 的 separator 语义不完整

- 位置：`packages/renderer/src/components/ui/ResizableSplit.tsx:77`
- 现象：只有 `aria-valuemin` 与 `aria-valuenow`，缺 `aria-valuemax`，像素值对用户不直观；三个及以上 children 仍渲染多个 handle，却只生成一组三列 grid 配置。
- 建议：补 `aria-valuemax` 与 `aria-valuetext`，并在组件内限制为两个 panel（或明确拒绝多余 children）。

## P3：响应式与默认状态（需要产品确认）

### renderer 实际不支持窄于 680px 的窗口

- 位置：`packages/renderer/src/styles/global.css:17`、`src/main/window.ts:13`
- 现状：`body` 设 `min-width: 680px`，BrowserWindow 最小宽度 760px；仅在 720px viewport 下验证过设置控件不越界。
- 需要定：把「桌面最小宽度」作为产品约束显式保留，还是重新设计 shell、Page header 与设置行以支持更窄窗口。

### `AIModelSelect` 遇到失效 value 时显示空白选择

- 位置：`packages/renderer/src/components/ai/AIModelSelect.tsx:33`
- 现象：外部 value 不在 options 中时 `selectedIndex` 为 `-1`，有 options 却没有占位项，用户看到空白下拉框而不知道当前值已失效。
- 建议：显示「当前模型不可用」并允许重新选择，或在 options 变化时显式清空并提示。
