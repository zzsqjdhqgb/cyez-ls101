# Lab UI 重写工作契约（临时文档）

> 临时文件，仅用于跨会话/上下文压缩保留约定。重写结束后可删除。
> 分支：`feat/lab-deployment`（不合并）。工作区改动由用户自行 commit，AI 不执行 `git add`/`git commit`。

## 1. 目标

教师端与学生端统一使用主程序的 UI 外壳；lab 与主程序冲突的方案（全局 CSS、自造 header/tabs/弹窗）一律删除，采用主程序方案；启动动画同样落到 lab；样式统一到设计令牌 + CSS Modules。

不变项：lab 服务端契约（OpenAPI）、队列/重试/幂等语义、宿主 capability 白名单、打包产物路径。

## 2. 目标结构

- 新增 `@ls101/desktop-ui`（`packages/desktop-ui`）：外壳（AppShell/TitleBar/Sidebar）、UI 原语、设计令牌、启动动画、主进程窗口控制。
  - `exports`：`.`（外壳 + 原语 + 路由注册表）、`./styles.css`、`./startup`、`./main`（P4 起）。
- 新增 `@ls101/lab-renderer`（`packages/lab-renderer`）：`useLabQuery`/`useLabMutation`/`useSelection`/`describeLabError`/格式化工具；lab 两端共用。
- lab 两端改为 `MemoryRouter` + route registry + `AppShell`；渲染层目录改为 `renderer/src/{app,pages,components,hooks,...}`。
- lab 宿主窗口改 `frame: false`，复用共享窗口控制。

## 3. 主程序暂停点（必须让用户跑文档测试）

判据：diff 落在 `packages/renderer/**`、`src/main/**`、`src/preload/**`，或改动主程序在用的 `@ls101/desktop-ui` 组件样式/行为。

| 暂停点 | 内容 | 预期视觉差异 | 用户验证 |
| --- | --- | --- | --- |
| P1 | 建包、搬迁文件、重写 import（纯搬运） | 零差异 | `yarn test:product-docs` |
| P2 | 外壳参数化（TitleBar/AppShell 可选 props、layout 覆盖、窗口控制降级） | 零差异 | `yarn test:product-docs` |
| P3 | 启动统一（Vite 插件注入占位 + 共享 bootstrap） | 启动后零差异；启动动画需肉眼确认 | `yarn test:product-docs` + 手动看启动 |
| P4 | 窗口控制抽到 `@ls101/desktop-ui/main`（main + preload） | 无视觉差异 | 手动验最小化/最大化/还原/关闭 |

每个暂停点 AI 先自测：`yarn lint`、`yarn test:vitest`、`yarn test:playwright:components`、`xvfb-run -a yarn test:smoke`。
严格门禁：`yarn docs:product:check`（Docker canonical）；快速回路：`yarn test:product-docs`（输出 `test-results/product-docs-preview`，不改 `docs/product`）。

P4 之后 lab 侧不再触发主程序文档测试。lab 检查点（L 系列）仅需人工观感确认 + AI 跑 `yarn lab:test:integration`。

**硬规则：任何后续步骤若意外造成主程序可见界面变化，立即停止并报告，绝不自行接受视觉差异。**

## 4. 决策边界

- AI 自行决定（不提问）：布局、组件选型、样式、加载/空/失败/旧数据态、错误文案、可访问性、轮询频率、代码结构。
- 必须询问用户：页面上有哪些操作、权限与准入、默认值、破坏性操作确认文案、功能保留/合并/移动、设计文档与现实现冲突、任何改变用户可见流程的事。
- 提问方式：批量、附推荐答案；确认后记入决策文档再实现。

## 5. 页面层流程（教师端/学生端）

基础设施（P1–P4 + lab 宿主 + `@ls101/lab-renderer`）不问直接做。
页面层**不做忠实搬运**：先按页面产出「契约梳理」（目标/入口与准入/状态/操作/服务端 operation 与 revision/异常与冲突/待决问题），依据 `docs/lab-deployment-design.md`、`docs/lab-teacher-workflow-design.md`、`docs/lab-student-state-design.md`、`docs/lab-server-api-design.md` + 现实现；批量提问 → 用户确认 → 每页只实现一次。

安全网：非 UI 测试（server、队列、controller、契约、`lab-design-contract`）全程保持绿；lab 集成 spec 按页面逐段改造；**任何编码安全规则的断言如需删改必须先上报**。

## 6. 其他约定

- 一个暂停点一个可独立回滚的提交；AI 不执行 git 命令。
- 不碰 `infra/windows-vm/**`、lab 服务端/契约、主程序业务页面（除 import 路径与外壳 props 传参）。
- 发现环境问题（只读 node_modules、缺少必需原生工具等）或预期外差异 → 立刻停下报告。
- `yarn typecheck` 目前是空转（根 tsconfig `files: []` + references，`tsc -p` 不构建引用工程）；收尾阶段补 `typecheck:apps` 脚本，不单独改 CI 语义。

### 已知开发坑（2026-09-18 会话记录，2026-09-24 校对；原 `HANDOFF-lab-ui-rewrite.local.md` 已删除）

