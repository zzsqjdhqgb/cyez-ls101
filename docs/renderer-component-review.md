<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# Renderer 组件临时设计审查

状态：临时清单。结论来自 FE-01 至 FE-08 的真实 Chromium 操作、窄 viewport 检查和当前 renderer 源码阅读；这里只记录需要后续确认或修复的设计问题，不改变本次组件测试的通过标准。

## 优先处理

### P1：确认框没有焦点管理和 Escape 行为

位置：[`ConfirmModal.tsx`](../packages/renderer/src/components/ui/ConfirmModal.tsx:22)

当前 modal 能提供 `role="dialog"`、`aria-modal` 和按钮操作，但打开时不会把焦点移入对话框，关闭后也不会恢复触发控件焦点；按 Escape 不会取消，Tab 也没有焦点陷阱。键盘用户可能继续操作背景页面，尤其是删除确认场景风险较高。建议补充初始焦点、Escape、焦点恢复和可测试的 focus trap；同时把固定的 `confirm-modal-title` / `confirm-modal-description` 改成 `useId`，避免同页存在多个 modal 时产生重复 ID。

### P1：手动导入图片弹窗缺少同等级的模态可用性

位置：[`ManualImageGenerationDialog.tsx`](../packages/renderer/src/features/airouter/ManualImageGenerationDialog.tsx:82)

该弹窗也声明了 `role="dialog"` 和 `aria-modal`，但没有初始焦点、Escape、焦点恢复和 `aria-describedby`。导入失败信息只是普通 `div`（同文件约 169 行），异步错误不一定会被辅助技术及时播报。建议与确认框共用一个模态行为基础，并给错误区加 `role="alert"` 或状态播报策略。

## P2：辅助语义和状态反馈不完整

### Tooltip 没有和触发控件建立描述关系

位置：[`Tooltip.tsx`](../packages/renderer/src/components/ui/Tooltip.tsx:14)、[`IconButton.tsx`](../packages/renderer/src/components/ui/IconButton.tsx:29)

tooltip 通过 CSS 的 hover/focus-within 显示，但没有为 tooltip 生成 ID，也没有给子控件设置 `aria-describedby`。图标按钮自身有 `aria-label`，所以 FE-02 的视觉/可发现性通过，但其他需要补充说明的触发器不能稳定获得同一语义。建议使用 `useId` 建立描述关系，并明确 disabled 控件是否仍需要可读的原因说明。

### toast 溢出提示不可操作

位置：[`ToastViewport.tsx`](../packages/renderer/src/components/ui/ToastViewport.tsx:37)、[`Toast.module.css`](../packages/renderer/src/components/ui/Toast.module.css:8)

超过 4 条通知时只显示 `2+` 状态徽标，徽标设置了 `pointer-events: none`，用户没有入口查看被隐藏的通知。错误或长时间运行任务的反馈可能因此丢失。建议把徽标变为可聚焦控件，或提供通知中心/展开全部动作，并为隐藏通知定义键盘访问顺序。

### SettingsRow 的 label 没有通用关联契约

位置：[`SettingsContent.tsx`](../packages/renderer/src/components/settings/SettingsContent.tsx:42)

`SettingsRow` 把 label 渲染为普通 `span`，组件本身不会给子控件生成 `id` 或 `aria-labelledby`。现有外观设置页面通过 select 的独立 `aria-label` 和 switch 的 `aria-label` 补救，因此 FE-07 通过；但复用 `SettingsRow` 的新控件若只依赖行标题，会缺少可访问名称。建议让 row 接收 `labelId`/`controlId`，或把控件渲染协议统一为 `aria-labelledby`。

### ResizableSplit 的 separator 语义还不完整

位置：[`ResizableSplit.tsx`](../packages/renderer/src/components/ui/ResizableSplit.tsx:77)

FE-04 验证了键盘调整和当前最小/最大边界，但 separator 只有 `aria-valuemin` 和 `aria-valuenow`，缺少 `aria-valuemax`；像素值对用户也不够直观。建议补最大值、`aria-valuetext`，并在组件内部明确只接受两个 panel。当前实现对三个及以上 children 仍会渲染多个 handle，但只生成一组三列 grid 配置，API 行为容易误用。

## P3：响应式与默认状态需要产品确认

### renderer 实际不支持窄于 680px 的窗口

位置：[`global.css`](../packages/renderer/src/styles/global.css:17)、[`window.ts`](../src/main/window.ts:13)

body 设置了 `min-width: 680px`，BrowserWindow 最小宽度为 760px。FE-07 只验证了 720px viewport 下设置控件不越界，因此当前桌面窗口范围内可用，但这不是移动或极窄窗口响应式设计。若未来要支持更窄窗口，需要重新设计 shell、Page header 和设置行；否则应把“桌面最小宽度”作为产品约束显式保留。

### AIModelSelect 遇到失效 value 时会显示空白选择

位置：[`AIModelSelect.tsx`](../packages/renderer/src/components/ai/AIModelSelect.tsx:33)

当外部 value 不再出现在 options 中，`selectedIndex` 为 `-1`，select value 被设为空字符串，但有 options 时没有对应的占位 option。Provider 模型被删除或刷新失败后，用户可能看到空白下拉框而不知道当前值已失效。建议显示“当前模型不可用”并允许重新选择，或在 options 变化时显式清空并提示。

## 已验证的正向约束

- Button 默认 `type="button"`，避免在表单中意外提交；图标使用 `aria-hidden`。
- IconButton 有明确 accessible name，键盘 focus 会显示 tooltip。
- 壳层的 standard/focus/immersive 三种布局在导航操作中没有出现遮挡或不可达的主内容。
- 设置行在 720px viewport 下控件仍在可视范围内；当前测试未将结论扩展到 680px 以下。
