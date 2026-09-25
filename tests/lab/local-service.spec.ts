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
      error: null as string | null
    },
    statusError: 'LOCAL_STATUS_UNAVAILABLE' as string | null,
    rejectUninstall: true,
    rejectForceStop: true,
    forceStopped: false,
    rejectExport: true,
    rejectPurge: true,
    purged: false,
    installError:
      'STORAGE_UNAVAILABLE\nLS101_INSTALL_ERROR [configure-service-account]: Access denied',
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
    await page.getByRole('button', { name: '本机服务管理' }).click()
    const localDialog = page.getByRole('dialog', { name: '本机服务' })
    const uninstall = page.getByRole('button', { name: '卸载服务', exact: true })
    // Management actions stay in place, disabled until their required state is known.
    await expect(localDialog.getByText('状态未知', { exact: true })).toBeVisible()
    await expect(localDialog.getByLabel('服务名称', { exact: true })).toBeDisabled()
    await expect(localDialog.getByLabel('对外地址', { exact: true })).toHaveAttribute(
      'placeholder',
      '未知'
    )
    await expect(uninstall).toBeDisabled()
    fixture.statusError = null
    fixture.status.state = 'unavailable'
    fixture.status.error = 'LOCAL_STATUS_ACCESS_DENIED'
    await writeFile(filename, JSON.stringify(fixture))
    await page.getByRole('button', { name: '检查本机状态' }).click()
    await expect(localDialog.getByRole('heading', { name: '服务状态暂时不可用' })).toBeVisible()
    await expect(localDialog.getByText(/services.msc/)).toBeVisible()
    await expect(localDialog.getByText(/当前账户无权连接本机状态通道/)).toBeVisible()
    await expect(localDialog.getByText('诊断代码：LOCAL_STATUS_ACCESS_DENIED')).toBeVisible()
    await expect(uninstall).toBeDisabled()
    await expect(localDialog.getByRole('button', { name: '停止', exact: true })).toBeDisabled()
    await expect(localDialog.getByLabel('服务名称', { exact: true })).toBeDisabled()
    await page.screenshot({ path: 'test-results/lab/teacher-local-unavailable.png' })
    await localDialog.getByRole('button', { name: '强制停止服务', exact: true }).click()
    const emergency = page.getByRole('alertdialog', { name: '强制停止本机服务' })
    await expect(emergency).toContainText('未完成的交卷需要学生重试')
    await emergency.getByRole('button', { name: '取消', exact: true }).click()
    expect(JSON.parse(await readFile(filename, 'utf8')).forceStopped).toBe(false)
    await localDialog.getByRole('button', { name: '强制停止服务', exact: true }).click()
    await emergency.getByRole('button', { name: '确认', exact: true }).click()
    await expect(localDialog.getByRole('alert')).toContainText('LOCAL_FORCE_STOP_FAILED')
    await expect(localDialog.getByText('状态未知', { exact: true })).toBeVisible()
    // A failed attempt must leave a retry available even when the status is unknown.
    fixture.rejectForceStop = false
    await writeFile(filename, JSON.stringify(fixture))
    await localDialog.getByRole('button', { name: '强制停止服务', exact: true }).click()
    await emergency.getByRole('button', { name: '确认', exact: true }).click()
    await expect(localDialog.getByText('已停止', { exact: true })).toBeVisible()
    await expect(localDialog.getByRole('button', { name: '启动', exact: true })).toBeEnabled()
    await expect(localDialog.getByRole('checkbox', { name: '开机启动本机服务' })).not.toBeChecked()
    expect(JSON.parse(await readFile(filename, 'utf8')).forceStopped).toBe(true)
    await writeFile(filename, JSON.stringify(fixture))
    await localDialog.getByRole('button', { name: '检查本机状态' }).click()
    await localDialog.getByRole('button', { name: '查看服务日志' }).click()
    await expect(localDialog.getByRole('tab', { name: '服务日志' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(localDialog.getByText('Fixture service log', { exact: true })).toBeVisible()
    await localDialog.getByRole('tab', { name: '服务信息与操作' }).click()
    fixture.status.error = 'LOCAL_STATUS_TIMEOUT'
    await writeFile(filename, JSON.stringify(fixture))
    await localDialog.getByRole('button', { name: '重新检查状态' }).click()
    await expect(localDialog.getByText(/本机状态通道未在规定时间内响应/)).toBeVisible()
    fixture.status.state = 'stopped'
    fixture.status.error = null
    await writeFile(filename, JSON.stringify(fixture))
    await localDialog.getByRole('button', { name: '重新检查状态' }).click()
    await expect(localDialog.getByText('已停止', { exact: true })).toBeVisible()
    await expect(localDialog.getByRole('button', { name: '启动', exact: true })).toBeEnabled()
    fixture.status.state = 'running'
    await writeFile(filename, JSON.stringify(fixture))
    await localDialog.getByRole('button', { name: '检查本机状态' }).click()
    await expect(localDialog.getByText('运行中', { exact: true })).toBeVisible()
    await expect(localDialog.getByRole('heading', { name: '服务状态暂时不可用' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
    await expect(uninstall).toBeDisabled()
    fixture.status.state = 'stopped'
    await writeFile(filename, JSON.stringify(fixture))
    await page.getByRole('button', { name: '检查本机状态' }).click()
    await expect(uninstall).toBeEnabled()
    await expect(localDialog.getByLabel('服务名称', { exact: true })).toBeDisabled()
    await localDialog.getByRole('tab', { name: '监听端口与备份恢复' }).click()
    await expect(localDialog.getByLabel('监听端口', { exact: true })).toBeEnabled()
    await expect(localDialog.getByLabel('监听端口', { exact: true })).toHaveValue('')
    await localDialog.getByLabel('监听端口', { exact: true }).fill('9443')
    await localDialog.getByRole('tab', { name: '服务日志' }).click()
    await localDialog.getByRole('button', { name: '读取日志' }).click()
    await expect(localDialog.getByText('Fixture service log', { exact: true })).toBeVisible()
    await localDialog.getByRole('tab', { name: '监听端口与备份恢复' }).click()
    await expect(localDialog.getByLabel('监听端口', { exact: true })).toHaveValue('9443')
    await localDialog.getByRole('tab', { name: '服务信息与操作' }).click()
    await uninstall.click()
    const confirmation = page.getByRole('alertdialog', { name: '卸载本机服务' })
    await expect(confirmation).toContainText('保留试卷、作答、备份和服务程序')
    await confirmation.getByRole('button', { name: '取消', exact: true }).click()
    expect(JSON.parse(await readFile(filename, 'utf8')).uninstalled).toBe(false)
    await uninstall.click()
    await confirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('RESOURCE_BUSY')
    await expect(uninstall).toBeDisabled()
    await page.getByRole('button', { name: '检查本机状态' }).click()
    await expect(uninstall).toBeEnabled()
    fixture.rejectUninstall = false
    await writeFile(filename, JSON.stringify(fixture))
    await uninstall.click()
    await confirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(localDialog.getByText('未安装', { exact: true })).toBeVisible()
    await expect(uninstall).toBeDisabled()
    await expect(page.getByRole('button', { name: '安装程序', exact: true })).toBeEnabled()
    expect(JSON.parse(await readFile(filename, 'utf8')).uninstalled).toBe(true)
    await page.getByRole('button', { name: '安装程序', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: '安装本机服务程序' })
      .getByRole('button', { name: '确认', exact: true })
      .click()
    await expect(page.getByRole('alert')).toContainText(
      'LS101_INSTALL_ERROR [configure-service-account]: Access denied'
    )
    // Recovery remains available when installation/status cannot be read.
    await localDialog.getByRole('tab', { name: '监听端口与备份恢复' }).click()
    await expect(localDialog.getByRole('button', { name: '彻底清除服务及数据' })).toHaveCount(0)
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, root)
    const exportData = async (): Promise<void> => {
      await localDialog.getByRole('button', { name: '导出原始数据', exact: true }).click()
      await page
        .getByRole('alertdialog', { name: '导出原始服务数据' })
        .getByRole('button', { name: '确认', exact: true })
        .click()
    }
    await exportData()
    await expect(localDialog.getByRole('alert')).toContainText('ENOSPC')
    await expect(localDialog.getByRole('button', { name: '彻底清除服务及数据' })).toHaveCount(0)
    fixture.rejectExport = false
    await writeFile(filename, JSON.stringify(fixture))
    await exportData()
    await expect(localDialog.getByText(/已校验导出：/)).toContainText('LS101-recovery-')
    const purge = localDialog.getByRole('button', { name: '彻底清除服务及数据', exact: true })
    await expect(purge).toBeDisabled()
    await localDialog.getByLabel('输入“清除本机服务”以确认').fill('清除本机服务')
    await purge.click()
    const purgeConfirmation = page.getByRole('alertdialog', { name: '彻底清除本机服务及数据' })
    await expect(purgeConfirmation).toContainText('此操作不可撤销')
    await purgeConfirmation.getByRole('button', { name: '取消', exact: true }).click()
    expect(JSON.parse(await readFile(filename, 'utf8')).purged).toBe(false)
    await purge.click()
    await purgeConfirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(localDialog.getByRole('alert')).toContainText('LOCAL_RECOVERY_EXPORT_CHANGED')
    fixture.rejectPurge = false
    await writeFile(filename, JSON.stringify(fixture))
    await purge.click()
    await purgeConfirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(localDialog.getByText('未安装', { exact: true })).toBeVisible()
    expect(JSON.parse(await readFile(filename, 'utf8')).purged).toBe(true)
    await expect(purge).toHaveCount(0)
    await localDialog.getByRole('tab', { name: '服务信息与操作' }).click()
    await expect(localDialog.getByRole('button', { name: '安装程序', exact: true })).toBeEnabled()
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
    await page.getByRole('button', { name: '本机服务管理' }).click()
    const localDialog = page.getByRole('dialog', { name: '本机服务' })
    await expect(localDialog.getByText('运行中', { exact: true })).toBeVisible()
    await expect(
      localDialog.getByRole('button', { name: '连接本机服务', exact: true })
    ).toHaveCount(0)
    await expect(localDialog.getByRole('tab')).toHaveCount(3)
    const name = localDialog.getByLabel('服务名称', { exact: true })
    await expect(name).toHaveValue('Local Lab')
    await expect(name).toBeEnabled()
    await name.fill('Local Lab renamed')
    await localDialog.getByRole('tab', { name: '监听端口与备份恢复' }).click()
    await expect(localDialog.getByRole('tabpanel', { name: '监听端口与备份恢复' })).toBeVisible()
    await expect(localDialog.getByLabel('监听端口', { exact: true })).toBeDisabled()
    await localDialog.getByRole('tab', { name: '服务日志' }).click()
    await expect(localDialog.getByRole('button', { name: '读取日志' })).toBeVisible()
    await localDialog.getByRole('tab', { name: '服务日志' }).press('Home')
    await expect(localDialog.getByRole('tab', { name: '服务信息与操作' })).toBeFocused()
    await expect(name).toHaveValue('Local Lab renamed')
    await localDialog.getByRole('button', { name: '保存服务信息' }).click()
    await expect(localDialog.getByText('服务信息已保存。', { exact: true })).toBeVisible()
    expect(await requestLocalControl(root, 'status')).toMatchObject({
      info: { name: 'Local Lab renamed' }
    })
    const address = localDialog.getByLabel('对外地址', { exact: true })
    await address.fill(`https://localhost:${port}/`)
    await localDialog.getByRole('button', { name: '保存服务信息' }).click()
    const addressConfirmation = page.getByRole('alertdialog', { name: '修改服务对外地址' })
    await expect(addressConfirmation).toContainText('不会自动更新地址')
    await addressConfirmation.getByRole('button', { name: '取消', exact: true }).click()
    expect(await requestLocalControl(root, 'status')).toMatchObject({
      settings: { baseUrl: `https://127.0.0.1:${port}/` }
    })
    await localDialog.getByRole('button', { name: '保存服务信息' }).click()
    await addressConfirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(localDialog.getByRole('button', { name: '保存服务信息' })).toBeDisabled()
    await expect(address).toBeEnabled()
    expect(await requestLocalControl(root, 'status')).toMatchObject({
      settings: { baseUrl: `https://localhost:${port}/` }
    })
    await localDialog.getByLabel('管理密码', { exact: true }).fill('changed-teacher-secret')
    await localDialog.getByRole('button', { name: '修改密码', exact: true }).click()
    const passwordConfirmation = page.getByRole('alertdialog', { name: '修改管理密码' })
    await expect(passwordConfirmation).toContainText('需要重新连接')
    await passwordConfirmation.getByRole('button', { name: '确认', exact: true }).click()
    await expect(
      localDialog.getByText('管理密码已修改，已登录的教师端需要重新连接。', { exact: true })
    ).toBeVisible()
    await expect(localDialog.getByLabel('管理密码', { exact: true })).toHaveValue('')
    expect(await requestLocalControl(root, 'status')).toMatchObject({
      settings: { securityRevision: 2 }
    })
    await page.screenshot({ path: 'test-results/lab/teacher-local-dialog.png' })
    await localDialog.getByRole('button', { name: '关闭对话框' }).click()
    const connected = await page.evaluate(async () =>
      (window as unknown as { lab: LabHost }).lab.invoke<{
        connectionId: string
        info: { name: string }
        localProof?: string
        fingerprint?: string
      }>('localService.connection')
    )
    expect(connected.info.name).toBe('Local Lab renamed')
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
