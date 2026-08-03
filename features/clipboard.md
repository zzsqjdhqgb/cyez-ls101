# 系统剪贴板图片读取

`@ls101/clipboard` 为 renderer 提供从系统剪贴板读取单张图片的窄能力，并已接入 Electron main 与 preload。该模块不读取剪贴板文本，不写入剪贴板，也不暴露任意 Electron IPC。

## 公共接口

renderer 使用唯一实例：

```typescript
import { imageClipboard } from '@ls101/clipboard/renderer'

const png = await imageClipboard.readImage()
```

`readImage()` 返回 `Promise<Uint8Array | null>`：剪贴板含图片时，返回由 Electron `NativeImage.toPNG()` 编码的 PNG 字节；没有图片时返回 `null`。

main 导出幂等注册函数：

```typescript
import { registerClipboard } from '@ls101/clipboard/main'

registerClipboard()
```

## 进程边界

1. renderer facade 调用 preload 暴露的 `window.imageClipboard.readImage()`。
2. preload 只允许固定的 `clipboard:read-image` IPC 请求。
3. main handler 使用 Electron `clipboard.readImage()` 读取当前系统剪贴板。
4. 空 `NativeImage` 映射为 `null`，其他图片统一转换成 PNG 字节返回。

该流程不使用浏览器 `navigator.clipboard.read()`，因此不依赖 Chromium 的 clipboard-read 权限或安全上下文。系统剪贴板仍受当前桌面会话约束；Linux 无图形会话、Wayland 配置或测试容器中可能没有可读图片。

## 集成状态

Interface 实例手动编辑页的图片字段使用该能力实现“从剪贴板读取”。剪贴板字节先保存在 renderer 的未保存表单状态中，用户保存题组时才写入 Interface 实例 assets。

## 验证覆盖

自动化测试覆盖 renderer bridge 的图片和空值返回、main handler 的 PNG 返回、空剪贴板处理及重复注册保护。真实操作系统剪贴板、不同 Linux clipboard selection 和超大图片转换未做自动化端到端测试。
