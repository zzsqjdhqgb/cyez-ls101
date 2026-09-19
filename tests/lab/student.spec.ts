import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LabService } from '../../packages/lab-server/src/service'
import { createLabHttpServer } from '../../packages/lab-server/src/http'
import { PinnedTransport } from '../../packages/lab-desktop-host/src/transport'
import { LabClient } from '../../packages/lab-client/src/index'
import { INVITATION_CODE_HASH } from '../../packages/license/src/index'
import { encodeExamPackage } from '../../packages/exam-package/src/index'
import type { ExamPackage } from '@ls101/core-types'
import type { Schema } from '@ls101/lab-contracts'

test('student enrollment, maintenance, practice and durable receipt run through real host capabilities', async () => {
  test.setTimeout(180000)
  const root = await mkdtemp(join(tmpdir(), 'ls101-lab-e2e-'))
  let app: ElectronApplication | undefined
  let studentApp: ElectronApplication | undefined
  const service = await LabService.initialize(
    { root: join(root, 'server'), releaseVersion: '0.4.1', isLicenseActive: () => true },
    { name: 'Test Lab', baseUrl: 'https://127.0.0.1:8443/', password: 'test-password' }
  )
  const server = createLabHttpServer(service)
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `https://127.0.0.1:${(server.address() as { port: number }).port}/`
    service.db.transaction(() => service.saveData({ ...service.data(), baseUrl }))
    const transport = new PinnedTransport(join(root, 'downloads'), '0.4.1')
    const target = await transport.open(
      { baseUrl, fingerprint: service.identity.fingerprint },
      'teacher'
    )
    await transport.authenticate(target.connectionId, 'test-password')
    const teacher = new LabClient(target.connectionId, transport)
    const enrollment = await teacher.request<Schema<'EnrollmentCreated'>>(
      'postTeacherEnrollments',
      {
        body: { expectedModeRevision: 1, validForSeconds: 600 },
        idempotencyKey: randomUUID()
      }
    )
    const archive = await teacher.request<{ handle: string }>('getTeacherEnrollmentsIdFile', {
      path: { id: enrollment.enrollment.id }
    })
    const enrollmentFile = transport.file(archive.handle)
    const { copyFile } = await import('node:fs/promises')
    const joinFile = join(root, 'lab.lsjoin')
    await copyFile(enrollmentFile, joinFile)
    const studentPath = join(root, 'student-lab-student')
    await mkdir(studentPath, { recursive: true })
    await writeFile(
      join(studentPath, 'license.json'),
      JSON.stringify({
        schemaVersion: 1,
        invitationCodeHash: INVITATION_CODE_HASH,
        activatedAt: new Date().toISOString()
      })
    )
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    app = await electron.launch({
      args: [
        resolve('tests/lab/student-entry.mjs'),
        '--no-sandbox',
        '--password-store=basic',
        `--user-data-dir=${join(root, 'student')}`,
        joinFile,
        '--server-fingerprint',
        service.identity.fingerprint
      ],
      env
    })
    const page = await app.firstWindow()
    await app.evaluate(({ app }, certificate) => {
      if (!app.isReady()) throw new Error('Application is not ready')
      new (process.getBuiltinModule('crypto').X509Certificate)(certificate)
    }, service.identity.certificate)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: '机房维护中' })).toBeVisible()
    await expect(page.getByText('设备编号', { exact: true })).toBeVisible()
    const denied = await page.evaluate(async () => {
      const host = (
        window as unknown as { lab: { invoke(name: string, input?: unknown): Promise<unknown> } }
      ).lab
      return Promise.all(
        ['connections.open', 'localService.uninstall'].map((capability) =>
          host.invoke(capability).then(
            () => false,
            () => true
          )
        )
      )
    })
    expect(denied).toEqual([true, true])
    await page.evaluate(async () => {
      const host = (
        window as unknown as { lab: { invoke(name: string, input?: unknown): Promise<unknown> } }
      ).lab
      await host.invoke('foreground.set', 'saving')
      await host.invoke('window.close')
    })
    await expect(
      page.getByText('正在保存作答，请在保存完成后关闭。', { exact: true })
    ).toBeVisible()
    expect(page.isClosed()).toBe(false)
    await page.evaluate(async () =>
      (
        window as unknown as { lab: { invoke(name: string, input?: unknown): Promise<unknown> } }
      ).lab.invoke('foreground.set', 'idle')
    )
    const exam: ExamPackage = {
      format: 'ls101-exam',
      formatVersion: 1,
      packageId: randomUUID(),
      examData: {
        title: '机房集成练习',
        resources: {},
        player: {
          pages: [{ id: 'one', content: [], timeline: [{ type: 'countdown', seconds: 0 }] }],
          recordingIndices: []
        }
      },
      answerCapturePlan: { strings: [], audios: [] },
      submissionTemplate: {
        format: 'ls101-submission',
        formatVersion: 1,
        meta: { examPackageId: '', examTitle: '机房集成练习' },
        schemaUses: [],
        resources: {}
      }
    }
    exam.submissionTemplate.meta.examPackageId = exam.packageId
    const examFile = join(root, 'exam.lsexam')
    await writeFile(examFile, await encodeExamPackage(exam, {}))
    const imported = await teacher.request<Schema<'ExamImport'>>('postTeacherExams', {
      archive: await transport.registerArchive(target.connectionId, examFile),
      idempotencyKey: randomUUID()
    })
    await teacher.request('patchTeacherExamsExamId', {
      path: { examId: imported.examId },
      body: { published: true, expectedRevision: imported.revision }
    })
    await teacher.request('deleteTeacherEnrollmentsId', { path: { id: enrollment.enrollment.id } })
    await teacher.request('putTeacherServiceMode', {
      body: { mode: 'normal', expectedRevision: 1 }
    })
    await page.getByRole('button', { name: '刷新连接' }).click()
    await expect(page.getByRole('heading', { name: '可用试卷' })).toBeVisible()
    await page.getByRole('button', { name: '开始练习' }).click()
    await page.getByLabel('姓名', { exact: true }).fill('集成学生')
    await page.getByLabel('考生号').fill('1001')
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await expect(page.getByRole('heading', { name: '考试完成' })).toBeVisible()
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('button', { name: '历史', exact: true }).click()
    await expect(page.getByText('提交完成', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/lab/student-history.png' })
    expect(errors).toEqual([])
    studentApp = app
    app = undefined
    const teacherPath = join(root, 'teacher-lab-teacher')
    await mkdir(teacherPath, { recursive: true })
    await writeFile(
      join(teacherPath, 'license.json'),
      JSON.stringify({
        schemaVersion: 1,
        invitationCodeHash: INVITATION_CODE_HASH,
        activatedAt: new Date().toISOString()
      })
    )
    app = await electron.launch({
      args: [
        resolve('out/lab-teacher/main/index.js'),
        '--no-sandbox',
        '--password-store=basic',
        `--user-data-dir=${join(root, 'teacher')}`
      ],
      env
    })
    const teacherPage = await app.firstWindow()
    await teacherPage.getByRole('button', { name: '添加服务' }).click()
    await teacherPage.getByLabel('服务地址', { exact: true }).fill(baseUrl)
    await teacherPage.getByLabel('公钥指纹', { exact: true }).fill(service.identity.fingerprint)
    await teacherPage.getByLabel('已通过管理员核对公钥指纹').check()
    await teacherPage.getByLabel('管理密码', { exact: true }).fill('test-password')
    await teacherPage.getByRole('button', { name: '连接', exact: true }).click()
    await expect(teacherPage.getByRole('heading', { name: '试卷', exact: true })).toBeVisible()
    await teacherPage.getByRole('link', { name: '设备', exact: true }).click()
    await expect(teacherPage.getByRole('heading', { name: '设备', exact: true })).toBeVisible()
    const deviceList = await teacher.request<Schema<'DeviceList'>>('getTeacherDevices')
    const listedDevice = deviceList.items[0]
    const deviceRow = teacherPage.locator('tr').filter({ hasText: listedDevice.number }).first()
    await deviceRow.getByRole('button', { name: '编辑设备', exact: true }).click()
    const deviceEditor = teacherPage.getByRole('dialog')
    await deviceEditor.getByLabel('设备编号', { exact: true }).fill('0007')
    await deviceEditor.getByLabel('机房', { exact: true }).fill('A101')
    await deviceEditor.getByRole('button', { name: '保存设备', exact: true }).click()
    const renamedDevices = await teacher.request<Schema<'DeviceList'>>('getTeacherDevices')
    expect(renamedDevices.items.find((device) => device.id === listedDevice.id)?.number).toBe(
      '0007'
    )
    await teacherPage.getByRole('link', { name: '维护', exact: true }).click()
    await expect(teacherPage.getByRole('heading', { name: '维护', exact: true })).toBeVisible()
    await teacherPage.getByRole('button', { name: '进入维护模式', exact: true }).click()
    await expect(
      teacherPage.getByRole('heading', { name: '进入维护模式', exact: true })
    ).toBeVisible()
    await teacherPage.getByRole('button', { name: '确认', exact: true }).click()
    await expect
      .poll(async () => (await teacher.request<Schema<'ServiceState'>>('getTeacherService')).mode)
      .toBe('maintenance')
    await teacherPage.screenshot({ path: 'test-results/lab/teacher-devices.png' })
    const registered = await teacher.request<Schema<'DeviceList'>>('getTeacherDevices')
    await page.evaluate(() => {
      const tracks: MediaStreamTrack[] = []
      const media = navigator.mediaDevices,
        getUserMedia = media.getUserMedia.bind(media)
      media.getUserMedia = async (constraints) => {
        const stream = await getUserMedia(constraints)
        tracks.push(...stream.getTracks())
        return stream
      }
      Object.assign(window, { deploymentTracks: tracks })
    })
    const testRun = await teacher.request<Schema<'TestRun'>>('postTeacherTestRuns', {
      body: {
        suiteId: 'ls101-lab-deployment',
        deviceIds: [registered.items[0].id],
        caseIds: [
          'identity',
          'storage',
          'download',
          'playback',
          'audio',
          'submission',
          'duplicate',
          'recovery'
        ],
        expiresAt: new Date(Date.now() + 600000).toISOString()
      },
      idempotencyKey: randomUUID()
    })
    await page.getByRole('button', { name: '刷新连接' }).click()
    await expect(page.getByText('显示与选择测试', { exact: true })).toBeVisible({ timeout: 20000 })
    await page.getByRole('radio', { name: 'A 确认', exact: true }).check()
    await page.screenshot({ path: 'test-results/lab/student-deployment.png' })
    let completedTest = testRun
    await expect
      .poll(
        async () => {
          completedTest = await teacher.request('getTeacherTestRunsId', {
            path: { id: testRun.id }
          })
          return completedTest.devices[0].report
        },
        { timeout: 45000 }
      )
      .not.toBeNull()
    expect(completedTest.devices[0].cases).toEqual(
      expect.arrayContaining(
        testRun.devices[0].task.parameters.type === 'deployment-test'
          ? testRun.devices[0].task.parameters.caseIds.map((caseId) => ({
              caseId,
              status: ['playback', 'audio'].includes(caseId) ? 'manual-required' : 'passed',
              error: null
            }))
          : []
      )
    )
    expect(completedTest.status).toBe('succeeded')
    expect(completedTest.devices[0].confirmation.cases).toHaveLength(2)
    expect(
      service.db.get<{ total: number }>('SELECT count(*) AS total FROM test_submissions')?.total
    ).toBe(1)
    const studentRecords = await page.evaluate(() =>
      (window as unknown as { lab: { invoke(name: string): Promise<unknown[]> } }).lab.invoke(
        'records.list'
      )
    )
    expect(studentRecords).toHaveLength(1)
    const journal = JSON.parse(
      await readFile(join(studentPath, 'tasks', testRun.devices[0].task.id, 'journal.json'), 'utf8')
    )
    const staleLeaseRejected = await page.evaluate(
      async (input) => {
        try {
          await (
            window as unknown as { lab: { invoke(name: string, input: unknown): Promise<unknown> } }
          ).lab.invoke('tests.storage', input)
          return false
        } catch {
          return true
        }
      },
      { taskId: testRun.devices[0].task.id, leaseId: journal.lease.leaseId }
    )
    expect(staleLeaseRejected).toBe(true)
    await teacherPage.getByRole('link', { name: '维护', exact: true }).click()
    await teacherPage.getByRole('button', { name: '部署测试', exact: true }).click()
    await teacherPage.getByRole('button', { name: '查看测试', exact: true }).click()
    await teacherPage.getByRole('button', { name: '人工确认', exact: true }).click()
    await teacherPage
      .getByLabel('Microphone and headphones', { exact: true })
      .selectOption('failed')
    await teacherPage.getByLabel('Local playback', { exact: true }).selectOption('passed')
    await teacherPage.getByRole('button', { name: '保存人工确认', exact: true }).click()
    const confirmedTest = await teacher.request<Schema<'TestRun'>>('getTeacherTestRunsId', {
      path: { id: testRun.id }
    })
    expect(confirmedTest.devices[0].cases).toEqual(completedTest.devices[0].cases)
    await teacherPage.screenshot({ path: 'test-results/lab/teacher-deployment.png' })
    await teacherPage.getByRole('button', { name: '重试失败项', exact: true }).click()
    await teacherPage.getByRole('heading', { name: '重试失败项', exact: true }).waitFor()
    await teacherPage.getByRole('button', { name: '确认', exact: true }).click()
    let retry: Schema<'TestRun'> | undefined
    await expect
      .poll(async () => {
        const runs = await teacher.request<Schema<'TestRunList'>>('getTeacherTestRuns')
        retry = runs.items.find((item) => item.retryOf === testRun.id)
        return retry?.devices[0].task.parameters
      })
      .toMatchObject({ caseIds: ['audio'] })
    await expect(page.getByText('显示与选择测试', { exact: true })).toBeVisible({ timeout: 20000 })
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { deploymentTracks: MediaStreamTrack[] }).deploymentTracks.some(
              (track) => track.readyState === 'live'
            )
          ),
        { timeout: 20000, intervals: [50, 100] }
      )
      .toBe(true)
    await teacher.request('postTeacherTestRunsIdCancel', { path: { id: retry!.id } })
    await expect
      .poll(
        async () => {
          retry = await teacher.request('getTeacherTestRunsId', { path: { id: retry!.id } })
          return retry?.devices[0].report?.status
        },
        { timeout: 15000 }
      )
      .toBe('cancelled')
    await expect(page.getByRole('heading', { name: '机房维护中' })).toBeVisible()
    expect(
      await page.evaluate(() =>
        (window as unknown as { deploymentTracks: MediaStreamTrack[] }).deploymentTracks.every(
          (track) => track.readyState === 'ended'
        )
      )
    ).toBe(true)
    expect(
      service.db.get<{ total: number }>('SELECT count(*) AS total FROM test_submissions')?.total
    ).toBe(1)
    const plan = await teacher.request<Schema<'CleanupPlan'>>('postTeacherHistoryCleanups', {
      body: {
        deviceIds: [registered.items[0].id],
        submittedBefore: new Date(Date.now() + 1000).toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString()
      },
      idempotencyKey: randomUUID()
    })
    let preview = plan
    await expect
      .poll(
        async () => {
          preview = await teacher.request('getTeacherHistoryCleanupsId', { path: { id: plan.id } })
          return preview.devices[0].selectionDigest
        },
        { timeout: 20000 }
      )
      .not.toBeNull()
    expect(preview.devices[0].selectedCount).toBe(1)
    const savedId = (await readdir(join(studentPath, 'submissions')))[0]
    await readFile(join(studentPath, 'submissions', savedId, 'archive.lssubmission'))
    await teacher.request('postTeacherHistoryCleanupsIdConfirm', {
      path: { id: plan.id },
      body: {
        expectedRevision: preview.revision,
        selections: [
          { deviceId: registered.items[0].id, selectionDigest: preview.devices[0].selectionDigest }
        ]
      },
      idempotencyKey: randomUUID()
    })
    await expect
      .poll(
        async () =>
          (
            await teacher.request<Schema<'CleanupPlan'>>('getTeacherHistoryCleanupsId', {
              path: { id: plan.id }
            })
          ).status,
        { timeout: 20000 }
      )
      .toBe('succeeded')
    await expect(
      readFile(join(studentPath, 'submissions', savedId, 'archive.lssubmission'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    const cleaned = JSON.parse(
      await readFile(join(studentPath, 'submissions', savedId, 'record.json'), 'utf8')
    )
    expect(cleaned).toMatchObject({
      state: 'completed',
      archivePresent: false,
      retryPolicy: 'none'
    })
    expect(cleaned.receipt.receipt.submissionId).toBe(savedId)
    await app.close()
    app = undefined
    await studentApp.close()
    studentApp = undefined
  } catch (error) {
    await test.info().attach('deployment-task-reports', {
      body: JSON.stringify(service.db.all('SELECT data FROM task_results'), null, 2),
      contentType: 'application/json'
    })
    throw error
  } finally {
    await app?.close().catch(() => undefined)
    await studentApp?.close().catch(() => undefined)
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    await service.backups.wait()
    await service.db.close()
    await rm(root, { recursive: true, force: true })
  }
})
