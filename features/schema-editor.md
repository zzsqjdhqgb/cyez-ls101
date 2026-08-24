# Schema 领域模块

`@ls101/schema-editor` 实现 UI 无关的 Schema 结构、评分单元、校验和持久化规则。Template 已接入新的 SchemaUse、附件变量、正式 Schema 快照和 ExamPackage 资源清单。

## 结构契约

一个 Schema 对应一个可复用评分单元，不再包含 `blocks`。评分管道为：

- `objective`
- `fixed-reading`
- `freetalk`

答案类型为：

- `text`
- `fixed-speech`，由固定原文和学生录音组成
- `free-speech`，由学生录音组成

评分结构契约包含：

- 题型。
- 答案槽位的 ID、类型和顺序。
- Template 文本输入的 ID、类型和必填性。

答案和输入的显示说明、名称、满分、评分标准及 AI 额外提示词属于正式 Schema 的可编辑数据，不参与结构哈希。

## 直接编辑与保存

评分单元不再要求先建立草稿库或执行发布。新建或从内置评分单元复制时产生 revision 0 的编辑阶段，结构、名称、分值和评分标准在同一个编辑页完成；第一次保存后结构固定，后续只允许修改名称、描述、分值和评分说明等数据。每次保存递增 revision，读取时仍会校验结构哈希。

内置评分单元完全只读。用户需要调整时必须“复制并修改”，完成后保存为“我的评分单元”。

旧版本留下的草稿库仍可被仓储读取，作为数据兼容措施，但新界面不会创建、展示或依赖草稿库。

`FileSchemaRepository` 使用 ScopedStore 兼容接口：

- 直接创建和更新使用 revision/CAS。
- 创建和保存时同时严格校验结构和评分数据。
- `updateSchema()` 只允许 revision 0 改变结构；后续调用只能保持原结构。

## 评分结果

所有评分管道共享：

```ts
interface GradingResult {
  score: number
  comment: string // Markdown
}
```

`validateGradingResult()` 保证分数是 `0..maxScore` 之间的有限数字，并校验评语类型。

## Template 编译边界

Template 文档只保存稳定 `schemaId`，不保存 revision。校验和编译时通过仓储读取最新正式 Schema；ExamPackage 保存当次完整 Schema 快照、每次 SchemaUse 的静态输入和答案索引。旧 `blocks`、`blockId`、`CompiledSchemaPipeline` 及运行期实例适配类型已经删除。

SchemaUse 附件不进入 Schema 结构。Template 编译器把 `[@this.varName]` 解析为 `resource:<assetKey>`，并写入 ExamPackage 资源清单；Schema 和后续评分系统只消费解析后的文本及统一资源 resolver。
