import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { ExamPackage } from '@ls101/core-types'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { launchIntegrationApp } from './support/electron-app'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

async function expectValidStyleBindings(currentPage: Page): Promise<void> {
  const invalidBindings = await currentPage.locator('body').evaluate(() => {
    const definedModuleClasses = new Set<string>()

    const collectRules = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          for (const match of rule.selectorText.matchAll(/\.(_[A-Za-z_][\w-]*)/g)) {
            definedModuleClasses.add(match[1])
          }
        }
        if ('cssRules' in rule) {
          try {
            collectRules((rule as CSSGroupingRule).cssRules)
          } catch {
            // Ignore browser-managed rules that do not expose their children.
          }
        }
      }
    }

    for (const stylesheet of document.styleSheets) {
      try {
        collectRules(stylesheet.cssRules)
      } catch {
        // Cross-origin stylesheets are opaque; packaged renderer styles are same-origin.
      }
    }

    const problems: string[] = []
    for (const element of document.querySelectorAll<HTMLElement>('[class]')) {
      const className = element.getAttribute('class') ?? ''
      if (
        /=>|\bfunction\b|\[object Object\]|\b(?:undefined|null)\b|\$\{|styles[$.]/.test(className)
      ) {
        problems.push(`${element.tagName.toLowerCase()}: suspicious class="${className}"`)
      }

      for (const moduleClass of element.classList) {
        if (moduleClass.startsWith('_') && !definedModuleClasses.has(moduleClass)) {
          problems.push(`${element.tagName.toLowerCase()}: missing CSS rule for .${moduleClass}`)
        }
      }
    }

    return problems
  })

  expect(invalidBindings).toEqual([])
}

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-integration-'))
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

test('starts a hardened application window and exposes every preload bridge', async () => {
  const windowState = await electronApp.evaluate(({ BrowserWindow, Menu, app }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const preferences = window.webContents.getLastWebPreferences()
    return {
      appName: app.getName(),
      isPackaged: app.isPackaged,
      applicationMenuRemoved: Menu.getApplicationMenu() === null,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
      sandbox: preferences.sandbox,
      title: window.getTitle(),
      userDataPath: app.getPath('userData'),
      visible: window.isVisible()
    }
  })

  expect(windowState).toMatchObject({
    appName: 'cyez-ls101',
    applicationMenuRemoved: true,
    contextIsolation: true,
    isPackaged: true,
    nodeIntegration: false,
    sandbox: true,
    title: '曹二听说101',
    visible: true
  })
  expect(path.resolve(windowState.userDataPath)).toBe(path.resolve(userDataDir))

  const rendererState = await page.evaluate(() => {
    const runtimeWindow = window as unknown as Record<string, unknown>
    const methods = (name: string): string[] => Object.keys(runtimeWindow[name] as object).sort()
    return {
      airouter: methods('airouter'),
      appInfo: methods('appInfo'),
      configStore: methods('configStore'),
      dataDirectory: methods('dataDirectory'),
      fileDialog: methods('fileDialog'),
      fileStore: methods('fileStore'),
      imageClipboard: methods('imageClipboard'),
      nodeProcess: typeof runtimeWindow.process,
      nodeRequire: typeof runtimeWindow.require,
      windowControls: methods('windowControls')
    }
  })

  expect(rendererState).toEqual({
    airouter: [
      'deleteImageProviderConfig',
      'deletePronunciationAssessmentExtension',
      'deleteProviderConfig',
      'deleteSpeechModelPackage',
      'deleteSpeechProviderConfig',
      'deleteSpeechRecognitionModelPackage',
      'deleteSpeechRecognitionProviderConfig',
      'getPronunciationAssessmentExtensionStatus',
      'importPronunciationAssessmentExtension',
      'importSpeechModelPackage',
      'importSpeechRecognitionModelPackage',
      'listImageModels',
      'listImageProviderConfigs',
      'listModels',
      'listPronunciationAssessmentModels',
      'listProviderConfigs',
      'listSpeechModelPackages',
      'listSpeechModels',
      'listSpeechProviderConfigs',
      'listSpeechRecognitionModelPackages',
      'listSpeechRecognitionModels',
      'listSpeechRecognitionProviderConfigs',
      'listSpeechRecognitionProviderModels',
      'listSpeechVoices',
      'probeQwenTtsCuda',
      'readImageProviderApiKey',
      'readProviderApiKey',
      'readSpeechProviderApiKey',
      'readSpeechRecognitionProviderApiKey',
      'saveImageProviderConfig',
      'saveProviderConfig',
      'saveSpeechProviderConfig',
      'saveSpeechRecognitionProviderConfig',
      'startImageGeneration',
      'startPronunciationAssessment',
      'startSpeechRecognition',
      'startSpeechSynthesis',
      'startTextGeneration',
      'testConnection',
      'testImageConnection',
      'testSpeechConnection'
    ],
    appInfo: ['getVersion'],
    configStore: ['invoke'],
    dataDirectory: [
      'choose',
      'chooseDefault',
      'deleteOld',
      'getInfo',
      'migrate',
      'resetDefault',
      'useExisting'
    ],
    fileDialog: ['read', 'write'],
    fileStore: ['invoke'],
    imageClipboard: ['readImage', 'writeText'],
    nodeProcess: 'undefined',
    nodeRequire: 'undefined',
    windowControls: ['close', 'getMaximized', 'minimize', 'onMaximizedChange', 'toggleMaximize']
  })
})

