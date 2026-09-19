<!--
status: implemented
product-version: 0.4.1
audience: both
owner: settings
-->

# 设置

## 对象定位

设置管理应用级偏好和 AI 能力配置，是基础设施配置入口，不是题组、试卷或评分记录的工作区。
它拥有：外观偏好、软件数据位置、激活状态、AI Provider / 模型 / 密钥配置、本地模型包与扩展包状态。
设置改变后续任务的起点，但不改写已经保存的题组、试卷和作答记录。

## 能力边界

设置提供：

- 存储：查看与更改软件数据的保存位置、恢复默认位置、删除旧数据目录；
- 许可：查看激活状态、取消激活、打开激活方式意见征集；
- 外观：主题和减少动态效果；
- 关于：应用名称、版本、版本说明、项目团队与许可信息；
- AI 引擎：文本生成、图像生成、语音合成、语音识别与 AI 语音评测五个区域，各自管理 Provider、模型、密钥、连接测试与可用状态。

设置不提供：

- 题组、试卷、评分结果等业务工作区；
- 关于页面的运行环境信息；
- 在设置内执行生成或评分任务；
- AI 语音评测的后端切换，该能力由扩展包提供。

**边界约束**：只有真正影响当前任务的配置才在题组生成、试卷生成或 AI 评分的设置步骤中出现；Provider 管理本身不产生题组、试卷或评分结果。

## 状态与生命周期

- **外观偏好**：修改后立即作用于当前窗口并持久化；保存失败回滚到上一次的值；可恢复默认设置。
- **Provider**：新建草稿、填写协议与地址、测试连接、保存、发现与管理模型、使用。测试失败或模型发现失败保留草稿且不写入配置。
- **已保存 Provider**：可编辑配置、启用或禁用模型、删除。删除 Provider 会同时删除其加密密钥。
- **密钥**：保存后不在普通列表明文展示；查看已保存密钥需要显式操作。
- **数据目录**：区分当前目录与默认目录。更改位置时，空目录走复制迁移，已有数据目录可直接使用；迁移或整理期间应用重启。迁移成功前不切换目录、不删除原数据；迁移后原目录成为旧数据目录，需显式永久删除。存在旧数据目录或旧版数据归档清理未完成时，不能更改位置。
- **许可**：激活状态由邀请码推导并带过期时间。取消激活删除本机激活信息并重启应用，再次使用时需要重新输入邀请码；其他软件数据不受影响。
- **AI 语音评测扩展包**：未导入时，固定阅读题的发音评测不可用；扩展包需与应用要求版本匹配。

## 关键交互语义

- **设置组织**：设置以总览页加分区详情页组织，分区按“通用”与“AI”两组排列；进入分区后可返回设置总览。
- **草稿优先**：连接测试与模型发现都使用当前表单草稿，可以在未保存时验证地址、协议和密钥。
- **模型管理**：模型发现结果合并进草稿；新发现的模型默认未启用，用户需显式启用要使用的模型。
- **任务模型固定**：评分会话在开始时确定语音识别与文本评分模型，会话进行中使用该选择，设置页后续变化不改变进行中的会话。
- **失败不回写**：测试失败、模型发现失败与迁移失败都不产生半成品配置，页面保留可重试的草稿或原目录。
- **不可逆操作**：删除旧数据目录与删除 Provider 都需要二次确认；删除 Provider 不影响已经保存的题组、试卷和作答记录。

## 术语

设置、外观、AI 引擎、Provider、模型、API 密钥、数据目录、旧数据目录、扩展包。详见 [`../glossary.md`](../glossary.md)。

## 界面

UI 规格索引见 [`../screens/README.md`](../screens/README.md)。

- UI-ST-01 设置总览
- UI-ST-02 存储
- UI-ST-03 许可
- UI-ST-04 外观
- UI-ST-05 关于
- UI-ST-06 AI 引擎（内部包含文本生成、图像生成、语音合成、语音识别、AI 语音评测五个区域）

## 验证

- 行为：未建立（旧产品文档没有设置行为编号）。
- 存储与数据目录：`tests/main/data-directory.test.ts`、`tests/integration/data-directory.spec.ts`、`packages/renderer/src/__tests__/StorageSettingsPage.test.tsx`
- 许可：`tests/main/license-service.test.ts`、`tests/main/license.test.ts`、`tests/integration/license.spec.ts`、`packages/renderer/src/__tests__/LicenseSettingsPage.test.tsx`
- 外观：`packages/renderer/src/__tests__/AppearanceSettingsApplication.test.ts`、`packages/renderer/src/__tests__/AppearanceSettingsPage.test.tsx`
- AI 引擎：`packages/renderer/src/__tests__/AIRouterSettingsPage.test.tsx`、`packages/renderer/src/__tests__/airouter-client.test.ts`
- 总览与关于：`packages/renderer/src/__tests__/SettingsPages.test.tsx`、`packages/renderer/src/__tests__/settings-registry.test.tsx`、`packages/renderer/src/__tests__/AboutSettingsPage.test.tsx`
- 视觉：未建立。
