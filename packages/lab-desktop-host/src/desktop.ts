import { app, BrowserWindow, dialog, ipcMain, Menu, protocol } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { readFile, mkdir, copyFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { LicenseService } from '@ls101/license'
import { bindWindowControlEvents, registerWindowControlHandlers } from '@ls101/desktop-ui/main'
import { validateSchema, operationDefinitions, type Schema } from '@ls101/lab-contracts'
import { PinnedTransport, validateTarget, type TrustedTarget } from './transport'
import { StudentRecords } from './records'
import { BindingStore, machineDataRoot } from './binding'
import { ExamCache } from './cache'
import { exportFile, loadJson, saveFile, requireId } from './files'
import { parseCommand, type StartupCommand } from './commands'
import type { HostRequest, PracticeIntent, StudentRecord } from './shared'
import { checkStudentOperation } from './policy'
import { TeacherOperations, type TeacherOperation } from './teacher-operations'
import { TaskJournals } from './task-journals'
import type { TaskJournal } from './shared'
import type { LocalServiceConnection } from './local-service-types'
import { LocalRecovery } from './local-recovery'

export interface DesktopOptions {
  role: 'student' | 'teacher'
  preload: string
  renderer: string
  developmentUrl?: string
  releaseVersion: string
  frameless?: boolean
  localService?: { invoke(capability: string, input: unknown): Promise<unknown> }
}
interface SavedConnection extends TrustedTarget {
  id: string
  name: string
}

export function startLabDesktop(options: DesktopOptions): void {
  const originalData = app.getPath('userData')
  app.setName(`ls101-lab-${options.role}`)
  app.setPath('userData', `${originalData}-lab-${options.role}`)
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'ls101-exam',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  let window: BrowserWindow | null = null
  const pending: StartupCommand[] = []
  const completedCommands = new Set<string>()
  let foreground = 'idle',
    currentEpoch = 0,
    knownState: Schema<'StudentState'> | null = null
  let versionMismatch = false
  // The window is created hidden and shown on the first renderer paint; commands that arrive
  // earlier must not surface a half-painted window.
  let rendererReady = false
  const dispatch = (argv: string[], cwd: string): void => {
    try {
      const command = parseCommand(argv, cwd, randomUUID(), !app.isPackaged)
      if (command) {
        pending.push(command)
        window?.webContents.send('lab:event', { type: 'startup-command', value: command.id })
      }
      if (rendererReady) {
        window?.show()
        window?.focus()
      }
    } catch {
      window?.webContents.send('lab:event', { type: 'command-error', value: '启动参数无效' })
    }
  }
  const initialArgs = process.argv.slice(app.isPackaged ? 1 : 2)
  app.on('second-instance', (_event, argv, cwd) =>
    dispatch(argv.slice(app.isPackaged ? 1 : 2), cwd)
  )
  app.on('open-file', (event, path) => {
    event.preventDefault()
    dispatch([path], process.cwd())
  })
  app.on('window-all-closed', () => app.quit())
  void app
    .whenReady()
    .then(async () => {
      const configurationRoot = app.getPath('userData')
      const root =
        options.role === 'student' ? machineDataRoot(configurationRoot) : configurationRoot
      const localRecovery = new LocalRecovery(
        async () => {
          const selected = await dialog.showOpenDialog(window!, {
            title: '选择原始数据导出的保存位置',
            properties: ['openDirectory', 'createDirectory']
          })
          return selected.canceled ? null : selected.filePaths[0]
        },
        (operation, input) => options.localService!.invoke(operation, input)
      )
      await mkdir(root, { recursive: true, mode: 0o700 })
      const license = new LicenseService({ storagePath: join(configurationRoot, 'license.json') })
      const transport = new PinnedTransport(join(root, 'transfers'), options.releaseVersion)
      const records = new StudentRecords(root)
      const binding = new BindingStore(configurationRoot, transport)
      const cache = new ExamCache(join(root, 'exam-cache'))
      const testCache = new ExamCache(join(root, 'test-data', 'exam-cache'))
      const testRecords = new Map<string, StudentRecords>()
      const teacherOperations = new TeacherOperations(join(root, 'teacher-operations'))
      const taskJournals = new TaskJournals(join(root, 'tasks'))
      const taskLeases = new Map<
        string,
        { deadline: number; lease: Schema<'TaskLease'>; contextId: string }
      >()
      const requests = new Map<string, AbortController>()
      const invocations = new Set<Promise<unknown>>()
      let closingWindow = false
      let allowClose = false
      let askingClose = false
      const studentConnections = new Map<
        string,
        { contextId: string; state: Schema<'StudentState'> | null }
      >()
      let initializationError: string | null = null
      try {
        await transport.initialize()
        await records.initialize()
        if (options.role === 'student') await taskJournals.collect(join(root, 'test-data'))
      } catch {
        initializationError = '本地作答数据无法初始化，请联系管理员。'
      }
      protocol.handle('ls101-exam', (request) => {
        if (license.getStatusSync().state !== 'active') return new Response(null, { status: 403 })
        const response = cache.respond(request.url)
        return response.status === 404 ? testCache.respond(request.url) : response
      })
      Menu.setApplicationMenu(null)
      registerWindowControlHandlers()
      // Custom title bar is opt-in: an app enables it together with its own title bar, otherwise
      // the window would have no way to be moved.
      //
      // Windows uses the documented `titleBarStyle: 'hidden'` route: it removes the title bar but
      // keeps the native frame, drop shadow and mouse resizing. `frame: false` left a 35px native
      // caption on some Windows machines even though Electron reported the window as frameless.
      // Other platforms keep the plain frameless window.
      //
      // The window is created hidden and shown once the renderer is ready, like the main
      // application window, so Windows never paints default chrome for a window that is still
      // empty.
      const frameless = options.frameless === true
      const windowStyle: Electron.BrowserWindowConstructorOptions = !frameless
        ? {}
        : process.platform === 'win32'
          ? { titleBarStyle: 'hidden' }
          : { frame: false }
      console.info(
        `[lab] creating ${options.role} window (frameless=${frameless}, style=${JSON.stringify(windowStyle)})`
      )
      window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 760,
        minHeight: 560,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        title: options.role === 'student' ? '听说101 学生端' : '听说101 教师端',
        ...windowStyle,
        webPreferences: {
          preload: options.preload,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false
        }
      })
      bindWindowControlEvents(window)
      const contents = window.webContents
      contents.once('dom-ready', () => {
        rendererReady = true
        if (!window || window.isDestroyed()) return
        if (!window.isVisible()) window.show()
        // Measure after the window is on screen: an unrealized window can report a stale frame.
        setTimeout(() => window && reportWindowChrome(window, frameless), 1000)
      })
      window.on('close', (event) => {
        if (allowClose) return
        event.preventDefault()
        if (askingClose || closingWindow) return
        if (options.role === 'student' && foreground === 'saving') {
          contents.send('lab:event', {
            type: 'close-blocked',
            value: '正在保存作答，请在保存完成后关闭。'
          })
          return
        }
        askingClose = true
        void (async () => {
          try {
            if (
              options.role === 'student' &&
              ['preparing', 'practicing', 'testing', 'error'].includes(foreground)
            ) {
              const answer = await dialog.showMessageBox(window!, {
                type: 'warning',
                message: '退出当前活动？',
                detail: '尚未保存的当前作答将丢失。已保存的作答会保留。',
                buttons: ['继续当前活动', '退出'],
                defaultId: 0,
                cancelId: 0
              })
              if (answer.response !== 1) return
            }
            if (options.role === 'student' && foreground === 'saving') return
            closingWindow = true
            for (const request of requests.values()) request.abort()
            await Promise.allSettled([...invocations])
            allowClose = true
            window?.close()
          } finally {
            askingClose = false
          }
        })().catch(() => {
          closingWindow = false
        })
      })
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('will-navigate', (event) => event.preventDefault())
      contents.on('render-process-gone', () => {
        for (const request of requests.values()) request.abort()
        requests.clear()
      })
      contents.session.setPermissionRequestHandler((sender, permission, callback) => {
        callback(
          sender.id === contents.id &&
            permission === 'media' &&
            options.role === 'student' &&
            license.getStatusSync().state === 'active' &&
            ['preparing', 'practicing', 'testing'].includes(foreground)
        )
      })
      const active = (): void => {
        if (license.getStatusSync().state !== 'active') throw new Error('LICENSE_INACTIVE')
      }
      const mayExport = async (): Promise<void> => {
        active()
        const summary = await binding.summary()
        if (
          options.role === 'student' &&
          (!summary ||
            summary.maintenanceLocked ||
            summary.versionMismatch ||
            versionMismatch ||
            (knownState && !['ready'].includes(knownState.availability)))
        )
          throw new Error('当前状态不允许导出')
      }
      const invoke = async (
        capability: string,
        input: unknown,
        sender: number
      ): Promise<unknown> => {
        if (capability === 'license.status') return license.getStatus()
        if (capability === 'license.activate') {
          if (foreground !== 'idle') throw new Error('设备忙碌')
          return license.activate(input)
        }
        if (capability === 'startup.status')
          return {
            role: options.role,
            version: options.releaseVersion,
            computerName: hostname(),
            initializationError
          }
        if (capability === 'window.close') {
          window?.close()
          return null
        }
        if (capability === 'startup.commands') {
          const result: unknown[] = []
          for (const command of pending.splice(0)) {
            if (completedCommands.has(command.id)) continue
            completedCommands.add(command.id)
            try {
              if (license.getStatusSync().state !== 'active') {
                if (command.type !== 'activate') throw new Error('请先激活，再重新调用入网命令')
                result.push({
                  id: command.id,
                  type: command.type,
                  result: await license.activate(command.code)
                })
              } else {
                if (versionMismatch || initializationError || foreground !== 'idle')
                  throw new Error('当前状态拒绝部署命令')
                if (command.type === 'activate') throw new Error('软件已激活')
                if (options.role !== 'student') throw new Error('仅学生端可以入网')
                for (const request of requests.values()) request.abort()
                const summary = await binding.enroll(
                  await readFile(command.filename, 'utf8'),
                  command.fingerprint
                )
                currentEpoch = 0
                knownState = null
                versionMismatch = false
                result.push({ id: command.id, type: command.type, result: summary })
              }
            } catch (error) {
              result.push({
                id: command.id,
                type: command.type,
                error: error instanceof Error ? error.message : '命令失败'
              })
            }
          }
          await saveFile(join(root, 'last-command-results.json'), JSON.stringify(result))
          return result
        }
        if (capability === 'binding.enroll') {
          active()
          if (options.role !== 'student') throw new Error('仅学生端可以入网')
          if (versionMismatch || initializationError || foreground !== 'idle')
            throw new Error('当前状态拒绝入网')
          if (
            !input ||
            typeof input !== 'object' ||
            typeof (input as { file?: unknown }).file !== 'string' ||
            typeof (input as { fingerprint?: unknown }).fingerprint !== 'string'
          )
            throw new Error('入网文件和服务器公钥指纹均为必填项')
          for (const request of requests.values()) request.abort()
          const value = input as { file: string; fingerprint: string }
          const summary = await binding.enroll(value.file, value.fingerprint)
          currentEpoch = 0
          knownState = null
          versionMismatch = false
          return summary
        }
        const completingSave =
          options.role === 'student' &&
          ((['records.begin', 'records.chunk', 'records.finish'].includes(capability) &&
            foreground === 'saving') ||
            (capability === 'foreground.set' &&
              foreground !== 'idle' &&
              ['saving', 'idle', 'error'].includes(String(input))))
        if (!completingSave) active()
        if (initializationError) throw new Error(initializationError)
        if (
          options.role === 'student' &&
          capability.startsWith('connections.') &&
          capability !== 'connections.close'
        )
          throw new Error('Teacher connection required')
        if (
          options.role === 'teacher' &&
          /^(binding\.|records\.|practice\.|cache\.|tasks\.|tests\.|cleanup\.)/.test(capability)
        )
          throw new Error('Student capability required')
        if (capability.startsWith('localService.')) {
          if (options.role !== 'teacher' || !options.localService)
            throw new Error('本机服务能力不可用')
          if (capability === 'localService.export-data' || capability === 'localService.purge')
            return localRecovery.run(
              capability === 'localService.purge' ? 'purge' : 'export-data',
              input
            )
          if (capability === 'localService.selectBackup') {
            const chosen = await dialog.showOpenDialog(window!, {
              properties: ['openFile'],
              filters: [{ name: 'Lab backup', extensions: ['7z'] }]
            })
            return chosen.canceled ? null : chosen.filePaths[0]
          }
          const editOperation =
            capability === 'localService.updateSettings'
              ? 'patchTeacherSettings'
              : capability === 'localService.changePassword'
                ? 'putTeacherSecurityPassword'
                : null
          const result = await options.localService.invoke(
            editOperation ? 'connection' : capability.slice(13),
            editOperation ? undefined : input
          )
          if (capability !== 'localService.connection' && !editOperation) return result
          const target = result as LocalServiceConnection
          const url = new URL(target.baseUrl)
          if (
            url.protocol !== 'https:' ||
            url.hostname !== '127.0.0.1' ||
            url.username ||
            url.password ||
            typeof target.localProof !== 'string'
          )
            throw new Error('INVALID_LOCAL_CONNECTION')
          const connection = await transport.open(
            { baseUrl: target.baseUrl, serverId: target.serverId, fingerprint: target.fingerprint },
            'teacher'
          )
          try {
            await transport.authenticate(connection.connectionId, undefined, target.localProof)
            if (editOperation) {
              try {
                const response = await transport.request(connection.connectionId, editOperation, {
                  body: input
                })
                if (response.status !== 200)
                  throw new Error((response.body as Schema<'Error'>).error.code)
                return response.body
              } finally {
                await transport
                  .request(connection.connectionId, 'deleteTeacherSessionsCurrent', {})
                  .catch(() => undefined)
                await transport.close(connection.connectionId)
              }
            }
            currentEpoch = connection.epoch
            return connection
          } catch (error) {
            await transport.close(connection.connectionId)
            throw error
          }
        }
        if (capability === 'foreground.set') {
          if (
            typeof input !== 'string' ||
            !['idle', 'preparing', 'practicing', 'saving', 'testing', 'error'].includes(input)
          )
            throw new Error('Invalid phase')
          foreground = input
          return null
        }
        if (capability === 'window.maintenance') {
          window?.setFullScreen(input === true)
          return null
        }
        if (capability === 'binding.configured') return binding.configured()
        if (capability === 'binding.summary') return binding.summary()
        if (capability === 'binding.connect') {
          const contextIdInput = typeof input === 'string' ? input : undefined
          const origin = contextIdInput
            ? (await records.list()).find(
                (record) => record.originalBinding.contextId === contextIdInput
              )?.originalBinding
            : undefined
          if (contextIdInput && !origin) throw new Error('Unknown submission binding')
          const connected = await binding.connect(contextIdInput, origin?.serverId)
          const summary = await binding.summary()
          const contextId = connected.contextId
          studentConnections.set(connected.connectionId, { contextId, state: null })
          if (contextId === summary?.contextId) {
            currentEpoch = connected.epoch
            knownState = null
          }
          return connected
        }
        if (capability === 'binding.runtime') return binding.runtime()
        if (capability === 'binding.observe') {
          const value = input as { contextId: string; epoch: number; state: Schema<'StudentState'> }
          validateSchema('StudentState', value.state)
          if (value.epoch !== currentEpoch) throw new Error('Stale connection')
          const trusted = [...studentConnections.entries()].find(
            ([id, connection]) =>
              connection.contextId === value.contextId && transport.get(id).epoch === currentEpoch
          )?.[1].state
          if (!trusted || JSON.stringify(trusted) !== JSON.stringify(value.state))
            throw new Error('Untrusted admission state')
          const observed = await binding.observe(value.contextId, value.state)
          if (value.epoch !== currentEpoch) throw new Error('Stale connection')
          knownState = value.state
          versionMismatch = knownState.releaseVersion !== options.releaseVersion
          return observed
        }
        if (capability === 'connections.list')
          return (await loadJson<SavedConnection[]>(join(root, 'connections.json'))) ?? []
        if (capability === 'operations.list') {
          if (options.role !== 'teacher') throw new Error('Teacher capability required')
          return teacherOperations.list()
        }
        if (capability === 'connections.save') {
          if (options.role !== 'teacher') throw new Error('Teacher connection required')
          const target = input as SavedConnection
          const connections =
            (await loadJson<SavedConnection[]>(join(root, 'connections.json'))) ?? []
          requireId(target.id)
          validateTarget(target)
          if (
            typeof target.name !== 'string' ||
            !target.name.trim() ||
            target.name.length > 200 ||
            Object.keys(target).some(
              (key) => !['id', 'name', 'baseUrl', 'fingerprint', 'serverId'].includes(key)
            )
          )
            throw new Error('Invalid saved connection')
          if (target.serverId !== undefined) requireId(target.serverId)
          if (connections.filter((entry) => entry.id !== target.id).length >= 100)
            throw new Error('Saved connection limit reached')
          await saveFile(
            join(root, 'connections.json'),
            JSON.stringify([...connections.filter((entry) => entry.id !== target.id), target])
          )
          return null
        }
        if (capability === 'connections.open') {
          if (options.role !== 'teacher') throw new Error('Teacher connection required')
          const connected = await transport.open(input as TrustedTarget, 'teacher')
          currentEpoch = connected.epoch
          return connected
        }
        if (capability === 'connections.authenticate') {
          const value = input as { connectionId: string; password: string }
          if (
            typeof value.password !== 'string' ||
            Object.keys(value).some((key) => !['connectionId', 'password'].includes(key))
          )
            throw new Error('INVALID_REQUEST')
          await transport.authenticate(value.connectionId, value.password)
          return null
        }
        if (capability === 'connections.close') {
          await transport.close(String(input))
          studentConnections.delete(String(input))
          return null
        }
        if (capability === 'transport.cancel') {
          requests.get(String(input))?.abort()
          return null
        }
        if (capability === 'transport.request') {
          const value = input as HostRequest
          requireId(value.requestId)
          if (!Object.hasOwn(operationDefinitions, value.operationId))
            throw new Error('Unknown operation')
          if (requests.has(value.requestId)) throw new Error('Duplicate request ID')
          const studentConnection = studentConnections.get(value.connectionId)
          if (options.role === 'student') {
            const id = value.input?.path?.submissionId
            checkStudentOperation(
              value.operationId,
              await binding.summary(),
              studentConnection?.contextId,
              studentConnection?.state ?? null,
              options.releaseVersion,
              id ? await records.get(id) : null
            )
          }
          if (requests.size >= 64) throw new Error('Concurrent request limit reached')
          const request = new AbortController()
          requests.set(value.requestId, request)
          const startedAt = performance.now()
          let operation: TeacherOperation | null = null
          try {
            if (
              options.role === 'teacher' &&
              operationDefinitions[value.operationId].method !== 'GET'
            )
              operation = await teacherOperations.begin(
                transport.get(value.connectionId).serverId!,
                value.operationId,
                value.input
              )
            const result = await transport.request(
              value.connectionId,
              value.operationId,
              value.input,
              request.signal
            )
            if (operation) await teacherOperations.finish(operation, result)
            if (value.operationId === 'putStudentTasksIdResult' && result.status === 200) {
              taskLeases.delete(value.input.path!.id)
              testRecords.delete(value.input.path!.id)
            }
            if (['postStudentTasksIdClaim', 'putStudentTasksIdLease'].includes(value.operationId)) {
              const taskId = value.input.path!.id
              taskLeases.delete(taskId)
              if (result.status === 200 && studentConnection) {
                const lease = result.body as Schema<'TaskLease'>
                taskLeases.set(taskId, {
                  lease,
                  contextId: studentConnection.contextId,
                  deadline:
                    startedAt + Date.parse(lease.leaseExpiresAt) - Date.parse(lease.serverTime)
                })
              }
            }
            if (
              value.operationId === 'getStudentState' ||
              value.operationId === 'postStudentHeartbeat'
            ) {
              if (result.status === 200 && studentConnection) {
                const next = result.body as Schema<'StudentState'>
                const prior = studentConnection.state
                if (
                  !prior ||
                  (next.modeRevision >= prior.modeRevision &&
                    next.device.revision >= prior.device.revision)
                ) {
                  studentConnection.state = next
                  if (transport.get(value.connectionId).epoch === currentEpoch) knownState = next
                }
              }
            }
            return result
          } catch (error) {
            if (value.operationId === 'putStudentTasksIdLease')
              taskLeases.delete(value.input.path!.id)
            if (operation) await teacherOperations.finish(operation)
            throw error
          } finally {
            requests.delete(value.requestId)
          }
        }
        if (capability === 'transfer.import') {
          if (options.role !== 'teacher') throw new Error('Teacher import required')
          const { connectionId } = input as { connectionId: string }
          const selected = await dialog.showOpenDialog(window!, {
            properties: ['openFile'],
            filters: [{ name: '试卷', extensions: ['lsexam'] }]
          })
          if (selected.canceled) return null
          const temporary = join(root, 'transfers', randomUUID())
          await mkdir(join(root, 'transfers'), { recursive: true })
          await copyFile(selected.filePaths[0], temporary)
          try {
            return await transport.registerArchive(connectionId, temporary)
          } catch (error) {
            await rm(temporary, { force: true })
            throw error
          }
        }
        if (capability === 'transfer.export') {
          if (options.role !== 'teacher') await mayExport()
          const value = input as { handle: string; filename: string }
          const selected = await dialog.showSaveDialog(window!, { defaultPath: value.filename })
          if (selected.canceled || !selected.filePath) return false
          await exportFile(transport.file(value.handle), selected.filePath)
          return true
        }
        if (capability === 'transfer.exportJson') {
          if (options.role !== 'teacher') throw new Error('Teacher export required')
          const value = input as { body: unknown; filename: string }
          const selected = await dialog.showSaveDialog(window!, { defaultPath: value.filename })
          if (selected.canceled || !selected.filePath) return false
          await saveFile(selected.filePath, JSON.stringify(value.body, null, 2))
          return true
        }
        if (capability === 'cache.prepare') {
          const value = input as { handle: string; sha256: string }
          return cache.prepare(transport.file(value.handle), value.sha256)
        }
        if (capability === 'tasks.listJournals') return taskJournals.list()
        if (capability === 'tasks.saveJournal') {
          if (options.role !== 'student') throw new Error('Student task required')
          const journal = input as TaskJournal,
            summary = await binding.summary()
          if (journal.contextId !== summary?.contextId) throw new Error('Binding changed')
          return taskJournals.save(journal)
        }
        if (capability.startsWith('tests.')) {
          const value = input as {
            taskId: string
            leaseId: string
            handle: string
            sha256: string
            bytes: number | Uint8Array
            sequence: number
            baseUrl: string
            connectionId: string
            record: StudentRecord
          }
          requireId(value.taskId)
          if (options.role !== 'student') throw new Error('Student test required')
          if (capability === 'tests.release') {
            testCache.release(value.baseUrl)
            return null
          }
          const trusted = taskLeases.get(value.taskId),
            summary = await binding.summary()
          if (
            !trusted ||
            !summary ||
            trusted.contextId !== summary.contextId ||
            trusted.lease.leaseId !== value.leaseId ||
            trusted.lease.cancelRequested ||
            trusted.deadline <= performance.now() ||
            foreground !== 'testing' ||
            knownState?.availability !== 'maintenance' ||
            knownState.releaseVersion !== options.releaseVersion ||
            trusted.lease.parameters.type !== 'deployment-test'
          )
            throw new Error('No current deployment-test lease')
          const parameters = trusted.lease.parameters
          let storage = testRecords.get(value.taskId)
          if (!storage) {
            storage = new StudentRecords(join(root, 'test-data', value.taskId))
            await storage.initialize()
            testRecords.set(value.taskId, storage)
          }
          if (capability === 'tests.storage') {
            const path = join(storage.root, 'probe.json'),
              probe = { taskId: value.taskId, nonce: randomUUID() }
            await saveFile(path, JSON.stringify(probe))
            if (JSON.stringify(await loadJson(path)) !== JSON.stringify(probe))
              throw new Error('Durable storage verification failed')
            return null
          }
          if (capability === 'tests.prepare')
            return testCache.prepare(transport.file(value.handle), parameters.testExamSha256)
          if (capability === 'tests.begin')
            return storage.begin(
              sender,
              {
                submissionId: parameters.testSubmissionId,
                examId: value.taskId,
                candidate: { candidateId: 'deployment-test', displayName: '部署测试' },
                binding: summary
              },
              { sha256: value.sha256, bytes: value.bytes as number }
            )
          if (capability === 'tests.chunk')
            return storage.chunk(sender, value.handle, value.sequence, value.bytes as Uint8Array)
          if (capability === 'tests.finish')
            return storage.finish(sender, value.handle, value.sha256)
          if (capability === 'tests.list') return storage.list()
          if (capability === 'tests.cas') {
            if (value.record.submissionId !== parameters.testSubmissionId)
              throw new Error('Test identity mismatch')
            return storage.compareAndSwap(
              value.record.submissionId,
              value.record.revision,
              value.record
            )
          }
          if (capability === 'tests.uploadHandle') {
            if (studentConnections.get(value.connectionId)?.contextId !== summary.contextId)
              throw new Error('Test connection changed')
            return transport.registerArchive(
              value.connectionId,
              storage.archivePath(parameters.testSubmissionId)
            )
          }
          throw new Error('Unsupported test capability')
        }
        if (capability.startsWith('cleanup.')) {
          const value = input as { taskId: string; leaseId: string; index?: number }
          const trusted = taskLeases.get(value.taskId),
            summary = await binding.summary()
          if (
            options.role !== 'student' ||
            foreground !== 'testing' ||
            !trusted ||
            trusted.contextId !== summary?.contextId ||
            trusted.lease.leaseId !== value.leaseId ||
            trusted.lease.cancelRequested ||
            trusted.deadline <= performance.now() ||
            knownState?.availability !== 'maintenance' ||
            knownState.releaseVersion !== options.releaseVersion
          )
            throw new Error('No current maintenance lease')
          const parameters = trusted.lease.parameters
          if (parameters.type !== 'history-cleanup') throw new Error('Cleanup lease required')
          if (capability === 'cleanup.preview' && parameters.phase === 'preview')
            return records.preview(parameters.planId, parameters.submittedBefore)
          if (parameters.phase !== 'execute') throw new Error('Cleanup execution lease required')
          if (capability === 'cleanup.snapshot')
            return records.snapshot(parameters.planId, parameters.selectionDigest)
          if (capability === 'cleanup.item')
            return records.cleanupItem(
              value.taskId,
              parameters.planId,
              parameters.selectionDigest,
              value.index!,
              () => {
                if (
                  taskLeases.get(value.taskId) !== trusted ||
                  trusted.deadline <= performance.now() ||
                  knownState?.availability !== 'maintenance' ||
                  foreground !== 'testing'
                )
                  throw new Error('Maintenance lease ended before deletion')
              }
            )
        }
        if (capability === 'tasks.cleanupResult') {
          const value = input as { taskId: string; selectedCount: number }
          return records.cleanupResult(value.taskId, value.selectedCount)
        }
        if (capability === 'cache.release') {
          cache.release(String(input))
          return null
        }
        if (capability === 'practice.persist') {
          const intent = input as PracticeIntent
          requireId(intent.submissionId)
          requireId(intent.examId)
          validateSchema('Candidate', intent.candidate)
          const summary = await binding.summary()
          if (summary?.contextId !== intent.binding.contextId) throw new Error('Binding changed')
          await saveFile(
            join(root, 'practices', `${intent.submissionId}.json`),
            JSON.stringify(intent)
          )
          return null
        }
        if (capability === 'records.list') return records.list()
        if (capability === 'records.begin') {
          const {
            intent: value,
            sha256,
            bytes
          } = input as { intent: PracticeIntent; sha256: string; bytes: number }
          requireId(value.submissionId)
          const saved = await loadJson<PracticeIntent>(
            join(root, 'practices', `${value.submissionId}.json`)
          )
          if (!saved || JSON.stringify(saved) !== JSON.stringify(value))
            throw new Error('Practice intent not persisted')
          return records.begin(sender, value, { sha256, bytes })
        }
        if (capability === 'records.chunk') {
          const value = input as { handle: string; sequence: number; bytes: Uint8Array }
          return records.chunk(sender, value.handle, value.sequence, value.bytes)
        }
        if (capability === 'records.finish') {
          const value = input as { handle: string; sha256: string }
          return records.finish(sender, value.handle, value.sha256)
        }
        if (capability === 'records.cas') {
          const value = input as StudentRecord
          return records.compareAndSwap(value.submissionId, value.revision, value)
        }
        if (capability === 'records.uploadHandle') {
          const value = input as { id: string; connectionId: string }
          const record = await records.get(value.id),
            summary = await binding.summary()
          if (
            !record ||
            record.receipt ||
            record.originalBinding.contextId !== summary?.contextId ||
            transport.get(value.connectionId).serverId !== summary.serverId
          )
            throw new Error('Submission upload is not allowed')
          return transport.registerArchive(value.connectionId, records.archivePath(value.id))
        }
        if (capability === 'records.export') {
          await mayExport()
          const ids = input as string[]
          if (!Array.isArray(ids) || ids.length > 500) throw new Error('Invalid selection')
          const selected = await dialog.showOpenDialog(window!, {
            properties: ['openDirectory', 'createDirectory']
          })
          if (selected.canceled) return false
          for (const id of ids) {
            requireId(id)
            await records.exportTo(id, join(selected.filePaths[0], `${id}.lssubmission`))
          }
          return true
        }
        throw new Error('Unsupported host capability')
      }
      ipcMain.handle('lab:invoke', async (event, capability: unknown, input: unknown) => {
        if (closingWindow) throw new Error('WINDOW_CLOSING')
        const expected = options.developmentUrl ? new URL(options.developmentUrl).origin : null
        const senderUrl = event.senderFrame?.url
        if (
          event.sender.id !== contents.id ||
          event.senderFrame !== contents.mainFrame ||
          !senderUrl ||
          (expected
            ? new URL(senderUrl).origin !== expected
            : senderUrl.split('#')[0] !== pathToFileURL(options.renderer).href) ||
          typeof capability !== 'string'
        )
          throw new Error('Untrusted IPC sender')
        if (
          !['records.chunk', 'tests.chunk'].includes(capability) &&
          Buffer.byteLength(JSON.stringify(input ?? null)) > 1024 * 1024
        )
          throw new Error('IPC message too large')
        const work = invoke(capability, input, event.sender.id)
        invocations.add(work)
        try {
          return await work
        } finally {
          invocations.delete(work)
        }
      })
      dispatch(initialArgs, process.cwd())
      if (options.developmentUrl) await window.loadURL(options.developmentUrl)
      else await window.loadFile(options.renderer)
    })
    .catch((error) => {
      void dialog
        .showMessageBox({
          type: 'error',
          title: '听说101',
          message: '应用启动失败',
          detail: error instanceof Error ? error.message : '未知错误'
        })
        .then(() => app.quit())
    })
}

/**
 * Diagnostic for the custom title bar: a native title bar is part of the window's non-client
 * area, so the content area ends up shorter than the window bounds. Printed once per window so a
 * dev run states plainly whether the frameless flag took effect.
 */
function reportWindowChrome(window: BrowserWindow, frameless: boolean): void {
  if (window.isDestroyed()) return

  const bounds = window.getBounds()
  const content = window.getContentBounds()
  const frameHeight = bounds.height - content.height
  const line = `[lab] window chrome: frameless=${frameless} frameHeight=${frameHeight}px menuBarVisible=${window.isMenuBarVisible()}`

  if (frameless && frameHeight > 0) console.warn(`${line} — a native frame is present`)
  else console.info(line)
}