test('round-trips data through file, config, asset protocol, AI and clipboard IPC', async () => {
  const originalClipboard = await electronApp.evaluate(({ clipboard }) => clipboard.readText())

  try {
    const result = await page.evaluate(async () => {
      const runtimeWindow = window as unknown as {
        airouter: {
          listImageProviderConfigs(): Promise<unknown[]>
          listProviderConfigs(): Promise<unknown[]>
          listSpeechRecognitionModels(): Promise<unknown[]>
        }
        configStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        imageClipboard: {
          readImage(): Promise<Uint8Array | null>
          writeText(text: string): Promise<void>
        }
        windowControls: { getMaximized(): Promise<boolean> }
      }
      const location = { scope: ['integration', 'round-trip'], filename: 'state.json' }
      const assetLocation = {
        scope: ['integration', 'round-trip'],
        filename: 'sample.bin'
      }
      const configLocation = { scope: ['integration'], key: 'settings' }

      await runtimeWindow.fileStore.invoke(
        'file:write-text',
        location,
        JSON.stringify({ ready: true })
      )
      const text = await runtimeWindow.fileStore.invoke('file:read-text', location)
      const hasText = await runtimeWindow.fileStore.invoke('file:has-text', location)
      const files = await runtimeWindow.fileStore.invoke('file:list-text', location.scope)
      const swapped = await runtimeWindow.fileStore.invoke(
        'file:compare-and-swap-text',
        location,
        text,
        JSON.stringify({ ready: false })
      )

      await runtimeWindow.fileStore.invoke(
        'file:write-asset',
        assetLocation,
        new Uint8Array([10, 20, 30, 40])
      )

      await runtimeWindow.configStore.invoke('config:write', configLocation, {
        enabled: true,
        count: 2
      })
      const config = await runtimeWindow.configStore.invoke('config:read', configLocation)

      let unsupportedChannelError = ''
      try {
        await runtimeWindow.fileStore.invoke('file:not-allowed')
      } catch (error) {
        unsupportedChannelError = error instanceof Error ? error.message : String(error)
      }

      await runtimeWindow.imageClipboard.writeText('LS101 integration test')
      const clipboardImage = await runtimeWindow.imageClipboard.readImage()

      return {
        clipboardImage,
        config,
        files,
        hasText,
        imageProviders: await runtimeWindow.airouter.listImageProviderConfigs(),
        maximized: await runtimeWindow.windowControls.getMaximized(),
        providers: await runtimeWindow.airouter.listProviderConfigs(),
        recognitionModels: await runtimeWindow.airouter.listSpeechRecognitionModels(),
        swapped,
        text,
        unsupportedChannelError
      }
    })

    const assetResponse = await electronApp.evaluate(async ({ net }) => {
      const response = await net.fetch('asset://local/integration/round-trip/sample.bin')
      return {
        bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        status: response.status
      }
    })

    expect(result).toMatchObject({
      clipboardImage: null,
      config: { enabled: true, count: 2 },
      files: ['state.json'],
      hasText: true,
      imageProviders: [
        {
          baseUrl: '',
          hasApiKey: false,
          id: 'manual',
          models: [],
          name: '手动生成',
          type: 'manual'
        }
      ],
      maximized: false,
      providers: [],
      recognitionModels: [],
      swapped: true,
      text: '{"ready":true}'
    })
    expect(assetResponse).toEqual({ bytes: [10, 20, 30, 40], status: 200 })
    expect(result.unsupportedChannelError).toContain('Unsupported file-store channel')
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('LS101 integration test')
  } finally {
    await electronApp.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      originalClipboard
    )
  }
})

