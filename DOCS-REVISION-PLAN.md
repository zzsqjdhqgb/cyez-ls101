# LS101 文档体系重构方案（临时工作稿）

```yaml
status: temporary
audience: maintainer
product-version: 0.4.1
branch: dev
note: 本文件是执行前的临时工作稿，重构完成后删除或移入 docs/archive/。
```

> 本方案在 `dev` 分支（`package.json` 0.4.1，tag `v0.4.1`）上拟定。`dev` 比 `main` 多的 4 个提交全部是
> dev-container / Docker / 工具配置类改动，不含产品代码变更，因此本分支的功能面即 v0.4.1。
> **硬规则：代码（v0.4.1）是唯一事实来源。** 与代码冲突的内部设计稿一律降级为 `superseded`，不再作为依据。

---

## 1. 背景：要解决的三个问题

### 1.1 未定稿设计与实装正式稿混杂

- 同一主题存在多达四份文档，处于不同生命周期阶段，但**没有任何一篇标注状态**：
  `design/file-store.md`（草案）↔ `features/file-store.md`（自称正式）↔ 代码。
- 更严重的是**权威冲突**：`docs/product/README.md:3` 宣布 `design/`、`refactor/` 是历史草案；
  `features/README.md:7` 又宣布"不把现有 `design/` 或 `docs/` 内容视为正确前提"。两份都自称唯一事实来源。
- 矛盾可量化：`design/` + `refactor/` 与代码至少 15 处硬冲突（`SchemaDefinition.blocks` 已删、
  `SchemaUse.bindings` 改名、`play.text` → `play.src`、`submission.zip` 布局被
  `manifest.json + resources/ + recordings/` 取代等）；`features/` 与代码至少 11 处，
  其中 `features/application-shell.md` 一篇约占 8 处。
- `old/` 的文档连相对 `old/src` 都已失真（行号漂移、字段缺失）。

### 1.2 文档体系混乱：组织问题 + 内容密度问题

**组织问题**（即使文档正确也受害）：

- 没有总索引；唯一入口 `README.md` 只索引 `docs/` 的 5 项；
- `/features` 全库无反向链接，是孤岛；
- `docs/engineering/` 无索引，5 篇中 2 篇无人链接；`standards/` 4 篇中 2 篇无人链接；
- `TODO-*.md` 散在根目录；同一主题三份拷贝互不引用；
- `features` / `docs/product` / `design` 等命名本身不传达权威与状态。

**内容密度问题**，分五类：

1. 愿景 / 原则类套话：`test-as-documentation-direction.md` 大段复述原则；
   `license-activation-options.md` 自己写明"不代表最终决定"。
2. 模板化空转：`features/` 的统一小节在内容不足时即套话（`schema-editor.md` 58 行、
   `config-store.md` 60 行，甚至缺"验证覆盖 / 代码依据"）。
3. 权威口吻但无验证的规格：`docs/product/modules/submission-records/README.md` 117 行写得很具体，
   却只被 57 行 SR-01（纯人工）锚定。这类比套话更危险。
4. 刻意的双份渲染被读成冗余：`guide/` 与 `behaviors/` 出自同一来源。
5. 一次性材料永久化：`renderer-component-review.md`、license 问卷页。

### 1.3 UI 设计锚定强度不足

- 现有锚定机制（测试即文档）很强，但只覆盖极窄切片（2 条旅程 / 18 项操作），
  且它本质是**回归证据**而非设计规定。
- 切片之外，UI 只有孤立、无人维护、无强制力的散文：
  `interface-library-interaction-direction.md`（"已确认，待实现"）、`text-selection-direction.md`、
  `design/template-editor-ui-draft.md`（自称临时）。
- 本该锚定 UI 结构的 `features/application-shell.md` 恰恰错得最多
  （13 个 preload bridge 写成 3 个、路由数量、主题、`ready-to-show`）。
- 术语未锚定：产品定义要求 UI 不出现 "Schema"，而测试点击的按钮就是"返回 Schema 列表"。
- 一半根因在产品侧：`register-placeholder-routes.ts` 说明部分界面仍是占位；未决定的东西文档锚不住。

### 1.4 容易遗漏的结构性缺口

1. 文档同时"过载"与"缺失"：exam-player / exam-library / exam-package、评分结算后半段、
   license、installation-marker、logger、secret-store、启动编排、legacy-data 归档（1,721 行）
   均无文档。**只删不写修不好。**
