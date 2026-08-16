# 测试即文档约定

已经确认的标准用户旅程和完整用户行为应实现为 Playwright 集成测试，并由成功执行的测试生成产品文档。

## 测试边界

产品文档测试内部区分完整用户旅程和局部产品行为，并与其他自动化测试严格分离：

- `tests/product-docs/journeys/` 覆盖已经确认的标准用户旅程。旅程从用户可理解的起点开始，通过界面连续产生并消费核心业务对象，不允许直接向仓储写入旅程中的中间对象；
- `tests/product-docs/modules/` 和 `tests/product-docs/flows/` 覆盖已经确认的局部产品行为、交互规则和异常边界，可以构造声明过的前置状态；
- `tests/integration/`、`tests/components/` 和 Vitest 继续覆盖技术回归、跨进程契约、组件状态和异常边界；
- `playwright.product-docs.config.ts` 使用独立的测试目录、运行产物和文档 reporter。

产品文档测试需要遵守以下规则：

- 测试从用户可以操作的界面进入，覆盖完整操作路径和可见结果；
- 标准旅程使用 `productJourney` 声明，并保证前一步产生的业务对象被后一步真实使用；
- 模块和流程中的局部产品行为使用 `productTest` 声明；
- 两类测试都要提供稳定规格 ID、产品归属、能力、意图、前置条件和行为保证；
- 使用 `productStep` 声明带稳定 key 的用户操作步骤，不依赖实现细节；
- 配套产品文档记录测试无法直接表达的前置条件、边界和明确不覆盖的行为；
- 新产品主线可以先建立一套独立的 Playwright 测试，再审查并删除旧测试中的重复覆盖；
- 在新测试稳定之前，不因表面重复提前删除旧测试。

## 文档生成

- 整套产品文档测试通过后，reporter 在所属模块或流程的 `behaviors/` 中为每个行为生成独立 Markdown；
- Reporter 同时按 `tests/product-docs/support/product-guide.ts` 的章节顺序生成 `docs/product/guide/`，分别展示完整用户旅程和局部产品行为；
- 旅程章节中的目标、输入、产物、下一步和“尚待自动验证”属于产品说明层，行为测试只负责提供可执行事实，不在 Reporter 中硬编码行为 ID；
- `docs/product/coverage.md` 只汇总产品域、行为数量和截图数量，不重复场景摘要；
- 正式生成先写入暂存目录，完成结构校验后再事务式替换已生成目录；发布失败时恢复上一次成功结果；
- 只有无筛选的完整套件可以更新正式文档，单文件和 `--grep` 运行只写入 `test-results/product-docs-preview/`；
- 生成器校验行为 ID、归属信息、步骤 key、截图 key、截图所属步骤和每个行为的截图预算；
- 失败的产品文档测试不会覆盖上一次成功生成的文档；
- 已生成的行为页、截图、覆盖表和 manifest 需要随代码提交和评审；
- 同一行为如果只有后台状态变化，由 Playwright 断言证明，不添加无法提供额外信息的截图；
- `test-results/`、trace 和 HTML report 等单次运行产物继续忽略。

## 截图证据

每个行为默认最多保留三张截图，并通过 `evidence` 绑定到具体产品步骤：

- `decision`：不可逆选择、风险说明或覆盖确认；
- `exception`：重要错误状态及恢复入口；
- `result`：用户最终可见的完成状态。

空白初始页、纯导航过程和重复表单不截图。截图文件名由行为 ID 和稳定 evidence key 组成，不使用标题或截图序号。

## 运行命令

- `yarn test:product-docs`：构建应用，执行产品文档测试并生成文档；
- `yarn test:product-docs:run`：使用已经构建的应用执行产品文档测试；
- `yarn test:product-docs:preview --grep <pattern>`：运行筛选场景并只生成临时预览；
- `yarn docs:product:check`：重新生成正式文档，并检查仓库中的生成结果是否最新；
- `yarn test`：技术回归测试通过后继续执行产品文档测试。

当前自动生成文档入口：[产品测试覆盖](../coverage.md)。
