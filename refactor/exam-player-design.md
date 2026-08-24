# 考试播放器设计

## 定位

考试播放器是一个纯前端 React 组件。它从一个兼容 HTTP GET 语义的考试根地址加载并验证 ExamPackage，播放完整考试流程，最后产出作答结果。除最终作答归档的保存或上传外，播放器不依赖 Electron、IPC、应用全局状态或本地文件路径。

播放器使用 CSS Modules 隔离样式，不依赖软件主体的全局样式或 UI 组件。

## 一、挂载方式

组件作为 fixed 覆盖层挂载：

- `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999`
- 挂载即独占视口，原有界面被完全覆盖。
- 组件卸载后恢复原有界面。

```tsx
<ExamPlayer
  examBaseUrl="https://example.test/exams/exam-id/"
  allowExit={true}
  onFinish={(archive) => { /* 交给宿主保存或上传 */ }}
  onExit={() => { /* 卸载播放器 */ }}
/>
```

`examBaseUrl` 必须是可以通过 Fetch API 使用 GET 请求读取的目录 URL，并以 `/` 结尾。它可以是 HTTP(S) URL，也可以是实现了相同 GET 语义的自定义协议 URL。跨源 HTTP(S) 地址必须由服务器提供允许当前页面读取的 CORS 响应头。

## 二、CSS 隔离

- 组件内样式全部写在 `.module.css` 文件中。
- 组件根节点显式重置字体、盒模型、边距等关键属性。
- 组件内部不使用 `body`、`div`、`*` 等全局选择器。
- 不依赖主体应用的主题变量和 UI 组件。

## 三、统一缩放与状态栏

- 播放器设计基准尺寸为 `1200 x 880`。
- 页面模板自身的设计尺寸也是 `1200 x 800`。
- 考试页面保持完整的 `1200 x 800` 设计尺寸显示。
- 底部另设 `80px` 高的状态栏；页面内容不被状态栏覆盖，也不改变纵横比。
- 播放器整体通过 `min(viewportWidth / 1200, viewportHeight / 880)` 等比缩放至视口。
- 不使用响应式断点改变布局；多余空间使用黑色背景填充。

## 四、加载与完整性预检

播放器挂载后自行加载考试包，不要求宿主预先传入 ExamPackage：

```text
GET <examBaseUrl>manifest.json
```

进入考生信息页面前必须完成以下检查：

1. GET 并解析 `manifest.json`。
2. 校验 ExamPackage 的格式版本、播放器数据、答案捕获计划、SubmissionTemplate、索引和资源引用。
3. 拒绝绝对资源路径、路径穿越、清单外资源键以及解析后逃逸出 `examBaseUrl` 的 URL。
4. 对 `examData.resources` 中的每个资源执行 GET，确认服务器能够成功返回资源。
5. 将已取得的资源保存在本次播放器实例的内存缓存中，后续图片和时间线音频不再依赖未验证的远端请求。

这里使用 GET 而不是 HEAD，避免要求静态服务器额外实现 HEAD，并保证预检与实际读取使用相同协议语义。

任一检查失败时：

- 不进入考生信息、麦克风测试或正式考试流程。
- 播放器直接显示不可继续的错误页面。
- 错误页面可以重新执行完整加载与预检。
- 如果宿主提供错误通知回调，同时把错误报告给宿主。

## 五、静态考试包

ExamPackage 的规范内容是一个可以直接部署的静态目录：

```text
<exam-root>/
├── manifest.json
└── resources/
    └── <assetKey>/
        └── <filename>
```

ZIP 只是该目录的传输形式。清单中的 `packagePath` 只保存相对于 `<exam-root>/` 的安全路径，不保存作者机器路径或固定部署地址。

运行时通过 `manifest.json` 把 `resource:<assetKey>` 解析为清单资源。播放器只访问清单内资源，不把资源复制到应用全局目录，也不依赖考试根目录之外的文件。

## 六、编译期 TTS 与时间线

播放器不执行 TTS。Template 中的 `play` 时间线动作仍由作者填写文本，但 Template 编译阶段必须：

1. 解析最终文本。
2. 调用选定的 TTS 服务生成音频。
3. 将音频写入 ExamPackage 的资源区域和资源清单。
4. 把 PlayerExamData 中的 `play` 动作编译为对该音频资源的引用。

每次生成一份 ExamPackage 时，用户选择本次生成使用的语音 Provider、Model 和 Voice。该选择对本次生成中的全部 `play` 动作生效，不写入 Template 文档；以后再次从同一 Template 生成试卷时可以选择不同配置。Template 编译器通过编译上下文取得一个已经绑定本次选择的语音合成函数，不直接依赖 AIRouter 或 Electron IPC。

如果 Template 展开后没有任何 `play` 动作，本次生成不要求选择或配置 TTS，也不调用语音合成服务。只有实际遇到 `play` 动作但编译上下文没有合成器时，编译器才返回缺少语音合成器错误。