2. 缺生命周期 / 状态模型。
3. 缺"一篇文档该有什么"的内容契约。
4. 缺版本标签：`old/`=0.3.x、`design/refactor`=0.4 设计期、`features/`≈0.4.0–0.4.1 早期、
   `docs/product`=当前，但无一篇标注自己描述哪个版本。
5. 人工文档没有新鲜度纪律：生成层有 CI 门禁，人工层没有；`features/` 停在 08-24，仓库已到 09-18。
6. 过期命令会主动误导：`docs/testing.md`、`.github/CI.md`、`standards/test-as-documentation.md`。
7. 代码缺陷会被"如实文档化"继承：`editor-kit`/`section-engine` 空壳却作为依赖、
   `renderer` 未声明 `grading-engine`、`grading-engine` 分层倒置。
8. 有些"文档"其实是应用资源或决策材料：`docs/license-activation.html` 被 `electron-builder`
   打进应用并由运行时代码打开，移动会坏功能。
9. 双读者边界（用户/第三方 ↔ 工程师）未定义。
10. 发布说明 `packages/renderer/src/features/release-notes/releases/*.md` 游离在体系外。

---

## 2. 目标与总原则

**目标**：让文档可导航、有唯一权威、有生命周期、能具体锚定 UI 设计。

1. **一主题一权威**：任何主题只有一篇 `implemented` 文档算数，其余只能是 `draft / superseded / archived`。
2. **按体裁定内容**：不同文档类型有强制大纲与禁写项（第 6 节），以治套话与过度文档。
3. **UI 设计必须具体到控件与文案**：新增手写逐屏 UI 规格层（第 6.1 节）。
4. **状态与版本写在文件头上**，不靠目录名和 git 历史推断。
5. **说明书与回归解耦**：产品说明书是产物，UI 回归是测试，两者不再共用一套定义。

---

## 3. 目标目录结构

```
docs/
  README.md                  唯一入口：权威地图、状态词表、写作契约、导航        [新增]
  manual/                    自动生成的《产品说明书》——唯一生成产物
    README.md                章节目录（生成）
    01-*.md …                正文章节（生成）
  ui/                        手写：产品与界面设计权威（正文不生成）
    README.md                模板与索引
    modules/<module>.md      模块级对象定位、边界、交互语义
    screens/UI-<module>-<n>.md   逐屏 UI 规格
    glossary.md              用户可见术语 ↔ 代码术语
    open-questions.md        唯一未决清单
    coverage.md              生成：索引与锚定状态
  engineering/               面向工程师：代码如何实现、契约是什么
    README.md                [新增] 工程文档索引
    features/                由 /features 迁入，逐篇对齐 v0.4.1
    subsystems/              [新增] exam-player/exam-library/exam-package、license、
                             startup、legacy-data、logger、secret-store、builtin 生命周期
    testing.md
    setup-assets.md
    qwen-tts.md
    airouter-model-catalog.md
    tooling/                 prettier 版本策略等
    todo/                    TODO-*.md 收拢并标状态
  archive/                   只读历史区
    README.md                [新增] 档案说明 + 唯一价值索引 + 已迁移去向
    product-docs-0.4.1/      现状 docs/product：冻结、弃用（迁移期回归参照）
    design/                  design/ 迁入
    refactor/                refactor/ 迁入
    legacy/                  old/ 迁入（或原地保留，见第 10 节）
tests/
  visual/
    <module>/<UI-ID>.spec.ts        逐屏视觉回归，与 UI-* 一一对应
    baselines/<UI-ID>/<state>.png   视觉基线（生成并提交）
```

**不做全量物理搬迁**：只迁移 `/features`（解决孤岛）与 `TODO-*.md`（收拢）。
其余目录以状态头 + `archive/README.md` 归类，避免大量断链与无意义 diff。
`old/` 若保留原地，需新增 `old/README.md` 标注为 0.3.x 档案。

---

## 4. 产物职责矩阵

