import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { startServiceRuntime } from '../../packages/lab-server/src/runtime'
import { requestLocalControl } from '../../packages/lab-server/src/control'
import { INVITATION_CODE_HASH } from '../../packages/license/src/index'
import type { LabHost } from '../../packages/lab-desktop-host/src/shared'

test('service uninstall requires a stopped service and confirmation, handles failure, then refreshes status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ls101-uninstall-ui-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  const fixture = {
    status: {
      state: 'running',
      autostart: true,
      releaseVersion: '0.4.1',
      license: null,
      info: null,
      port: null,
      error: null
    },
    rejectUninstall: true,
    uninstalled: false
  }
  const filename = join(root, 'management.json')
  try {
    await writeFile(filename, JSON.stringify(fixture))
    await mkdir(join(root, 'teacher-lab-teacher'))
    await writeFile(
      join(root, 'teacher-lab-teacher/license.json'),
      JSON.stringify({
        schemaVersion: 1,
        invitationCodeHash: INVITATION_CODE_HASH,
        activatedAt: new Date().toISOString()
      })
    )
    app = await electron.launch({
      args: [
        resolve('out/lab-tests/teacher-local.cjs'),
        '--no-sandbox',
        '--password-store=basic',
        `--user-data-dir=${join(root, 'teacher')}`
      ],
      env: { ...process.env, LS101_TEST_SERVICE_ROOT: root, LS101_TEST_SERVICE_MANAGEMENT: '1' }
    })
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '本机服务', exact: true }).click()
    const uninstall = page.getByRole('button', { name: '卸载服务', exact: true })
    await expect(uninstall).toBeDisabled()
    await page.getByRole('button', { name: '检查本机状态' }).click()
    await expect(page.getByText('运行中', { exact: true })).toBeVisible()
    await expect(uninstall).toBeDisabled()
    fixture.status.state = 'stopped'
    await writeFile(filename, JSON.stringify(fixture))
    await page.getByRole('button', { name: '检查本机状态' }).click()
    await expect(uninstall).toBeEnabled()
    await uninstall.click()
    const confirmation = page.getByRole('alertdialog', { name: '卸载本机服务' })
    await expect(confirmation).toContainText('保留试卷、作答、备份和服务程序')
    await confirmation.getByRole('button', { name: '取消', exact: true }).click()
    expect(JSON.parse(await readFile(filename, 'utf8')).uninstalled).toBe(false)
    await uninstall.click()
    await confirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('RESOURCE_BUSY')
    await expect(uninstall).toBeEnabled()
    fixture.rejectUninstall = false
    await writeFile(filename, JSON.stringify(fixture))
    await uninstall.click()
    await confirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(page.getByText('未安装', { exact: true })).toBeVisible()
    await expect(uninstall).toBeDisabled()
    await expect(page.getByRole('button', { name: '安装程序', exact: true })).toBeEnabled()
    expect(JSON.parse(await readFile(filename, 'utf8')).uninstalled).toBe(true)
  } finally {
    await app?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('local teacher connection consumes the proof in main and leaves the independent service running on exit', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-local-e2e-'))
  const root = join(parent, 'service')
  const license = JSON.stringify({
    schemaVersion: 1,
    invitationCodeHash: INVITATION_CODE_HASH,
    activatedAt: new Date().toISOString()
  })
  const runtime = await startServiceRuntime(root, '0.4.1')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await writeFile(join(root, 'license.json'), license, { mode: 0o600 })
    const listener = createServer()
    await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done))
    const port = (listener.address() as { port: number }).port
    await new Promise<void>((done) => listener.close(() => done()))
    await requestLocalControl(root, 'initialize', {
      name: 'Local Lab',
      baseUrl: `https://127.0.0.1:${port}/`,
      password: 'local-teacher-secret',
      config: { schemaVersion: 1, host: '127.0.0.1', port }
    })
    await mkdir(join(parent, 'teacher-lab-teacher'))
    await writeFile(join(parent, 'teacher-lab-teacher/license.json'), license, { mode: 0o600 })
    app = await electron.launch({
      args: [
        resolve('out/lab-tests/teacher-local.cjs'),
        '--no-sandbox',
        '--password-store=basic',
        `--user-data-dir=${join(parent, 'teacher')}`
      ],
      env: { ...process.env, LS101_TEST_SERVICE_ROOT: root }
    })
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '本机服务', exact: true }).click()
    await page.getByRole('button', { name: '检查本机状态' }).click()
    await expect(page.getByText('运行中', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/lab/teacher-local-dialog.png' })
    const connected = await page.evaluate(async () =>
      (window as unknown as { lab: LabHost }).lab.invoke<{
        connectionId: string
        info: { name: string }
        localProof?: string
        fingerprint?: string
      }>('localService.connection')
    )
    expect(connected.info.name).toBe('Local Lab')
    expect(connected.localProof).toBeUndefined()
    expect(connected.fingerprint).toBeUndefined()
    await page.getByRole('button', { name: '连接本机服务', exact: true }).click()
    await expect(page.getByRole('heading', { name: '试卷', exact: true })).toBeVisible()
    const rejected = await page.evaluate(async () => {
      const host = (window as unknown as { lab: LabHost }).lab
      const results = []
      for (const capability of [
        'records.list',
        'cache.prepare',
        'tests.storage',
        'tasks.listJournals',
        'cleanup.preview'
      ])
        results.push(
          await host.invoke(capability, {}).then(
            () => false,
            () => true
          )
        )
      return results
    })
    expect(rejected).toEqual([true, true, true, true, true])
    await page.screenshot({ path: 'test-results/lab/teacher-local.png' })
    await app.close()
    app = undefined
    expect(await requestLocalControl(root, 'status')).toMatchObject({ state: 'running' })
  } finally {
    await app?.close()
    await runtime.close()
    await rm(parent, { recursive: true, force: true })
  }
})
