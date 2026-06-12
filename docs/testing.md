<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 自动化测试

## 概述

项目使用 **vitest 4.1.6** 作为测试框架，配合 `@testing-library/react`、`@testing-library/jest-dom` 和 `jsdom` 环境。配置定义在 `vitest.config.ts`，测试环境初始化在 `vitest.setup.ts`。

### 运行测试

```bash
pnpm test          # 运行所有测试
pnpm test:watch    # 监视模式
```

## 测试配置

**`vitest.config.ts`**:
- 环境：`jsdom`
- 插件：`@vitejs/plugin-react`（JSX 转换）
- 别名：`@renderer` → `src/renderer/src`
- 排除：`node_modules`、`out/`、`.git/`

**`vitest.setup.ts`**:
- 引入 `@testing-library/jest-dom/vitest`（toBeInTheDocument 等自定义 matcher）
- Mock `electron` 模块（ipcRenderer, app, BrowserWindow, contextBridge, net 等）

## 测试文件总览

10 个测试文件，共 **127 个测试用例**，全部通过。

| # | 测试文件 | 测试数 | 模块 | 覆盖内容 |
|---|----------|--------|------|----------|
| 1 | `src/shared/__tests__/validation.test.ts` | 33 | shared/validation | validateExamPackage 全部验证规则 |
| 2 | `src/main/__tests__/utils.test.ts` | 10 | main/utils | isSafeMediaPath 路径安全 |
| 3 | `src/main/__tests__/utils-prefix.test.ts` | 7 | main/utils | prefixContentNodesForExam 协议前缀 |
| 4 | `src/main/tts/__tests__/wav-encoder.test.ts` | 11 | main/tts | encodeWav WAV 编码 |
| 5 | `src/main/tts/__tests__/tokenizer.test.ts` | 9 | main/tts | UnigramTokenizer 分词 |
| 6 | `src/main/protocols/__tests__/factory.test.ts` | 11 | main/protocols | 协议工厂函数 |
| 7 | `src/main/services/__tests__/template-service.test.ts` | 14 | main/services | 模板验证逻辑 |
| 8 | `src/main/services/__tests__/grading-service.test.ts` | 8 | main/services | computeRid, records 加载/保存 |
| 9 | `src/main/services/__tests__/grading-session.test.ts` | 9 | main/services | GradingSession 核心流程 |
| 10 | `src/renderer/src/components/__tests__/Modal.test.tsx` | 15 | renderer/components | Modal 组件渲染和交互 |

---

## 各模块测试详情

### 1. validation.test.ts (33 tests)

测试 `validateExamPackage()` 函数，覆盖共享验证层全部规则：

- **根对象验证** (2): null、非对象输入
- **questions 数组** (1): 缺失
- **题目结构** (4): 非对象题目、缺少 id、缺少 content、缺少 time
- **内容节点类型** (8): 无效 type、text 缺少 text、image 缺少 src、video 缺少 src、audio 缺少 src、audio 缺少 text、quad-image 非 4 图片、quad-image 正确 4 图片
- **时间控制** (6): 无效 time type、countdown 缺少 seconds、record 缺少 duration、content-controlled 媒体数为 0/1/多个
- **gradingInfo** (10): 非数组、id 非数字、id 跳跃、recordIndex 不匹配、recordIndex 重复、缺少 problemInfo、缺少 gradingInfo、fullScore 非正数、覆盖不完整、合法 gradingInfo
- **合法试卷** (2): 最小合法试卷、完整 gradingInfo 试卷

### 2. utils.test.ts (10 tests)

测试 `isSafeMediaPath()` 路径安全验证：

- 合法相对路径、子目录路径
- 空字符串、非字符串、null
- 绝对路径（`/`开头）、反斜杠开头
- 路径遍历（`..`）、目录外路径、反向遍历
- media 目录本身（边界）

### 3. utils-prefix.test.ts (7 tests)

测试 `prefixContentNodesForExam()` 协议前缀转换：

- image/video/audio 节点的 src 前缀
- quad-image 节点的 images 数组前缀
- text 节点不变、无 src 节点不变
- 不修改原始数组（不可变性）

### 4. wav-encoder.test.ts (11 tests)

测试 `encodeWav()` WAV 编码器：

- RIFF 头部、WAVE 标识、fmt chunk、PCM format
- 采样率、声道数、位深度
- data chunk 和数据大小
- 静音编码、非静音编码
- 样本钳制、ByteRate 和 BlockAlign 计算

### 5. tokenizer.test.ts (9 tests)

测试 `UnigramTokenizer` 分词器：

- protobuf 解码：单个 piece、多个 pieces
- 分词：空文本、英文文本、带标点文本
- 未知字符处理
- 控制 token、边界 case

### 6. factory.test.ts (11 tests)

测试协议工厂函数：

- `createSimpleProtocolHandler` 基本路径服务
- `createResourceProtocolHandler` ID 提取和路径构建
- 空 URL、无斜杠 URL
- 子目录请求
- 路径遍历防护（禁止访问基准目录外部）

### 7. template-service.test.ts (14 tests)

测试模板验证逻辑：

- ID 唯一性、fileName 重复
- 占位符完整性（引用未定义、定义了未引用）
- audio 节点验证（缺少 text、缺少 src）
- 文件引用完整性
- 边界情况

### 8. grading-service.test.ts (8 tests)

测试批改数据导入模块：

- `computeRid` 的确定性（相同输入产生相同 RID）
- `loadRecords` 空文件返回空对象
- `saveRecords` / `loadRecords` 往返
- `loadExamPackage` 文件不存在返回 null
- `getSubmissionMeta` 缺失返回 undefined

### 9. grading-session.test.ts (9 tests)

测试 `GradingSession` 类核心流程：

- 空列表 start 返回错误
- 有效列表 start 返回 firstItem
- submitScore 保存分数并返回下一项
- 最后一题 submitScore 返回 settle: true
- pause/finish 清空会话状态
- getSettlementInfo 返回结算数据
- findNextUngradedGradingInfoId 查找逻辑

### 10. Modal.test.tsx (15 tests)

测试 Modal 组件族渲染和交互：

- MessageModal 的打开/关闭、title/message 渲染、error 类型样式
- ConfirmModal 的确认/取消按钮回调
- ProgressModal 的进度条、步骤文本、错误列表
- ResultModal 的成功/失败状态、详情列表
- 各 Modal 关闭时不渲染

## Mock 策略

- **electron 模块**：在 `vitest.setup.ts` 中全局 mock（`vi.mock('electron', ...)`）
- **文件系统依赖**：`grading-service.test.ts` 和 `grading-session.test.ts` 使用 `vi.mock('../../utils', ...)` mock `getGradingPath`
- **React 组件**：Modal 测试通过设置 `vi.mock('lucide-react', ...)` 解决图标库解析问题
- **命名导出**：Modal 测试使用 `import { MessageModal, ... }` 命名导出而非默认导出，便于 vitest 正确追踪

## Typecheck 和 Lint

- `tsconfig.node.json` 和 `tsconfig.web.json` 均排除 `**/__tests__/**`
- `eslint.config.mjs` 忽略 `**/__tests__/**`
- 测试文件不受类型检查和 lint 约束
