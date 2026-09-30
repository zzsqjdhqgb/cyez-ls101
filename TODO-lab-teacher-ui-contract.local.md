# 教师端页面契约（E 阶段，临时文档）

> 用途：重写前的页面契约与决策清单。依据：`docs/lab-deployment-design.md`（§4/§6/§12/§13）、
> `docs/lab-teacher-workflow-design.md`、`docs/lab-desktop-design.md`（§3）、当前 renderer 实现、
> `packages/lab-contracts` 的 operationDefinitions（含查询参数）。
> 决策未确认前不实现页面。

## 0. 统一约定（我决定，无需确认）

- 结构：`MemoryRouter` + route registry + `AppShell`；页面 `Page` + `PageHeader`；表格 `Table`；弹窗 `Modal`/`ConfirmModal`。
- 路由与布局：
  - `/activate`（focus）、`/connect`（focus，连接页含本机服务入口）
  - `/exams`、`/submissions`、`/devices`、`/maintenance/*`、`/settings`（standard）
- 数据：`useLabQuery({ queryKey: queryKey(op, input), queryFn, pollMs })`；列表首载 skeleton、空 EmptyState、失败 Banner（保留旧数据 + stale 标记）。
- 轮询：设备/维护摘要 5s；作答/试卷/备份/清理/测试 15s；未挂载的路由不轮询；`document.hidden` 时暂停。
- 写入：`useLabAction`；成功 toast，失败 Banner/内联错误；破坏性操作一律 `ConfirmModal`。
- 错误：`describeLabError`（中文 + 原始 code）。
- 冲突：`REVISION_CONFLICT` 保留草稿、显示服务器当前值 + "载入最新版本"。
- 秘密：密码/激活码输入用完即清，不进入日志与错误信息。
- TitleBar actions：服务名称/地址/版本/模式徽标 + 刷新 + 切换服务 + 本机服务。

## 1. 激活页 `/activate`

- 数据：`license.status` / `license.activate`（宿主）。
- 状态：未激活（表单）、激活中（busy）、失败（Banner：激活码无效/已到期）。
- 契约：未激活只允许激活与关闭（设计 §3.1）。
- 现状：与契约一致。无待决。

## 2. 连接页 `/connect` + 本机服务

- 数据：`connections.list/open/authenticate/save/close`、`localService.*`（宿主）。
- 状态：未连接；连接中；失败原因（指纹不匹配、密码错误、服务不可达）。
- 契约：
  - 先核对公钥指纹再发密码；失败展示实际原因（设计 §5.1）。
  - 本机服务控制不要求已连接 HTTP；远程连接不顺带启动本机服务（§2.2）。
  - 关闭窗口/断开连接不停止本机服务（§2.2）。
- **页面形态（2026-09-18 用户确认，取代现有表单式布局）**：
  - 主体是**已配置服务列表**：每行显示服务名称、地址、指纹核对状态；行内提供"连接"动作（点击后只补管理密码；首次添加时才填地址/指纹/信任勾选）。
  - 列表下方是**同样式、独立分区的"本机服务"条目**：显示本机服务状态（未安装/已停止/等待初始化/运行中/不可用）与版本；**右侧一个设置按钮**，点击打开本机服务管理弹窗（安装/卸载/启动/停止/开机启动/端口/日志/恢复备份、升级），**不是**服务器业务管理；运行中时行内提供"连接本机服务"。
  - 页头动作："添加服务"（打开添加对话框）。
  - 空状态：尚未配置任何服务时显示引导 + 添加服务。
- 缺口：未记住上次连接；远程连接时服务设置页没有"本机操作需在服务机执行"的提示。
- 待决：**Q7**（记住上次服务）、**Q8**（远程提示）。

## 3. 试卷 `/exams`

