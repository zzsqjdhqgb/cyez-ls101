<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# AIRouter 集成测试规划

状态：规划中，尚未实现对应的 Playwright 测试文件。

本阶段只确定测试项标题和简介，不记录具体操作流程、HTTP 路由、请求样例或断言细节。实现每一项时，再将它扩展为与 [`electron-app.md`](./electron-app.md) 一致的完整测试路径文档。

## 本地模拟 API

AIRouter 集成测试有必要建立本地模拟 API。Provider 配置、模型发现和界面状态可以在不联网的情况下测试，但文本连接、流式生成和图像生成只有经过 AI SDK 与真实 HTTP 边界，才能覆盖协议适配、请求头、流事件、错误传播及取消行为。

建议由 Playwright fixture 在测试进程内启动轻量 Node HTTP 服务，仅监听 `127.0.0.1` 并使用系统分配的随机端口。服务同时模拟 OpenAI-compatible、Anthropic 和 OpenAI-compatible 图像协议，允许测试按场景配置成功、流式、延迟、失败、截断和无效媒体响应，并记录收到的请求供测试断言。每条测试前重置场景和请求记录，套件结束后关闭服务；不使用真实 API Key，也不访问公网。

## 设置与初始状态

### AR-01 AI 引擎设置入口与分类导航

确认用户能够从设置首页进入 AI 引擎，并在文本模型、图像模型以及尚未开放的语音分类之间切换。该项建立 AIRouter 所有后续设置测试的页面入口基线。

### AR-02 文本空状态与默认手动图像 Provider

确认全新用户数据目录中没有文本 Provider，同时图像设置自动提供可选择的“手动生成”Provider。该项覆盖两个配置域不同的初始化契约。

## 文本 Provider 配置

### AR-03 OpenAI-compatible Provider 创建与重载

确认用户能够保存包含名称、Base URL、API Key 和启用模型的 OpenAI-compatible 文本 Provider，并在 renderer 重载后看到相同的非敏感配置摘要。

### AR-04 Anthropic Provider 创建与重载

确认 Anthropic 类型可以独立保存和恢复，并保持自己的类型、默认地址语义和模型配置，不被当作 OpenAI-compatible Provider 处理。

### AR-05 文本 Provider API Key 生命周期

覆盖已保存密钥的状态提示、按需读取、替换和清除，确认敏感值与普通 Provider 配置分开存储，列表与重载过程不会直接泄露密钥内容。

### AR-06 文本模型手动管理与启用状态

确认用户可以手动添加模型 ID、切换启用状态、去重并移除模型，且保存后的模型集合与界面选择状态一致。

### AR-07 文本模型发现与现有配置合并

使用本地模拟 API 返回无序且混合格式的模型列表，确认发现结果经过规范化和排序，并与草稿中已有模型合并而不丢失启用状态。

### AR-08 OpenAI-compatible 未保存草稿连接测试

确认用户无需先保存 Provider 就能使用当前草稿中的 Base URL、API Key 和已启用模型完成连接测试，并且测试本身不会产生持久化配置。

### AR-09 Anthropic 未保存草稿连接测试

确认 Anthropic 草稿通过对应协议完成连接测试，验证类型特有的鉴权和消息协议确实经过本地模拟端点，而不是复用 OpenAI 请求格式。

### AR-10 文本 Provider 编辑、删除与密钥清理

确认已保存 Provider 可以修改基础字段和模型配置，删除时经过确认界面，并同时移除配置摘要与加密密钥，不影响其他 Provider。

## 文本生成运行时

### AR-11 OpenAI-compatible 文本流端到端传递

确认已保存且启用的 OpenAI-compatible 模型能够把本地模拟 API 的文本与推理增量依次传过 AI SDK、main、IPC、preload 和 renderer 异步迭代器，并正常结束。

### AR-12 Anthropic 文本流端到端传递

确认 Anthropic 流式响应经过其独立协议适配后，向 renderer 提供与 OpenAI-compatible 相同的 AIRouter chunk 契约。

### AR-13 文本生成取消与资源释放

确认 renderer 发起的取消会终止当前 IPC 生成任务和底层 HTTP 请求，异步迭代器及时结束，且监听器与 active request 不会残留到下一次生成。

### AR-14 文本 Provider 错误与截断反馈

覆盖 HTTP 失败、Provider 流错误、长度上限和内容过滤等结果，确认 AIRouter 将它们转换为稳定、可理解的 renderer 错误，而不是静默返回不完整内容。

## 图像 Provider 与生成

### AR-15 手动图像生成与剪贴板导入

确认默认手动 Provider 能打开全局导入对话框、展示提示词、复制提示词、从真实剪贴板读取图片并把确认后的字节返回原调用方，同时在取消时正确结束请求。

### AR-16 OpenAI-compatible 图像 Provider 配置

确认图像 Provider 使用独立于文本 Provider 的配置和密钥域，并支持保存名称、Base URL、API Key、模型及启用状态后重载恢复。

### AR-17 图像模型发现与连接预览

使用本地模拟 API 发现图像模型并执行测试生成，确认设置页能够显示成功反馈和有效图片预览，且未保存草稿同样可以完成连接测试。

### AR-18 API 图像生成端到端传递

确认消费方提交 Provider、模型、提示词和可选尺寸后，本地模拟 API 返回的图片媒体类型与字节能够经过 main、IPC 和 preload 完整到达 renderer。

### AR-19 图像生成错误、取消与结果限制

覆盖请求取消、HTTP 失败、非图片媒体类型和超大结果，确认错误能传回原调用方，取消后不会再接收迟到的成功结果。

### AR-20 图像 Provider 删除与可选择项兜底

确认删除图像 Provider 会同步清理其密钥；当删除后没有手动 Provider 或启用的 API 模型时，系统会恢复默认手动 Provider，保证图像功能始终存在可选择入口。

## 消费方集成说明

AR-11、AR-12、AR-15 和 AR-18 不应只在设置页内部调用 AIRouter client。实现时应选择至少一个真实业务消费入口，确认设置中启用的模型或 Provider 能被消费方列出、选择并实际调用。具体消费页面和路径将在实现对应测试项时确定。