Template 编辑器提供“生成试卷”入口。生成对话框负责选择本次编译使用的 Interface 实例及 TTS Provider、Model 和 Voice，然后执行编译、收集静态资源和 TTS 音频并导出完整 ExamPackage。

播放器收到的运行期动作应为：

```ts
type ResolvedTimelineAction =
  | { type: 'play'; src: string }
  | { type: 'countdown'; seconds: number }
  | { type: 'record'; duration: number; recordIndex: number }
```

其中 `play.src` 必须是 `resource:<assetKey>`。播放器从预检完成的内存资源缓存中播放该音频，并在播放结束后推进到下一时间线动作。

展开后的考试必须至少包含一个页面，并且每个页面必须至少包含一个时间线动作。Template 编译和 ExamPackage 校验必须拒绝零页面；Template 验证或编译必须拒绝空时间线。播放器不为缺失页面或时间线的试卷提供手动“下一页”兜底。

## 七、播放器内容

当前 PlayerExamData 契约只支持以下内容块：

- `text`
- `image`
- `choice-view`

播放器不实现旧版的 `video`、独立 `audio` 或 `quad-image` 内容节点。音频播放只通过时间线中的 `play` 动作发生。

页面按声明顺序执行，页面内时间线也按声明顺序执行。当前时间线动作的 `choiceViewOverrides` 覆盖对应选择题视图的默认 viewport；该动作结束后再应用下一动作的 override。

## 八、考生与麦克风流程

内部状态流转：

```text
加载并预检
  -> 考生信息
  -> 麦克风测试（仅有录音动作时）
  -> 正式考试
  -> 完成
```

- 考生姓名和考生号去除首尾空白后必须非空，不限制为六位数字。
- 没有录音动作的考试跳过麦克风测试。
- 有录音动作时，考生必须选择设备、完成试录、回放并确认后才能开始考试。
- `record.duration` 必须严格大于零；作者态字面量、编译后的静态值和 ExamPackage 都执行该约束。
- 正式录音按 `record.duration` 自动开始和结束。
- 录音失败时暂停流程并显示重试或退出选择，不得静默跳过必需录音。
- 录音开始和结束提示音通过可选 URL 由宿主提供；播放器不硬编码 Electron 的 `app-resource://` 地址。

## 九、作答归档

播放器按 `answerCapturePlan` 填充字符串和音频答案，复制 `submissionTemplate`，并补充：

- `submissionId`
- 考生身份
- `startedAt`
- `submittedAt`

播放器使用预检阶段已经取得的静态资源和本次考试产生的录音，生成完整、可独立批改的 `.lssubmission` 归档。归档内容为：

```text
manifest.json
resources/<assetKey>/<filename>
recordings/<resourceKey>/<filename>
```

播放器完成后返回一个包含该归档的 `Blob`。Blob 的 MIME 类型为 `application/x-ls101-submission`。宿主不再负责补齐静态资源或编码 ZIP，只负责决定将 Blob 下载、写入 Electron 本地收卷库还是上传到 HTTP 服务。

播放器不执行 Schema 解析或批改。

## 十、宿主通知接口

以下名称描述 React 组件通知宿主的事件，不表示直接关闭浏览器窗口或执行 IPC：

- `onFinish(archive)`：考试正常完成并成功生成完整作答归档 Blob 后调用一次。宿主收到 Blob 后负责保存、下载或上传。
- `onExit()`：考生请求中途退出时调用。宿主决定是否卸载播放器或返回其他界面。
- `onError(error)`：加载、媒体或组包发生错误时通知宿主，供日志或外围 UI 使用。错误页面和重试仍由播放器自身负责。

- `allowExit`：控制是否允许考生主动退出，默认值为 `true`。为 `true` 时，正式考试的状态栏显示退出按钮；点击后必须二次确认，再调用 `onExit()`。为 `false` 时隐藏主动退出入口，供未来专用考试终端使用。
- `onFinish` 允许返回 Promise；Promise 完成前播放器保持“正在提交”状态，失败时显示可重试的提交错误。

## 十一、实现边界

本次实现包括：

- 核心 PlayerExamData、ExamPackage 和编译契约调整。
- Template 编译期 TTS 音频生成和空时间线校验。
- Template 编辑器中的生成试卷入口、配置选择和导出。
- `@ls101/exam-player` 完整播放器及自动化测试。
- 主应用本地考试库，支持导入、删除和从列表开始考试。
- 本地 `.lsexam` 到 Player HTTP GET 协议的只读适配，以及完成后的作答包保存。

本次不实现作答包自动写入收卷库和评分流程。当前宿主在 `onFinish` 收到 Blob 后打开文件保存对话框；后续可在不修改 Player 的前提下增加本地收卷或上传策略。