test('navigates through every primary application area', async () => {
  await expectValidStyleBindings(page)

  await page.getByRole('link', { name: '题型库' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '题型库' })).toBeVisible()
  await expect(page.getByText('正在加载题型...')).toBeHidden()
  await expectValidStyleBindings(page)

  await page.getByRole('link', { name: '试卷库' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '试卷库' })).toBeVisible()
  await expect(page.getByText('正在加载考试库...')).toBeHidden()
  await expect(page.getByText('暂无试卷')).toBeVisible()
  await expectValidStyleBindings(page)

  await page.getByRole('link', { name: '试卷模板' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '试卷模板' })).toBeVisible()
  await expect(page.getByText('正在加载模板...')).toBeHidden()
  await expect(page.getByRole('tab', { name: '内置模板' })).toHaveAttribute('aria-selected', 'true')
  await expectValidStyleBindings(page)

  await page.getByRole('link', { name: '评分单元' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '评分单元' })).toBeVisible()
  await expect(page.getByText('正在加载 Schema...')).toBeHidden()
  for (const name of [
    '上海高考 - 朗读句子',
    '上海高考 - 朗读短文',
    '上海高考 - 情景提问',
    '上海高考 - 看图说话',
    '上海高考 - 快速应答',
    '上海高考 - 听短文回答事实题',
    '上海高考 - 听短文回答观点题',
    '上海中考 - 朗读词组',
    '上海中考 - 朗读句子',
    '上海中考 - 交际应答',
    '上海中考 - 复述',
    '上海中考 - 话题表达'
  ]) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }
  await expect(page.getByRole('tab', { name: '内置评分单元' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page.getByText('内置', { exact: true })).toHaveCount(14)
  await expect(page.getByRole('button', { name: '删除评分单元' })).toHaveCount(0)
  await expectValidStyleBindings(page)

  await page.getByRole('link', { name: '设置' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
  await expect(page.getByRole('button', { name: /外观/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /AI 引擎/ })).toBeVisible()
  await expectValidStyleBindings(page)
  await page.getByRole('button', { name: /关于/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: '关于' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '曹二听说101' })).toBeVisible()
  await expect(page.getByText(/^版本 \S+/)).toBeVisible()
  await expectValidStyleBindings(page)

  await page.getByRole('link', { name: '工作台' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
  await page.getByRole('button', { name: '收起侧边栏' }).click()

  const sidebar = page.getByRole('navigation', { name: '主导航' }).locator('..')
  const workbenchLink = page.getByRole('link', { name: '工作台' })
  await expect(sidebar).toHaveCSS('width', '68px')
  await expect(workbenchLink).toHaveCSS('width', '42px')
  await expect(workbenchLink).toHaveCSS('justify-content', 'center')
  await expect(workbenchLink.locator('span')).toBeHidden()
  await expectValidStyleBindings(page)
})

test('exports a submission containing a large resource through the renderer ZIP worker', async () => {
  const examPath = path.join(userDataDir, 'large-resource.lsexam')
  const submissionPath = path.join(userDataDir, 'large-resource.lssubmission')
  const resource = new Uint8Array(200_000)
  for (let offset = 0; offset < resource.length; offset += 65_536) {
    crypto.getRandomValues(resource.subarray(offset, offset + 65_536))
  }
  const manifest = largeResourceExamManifest()
  const examBytes = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'resources/attachment/data.bin': resource
  })
  await writeFile(examPath, examBytes)

  await page.getByRole('link', { name: '试卷库' }).click()
  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [filePath] })
    })
  }, examPath)
  await page.getByRole('button', { name: '导入试卷包' }).click()
  await page.getByRole('button', { name: '开始考试' }).click()
  await page.getByLabel('姓名').fill('测试考生')
  await page.getByLabel('考生号').fill('worker-001')

  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath })
    })
  }, submissionPath)
  await page.getByRole('button', { name: '继续' }).click()

  await expect(page.getByRole('heading', { name: '考试完成' })).toBeVisible()
  const submission = unzipSync(await readFile(submissionPath))
  expect(submission['resources/attachment/data.bin']).toEqual(resource)
  expect(JSON.parse(Buffer.from(submission['manifest.json']).toString('utf8'))).toMatchObject({
    format: 'ls101-submission',
    meta: { candidate: { candidateId: 'worker-001', displayName: '测试考生' } }
  })
})

