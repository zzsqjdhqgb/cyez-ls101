import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { startServiceRuntime } from '../../packages/lab-server/src/runtime'
import { requestLocalControl } from '../../packages/lab-server/src/control'
import { INVITATION_CODE_HASH } from '../../packages/license/src/index'
import type { LabHost } from '../../packages/lab-desktop-host/src/shared'

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