- 数据：`getTeacherExams({cursor,limit,q,published})`、`postTeacherExams`、`patchTeacherExamsExamId`、`deleteTeacherExamsExamId`、`getTeacherExamsExamIdArchive`。
- 状态：列表（分页）、导入中、冲突、空。
- 操作与确认：
  - 导入：选择 `.lsexam` → 上传校验 → 成功默认上架（设计 §4）。
  - 上/下架：PATCH `published` + `expectedRevision`。
  - 下载原包：`getTeacherExamsExamIdArchive`。
  - 删除：确认文案说明"已收作答与已发放练习许可保留"（§4）；`deleteTeacherExamsExamId`。
- 缺口：
  - 文档要求"上传、搜索"；API 支持 `q`/`published`，UI 未用 → **Q1**。
  - 文档要求"同包 ID 同摘要提示已存在；同 ID 不同摘要拒绝覆盖"；现仅显示 `CONTENT_CONFLICT` → **Q2**。
  - 文档要求"上传显示传输与校验两个阶段"；宿主 `transfer.import` 无进度事件 → **Q10**。

## 4. 作答 `/submissions`

- 数据：`getTeacherSubmissions({cursor,limit,room,examId,deviceId,candidateId,candidateName,from,before})`、`postTeacherSubmissionsExport`（≤500）、`postTeacherSubmissionsDelete`、`getTeacherSubmissionsIdArchive`。
- 状态：列表、跨页选择（仅显式 ID）、导出中、删除确认、删除结果逐项。
- 契约：内容不可修改；批量导出 ZIP 保留完整 `.lssubmission`；删除需固定范围确认（§4）。
- 现状：筛选仅姓名/考生号/机房；详情含接收时与当前设备标签；批量删除返回逐项结果弹窗。
- 缺口：API 支持试卷、设备、时间范围筛选而 UI 未用 → **Q3**；详情未显示试卷名/摘要/大小 → **Q4**。

## 5. 设备 `/devices`

- 数据：`getTeacherDevices({cursor,limit,room,q,online,versionMismatch})`、`getTeacherDevicesId`、`patchTeacherDevicesId`、`postTeacherDevicesIdResetBinding`。
- 状态：5s 轮询；在线/离线/禁用；心跳摘要（版本、激活、阶段、等待首次上传/未确认/异常）。
- 契约：编辑冲突保留草稿并展示当前值；禁用确认说明本地作答保留；重置绑定需单独确认并说明需重新入网（工作流 §3）。
- 缺口：API 支持 `q`（编号/计算机名）与 `versionMismatch` 筛选，UI 未用 → **Q5**。

## 6. 维护 `/maintenance`（子路由：enrollments / tests / cleanup / backups）

统一：进入维护/退出维护在 TitleBar 或页面页头；退出必须读取最新 `getTeacherService` 并提交当前 `modeRevision`；阻塞项来自 `ServiceState.blockers`（设计 §5、工作流 §5）。

### 6.1 入网 `/maintenance/enrollments`
- 数据：`getTeacherEnrollments`、`postTeacherEnrollments`、`deleteTeacherEnrollmentsId`、`getTeacherEnrollmentsIdFile`。
- 契约：默认 10 分钟；开启入网自动进入维护；过期/撤销后禁用下载；关闭批次不影响已注册设备（§6.1）。
- 现状：有效期输入 + 列表（状态、注册数、下载、关闭）。
- 待决：**Q6**（开启入网后是否自动下载文件）。

### 6.2 部署测试 `/maintenance/tests`
- 数据：`getTeacherTestSuites`、`getTeacherTestRuns`、`getTeacherTestRunsId`、`postTeacherTestRuns`、`postTeacherTestRunsIdCancel`、`getTeacherTestRunsIdReport`、`putTeacherTestRunsIdDevicesDeviceIdConfirmation`。
- 契约：固定内置套件；逐设备逐用例状态；声音/麦克风需人工确认；重试失败项生成新批次（`retryOf`），原报告保留；取消后显示"正在停止"直到租约结束（§12、工作流 §5）。
- 现状：创建对话框有套件下拉 + 用例勾选 + 机房筛选 + 设备多选；详情支持取消、导出、人工确认、重试；状态文案映射不完整（部分原始英文）。
- 待决：**Q9**（是否隐藏套件下拉、仅内置套件 + 用例勾选）。

