# 学生端与教师端测试补强

## 范围与基线

2026-09-25 审查：学生端 Vitest 41 项、教师端 Vitest 23 项、机房 Electron 集成测试 5 项通过。通过数量不代表业务覆盖充分。服务端协议、共享播放器及本地存储测试不能替代桌面端的状态衔接和页面操作测试。

## 实施顺序与验收标准

1. **教师端作答与试卷页面**：使用真实页面、查询和选择逻辑，仅替换会话的服务边界。验证批量删除确认范围固定、取消不写入、部分失败只保留失败项、筛选清空选择，以及试卷导入、上架冲突刷新和删除确认。
2. **学生端练习生命周期**：通过公开 Controller 方法和可控宿主响应验证下载期间进入维护或关闭程序、许可过期/撤销/取消、落盘分块失败后重试。失败不得启动练习、提前报告保存成功或触发上传；重试保留作答身份与归档内容。
3. **教师端会话异常**：验证结果未知后的重试复用幂等键，成功后的新操作使用新键，令牌过期清理连接，切换服务取消旧请求并拒绝迟到结果。
4. **独立 Electron 场景**：新增可单独运行的业务测试，覆盖教师端页面操作，以及学生端真实断网交卷、重启、恢复上传。原有联合流程保留为跨端联调测试，新增关键验收不依赖它的前置断言。
5. **统一入口**：让 `lab:test` 显式执行桌面相关 Vitest，避免单独运行机房验收时遗漏已有用例。主 CI 的根 Vitest 仍保留。

## 验证要求

- 页面测试断言用户可见状态与实际发出的操作参数，不仅断言 mock 被调用。
- 生命周期测试对故障点注入错误，断言持久化、上传、资源释放的边界和重试结果。
- Electron 场景构建真实两端，通过真实主进程、预加载和服务通信；文件对话框可以替换，业务响应不能用静态成功值替代。
- 修改 renderer、preload 或 main 生产代码后执行 `xvfb-run -a yarn test:smoke`；机房行为额外运行 `xvfb-run -a yarn lab:test:integration`。
- 本文中的 Linux 命令用于容器内部。Windows 用户运行机房集成测试使用 `yarn lab:test:integration`。
- 容器测试不替代 Windows 安装、提权及真实音频设备验收。

## 实施记录

已新增 19 项 Vitest 和 2 项独立 Electron 测试，未修改生产业务逻辑：

本轮继续补充了三项高优先级证据：

- `packages/exam-player/src/__tests__/submission.test.ts` 现在会把同时包含选择题答案和录音资源的作答包实际编码、解码，并核对答案、音频元数据和音频字节。
- `apps/lab-teacher/renderer/src/pages/__tests__/business-pages.test.tsx` 已覆盖教师端作答详情、批量导出和删除确认的页面逻辑；跨端恢复场景单独核对服务端回执与学生端本地记录。
- 学生端强制退出的边界继续由 `packages/lab-desktop-host/src/__tests__/records.test.ts` 的中断归档恢复用例和 `packages/lab-server/src/__tests__/integration/crash-recovery.test.ts` 的四个服务端提交崩溃点覆盖；本轮将其列入统一桌面验收说明。

| 层次          | 文件                                                                    | 新增验收                                                                                               |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 教师页面      | `apps/lab-teacher/renderer/src/pages/__tests__/business-pages.test.tsx` | 5 项：删除取消、筛选清空选择、确认范围快照、部分失败后重试/导出、网络失败重试、上架冲突刷新及导入/删除 |
| 教师会话      | `apps/lab-teacher/renderer/src/session/__tests__/session.test.ts`       | 6 项：未知写入复用幂等键、三种鉴权失败、切换连接后的迟到成功和鉴权失败                                 |
| 学生生命周期  | `apps/lab-student/renderer/__tests__/practice.test.ts`                  | 8 项：下载时维护/关闭、许可过期/模式修订变化/撤销/取消、分块写入或发布失败后的同一归档重试             |
| 教师 Electron | `tests/lab/teacher-business.spec.ts`                                    | 从文件对话框导入，验证默认上架、下架、重新上架、取消删除、确认删除及服务端结果                         |
| 学生 Electron | `tests/lab/student-recovery.spec.ts`                                    | 关闭真实 TLS 监听后交卷；离线重启保留归档；恢复连接后上传；再次重启不重复提交                          |

`lab:test:desktop` 收集学生端、教师端、共享 renderer 和 desktop host 的 Vitest，并由 `lab:test` 执行。学生端入网与练习测试共享宿主夹具；新增 Electron 场景各自创建临时服务和用户目录，不依赖原有长流程。

离线重启的预期遵循 [hostname 部署设计](./lab-hostname-deployment-design.md)：设备身份仅驻留内存，重启后连接恢复前不开放练习或导出。测试同时验证离线页没有业务导航、本地归档仍存在且字节不变；不能用旧作答的绑定快照恢复身份。

验证记录：

- 桌面 Vitest：21 个文件、114 项通过（学生端 49、教师端 34、共享包 31）。
- 完整作答包：`yarn lab:test:submission`，覆盖选择题与录音资源的编码、解码和字节完整性。
- 机房 Electron 完整回归：7 项通过；恢复场景调整等待条件后单独复验通过。
- 默认 `test:smoke`：重新构建打包，12 项通过。
- 学生端、教师端及新增 Electron 测试的 TypeScript 检查通过。
- 修改文件的 ESLint、Prettier 与 `git diff --check` 通过。

Windows PowerShell 可单独运行桌面测试：

```powershell
yarn lab:test:desktop
```

本轮没有把所有异常排列组合穷举完：强制杀进程的不同落盘时间点、多个教师同时编辑的真实跨进程竞争，以及 Windows 提权/安装与真实麦克风设备仍需各自专项验收。现有队列/存储故障测试继续保留。