| 产物 | 手写 / 生成 | 权威性 | 作用 | 位置 |
| --- | --- | --- | --- | --- |
| 产品说明书 | 生成（源自手写手册规格） | 产品承诺 | 用户 / 第三方阅读 | `docs/manual/` |
| 逐屏 UI 设计规格 | **手写** | UI 设计权威 | 具体规定布局 / 控件 / 状态 / 文案 | `docs/ui/screens/` |
| 模块设计约束 | 手写 | 产品设计权威 | 对象生命周期、边界、交互语义 | `docs/ui/modules/` |
| 逐屏视觉回归基线 | 生成（提交） | 外观事实 | 防视觉漂移 | `tests/visual/baselines/` |
| 行为 / 技术回归 | 手写 | 技术契约 | 进程、数据、异常、流程 | `tests/integration/` 等 |
| 旧 product docs | 冻结 | **弃用** | 迁移期回归参照 | `docs/archive/product-docs-0.4.1/` |

关键点：

- **UI 设计文档不自动生成**。生成出来的设计意图必然退化为套话。
  可以生成的只有它的**索引**与**锚定状态**（`docs/ui/coverage.md`）。
- **视觉基线是生成物，但不属于文档**。放 `tests/visual/baselines/`，
  `docs/` 从此不承载 PNG，消除现在 30 张图带来的 diff 噪声。

---

## 5. 生命周期与状态头

每篇文档头部必填：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `status` | `implemented` / `confirmed` / `draft` / `superseded` / `archived` | — |
| `product-version` | 如 `0.4.1` | 描述生效的版本 |
| `superseded-by` | 文档路径 | `superseded` 时必填 |
| `audience` | `user` / `engineer` | — |
| `owner` | 责任域 | — |

规则：

- `implemented` 文档**只允许描述代码里存在的行为**；任何"将来 / 计划 / 应当"必须移出到
  `confirmed` 或 `open-questions.md`。
- `superseded` 文档只保留入口指向，不再接收内容修改。

---

## 6. 内容契约：体裁定内容

### 6.1 UI 规格模板（逐屏，新增）

位置 `docs/ui/screens/`，一屏一篇，编号 `UI-<模块>-<序号>`。

```markdown
# <界面名> · UI-IF-03
status: implemented@0.4.1
route: /interfaces/:interfaceId/groups/:groupId
entry: 从题型库详情 → 题组列表 → 点击题组
objects: 操作哪些产品对象（题型 / 题组 / …）

## 布局
区域划分、默认选中、主次层级、可调整尺寸约束

## 控件清单
| 名称 | 类型 | 默认 / 悬停 / 禁用 / 加载 / 错误 | 触发结果 | 快捷键 |

## 文案
标题 / 按钮 / 空状态 / 错误 / 确认框 的准确文本（可被测试直接引用）

## 状态与恢复
空、加载、失败、中断、冲突、未保存离开

## 有损操作
删除 / 覆盖 / 重置 / 结算 的确认措辞与后果，是否可逆

## 术语
本屏出现的用户可见词，须与 glossary.md 一致

## 产物
完成后的对象与下一步入口

## 锚点
anchors:
  visual: VR-IF-03 | n/a（原因）
  behavior: <测试 ID> | unverified
```

- 每个界面要么被视觉 / 行为测试锚定，要么显式标注 `unverified`。
  锚定率计入 `docs/ui/coverage.md`，使"锚定"不再是"有测试 / 什么都没有"的二元状态。

### 6.2 模块设计文档（`docs/ui/modules/`）

必填：对象定位、边界、状态与生命周期、关键交互语义、术语、已实现 / 未实现标注。
禁写：代码路径、类名、IPC、愿景段落。

### 6.3 工程特性文档（`docs/engineering/features/`）

必填：功能状态、功能边界、公共接口、进程 / 存储边界、数据语义、验证覆盖、已知限制、代码依据。
禁写：未实现规划、重复别处正文（只许链接）。

### 6.4 子系统文档（`docs/engineering/subsystems/`）

必填：架构、运行时 / 生命周期、存储与格式、失败与恢复、运维入口。
禁写：重复 feature 文档。

### 6.5 决策记录与开放问题

- 决策记录：决策、背景、备选、后果（不可变）。
- `docs/ui/open-questions.md`：问题、选项、阻塞点、需要谁定。

### 6.6 通用禁写项

- 没有范围的"支持 / 安全 / 已接入"。
- 同一内容在第二处展开（必须先链接）。
- 把提案写成规格。
- 在 `implemented` 文档中出现未来时态。

---

## 7. 产品说明书生成（manual-first）

**变更核心：说明书是第一产物，测试是验证方式，而不是反过来。**

- **规格先行**：章节 / 任务 / 步骤先以人的语言写（手册规格），步骤可选地绑定一个可执行验证动作。
- 生成器产出手册；验证套件单独运行绑定断言。
- **允许 `unverified` 步骤存在并计入锚定率**，从而解开当前"没有测试就没有文档"的死结，
  这是扩大覆盖面的前提。
