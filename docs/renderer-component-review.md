<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# Renderer 组件临时设计审查

状态：临时清单。结论来自 FE-01 至 FE-09 的真实 Chromium 操作、窄 viewport 检查和当前 renderer 源码阅读；已在本次重构中解决的项目保留在“已处理”小节，其他项目供后续修复。

## 本次已处理

- `ConfirmModal` 改用 Radix `AlertDialog`，补齐 `alertdialog` 语义、初始焦点、焦点陷阱、显式取消语义和关闭后的触发控件焦点恢复。
- 新增共享 `Modal`，统一三个 Provider 编辑器和手动图片导入弹窗的 Portal、焦点管理和显式关闭；Escape 与遮罩外点击始终不会关闭弹窗，保留原有可见 DOM 结构和 CSS。
- `Tooltip` 改用 Radix Tooltip，补齐 Portal、碰撞处理、键盘触发和 `aria-describedby` 关联。
- 手动图片导入错误区增加 `role="alert"`，异步失败可以被辅助技术及时播报。

## 优先处理

### P1：确认框历史上没有焦点管理和 Escape 行为（已处理）

位置：[`ConfirmModal.tsx`](../packages/renderer/src/components/ui/ConfirmModal.tsx:22)

本次改为 Radix `AlertDialog`，由 Radix 管理焦点陷阱和模态层交互，并使用自动生成的标题/描述 ID；受控调用场景额外恢复打开前的触发控件焦点。组件测试 FE-03 覆盖确认和取消流程。

### P1：手动导入图片弹窗缺少同等级的模态可用性（已处理）

位置：[`ManualImageGenerationDialog.tsx`](../packages/renderer/src/features/airouter/ManualImageGenerationDialog.tsx:82)

该弹窗现在复用 `Modal`，拥有初始焦点、焦点陷阱、焦点恢复和 `aria-describedby`；导入失败信息也已经改为 `role="alert"`。Escape 和遮罩外点击不会取消导入，必须使用显式取消按钮或右上角关闭按钮。

## P2：辅助语义和状态反馈不完整

### Tooltip 历史上没有和触发控件建立描述关系（已处理）

位置：[`Tooltip.tsx`](../packages/renderer/src/components/ui/Tooltip.tsx:14)、[`IconButton.tsx`](../packages/renderer/src/components/ui/IconButton.tsx:29)

现在由 Radix Tooltip 在打开时生成 ID 并把 `aria-describedby` 关联到触发控件；FE-02 已验证该关系。disabled 触发器仍不会挂载 Tooltip，这是当前 API 的明确行为，后续若需要解释禁用原因应改用可聚焦包装元素。

### toast 溢出提示不可操作

位置：[`ToastViewport.tsx`](../packages/renderer/src/components/ui/ToastViewport.tsx:37)、[`Toast.module.css`](../packages/renderer/src/components/ui/Toast.module.css:8)

超过 4 条通知时只显示 `2+` 状态徽标，徽标设置了 `pointer-events: none`，用户没有入口查看被隐藏的通知。错误或长时间运行任务的反馈可能因此丢失。建议把徽标变为可聚焦控件，或提供通知中心/展开全部动作，并为隐藏通知定义键盘访问顺序。

### SettingsRow 的 label 没有通用关联契约

位置：[`SettingsContent.tsx`](../packages/renderer/src/components/settings/SettingsContent.tsx:42)

`SettingsRow` 把 label 渲染为普通 `span`，组件本身不会给子控件生成 `id` 或 `aria-labelledby`。现有外观设置页面通过 select 的独立 `aria-label` 和 switch 的 `aria-label` 补救，因此 FE-08 通过；但复用 `SettingsRow` 的新控件若只依赖行标题，会缺少可访问名称。建议让 row 接收 `labelId`/`controlId`，或把控件渲染协议统一为 `aria-labelledby`。

### ResizableSplit 的 separator 语义还不完整

位置：[`ResizableSplit.tsx`](../packages/renderer/src/components/ui/ResizableSplit.tsx:77)

FE-05 验证了键盘调整和当前最小/最大边界，但 separator 只有 `aria-valuemin` 和 `aria-valuenow`，缺少 `aria-valuemax`；像素值对用户也不够直观。建议补最大值、`aria-valuetext`，并在组件内部明确只接受两个 panel。当前实现对三个及以上 children 仍会渲染多个 handle，但只生成一组三列 grid 配置，API 行为容易误用。

## P3：响应式与默认状态需要产品确认

### renderer 实际不支持窄于 680px 的窗口

位置：[`global.css`](../packages/renderer/src/styles/global.css:17)、[`window.ts`](../src/main/window.ts:13)

body 设置了 `min-width: 680px`，BrowserWindow 最小宽度为 760px。FE-08 只验证了 720px viewport 下设置控件不越界，因此当前桌面窗口范围内可用，但这不是移动或极窄窗口响应式设计。若未来要支持更窄窗口，需要重新设计 shell、Page header 和设置行；否则应把“桌面最小宽度”作为产品约束显式保留。

### AIModelSelect 遇到失效 value 时会显示空白选择

位置：[`AIModelSelect.tsx`](../packages/renderer/src/components/ai/AIModelSelect.tsx:33)

当外部 value 不再出现在 options 中，`selectedIndex` 为 `-1`，select value 被设为空字符串，但有 options 时没有对应的占位 option。Provider 模型被删除或刷新失败后，用户可能看到空白下拉框而不知道当前值已失效。建议显示“当前模型不可用”并允许重新选择，或在 options 变化时显式清空并提示。

## 已验证的正向约束

- Button 默认 `type="button"`，避免在表单中意外提交；图标使用 `aria-hidden`。
- IconButton 有明确 accessible name，键盘 focus 会显示 tooltip。
- 壳层的 standard/focus/immersive 三种布局在导航操作中没有出现遮挡或不可达的主内容。
- 设置行在 720px viewport 下控件仍在可视范围内；当前测试未将结论扩展到 680px 以下。
