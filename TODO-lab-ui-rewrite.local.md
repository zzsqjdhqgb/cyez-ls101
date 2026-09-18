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

## 7. 进度台账

- [x] P1 建 `@ls101/desktop-ui`、搬迁、import 重写 —— 已通过 `docs:product:check`
- [x] P2 外壳参数化（title/subtitle/icon/actions/layout + FE-10）—— 已通过 `docs:product:check`
- [x] P3 启动统一（Vite 插件注入占位 + 共享 bootstrap）—— 已通过 `docs:product:check`
- [x] P4 窗口控制共享（`@ls101/desktop-ui/main`）—— 已通过 `docs:product:check` + 手动窗口测试
- [x] D lab 宿主窗口控制接线（`frameless` 选项 + bridge；无框切换在各端重写时开启）—— lab 集成 3/3
- [x] D2 `@ls101/lab-renderer` 数据层（query/action/selection/format，17 用例）
- [x] E 教师端页面契约梳理 → `TODO-lab-teacher-ui-contract.local.md`（Q1–Q15 待用户确认）
- [ ] E2 教师端实现（等 Q1–Q15 答复）
- [ ] F 学生端页面契约梳理 + 提问
- [ ] F2 学生端实现
- [ ] G 收尾（stories/CI/文档/typecheck）

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
