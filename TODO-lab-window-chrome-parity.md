# TODO：主程序与教师端窗口外观不一致的根因研究与验证

状态：待研究（阻塞点已用 workaround 绕过，但原因未证实）
创建：2026-09-18

## 1. 现象

同一个 Electron 版本、同一台 Windows 机器上：

- **主程序**（`src/main/window.ts`）使用 `frame: false`，窗口没有原生标题栏。
- **教师端 lab 窗口**（`packages/lab-desktop-host/src/desktop.ts`）同样设置 `frame: false`，却始终显示一条原生标题栏（最小化/最大化/关闭 + 窗口标题「听说101 教师端」），叠加在自绘标题栏之上。
- Windows 11 与 Windows Server 2022 表现一致；dev 模式与安装包一致。

2026-09-18 的临时修复：win32 上改用 `titleBarStyle: 'hidden'`（保留原生边框/阴影/鼠标缩放），标题栏消失。主程序仍为 `frame: false`。**该修复有效，但根因未验证。**

## 2. 已收集的证据

- 主进程日志证明参数已传入并生效：`[lab] creating teacher window (frameless=true)`。
- 主进程诊断（在 `dom-ready`、`window.show()` **之前**测量）：
  `[lab] window chrome: frameless=true frameHeight=35px menuBarVisible=false — a native frame is present`
  即 Electron 认为窗口无框，但窗口仍存在 35px 非客户区。
- 修复前 lab 与主程序的窗口创建差异只有两点：
  1. lab 用默认 `show: true`（创建即可见）；主程序 `show: false` + `dom-ready` 后 `show()`。
  2. lab 的启动命令分发 `dispatch()` 会无条件 `window.show()` + `window.focus()`，可能在首帧前改变激活状态；主程序没有这条路径。

## 3. 假设

- **H1（配置/平台缺陷）**：`frame: false` 在 Windows 上走 Chromium 的 custom-frame 路径，其 `WM_NCACTIVATE → DefWindowProc` 分支会把非客户区（标题栏）重绘出来（Electron 曾为此修复，见参考 [1]）。窗口在首帧前可见、激活状态变化（show/focus、提权交互、启动命令）是触发条件。若成立，`titleBarStyle: 'hidden'` 是**必需**修复。
- **H2（时序）**：真正起作用的是"隐藏创建 + 就绪后显示"的时序，`titleBarStyle: 'hidden'` 只是同批上线。35px 读数取自尚未实现的窗口，可能是过期值，不能作为 `frame: false` 失效的证据。若成立，主程序一直是靠时序躲过问题，两边可继续用 `frame: false`。

## 4. 实验设计（Windows，单次 dev 可判定）

- **E1（区分 H1/H2）**：在 `desktop.ts` 的 win32 分支临时改回 `{ frame: false }`，其余保持现状（`show: false` + 就绪后显示 + 显示后 1s 的诊断），dev 运行一次：
  - 标题栏复发 → H1 成立；
  - 标题栏不复发 → H2 成立。
- **E2（若 E1 判定 H2）**：把主程序临时改成创建即可见，复现标题栏，确认触发条件是显示时序；随后决定两边是否统一。
- **E3（测量可靠性）**：诊断改为在 `show()` 前后各打一次，确认 35px 是否只是未实现窗口的读数。

判定标准：

- H1：`frame: false` + `show: false` 的 lab 构建仍出现原生标题栏（`frameHeight > 0` 且肉眼可见）。
- H2：同一构建不再出现，且把主程序改成 `show: true` 能复现。

## 5. 结果如何影响实现

- **H1 成立**：保留 win32 的 `titleBarStyle: 'hidden'`；并考虑主程序是否对齐（主程序属可见行为变更，需另跑 `docs:product:check` 与 `yarn test:smoke`）。
- **H2 成立**：两边都回到 `frame: false` + "隐藏创建、就绪后显示"，配置更统一；`titleBarStyle: 'hidden'` 可保留作双保险，也可回退。
- 无论哪种结论，都应把最终配置与理由写回 `docs/lab-desktop-design.md`（宿主窗口章节），避免后来者再踩。

## 6. 现状快照

| 窗口 | `frame` | `titleBarStyle` | `show` | 显示时机 |
| --- | --- | --- | --- | --- |
| 主程序 `src/main/window.ts` | `false` | 无 | `false` | `dom-ready` 后 `show()` |
| lab（修复前） | `false` | 无 | 默认 `true`，且 `dispatch()` 里 `show()/focus()` | 首帧前可见 |
| lab（现状） | 默认 `true` | `'hidden'`（仅 win32） | `false` | `dom-ready` 后 `show()` |

lab 侧入口已统一：产品入口 `apps/lab-teacher/main/index.ts` 与测试宿主 `tests/lab/teacher-local-entry.ts` 都经 `apps/lab-teacher/main/desktop.ts` 的 `startTeacherDesktop()`，窗口参数只有一处。

## 7. 范围外（本 TODO 不做）

- 不改动本机服务弹窗的交互逻辑。
- 不跑收尾/回归（由其他会话执行）；本任务只做研究与结论落档。
- 在结论明确前不调整主程序窗口配置。

## 8. 参考

1. Electron 修复提交（2024-01，标题栏错误出现在无框窗口上）：https://github.com/electron/electron/commit/a917645ba67039c41939ed3b8387da59c1c9249c
2. Electron Custom Title Bar（Windows/Linux 用 `titleBarStyle: 'hidden'`，不给 `titleBarOverlay` 则不出现系统按钮）：https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
3. Electron Custom Window Styles（`frame: false` 的官方用法）：https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
