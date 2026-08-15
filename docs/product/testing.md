# 测试即文档约定

已经确认的完整用户行为应实现为 Playwright 集成测试，并由成功执行的测试生成产品行为文档。

## 测试边界

产品文档测试与其他自动化测试严格分离：

- `tests/product-docs/` 只覆盖已经确认的用户可见产品行为；
- `tests/integration/`、`tests/components/` 和 Vitest 继续覆盖技术回归、跨进程契约、组件状态和异常边界；
- `playwright.product-docs.config.ts` 使用独立的测试目录、运行产物和文档 reporter。

产品文档测试需要遵守以下规则：

- 测试从用户可以操作的界面进入，覆盖完整操作路径和可见结果；
- 测试名称和步骤直接表达产品行为，不依赖实现细节；
- 配套产品文档记录测试无法直接表达的前置条件、边界和明确不覆盖的行为；
- 新产品主线可以先建立一套独立的 Playwright 测试，再审查并删除旧测试中的重复覆盖；
- 在新测试稳定之前，不因表面重复提前删除旧测试。

## 文档生成

- 整套产品文档测试通过后，reporter 根据实际执行的用例、步骤、注解和截图生成 `docs/product/generated/`；
- `generated/README.md` 只作为索引，具体行为按产品域拆分到独立 Markdown 文档；
- 截图用于证明关键选择、风险确认和最终可见结果，不为每个操作步骤重复截图；
- 同一行为如果只有后台状态变化，由 Playwright 断言证明，不添加无法提供额外信息的截图；
- 失败的产品文档测试不会覆盖上一次成功生成的文档；
- `docs/product/generated/` 需要随代码提交和评审，不加入 `.gitignore`；
- `test-results/`、trace 和 HTML report 等单次运行产物继续忽略。

## 运行命令

- `yarn test:product-docs`：构建应用，执行产品文档测试并生成文档；
- `yarn test:product-docs:run`：使用已经构建的应用执行产品文档测试；
- `yarn test`：技术回归测试通过后继续执行产品文档测试。

当前自动生成文档入口：[产品行为文档索引](./generated/README.md)。
