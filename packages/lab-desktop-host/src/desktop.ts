import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { LicenseService } from '@ls101/license'
import { validateSchema, operationDefinitions, type Schema } from '@ls101/lab-contracts'
import { PinnedTransport, type TrustedTarget } from './transport'
import { StudentRecords } from './records'
import { BindingStore } from './binding'
import { ExamCache } from './cache'
import { loadJson, saveFile, requireId } from './files'
import { parseCommand, type StartupCommand } from './commands'
import type { HostRequest, PracticeIntent, StudentRecord } from './shared'
import { checkStudentOperation } from './policy'
import { TeacherOperations } from './teacher-operations'
import { TaskJournals } from './task-journals'
import type { TaskJournal } from './shared'

export interface DesktopOptions {
  role: 'student' | 'teacher'
  preload: string
  renderer: string
  developmentUrl?: string
  releaseVersion: string
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
  const dispatch = (argv: string[], cwd: string): void => {
    try {
      const command = parseCommand(argv, cwd, randomUUID())
      if (command) {
        pending.push(command)
        window?.webContents.send('lab:event', { type: 'startup-command', value: command.id })
      }
      window?.show()
      window?.focus()
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
      const root = app.getPath('userData')
      await mkdir(root, { recursive: true, mode: 0o700 })
      const license = new LicenseService({ storagePath: join(root, 'license.json') })
      const transport = new PinnedTransport(join(root, 'transfers'), options.releaseVersion)
      const records = new StudentRecords(root)
      const binding = new BindingStore(root, transport, {
        encrypt: (value) =>
          safeStorage.isEncryptionAvailable()
            ? `encrypted:${safeStorage.encryptString(value).toString('base64')}`
            : `restricted:${Buffer.from(value).toString('base64')}`,
        decrypt: (value) =>
          value.startsWith('encrypted:')
            ? safeStorage.decryptString(Buffer.from(value.slice(10), 'base64'))
            : Buffer.from(value.slice(11), 'base64').toString('utf8')
      })
      const cache = new ExamCache(join(root, 'exam-cache'))
      const teacherOperations = new TeacherOperations(join(root, 'teacher-operations'))
      const taskJournals = new TaskJournals(join(root, 'tasks'))
      const taskLeases = new Map<
        string,
        { deadline: number; lease: Schema<'TaskLease'>; contextId: string }
      >()
      const requests = new Map<string, AbortController>()
      const studentConnections = new Map<
        string,
        { contextId: string; state: Schema<'StudentState'> | null }
      >()
      let initializationError: string | null = null
      try {
        await records.initialize()
      } catch {
        initializationError = '本地作答数据无法初始化，请联系管理员。'
      }
      protocol.handle('ls101-exam', (request) => {
        if (license.getStatusSync().state !== 'active') return new Response(null, { status: 403 })
        return cache.respond(request.url)
      })
      Menu.setApplicationMenu(null)
      window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 760,
        minHeight: 560,
        backgroundColor: '#f5f7f8',
        title: options.role === 'student' ? '听说101 学生端' : '听说101 教师端',
        webPreferences: {
          preload: options.preload,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false
        }
      })
      const contents = window.webContents
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
                for (const request of requests.values()) request.abort()
                const summary = await binding.enroll(
                  await readFile(command.filename, 'utf8'),
                  command.fingerprint
                )
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
        active()
        if (initializationError) throw new Error(initializationError)
        if (
          options.role === 'student' &&
          capability.startsWith('connections.') &&
          capability !== 'connections.close'
        )
          throw new Error('Teacher connection required')
        if (options.role === 'teacher' && /^(binding\.|records\.|practice\.)/.test(capability))
          throw new Error('Student capability required')
        if (capability.startsWith('localService.')) {
          if (options.role !== 'teacher' || !options.localService)
            throw new Error('本机服务能力不可用')
          return options.localService.invoke(capability.slice(13), input)
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
        if (capability === 'binding.summary') return binding.summary()
        if (capability === 'binding.connect') {
          const connected = await binding.connect(typeof input === 'string' ? input : undefined)
          const summary = await binding.summary()
          const contextId = typeof input === 'string' ? input : summary!.contextId
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
          knownState = value.state
          versionMismatch = knownState.releaseVersion !== options.releaseVersion
          return binding.observe(value.contextId, value.state)
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
          const value = input as { connectionId: string; password?: string; localProof?: string }
          await transport.authenticate(value.connectionId, value.password, value.localProof)
          return null
        }
        if (capability === 'connections.close') {
          transport.close(String(input))
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
          const request = new AbortController()
          requests.set(value.requestId, request)
          const startedAt = performance.now()
          const operation =
            options.role === 'teacher' && operationDefinitions[value.operationId].method !== 'GET'
              ? await teacherOperations.begin(
                  transport.get(value.connectionId).serverId!,
                  value.operationId,
                  value.input
                )
              : null
          try {
            const result = await transport.request(
              value.connectionId,
              value.operationId,
              value.input,
              request.signal
            )
            if (operation) await teacherOperations.finish(operation, result)
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
          return transport.registerArchive(connectionId, temporary)
        }
        if (capability === 'transfer.export') {
          if (options.role !== 'teacher') await mayExport()
          const value = input as { handle: string; filename: string }
          const selected = await dialog.showSaveDialog(window!, { defaultPath: value.filename })
          if (selected.canceled || !selected.filePath) return false
          await saveFile(selected.filePath, await readFile(transport.file(value.handle)))
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
          capability !== 'records.chunk' &&
          Buffer.byteLength(JSON.stringify(input ?? null)) > 1024 * 1024
        )
          throw new Error('IPC message too large')
        return invoke(capability, input, event.sender.id)
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