test('guides microphone setup through recording and playback before the exam', async () => {
  const examPath = path.join(userDataDir, 'microphone-check.lsexam')
  const manifest = microphoneCheckExamManifest()
  await writeFile(examPath, zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }))

  await page.getByRole('link', { name: '试卷库' }).click()
  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [filePath] })
    })
  }, examPath)
  await page.getByRole('button', { name: '导入试卷包' }).click()

  await page.evaluate(() => {
    const track = { stop: () => undefined }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [
          {
            deviceId: 'integration-mic',
            groupId: 'integration-group',
            kind: 'audioinput',
            label: '集成测试麦克风',
            toJSON: () => ({})
          }
        ],
        getUserMedia: async () => ({ getTracks: () => [track] })
      }
    })

    class IntegrationMediaRecorder {
      mimeType = 'audio/webm'
      state: RecordingState = 'inactive'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null

      start(): void {
        this.state = 'recording'
      }

      stop(): void {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['integration recording']) } as BlobEvent)
        this.onstop?.()
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: IntegrationMediaRecorder
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: function play(this: HTMLMediaElement): Promise<void> {
        this.dispatchEvent(new Event('play'))
        window.setTimeout(() => this.dispatchEvent(new Event('ended')), 20)
        return Promise.resolve()
      }
    })
  })

  await page.getByRole('button', { name: '开始考试' }).click()
  await page.getByLabel('姓名').fill('麦克风测试考生')
  await page.getByLabel('考生号').fill('mic-001')
  await page.getByRole('button', { name: '继续' }).click()

  await expect(page.getByRole('heading', { name: '麦克风测试' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '录音设备' })).toHaveValue('integration-mic')
  await expect(page.getByText('准备试录')).toBeVisible()
  await expect(page.getByRole('button', { name: '声音正常，开始考试' })).toHaveCount(0)

  const panelBox = await page
    .getByRole('heading', { name: '麦克风测试' })
    .locator('xpath=ancestor::section')
    .boundingBox()
  const viewport = await page.evaluate(() => ({
    height: window.innerHeight,
    width: window.innerWidth
  }))
  expect(panelBox).not.toBeNull()
  expect(panelBox?.x).toBeGreaterThanOrEqual(0)
  expect(panelBox?.y).toBeGreaterThanOrEqual(0)
  expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height)

  await page.getByRole('button', { name: '开始试录' }).click()
  await expect(page.getByText('正在录音')).toBeVisible()
  await expect(page.getByText('试录完成')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: '声音正常，开始考试' })).toHaveCount(0)
  await page.getByRole('button', { name: '播放试录' }).click()
  await expect(page.getByText('回放完成')).toBeVisible()
  await expect(page.getByRole('button', { name: '声音正常，开始考试' })).toBeEnabled()

  await page.getByRole('button', { name: '退出' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '试卷库' })).toBeVisible()
})

