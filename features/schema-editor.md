# Schema 数据管道

当前 Schema 模块只定义评分数据的输入格式，不实现评分规则、AI 批改或 Schema 仓储。

## 定义

`SchemaDefinition` 是一份不可变的数据契约，由若干评分块组成。每个评分块包含：

- `blockId`、显示名称。
- `maxScore`，该评分块的满分。
- 任意数量的 `inputs`。

接入口只有两种类型：

- `string`：题面、参考答案、评分提示或学生选择结果等字符串。
- `audio`：ExamPlayer 录音资源的引用。

Schema 不包含评分维度、评分实现或 AI 配置。`schemaId` 是 Schema 内容的 SHA-256 ID，`formatVersion` 用于区分数据格式版本。

## 数据流

Template 编译时把每个接入口绑定到静态字符串、选择题输出或录音输出，并把 Schema 定义快照和绑定映射写入 `ExamPackage.schema`。ExamPlayer 只执行 Player 数据，负责产生录音和选择结果，不解析 Schema。

`instantiateSchemaPipeline()` 在考试结束后将映射与运行期数据合并为 `SchemaInstanceBundle`。音频字段保存 `assetKey`，不会把二进制内容写入 JSON；未作答和缺失录音使用显式的 `missing` 状态。

## 当前边界

当前不提供 Schema 草稿、发布、复用库、导入导出和可视化编辑器。Schema 可以由调用方直接构造或内嵌到模板相关数据中。`@ls101/schema-editor` 目前只提供纯 TypeScript 的身份、结构校验和实例化函数，之后可以在不改变管道契约的情况下替换内部实现。
