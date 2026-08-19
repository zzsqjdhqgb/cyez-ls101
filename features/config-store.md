# 应用配置存储

## 功能状态

`@ls101/config-store` 已提供作用域化的结构化配置存储，并完成 Electron main、preload 和 renderer 接线。当前后端将配置写为 `dataRoot/config/{scope}/{key}.json`；外观设置模块已使用该能力保存主题和减少动效偏好。

Config Store 只负责持久化 JSON 值，不理解设置页面、默认值、业务校验或配置生效方式。这些行为归注册设置页所属的业务模块负责。

## Renderer 接口

```typescript
const appearanceStore = configStore.scope('appearance')
const document = await appearanceStore.read('settings')
await appearanceStore.write('settings', document)
await appearanceStore.delete('settings')
await appearanceStore.clear()
```

`scope(name)` 可以继续创建子作用域。作用域段与 key 只能包含字母、数字、下划线和连字符；key 还允许句点。空值、路径分隔符和 `..` 会在 renderer 和 main 存储层拒绝。

`read()` 在配置不存在时返回 `null`，JSON 损坏时抛出解析错误。`write()` 只接受可 JSON 序列化的值。`delete()` 和 `clear()` 对不存在的目标保持幂等。

## 进程边界

renderer 通过 preload 暴露的 `window.configStore` bridge 调用固定 IPC 白名单：

- `config:read`
- `config:write`
- `config:delete`
- `config:clear`

main 在应用 ready 后解析可配置的业务数据目录，并以该目录注册 JSON 后端。公共 renderer API 不暴露路径、文件名或 JSON 文件操作，因此后续可以在保持模块接口不变的情况下更换为 SQLite 等后端。

## 写入语义

JSON 后端在目标目录旁创建权限为 `0600` 的临时文件，写入并同步后再原子替换目标文件。失败时清理临时文件，避免把半写入文档暴露给读取方。

Config Store 没有跨 key 事务、比较并交换或变更订阅。需要协调并发写入的模块必须在自己的应用服务中串行化操作。

## 外观设置集成

外观模块保存一个带版本号的配置文档：

```json
{
  "version": 1,
  "settings": {
    "theme": "dark",
    "reduceMotion": true
  }
}
```

`AppearanceSettingsApplication` 负责默认值、版本和内容校验、保存与重置。`AppearanceSettingsProvider` 在 renderer 启动时加载配置，统一管理当前值、加载和保存状态、错误、乐观更新及失败回滚，并通过 `useAppearanceSettings()` 向模块 UI 暴露命令。设置页面只渲染这些状态并调用 `setTheme()` 或 `setReduceMotion()`；`AppearanceSettingsRuntime` 由 Provider 驱动，将结果应用为根元素的 `data-theme` 与 `data-reduce-motion` 属性。

## 已知限制

- 当前配置使用明文 JSON，未提供 Secret Store，不适合直接保存需要加密保护的 API Key。
- 当前没有多窗口或外部文件修改同步。
- 浏览器预览没有 Electron preload bridge，真实配置读写只在 Electron renderer 中可用。