test('persists appearance settings through the renderer and config store', async () => {
  await page.getByRole('link', { name: '设置' }).click()
  await page.getByRole('button', { name: /外观/ }).click()

  const theme = page.getByRole('combobox', { name: '界面主题' })
  const reduceMotion = page.getByRole('switch', { name: '减少动态效果' })
  const readStoredSettings = (): Promise<unknown> =>
    page.evaluate(() =>
      window.configStore.invoke('config:read', { scope: ['appearance'], key: 'settings' })
    )

  await expect(theme).toBeEnabled()
  await expect(theme).toHaveValue('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await theme.selectOption('dark')
  await expect.poll(readStoredSettings).toEqual({
    version: 1,
    settings: { theme: 'dark', reduceMotion: false }
  })
  await expect(reduceMotion).toBeEnabled()
  await reduceMotion.locator('..').click()

  await expect(reduceMotion).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '')
  await expect.poll(readStoredSettings).toEqual({
    version: 1,
    settings: { theme: 'dark', reduceMotion: true }
  })

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('link', { name: '设置' }).click()
  await page.getByRole('button', { name: /外观/ }).click()
  await expect(page.getByRole('combobox', { name: '界面主题' })).toHaveValue('dark')
  await expect(page.getByRole('switch', { name: '减少动态效果' })).toBeChecked()
})

test('creates, edits and reloads a persisted template', async () => {
  await page.getByRole('link', { name: '试卷模板' }).click()
  await expect(page.getByText('正在加载模板...')).toBeHidden()
  await page.getByRole('button', { name: '新建模板' }).click()

  const nameInput = page.getByRole('textbox', { name: '名称', exact: true })
  await expect(nameInput).toHaveValue('未命名模板')
  await nameInput.fill('集成测试模板')
  await page.getByRole('textbox', { name: '描述' }).fill('由 Electron 集成测试创建')

  const templateExportPath = path.join(userDataDir, 'export.lstemplate')
  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath })
    })
  }, templateExportPath)
  await page.getByRole('button', { name: '导出模板', exact: true }).click()
  await expect(page.getByText('模板已导出')).toBeVisible()
  const exportedTemplate = JSON.parse(await readFile(templateExportPath, 'utf8'))
  expect(exportedTemplate).toMatchObject({
    revision: 1,
    content: {
      name: '集成测试模板',
      description: '由 Electron 集成测试创建'
    },
    resources: { functions: [] }
  })

  await expect(
    page.getByRole('button', { name: '高中基础题型，版本 3', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '高中大题组，版本 4', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加听短文回答题组' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '初中基础题型，版本 1', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '初中大题组，版本 1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加话题表达题组' })).toBeVisible()

  const createLibrary = page.getByRole('button', { name: '新建本地函数库' })
  await expect(createLibrary).toBeEnabled()
  await createLibrary.click()
  await expect(page.getByRole('tab', { name: '本地函数库' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(
    page.getByRole('button', { name: '未命名函数库，未导出', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '重命名本地函数库“未命名函数库”' }).click()
  const libraryName = page.getByRole('textbox', { name: '函数库“未命名函数库”名称' })
  await libraryName.fill('集成测试函数库')
  await libraryName.press('Enter')
  await expect(
    page.getByRole('button', { name: '集成测试函数库，未导出', exact: true })
  ).toBeVisible()

  await page.getByRole('button', { name: '在“集成测试函数库”中新建函数' }).click()
  await expect(page.getByRole('button', { name: '添加未命名函数' })).toBeVisible()
  await page.getByRole('button', { name: '编辑未命名函数' }).click()

  const functionName = page.getByRole('textbox', { name: '函数名称' })
  await expect(functionName).toHaveValue('未命名函数')
  await functionName.fill('集成测试函数')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText(/Revision 0$/)).toBeVisible()
  await page.getByRole('button', { name: '返回模板编辑' }).click()

  await page.getByRole('tab', { name: '本地函数库' }).click()
  await expect(page.getByRole('button', { name: '添加集成测试函数' })).toBeVisible()
  await page.getByRole('button', { name: '删除本地函数库“集成测试函数库”' }).click()
  const deleteLibraryDialog = page.getByRole('alertdialog', {
    name: '删除本地函数库“集成测试函数库”？'
  })
  await deleteLibraryDialog.getByRole('button', { name: '删除' }).click()
  await expect(
    page.getByRole('button', { name: '集成测试函数库，未导出', exact: true })
  ).toHaveCount(0)

  await expect(page.getByText('Revision 1')).toBeVisible()

  await page.getByRole('button', { name: '返回模板' }).click()
  await page.getByRole('tab', { name: '我的模板' }).click()
  await expect(page.getByRole('button', { name: '集成测试模板', exact: true })).toBeVisible()

  await page.reload()
  await page.getByRole('link', { name: '试卷模板' }).click()
  await page.getByRole('tab', { name: '我的模板' }).click()
  await expect(page.getByRole('button', { name: '集成测试模板', exact: true })).toBeVisible()
  await expect(page.getByText('由 Electron 集成测试创建')).toBeVisible()

  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [filePath], bookmarks: [] })
    })
  }, templateExportPath)
  await page.getByRole('button', { name: '导入模板' }).click()
  await expect(page.getByText('模板“集成测试模板”已存在')).toBeVisible()
  await expect(page.getByRole('button', { name: '集成测试模板', exact: true })).toHaveCount(1)

  const conflictingTemplate = {
    ...exportedTemplate,
    revision: 9,
    content: {
      ...exportedTemplate.content,
      name: '集成测试模板副本',
      description: '来自冲突文件的副本'
    }
  }
  await writeFile(templateExportPath, `${JSON.stringify(conflictingTemplate, null, 2)}\n`)
  await page.getByRole('button', { name: '导入模板' }).click()
  const importConflictDialog = page.getByRole('alertdialog', {
    name: '模板“集成测试模板副本”已存在'
  })
  await expect(importConflictDialog).toBeVisible()
  await importConflictDialog.getByRole('button', { name: '导入为副本' }).click()
  await expect(page.getByText('已将模板“集成测试模板副本”导入为副本')).toBeVisible()
  await expect(page.getByRole('button', { name: '集成测试模板副本', exact: true })).toBeVisible()

  const storedTemplates = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
      }
    ).fileStore
    const scope = ['template-editor', 'templates']
    const ids = (await bridge.invoke('file:list-scopes', scope)) as string[]
    return Promise.all(
      ids.map(async (templateId) => {
        const value = (await bridge.invoke('file:read-text', {
          scope: [...scope, templateId],
          filename: 'template.json'
        })) as string
        return JSON.parse(value)
      })
    )
  })
  expect(storedTemplates).toHaveLength(2)
  expect(storedTemplates).toContainEqual(
    expect.objectContaining({ templateId: exportedTemplate.templateId })
  )
  expect(storedTemplates).toContainEqual(
    expect.objectContaining({
      templateId: expect.not.stringMatching(exportedTemplate.templateId),
      revision: 0,
      content: expect.objectContaining({ name: '集成测试模板副本' })
    })
  )
})