- 生成器复用现有确定性设施：`docker/product-docs/`、`container-runner.mjs`、
  渲染器版本标记、固定 1280×800 / 1× 倍率、固定时钟、确定性 UUID、等价截图保留旧字节的逻辑。
- 停止"一份源两种渲染"：不再生成 `behaviors/` / `verified/` 操作页，
  其内容职责由手写 UI 规格接管。
- `docs/manual/` 由手写章节大纲（现 `tests/product-docs/support/product-guide.ts` 的位置）定义顺序。

---

## 8. 逐屏视觉回归（一一对应）

**屏幕级 1:1，状态级 1:N。**

```
docs/ui/screens/UI-IF-03.md                        ← 手写规格（权威）
tests/visual/interface-library/UI-IF-03.spec.ts    ← 一一对应，一屏一套件
tests/visual/baselines/UI-IF-03/default.png
tests/visual/baselines/UI-IF-03/validation-error.png
```

规格页声明状态：

```yaml
visual:
  states: [default, empty, validation-error]
  entry: <确定性入口 / 夹具>
```

校验规则：**规格声明的状态集合 == 测试实际捕获的状态集合 == 磁盘上的基线集合**，
三者任一不等即失败（少截＝缺锚；多截＝陈旧基线）。
该纪律复用现有 reporter 的"声明步骤 vs 实际执行步骤一致"逻辑，成本极低。

约束：

1. **方向必须是"规格 → 测试"**。若允许"测试定义状态、文档跟随生成"，即退回现有回归证据模式。
2. **允许显式 `n/a`**：系统文件对话框、纯 OS 原生弹窗等无法稳定截屏的界面，
   在规格中写 `visual: n/a（原因）`，门禁认可该例外，避免为凑 1:1 写假测试。
3. **入口必须确定**：每个套件独立到达该屏、不依赖其他测试残留；
   动态内容（姓名、考生号、时间、模型输出）固定或遮罩；
   沉浸页（考试播放器、结算页）用准备好的 `.lsexam` / 评分会话做夹具；
   沿用"旅程不许用夹具、模块操作允许构造前置"的区分。
4. **只有 canonical 容器能产基线**，本地只产 diff。
5. 每屏默认 1 张默认态，高风险屏最多再加 2–3 个状态（沿用现有"≤3 evidence"预算思路）。

配对状态由生成文件呈现：

| 页面 | 状态数 | 视觉 | 行为 |
| --- | --- | --- | --- |
| UI-IF-03 | 3 | ✅ VR-IF-03 | unverified |

门禁分两步：先 warning（列出未配对 / 有规格无测试 / 有测试无规格 / 有基线无声明），稳定后转 error。

---

## 9. 现有材料处置

| 现有物 | 处置 | 理由 |
| --- | --- | --- |
| `docs/product/` 生成层（guide/behaviors/verified/coverage/manifest） | **冻结迁出** → `docs/archive/product-docs-0.4.1/`，加弃用横幅；测试套件保留为迁移期回归网 | 现状产物不适合当说明书；机制设施值得继承 |
| `docs/product/modules·flows·journeys/README.md` | 能力拆分：对象/边界 → `docs/ui/modules/`；逐屏语义 → `docs/ui/screens/` | 它们就是"已确认设计约束"层，位置需按新结构重排 |
| `docs/product/standards/*direction.md` | 拆：已实现 → 正文规格；未实现 → `open-questions.md` | 现在把"已确认待实现""进行中"混在 standards，且两篇无人链接 |
| `features/*` | 迁到 `docs/engineering/features/`，逐篇对齐 v0.4.1，修 11 处已定位错误，补索引 | 唯一记录进程边界/契约，却全库无入口；停在 08-24 |
| `design/*` | → `docs/archive/design/`，加状态头 | 自称"定稿"但多数已被代码取代；含唯一价值内容需先迁移 |
| `refactor/*` | → `docs/archive/refactor/`，加状态头 | 自己声明是草案 |
| `old/*` | 迁入 `docs/archive/legacy/` 或原地 + `old/README.md` 状态说明 | 0.3.x 迁移唯一依据；`old/src` 被 `features/ai-router.md` 引用 |
| `docs/engineering/*` | 加索引；`prettier-version.md` 移入 `tooling/`；`setup-assets.md` 补链接 | 5 篇里 2 篇孤立 |
| `docs/testing.md` | 重写 | 漏 `test:scripts` 层与 `tests/main`；product-docs 命令、`test:playwright` 参数均已过期 |
| `.github/CI.md` | 修正 | 说 3 个 job，实际 4 个；产物名不符；漏 Linux smoke |
| `docs/renderer-component-review.md` | 转成 issue / 待办或归档 | 一次性审查材料；FE-01..09 已由组件测试记录 |
| `docs/license-activation.html` | **保留原路径**，在 `docs/README.md` 注明"应用资源，非文档" | `electron-builder` 打进包、运行时代码打开，移动会坏功能 |
| `docs/license-activation-options.md` | → 归档或决策记录 | 自己写明"不代表最终决定" |
| `TODO-*.md` | 收拢到 `docs/engineering/todo/`；已完成者删除 | 2 个已完成、1 个基本完成、5 个仍有效 |
| 包内 release notes | 保留在代码，工程索引链接一处 | 当前唯一准确的用户级变更记录 |
| `AGENTS.md` 与 `.claude/CLAUDE.md` | 去重（单一来源 + 指针） | 内容近乎重复 |