### 6.3 历史清理 `/maintenance/cleanup`
- 数据：`getTeacherHistoryCleanups`、`getTeacherHistoryCleanupsId`、`postTeacherHistoryCleanups`、`postTeacherHistoryCleanupsIdConfirm`、`postTeacherHistoryCleanupsIdCancel`。
- 契约：只清理有成功回执的本地历史；确认提交 `expectedRevision` + 每设备 `selectionDigest`；范围冻结；部分失败不等于成功（§10.4、工作流 §6）。
- 现状：创建对话框可选设备 + 截止时间 + 有效期；详情按设备勾选并二次确认。
- 缺口：文档要求"按机房、设备和截止日期选择范围" → **Q11**（加机房筛选）。

### 6.4 服务备份 `/maintenance/backups`
- 数据：`getTeacherBackups`、`postTeacherBackups`、`getTeacherBackupsIdArchive`。
- 契约：要求维护且任务停止；密码仅内存；`pending/running/ready/failed`；`ready` 才可下载；处理中阻塞退出维护（§7、§14.3）。
- 现状：与契约一致。
- 待决：**Q12**（创建前是否预检并展示阻塞详情，而非仅错误码）。

### 6.5 退出维护检查（TitleBar 动作）
- 必须读取最新 service，提交 `modeRevision`；硬阻塞列出并可定位（工作流 §5）。
- 现状：弹窗只显示 `kind: resourceId`。
- 待决：**Q13**（阻塞项显示可读名称 + 跳转到对应子页）。

## 7. 服务设置 `/settings`

- 数据：`getTeacherSettings`/`patchTeacherSettings`、`getTeacherSecurity`/`putTeacherSecurityPassword`、`getTeacherLogs({cursor,limit,from,before,level,requestId})`、宿主 `operations.list`。
- 契约：名称/对外地址/限制热更新；改密撤销所有会话并重新登录；日志分页；未确认操作使用原幂等键核对（工作流 §1/§7）。
- 现状：设置项 + 磁盘用量；管理密码；日志表；未确认操作表在页面底部。
- 缺口：日志无 level/时间筛选（API 支持）→ **Q14**；未确认操作位置 → **Q15**。

## 8. 决策清单（待用户确认，均附推荐）

| 编号 | 问题 | 推荐 |
| --- | --- | --- |
| Q1 | 试卷列表是否加搜索框与上/下架筛选 | 加（`q` + `published`） |
| Q2 | 重复导入的提示与处理 | 中文文案区分"已存在（同摘要）"与"冲突（同 ID 不同摘要）"，不提供覆盖 |
| Q3 | 作答筛选是否补试卷、设备、时间范围 | 补试卷 + 完成时间范围（`examId`、`from`/`before`） |
| Q4 | 作答详情是否显示试卷名/摘要/大小 | 显示 |
| Q5 | 设备筛选是否补关键字与版本异常 | 补 `q` 与 `versionMismatch` |
| Q6 | 开启入网后是否自动下载入网文件 | 不自动，保留下载按钮 |
| Q7 | 连接页是否记住上次服务 | 记住并预填，不自动连接 |
| Q8 | 远程连接时服务设置页是否提示本机操作 | 显示提示条 + 本机服务入口 |
| Q9 | 部署测试是否隐藏套件下拉 | 隐藏，仅内置套件 + 用例勾选 |
| Q10 | 试卷导入是否显示两阶段进度 | 首版仅忙态 + 阶段文案；进度条等宿主事件 |
| Q11 | 历史清理创建是否加机房筛选 | 加 |
| Q12 | 备份创建前是否预检阻塞 | 是，展示阻塞原因 |
| Q13 | 退出维护阻塞项是否可读化并定位 | 可读名称 + 跳转对应子页 |
| Q14 | 日志是否加级别与时间筛选 | 加级别 + 时间范围 |
| Q15 | 未确认操作放在哪里 | 服务设置页置顶，带数量徽标 |

## 9. 用户需补充的输入

- 计划改动的"操作逻辑"清单（若不提供，按上表推荐实现）。
- 是否有设计文档未覆盖、但确认要做的功能或删减。