- **本机服务仍是两条通道**：`localService.status` 在主进程直接走只读检查（**不提权**，所以可以自动刷新）；其余会改机器的 operation 才起提权 helper。变更必须串行——主进程 `localServiceHost` 用 `busy` 标志，并发直接 `LOCAL_OPERATION_BUSY`；渲染端 `LocalServiceStore` 另有队列，避免旧的 status 观测覆盖刚完成的操作结果。写新的本机服务能力前先想清楚它属于哪条通道。
- `react-hooks/set-state-in-effect` 经 `eslint-plugin-react-hooks` v7 的 `configs.recommended.rules` 生效，是 **error**：不要在 effect 里同步 `setState`，数据加载走 promise 回调。
- `packages/desktop-ui` 的 `Modal` 用 Radix `asChild`：面板组件必须 `forwardRef` 并透传 props，否则丢 `role="dialog"` 与可访问名（见 `ModalPanel.tsx` 顶部注释）。
- app 的 `tsconfig.json` `references` 含 `packages/lab-desktop-host`；改动其公开类型后要 `npx tsc -b packages/lab-desktop-host` 重建 dist，否则 app typecheck 报 TS6305。`desktop-ui`/`lab-renderer` **不要**加进 app references，直接走 node_modules 解析源码即可。
- `ELECTRON_ENTRY`（见 `package.json` 的 `lab:dev:*`）只告诉 electron-vite dev 启动哪个入口，**不改变构建输入**。

## 7. 进度台账

- [x] P1 建 `@ls101/desktop-ui`、搬迁、import 重写 —— 已通过 `docs:product:check`
- [x] P2 外壳参数化（title/subtitle/icon/actions/layout + FE-10）—— 已通过 `docs:product:check`
- [x] P3 启动统一（Vite 插件注入占位 + 共享 bootstrap）—— 已通过 `docs:product:check`
- [x] P4 窗口控制共享（`@ls101/desktop-ui/main`）—— 已通过 `docs:product:check` + 手动窗口测试
- [x] D lab 宿主窗口控制接线（`frameless` 选项 + bridge；无框切换在各端重写时开启）—— lab 集成 3/3
- [x] D2 `@ls101/lab-renderer` 数据层（query/action/selection/format，17 用例）
- [x] E 教师端页面契约梳理 → `TODO-lab-teacher-ui-contract.local.md`
- [x] E2a 教师端外壳 + 激活页 + 连接页（列表式 + 本机服务管理弹窗）+ 无框窗口；其余页面为占位
- [ ] W 研究并验证"主程序与教师端窗口外观不一致"的根因（H1 平台缺陷 vs H2 显示时序）→ `TODO-lab-window-chrome-parity.md`
- [ ] E2b 教师端 试卷 / 作答 / 设备 / 维护 / 设置 页面（逐页实现 + 用户逐页验收）
- [x] F 学生端页面契约梳理（本轮按现有操作和准入实现，无新增流程决策）→ `TODO-lab-student-ui-contract.local.md`
- [x] F2 学生端共享外壳、启动、页面及无框窗口实现（2026-09-21；单测、lab 集成、主程序烟雾与截图检查通过；待 Windows 人工观感确认）
- [ ] G 收尾（stories/CI/文档/typecheck）

### 迭代方式（2026-09-18 用户确认）

用户逐页验收、随时提出具体意见（示例：连接页要"已配置服务列表 + 同款式独立分区的本机服务条目，右侧设置按钮打开启停/卸载管理"）。
除用户明确提出的以外，Q1–Q15 按推荐实现。

### 窗口 chrome 结论（2026-09-18，重要）

- Windows 上 `frame: false` 在用户机器上会残留 35px 原生标题栏（Electron 仍报告 frameless=true，主程序同参数却正常，原因未明）。
  根因研究与判定实验见 `TODO-lab-window-chrome-parity.md`（现状是 workaround，不是已证实的结论）。
- 解法：Windows 改用官方 Custom Title Bar 路线的 `titleBarStyle: 'hidden'`（无 `titleBarOverlay`），**保留原生边框/阴影/鼠标缩放**；其他平台继续 `frame: false`。见 `packages/lab-desktop-host/src/desktop.ts`。
- 窗口必须是"`show:false` 创建、`dom-ready` 后显示"；启动命令（`dispatch`）在渲染就绪前不得 `show()`。
- 教师端两个入口已收敛到 `apps/lab-teacher/main/desktop.ts`（产品入口与 Playwright 测试宿主共用窗口参数）。
- 诊断日志 `[lab] creating … window` 与 `[lab] window chrome: …` 暂时保留，窗口调整全部结束后再删。

### 集成测试的临时改动（页面落地后必须恢复）

`tests/lab/student.spec.ts` 教师端部分：设备改名、进入维护、人工确认、重试失败项、取消测试改为等价 API 调用
（每处都有 `TODO(lab-ui)` 注释）；`tests/lab/local-service.spec.ts` 改为从连接页的"本机服务管理"按钮进入弹窗并
按 dialog 作用域断言。页面补齐后逐条恢复界面操作。

## 8. 关键命令

```bash
yarn lint
yarn test:vitest
yarn test:playwright:components
xvfb-run -a yarn test:smoke
yarn test:product-docs            # 用户执行，视觉回归
yarn docs:product:check           # 用户执行，严格门禁（Docker）
yarn lab:build:student && yarn lab:build:teacher
yarn lab:test:integration
yarn lab:dev:teacher              # 人工观感
yarn lab:dev:student
```