**迁移前必须先抽取的唯一价值内容**（否则会随归档丢失）：

- `design/file-store.md` §10-11：builtin 只读存储（代码已实现，features 未写）。
- `refactor/exam-player-design.md`：播放器内部（编译期 TTS、GET 预检、资源缓存），无 features 文档。
- `refactor/question-type-pipeline-notes.md`：`AnswerCapturePlan` / `SubmissionTemplate` 推导契约。
- `design/template-editor-ui-draft.md` §变量输入：`@` 自动补全交互细节。
- `refactor/architecture-overview.md` §领域包与 UI 分层规范。
- `design/decisions.md`：冲突矩阵与身份哈希理由。
- `old/docs/上海英语高考听说测试评分标准细则.docx`：全仓库唯一的分档评分标准。
- `old/docs/2025浦东一模听说(-annot).docx`：带逐段时长的真题。

---

## 10. 覆盖面扩展计划

现状：产品文档 2 条旅程 / 18 项操作 / 8 个产品域，缺 exam-library、settings、take-exam。

两个覆盖轴，`coverage.md` 分别统计：

- **轴 A 对象链主线**：评分单元 + 题型 + 题组 → 模板 → 生成 → 运行 → 导入作答 → 评分 → 结算。
  当前完整主线尚未贯通，为 P0。
- **轴 B 界面内任务**：7 个一级模块 × 仓储 / 编辑器 / 工作区任务 × 关键状态
  （空 / 错 / 冲突 / 中断 / 有损确认）。目标从 18 项扩到约 60–80 项。

| 优先级 | 内容 |
| --- | --- |
| P0 | 完整对象链主线旅程；修正 `flows/take-exam` 归属（测试在 flows/ 下却产出 journey 文档） |
| P1 | 试卷库导入/运行/导出/删除；作答记录全流程（人工 + AI + 审查 + 结算 + 报告 + 重新评分）；设置 / AI 配置；模板生成含三角色 TTS |
| P2 | 题型 / 评分单元的边界与冲突态；工作台；未保存 / 覆盖 / 删除确认 |
| P3 | 中断恢复、错误恢复路径 |

工程侧缺口同步补：

| 优先级 | 内容 |
| --- | --- |
| P0 | `exam-package` / `exam-library` / `exam-player` |
| P1 | `license` / `installation-marker` / 启动编排 / `logger` / `secret-store` |
| P2 | builtin 内容生命周期、legacy-data 归档（1,721 行） |

---

## 11. 机制与门禁

| 机制 | 做法 | 成本 |
| --- | --- | --- |
| 唯一入口 | 新增 `docs/README.md`：权威地图（哪层管什么）+ 状态词表 + 如何新增一篇 | 低 |
| 文档 lint | 校验：状态头存在、`status` 合法、`implemented` 无未来时态、链接可达、索引完备、被引代码路径存在 | 中 |
| 视觉回归门禁 | 规格 ↔ 测试 ↔ 基线三方一致 | 中 |
| 生成层门禁 | 沿用并改造 `docs:product:check`，指向新产物 | 已有 |
| 锚定率 | `docs/ui/coverage.md` 统计视觉 / 行为锚定率 | 低 |
| 术语校验 | `glossary.md` 词表与 UI 文案 / 生成文档比对 | 中 |

