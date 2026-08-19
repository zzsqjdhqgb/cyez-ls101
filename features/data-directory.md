# 数据目录

## 功能状态

应用将业务数据统一写入可配置的 `dataRoot`。默认位置是 `app.getPath('userData')/data`；Electron Cache、GPUCache 和可重新生成的 `qwen-tts-runtime` 仍位于 Electron `userData`，不会随业务数据迁移。

固定位置的 `userData/data-location.json` 是启动引导配置，记录格式版本、当前业务数据目录和挂起迁移。每个有效业务数据目录包含 `.ls101-data.json` 标记。主进程在注册 File Store、Config Store 和 AI Router 前解析或迁移目录。

## 设置与迁移

“设置 → 存储”显示当前目录和占用空间。用户可以选择空目录并复制当前数据，或直接使用另一个带有效标记的数据目录。普通非空目录、源目标互相嵌套和数据目录内容中的符号链接会被拒绝；目录本身会解析为真实路径后再检查包含关系。

复制请求先原子写入 `migrating` 引导状态，再重启应用。新进程在任何业务存储注册前将源目录复制到目标旁的临时目录，按相对路径和文件大小校验后重命名目标，最后把引导状态提交为 `ready`。失败时不更新当前目录、不删除源目录，并清理临时副本。再次启动会根据挂起状态重试。

应用使用单实例锁，避免两个进程同时迁移或写业务数据。自定义目录在启动时不可访问时，主进程提供重试、选择已有受管理目录或退出三种恢复操作。

## 旧数据整理

没有引导配置和数据目录标记，但 Electron `userData` 根目录存在已知业务目录时，应用执行一次旧数据整理。只复制 `config`、`secrets`、`models`、`extensions`、`template-editor`、`interfaces`、`schema-editor`、`exam-library` 和 `submission-library`；Electron 缓存与 `qwen-tts-runtime` 不复制。原目录内容会保留。

## 进程边界

renderer 只通过 `window.dataDirectory` 获取目录信息、调用系统目录选择器以及提交迁移或使用已有目录。路径检查、文件复制、引导配置和重启全部由 main 负责。preload 暴露固定的数据目录 IPC 方法，不向 renderer 提供 Node.js 文件系统能力。

## 验证覆盖

文件系统测试覆盖全新初始化、旧数据筛选整理、挂起复制恢复、源数据保留和非空目录拒绝。renderer 测试覆盖空目录迁移及使用已有数据目录。Electron 集成测试覆盖真实进程重启后的目录切换和数据保留。