test('opens and copies bundled Shanghai speaking templates', async () => {
  await page.getByRole('link', { name: '试卷模板' }).click()
  await expect(page.getByText('正在加载模板...')).toBeHidden()
  await expect(page.getByRole('tab', { name: '内置模板' })).toHaveAttribute('aria-selected', 'true')
  const zhongkaoRow = page
    .getByText('上海中考口语标准题型', { exact: true })
    .locator('xpath=ancestor::article')
  await expect(zhongkaoRow.getByText('v1', { exact: true })).toBeVisible()
  await expect(zhongkaoRow.getByText('中考', { exact: true })).toBeVisible()

  const builtinRow = page
    .getByText('上海高考口语标准题型', { exact: true })
    .locator('xpath=ancestor::article')
  await expect(builtinRow.getByText('v3', { exact: true })).toBeVisible()
  await expect(builtinRow.getByRole('button', { name: '编辑' })).toHaveCount(0)
  await expect(builtinRow.getByRole('button', { name: /删除/ })).toHaveCount(0)
  await builtinRow.getByRole('button', { name: '查看' }).click()

  await expect(page.getByRole('heading', { level: 1, name: '上海高考口语标准题型' })).toBeVisible()
  await expect(page.getByText('内置模板 · 只读')).toBeVisible()
  await expect(page.getByRole('button', { name: '选择节点 root' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /删除/ })).toHaveCount(0)
  await page.getByRole('button', { name: '创建副本' }).click()

  await expect(page.getByText('Revision 0')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '名称', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '保存' })).toBeVisible()
  await page.getByRole('button', { name: '返回模板' }).click()

  await expect(page.getByRole('tab', { name: '内置模板' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('上海高考口语标准题型', { exact: true })).toBeVisible()
  await expect(page.getByText('上海中考口语标准题型', { exact: true })).toBeVisible()
})