`coverage.md` 拆成两张表：

1. **说明书完整性**：章节 / 任务 / 对象链是否贯通。
2. **UI 规格锚定率**：视觉锚定 % / 行为锚定 %。

---

## 12. 旧 product docs 的过渡与退役

1. **冻结**：`docs/product/` 整体迁入 `docs/archive/product-docs-0.4.1/`，加弃用横幅与状态头，
   README 不再把它列为"产品说明书"。
2. **保留用途**：`tests/product-docs/` 套件原样保留，作为迁移期的 **UI 回归网与行为预言机**
   （写 UI 规格时可据此确认"当前界面到底怎么做"）。此期间它只写 preview，不再发布正式文档。
3. **摘除门禁**：从 CI 移除旧产物的 `docs:product:check` / canonical 发布门禁，
   但保留测试运行。
4. **退役**：新说明书 + 逐屏视觉回归 + 行为回归到位后，整包删除旧套件与归档产物。

明确：过渡期 `docs/archive/product-docs-0.4.1/` 只接收弃用标记，不接收内容修改。

---

## 13. 实施阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 0 冻结 | 状态词表、目录结构、各体裁模板、`docs/README.md` 权威地图、`archive/README.md` | 入口能回答"哪份算数" |
| 1 归档与索引 | 加状态头；迁 `/features`、`TODO`；修过期命令与断链；上线 docs lint | lint 全绿；无孤儿、无断链 |
| 2 工程对齐 | `features/` 11 处错误逐条修正；补 P0/P1 子系统 | 每篇有"代码依据"，抽样比对通过 |
| 3 UI 规格 | 7 个模块逐屏写规格，标注锚定 / `unverified` | 所有一级界面有 `UI-*` 页；锚定率可统计 |
| 4 覆盖扩展 | 写 P0→P2 产品测试并生成新说明书；含完整主线 | 主线贯通；操作数 ≥ 目标；双轴 coverage |
| 5 固化 | TODO 清理、open questions、release notes 接入、CI 接入 lint 与视觉门禁 | 全部门禁通过 |

价值前移：阶段 1 用机械操作先消除"找不到 / 不知道哪份算数"；
阶段 2–3 消除"错的和空的"；阶段 4 才是最大工程量的覆盖扩展。

---

## 14. 明确不做 / 约束

- **不删档案**：`design/`、`refactor/`、`old/` 先迁移唯一价值内容再加状态头。
- **不动 `docs/license-activation.html` 路径**（应用资源）。
- 不运行 `git add` / `git commit`，只提供命令（`AGENTS.md`）。
- 改 `tests/product-docs` 或 renderer 后按 `AGENTS.md` 跑 `xvfb-run -a yarn test:smoke`；
  正式生成必须走 Docker，普通运行只写 preview。
- 本方案默认**不改产品代码**；术语（Schema）对齐、空壳包（`editor-kit` / `section-engine`）、
  `renderer` 漏声明 `grading-engine` 等代码问题单独立项，文档先按现状记录或标注。

---

## 15. 规模估算

| 项 | 数量 |
| --- | --- |
| 现有文档（md/html，不含生成截图） | ~15,000 行 / 108 篇 |
| 需加状态头 | ~40 篇 |
| 需对齐 / 改写的工程文档 | 14 篇（`features/`）+ 索引 |
| 新增工程子系统文档 | ~7 篇 |
| 新增 UI 规格 | 估 25–40 屏 |
| 产品测试操作目标 | 18 → 60–80 项 |
| 新增脚本 / 门禁 | docs lint、视觉配对校验 |

---

## 16. 待拍板事项

1. **术语对齐**：UI 实际显示 "Schema"，与产品定义冲突。改 UI 文案（属代码变更，会触发视觉基线更新）
   还是在 `glossary.md` 里承认现状？
2. **`old/` 是否物理迁移**：迁入 `docs/archive/legacy/` 会破坏 `features/ai-router.md` 的一处引用；
   原地保留 + `old/README.md` 更省事。建议后者。
3. **`docs/manual/` 的规格格式**：TS（可绑定定位器，沿用现有 `product-test.ts` 类型）
   还是 YAML（更易手写）？建议 TS，便于绑定验证。
4. **门禁转 error 的时点**：docs lint 与视觉配对一个先 warning 后 error，需要定一个切换点。
