# Schema 领域模块

`@ls101/schema-editor` 实现 UI 无关的 Schema 结构、草稿库、正式 Schema、校验和持久化规则。Template 的新 SchemaUse、附件变量和资源打包尚未接入。

## 结构契约

一个 Schema 对应一个可复用评分单元，不再包含 `blocks`。评分管道为：

- `objective`
- `fixed-reading`
- `freetalk`

答案类型为：

- `text`
- `fixed-speech`，由固定原文和学生录音组成
- `free-speech`，由学生录音组成

冻结结构只包含：

- 题型。
- 答案槽位的 ID、类型和顺序。
- Template 文本输入的 ID、类型和必填性。

答案和输入的显示说明、名称、满分、评分标准及 AI 额外提示词属于正式 Schema 的可编辑数据，不参与结构哈希。

## 草稿与发布

`SchemaDraftLibraryDocument` 是带 revision 的草稿库工作文档。草稿只定义结构，同一个草稿可以多次发布，每次产生具有独立稳定 `schemaId` 的 `SchemaDefinition`。

正式 Schema 保存发布时的结构快照和 SHA-256 `structureHash`。`updateSchemaData()` 只接受可编辑数据并递增 revision，不接受结构参数；读取正式 Schema 时同时校验结构哈希。

`FileSchemaRepository` 使用 ScopedStore 兼容接口：

- 草稿库保存使用 revision/CAS。
- 发布时严格校验草稿结构和正式数据。
- 正式数据更新使用 revision/CAS。
- 正式 Schema 的结构不能通过仓储 API 修改。

## 评分结果

所有评分管道共享：

```ts
interface GradingResult {
  score: number
  comment: string // Markdown
}
```

`validateGradingResult()` 保证分数是 `0..maxScore` 之间的有限数字，并校验评语类型。

## 过渡边界

旧 Template 编译器仍暂时使用 `CompiledSchemaPipeline` 适配类型。该适配类型在 `core-types` 中标记为 deprecated，不再从 `@ls101/schema-editor` 导出。Template 的新绑定和资源模型实现完成后删除。
