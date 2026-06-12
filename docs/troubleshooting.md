<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 常见问题排查

## 应用无法启动

### 问题：启动后闪退或白屏

1. 检查 Node.js 版本是否 >= 18
2. 检查依赖是否完整安装：`pnpm install`
3. 查看控制台日志（开发模式下通过终端输出查看）
4. 尝试重置数据：打开"开发者选项"页面 → 点击"重置数据"

### 问题：开发模式启动失败（`pnpm dev`）

1. 确保已安装 pnpm
2. 清理并重新安装依赖：`rm -rf node_modules && pnpm install`
3. 检查端口是否被占用

## 考试相关

### 问题：导入考试失败 / 格式不合法

检查试卷 ZIP 是否包含以下错误：
- 缺少 `exam.json` 文件
- `exam.json` 格式不符合 [试卷格式规范](exam-format.md)
- 媒体文件路径错误或文件缺失
- `questions` 数组为空

详细的格式要求见 [exam-format.md](exam-format.md)。

### 问题：音频无法播放

1. 确认媒体文件（`.mp3`、`.wav`）存在于考试包的 `media/` 目录中
2. 确认 `exam.json` 中 `audio` 节点的 `src` 路径正确（相对于考试包根目录）
3. 检查音频文件格式是否兼容（推荐 MP3、WAV）
4. 确认 `audio` 节点包含 `text` 字段（系统要求必填）

### 问题：视频无法播放

1. 确认视频文件存在于 `media/` 目录
2. 视频节点只能出现在 `time.type === "content-controlled"` 的题目中
3. 每个 content-controlled 题目只能有一个视频或音频节点

### 问题：录音没有声音

1. 检查系统是否授予了麦克风权限
2. 确认麦克风设备正常工作
3. macOS 用户请检查"系统偏好设置 → 安全性与隐私 → 麦克风"

## 模板与草稿

### 问题：导入模板失败

模板验证失败的原因可能包括：
- `editableData` 中 ID 重复
- 占位符未被定义或定义了未使用
- 文件引用路径不匹配
- `audio` 节点缺少 `text` 或 `src`

详见 [template-format.md](template-format.md)。

### 问题：草稿导出失败

常见原因：
1. 有文本字段未填写
2. 有文件字段未上传
3. TTS 合成失败（见下方 TTS 问题）

## TTS 语音合成

### 问题：导出草稿时提示语音合成失败

1. 确认 TTS 模型文件已下载：运行 `node scripts/download-tts-assets.js`
2. 检查 `assets/` 目录下是否有以下文件：
   - `tts_b6369a24.safetensors`
   - `tokenizer.model`
   - `embeddings_v2/alba.safetensors`（及其他 6 个音色文件）
3. 检查 `resources/tts/` 目录下是否有 WASM 文件

### 问题：合成音频质量差

TTS 引擎使用 24000 Hz 采样率合成，质量受以下因素影响：
- 输入文本的长度和复杂度
- 长文本会自动分句处理，分句后加了停顿（0.2 秒静音）
- 当前版本默认使用 alba 音色，暂不支持切换

## 批改系统

### 问题：导入作答包失败

1. 确认 ZIP 文件是从"作答列表"页面导出的格式
2. 确认 ZIP 中每个作答目录包含 `meta.json`
3. 若提示"重复记录"，则该学生的该考试作答已经导入过

### 问题：PDF 导出失败

1. 确认批次中存在有效的批改记录
2. PDF 导出使用 Electron 内部 Chromium 打印引擎
3. 若部分学生 PDF 生成失败，其余学生的 PDF 仍会正常导出

## 数据管理

### 问题：如何备份数据

所有数据存储在 Electron 用户数据目录下：
- **Windows**：`%APPDATA%/cyez-ls101/`
- **macOS**：`~/Library/Application Support/cyez-ls101/`
- **Linux**：`~/.config/cyez-ls101/`

可以直接复制整个目录进行备份。

### 问题：如何重置所有数据

方式一：在应用的"开发者选项"页面点击"重置数据"按钮。
方式二：手动删除上述用户数据目录。

**警告**：重置数据不可恢复，操作前请备份重要数据。

## 构建与打包

### 问题：Windows 构建失败

1. 确保系统满足 electron-builder 要求
2. Windows 下可能需要管理员权限
3. 检查磁盘空间是否充足

### 问题：macOS 构建失败

1. 需要 macOS 系统和 Xcode 工具
2. 确保证书配置正确（`electron-builder.yml` 中 notarize 已设为 false）

## 获取帮助

如果上述方法无法解决问题：
1. 打开关于页面开启开发者模式
2. 按 F12 打开开发者工具查看控制台错误日志
3. 检查 `%APPDATA%/cyez-ls101/` 下的数据目录是否完整

更多信息见项目文档目录下的其他文档。