test('exports a persisted formal Schema through the native save dialog', async () => {
  const schema = {
    formatVersion: 2,
    schemaId: '30000000-0000-4000-8000-000000000001',
    sourceDraftId: '20000000-0000-4000-8000-000000000001',
    structureHash: 'sha256:5a3b2576fd81a3253de1e46e7bb73eeadf7c3e34bcc4b04faaee4ba640df36e4',
    revision: 3,
    structure: {
      questionType: 'fixed-reading',
      answerFormat: [{ answerId: 'recording', type: 'fixed-speech' }],
      templateInputs: [
        { inputId: 'question-description', type: 'text', required: true },
        { inputId: 'reference-answer', type: 'text', required: true }
      ]
    },
    data: {
      name: '集成测试 Schema',
      description: '用于验证正式 Schema 导出',
      maxScore: 10,
      answerDescriptions: { recording: '学生朗读录音' },
      inputDescriptions: {},
      rubricMarkdown: '按准确度和流利度评分。',
      extraPromptMarkdown: ''
    }
  }
  await page.evaluate(async (value) => {
    await window.fileStore.invoke(
      'file:write-text',
      {
        scope: ['schema-editor', 'published', value.schemaId],
        filename: 'schema.json'
      },
      JSON.stringify(value)
    )
  }, schema)

  const exportPath = path.join(userDataDir, 'export.lsschema')
  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath })
    })
  }, exportPath)

  await page.getByRole('link', { name: '评分单元' }).click()
  await expect(page.getByText('正在加载 Schema...')).toBeHidden()
  await page.getByRole('tab', { name: '我的评分单元' }).click()
  await page.getByRole('button', { name: schema.data.name }).click()
  await page.getByRole('button', { name: '导出' }).click()

  await expect(page.getByText('Schema 已导出')).toBeVisible()
  expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(schema)
})

test('routes window controls through preload to the owning BrowserWindow', async () => {
  await expect(page.getByRole('button', { name: '最小化' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '最大化' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '关闭' })).toBeEnabled()

  await Promise.all([
    electronApp.waitForEvent('close'),
    page.getByRole('button', { name: '关闭' }).click()
  ])
})

function largeResourceExamManifest(): ExamPackage {
  const attachment = {
    filename: 'data.bin',
    packagePath: 'resources/attachment/data.bin',
    mediaType: 'application/octet-stream'
  }
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: '50000000-0000-4000-8000-000000000001',
    examData: {
      title: '大附件导出测试',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [{ id: 'text-1', type: 'text', x: 10, y: 10, text: '测试内容' }],
            timeline: [{ type: 'countdown', seconds: 0 }]
          }
        ],
        recordingIndices: []
      },
      resources: { attachment }
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: {
        examPackageId: '50000000-0000-4000-8000-000000000001',
        examTitle: '大附件导出测试'
      },
      schemaUses: [],
      resources: { attachment }
    }
  }
}

function microphoneCheckExamManifest(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: '50000000-0000-4000-8000-000000000002',
    examData: {
      title: '麦克风检查测试',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [{ id: 'text-1', type: 'text', x: 10, y: 10, text: '请朗读' }],
            timeline: [{ type: 'record', duration: 1, recordIndex: 0 }]
          }
        ],
        recordingIndices: [0]
      },
      resources: {}
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: {
        examPackageId: '50000000-0000-4000-8000-000000000002',
        examTitle: '麦克风检查测试'
      },
      schemaUses: [],
      resources: {}
    }
  }
}
