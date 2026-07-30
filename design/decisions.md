# 设计决策碎片

本文档记录在设计讨论中达成的具体策略。不等同于定稿设计文档，仅存放碎片化的决策信息。

---

## Interface 的唯一性策略

### ID 方案

- `InterfaceDef.id` 是内容 ID，格式为 `sha256:<64 位十六进制摘要>`，不由 UI 或用户手工填写
- 哈希输入包含 `name`、`description`、`promptTemplate` 和有序 `fields` 树，不包含 ID、状态和时间戳
- 每层字段集合存储为 `{ order, nodes }`；`order` 与 `nodes` 的 key 集合必须完全一致，且是显示、遍历和哈希的唯一顺序来源
- 文本统一为 LF 换行和 Unicode NFC；字段顺序按 `order` 编码为条目数组，因此顺序变化视为内容变化
- 规范值使用 `fast-json-stable-stringify` 序列化：对象 key 按字典序排列，不输出缩进或额外空白，字段条目数组保持业务顺序
- 规范字符串固定使用 UTF-8 编码后计算 SHA-256，不依赖平台默认编码或 JavaScript 对象属性声明顺序
- 用户发布内容和内置 Interface 使用同一套 `publishInterface()` 计算规则；相同内容在不同设备上得到相同 ID
- 内置 Interface 内容不变时 ID 永远不变；内容修改后自然产生新 ID，不维护预设 UUID 表
- 草稿使用独立的随机 UUID v4 `draftId` 管理本地编辑会话，不参与发布、导入和 Template 引用
- 导入时必须调用 `verifyInterfaceId()` 复算摘要；本地已有同 ID 时再用 `compareInterfaceIdentity()` 比较规范化内容
- 导入时只要本地已有相同 ID 就拒绝导入；用户无需拥有一份与当前内置内容完全相同的副本
- 同 ID、不同内容视为哈希冲突或数据篡改，同样必须拒绝保存

### 两区隔离：草稿区 + 成品区

|                | 草稿区                  | 成品区                                           |
| -------------- | ----------------------- | ------------------------------------------------ |
| 编辑           | 自由编辑、复制、重命名  | 不可编辑、不可重命名                             |
| 删除           | 直接删除，无后果        | 删除前警告并列出引用此 Interface 的所有 Template |
| 导入           | 不可导入                | 从文件导入，导入后即为成品                       |
| 导出           | 可导出为文件分享        | 可导出为文件分享                                 |
| 可见性         | 仅 Interface 编辑器可见 | Template 编辑器的变量选择器可见                  |
| 内置 Interface | 不适用                  | 存放在此处                                       |

**流转**：用户在草稿区调好 Interface → 点击"发布" → 根据规范化内容计算内容 ID 并写入成品区 → 草稿版保留不删，可继续迭代。若相同内容已存在，则复用已有成品，不重复写入。

**更新已发布内容**：不属于直接编辑。路径是：草稿区改 → 再发布 → 内容发生变化时获得新内容 ID → 用户手动去 Template 里切换引用。不自动迁移，不隐式断链。若修改后内容与某个已有成品完全相同，则复用该成品的内容 ID。

**实现**：草稿、用户发布内容和内置内容物理分区存储。一个 `interfaceId` 在本机只能存在于 `published` 或某个 `builtin/<builtinKey>/versions` 中，不允许重复落盘。

## Interface 实例的身份策略

- `InterfaceInstance` 不参与 `InterfaceDef.id` 的哈希计算；新增、删除或导入实例不会改变 Interface 内容 ID
- `instanceId` 使用创建实例时生成的 UUID v4，表示一次独立生成、复制或另存结果
- Instance 使用实体身份而不是内容身份：不同 `instanceId` 即为不同实例，即使两份实例的 values 和资源完全相同
- AI 生成、复制实例、基于已有实例重新生成和修改后另存都会创建新的 `instanceId`
- 从交换文件导入或从备份恢复原实例时保留原 `instanceId`，以便重复导入能够识别同一实体
- 同 `instanceId`、同内容视为重复导入；同 `instanceId`、不同内容视为数据冲突，必须拒绝导入
- 实例本体不保存 `interfaceId`；归属由 `published|builtin/.../<interfaceId>/instances/<instanceId>` 目录位置表达
- 删除 Interface 时连同附属实例和资源一起删除
- 内置版本迁移保留实例 UUID，复制并验证实例及资源后删除旧版；最终一个 UUID 只能归属一个 Interface

## Interface 导入导出策略

- Interface 定义是交换文件中的必选主体，实例是可选附件；不支持脱离 Interface 单独导出实例
- 导出时可选择“仅 Interface”“选择实例”或“全部实例”
- 导入时可再次选择不导入实例、导入选中实例或导入全部附带实例
- 导入 Interface 时复算内容 ID；本地已有同 ID 时直接拒绝导入
- 不同 `instanceId` 的实例全部保留，不根据实例内容去重
- 实例包含的本地图片等资源必须随实例打包；导入应先完整校验定义、实例和资源，再落盘，避免部分导入

## 内置 Interface 更新策略

- `builtinKey` 表示一个稳定的内置 Interface 系列；同一 `builtinKey` 禁止改变 `varName + type` 变量契约
- 结构不变、仅名称、描述、提示词和示例变化时自动更新：迁移 Template 和实例，成功后删除旧版并通知用户
- JSON 结构变化但变量契约不变时手动更新，用户选择“更新并迁移”或“备份旧版”
- 更新并迁移：实例保留 UUID并写入新版目录，Template 切换新版，验证成功后删除旧版
- 备份旧版：旧版及其实例从内置分区物理复制到 `published`，验证后删除内置源目录；新版内置内容不附带实例
- 当前内置内容不能同时在 `published` 中拥有相同 ID；要编辑内置内容，应先复制为草稿，修改后再发布并获得新的内容 ID

## 外部文件与应用私有存储分离

- `@ls101/file-store` 只管理 `userData` 下的应用私有 scope 数据，不承担系统文件选择和导入导出职责
- 系统原生打开、保存对话框由独立的 `@ls101/file-dialog` 提供，不集成到 `ScopedStore`
- renderer 不获取用户文件的绝对路径；主进程在用户完成选择后直接读取或写入文件
- `file-dialog` 的 IPC 只传递文件 basename、`Uint8Array`、对话框选项和保存结果，不提供任意路径读写接口
- 对外提供二进制与 UTF-8 文本便捷方法，底层只维护一套二进制 IPC 和磁盘 I/O
- 用户取消读取返回 `null`，取消保存返回 `false`，取消不作为异常
