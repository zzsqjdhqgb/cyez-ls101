import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { launchIntegrationApp } from './support/electron-app'

test('archives root-level legacy data after startup and cleans it only after confirmation', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-legacy-data-integration-'))
  await writeFile(path.join(userDataDir, 'version'), '0.3.2')
  await mkdir(path.join(userDataDir, 'data', 'config'), { recursive: true })
  await writeFile(
    path.join(userDataDir, 'data', '.ls101-data.json'),
    JSON.stringify({ formatVersion: 1, kind: 'ls101-data-directory' })
  )
  await writeFile(path.join(userDataDir, 'data', 'config', 'settings.json'), '{"copied":true}')
  await mkdir(path.join(userDataDir, 'config'))
  await writeFile(path.join(userDataDir, 'config', 'settings.json'), '{"copied":true}')
  await mkdir(path.join(userDataDir, 'drafts'), { recursive: true })
  await writeFile(path.join(userDataDir, 'drafts', 'draft.json'), '{"legacy":true}')
  await mkdir(path.join(userDataDir, 'submissions', 'recordings'), { recursive: true })
  await writeFile(path.join(userDataDir, 'submissions', 'recordings', '0.mp3'), 'legacy-audio')
  const electronApp = await launchIntegrationApp(userDataDir)

  try {
    const page = await mainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { name: '旧数据已归档' })).toBeVisible()
    await expect(page.getByText('3 个')).toHaveCount(2)
    await expect(page.getByRole('button', { name: '关闭' })).toBeDisabled()

    const blocked = await page.evaluate(
      async (target) => {
        try {
          await window.dataDirectory!.migrate(target)
          return ''
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      },
      path.join(userDataDir, 'blocked-target')
    )
    expect(blocked).toContain('请先完成旧版数据归档清理')

    const legacyInfo = await page.evaluate(() => window.legacyData!.getInfo())
    expect(legacyInfo.status).toBe('archived')
    const archivePath = legacyInfo.archivePath!
    const archive = unzipSync(new Uint8Array(await readFile(archivePath)))
    expect(new TextDecoder().decode(archive['drafts/draft.json'])).toBe('{"legacy":true}')
    expect(new TextDecoder().decode(archive['submissions/recordings/0.mp3'])).toBe('legacy-audio')
    expect(archive['config/settings.json']).toBeUndefined()
    await expect(readFile(path.join(userDataDir, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      '{"legacy":true}'
    )

    await page.getByRole('button', { name: '清理并继续' }).click()
    await expect(page.getByRole('heading', { name: '旧数据已归档' })).toHaveCount(0)
    await closeReleaseNotes(page)
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await expect(readFile(path.join(userDataDir, 'drafts', 'draft.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(path.join(userDataDir, 'config', 'settings.json'))).rejects.toMatchObject(
      {
        code: 'ENOENT'
      }
    )
    await expect(
      readFile(path.join(userDataDir, 'data', 'config', 'settings.json'), 'utf8')
    ).resolves.toBe('{"copied":true}')
    await expect(readFile(path.join(userDataDir, 'version'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(archivePath)).resolves.not.toHaveLength(0)
    await expect(
      readFile(path.join(userDataDir, 'legacy-migration.json'), 'utf8')
    ).resolves.toContain('"state": "cleaned"')
  } finally {
    await electronApp.close().catch(() => undefined)
    await rm(userDataDir, { force: true, recursive: true })
  }
})

test('copies business data, switches directories after restart and retains the source', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-data-directory-integration-'))
  const targetParent = await mkdtemp(path.join(tmpdir(), 'ls101-data-directory-target-'))
  const target = path.join(targetParent, 'data')
  const source = path.join(userDataDir, 'data')
  const migrationId = '11111111-1111-4111-8111-111111111111'
  const sourceDirectoryId = '33333333-3333-4333-8333-333333333333'
  const staging = path.join(
    path.dirname(target),
    `.${path.basename(target)}.migrating-${migrationId}`
  )
  await mkdir(target)
  await mkdir(path.join(source, 'template-editor'), { recursive: true })
  await writeFile(
    path.join(source, '.ls101-data.json'),
    JSON.stringify({
      formatVersion: 1,
      kind: 'ls101-data-directory',
      directoryId: sourceDirectoryId
    })
  )
  const sourceFile = path.join(source, 'template-editor', 'migration-test.json')
  await writeFile(sourceFile, '{"migrated":true}')
  const sourceParentStats = await stat(userDataDir)
  const targetParentStats = await stat(targetParent)
  await writeFile(
    path.join(userDataDir, 'data-location.json'),
    JSON.stringify({
      formatVersion: 1,
      state: 'migrating',
      migrationId,
      source,
      target,
      staging,
      parentPath: targetParent,
      parentIdentity: {
        device: String(targetParentStats.dev),
        inode: String(targetParentStats.ino)
      },
      mode: 'copy',
      retiredSource: {
        path: source,
        directoryId: sourceDirectoryId,
        parentPath: userDataDir,
        parentIdentity: {
          device: String(sourceParentStats.dev),
          inode: String(sourceParentStats.ino)
        }
      }
    })
  )
  const electronApp = await launchIntegrationApp(userDataDir)
  const processErrors: string[] = []
  electronApp.process().stderr?.on('data', (chunk: Buffer) => processErrors.push(chunk.toString()))

  try {
    try {
      await expect
        .poll(async () =>
          Promise.all(electronApp.windows().map((window) => window.title().catch(() => '')))
        )
        .toContain('曹二听说101')
    } catch (error) {
      throw new Error(`${String(error)}\napplication stderr:\n${processErrors.join('')}`)
    }
    let mainWindow = electronApp.windows()[0]
    for (const window of electronApp.windows()) {
      if ((await window.title().catch(() => '')) === '曹二听说101') mainWindow = window
    }
    const page = mainWindow
    await page.waitForLoadState('domcontentloaded')
    const migrated = await page.evaluate(() => window.dataDirectory!.getInfo())

    expect(path.resolve(migrated.currentPath)).toBe(path.resolve(target))
    await expect(
      readFile(path.join(target, 'template-editor', 'migration-test.json'), 'utf8')
    ).resolves.toBe('{"migrated":true}')
    await expect(readFile(sourceFile, 'utf8')).resolves.toBe('{"migrated":true}')
    await expect(readFile(path.join(userDataDir, 'data-location.json'), 'utf8')).resolves.toContain(
      '"state": "ready"'
    )

    await closeReleaseNotes(page)
    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: /存储/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: '存储' })).toBeVisible()
    await expect(page.getByText(target)).toBeVisible()
    await expect(page.getByText(source)).toBeVisible()
    await expect(page.getByRole('button', { name: '更改位置' })).toBeDisabled()
    await page.getByRole('button', { name: '删除旧数据' }).click()
    await page.getByRole('button', { name: '永久删除' }).click()
    await expect(page.getByRole('button', { name: '更改位置' })).toBeEnabled()
    await expect(readFile(sourceFile)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await electronApp.close().catch(() => undefined)
    await rm(userDataDir, { force: true, recursive: true })
    await rm(targetParent, { force: true, recursive: true })
  }
})

test('resets a custom data directory to the validated default location', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-data-default-integration-'))
  const customParent = await mkdtemp(path.join(tmpdir(), 'ls101-data-default-custom-'))
  const custom = path.join(customParent, 'data')
  const defaultPath = path.join(userDataDir, 'data')
  await mkdir(path.join(custom, 'template-editor'), { recursive: true })
  await writeFile(
    path.join(custom, '.ls101-data.json'),
    JSON.stringify({
      formatVersion: 1,
      kind: 'ls101-data-directory',
      directoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    })
  )
  const customFile = path.join(custom, 'template-editor', 'reset-default.json')
  await writeFile(customFile, '{"reset":true}')
  await writeFile(
    path.join(userDataDir, 'data-location.json'),
    JSON.stringify({
      formatVersion: 1,
      state: 'ready',
      activeDataDirectory: custom
    })
  )

  let electronApp = await launchIntegrationApp(userDataDir, {
    environment: { LS101_DISABLE_AUTO_RELAUNCH: '1' }
  })
  try {
    const page = await mainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    await closeReleaseNotes(page)
    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: /存储/ }).click()
    await expect(page.getByText(custom)).toBeVisible()
    await page.getByRole('button', { name: '恢复默认位置' }).click()
    await expect(page.getByRole('heading', { name: '迁移数据目录？' })).toBeVisible()
    await expect(page.getByText(defaultPath, { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '复制并重启' }).click()
    await electronApp.waitForEvent('close')

    electronApp = await launchIntegrationApp(userDataDir)
    const restartedPage = await mainApplicationWindow(electronApp)
    await restartedPage.waitForLoadState('domcontentloaded')
    const reset = await restartedPage.evaluate(() => window.dataDirectory!.getInfo())
    expect(path.resolve(reset.currentPath)).toBe(path.resolve(defaultPath))
    await expect(
      readFile(path.join(defaultPath, 'template-editor', 'reset-default.json'), 'utf8')
    ).resolves.toBe('{"reset":true}')
    await expect(readFile(customFile, 'utf8')).resolves.toBe('{"reset":true}')
  } finally {
    await electronApp.close().catch(() => undefined)
    await rm(userDataDir, { force: true, recursive: true })
    await rm(customParent, { force: true, recursive: true })
  }
})

async function mainApplicationWindow(electronApp: ElectronApplication): Promise<Page> {
  await expect
    .poll(async () =>
      Promise.all(electronApp.windows().map((window) => window.title().catch(() => '')))
    )
    .toContain('曹二听说101')
  for (const window of electronApp.windows()) {
    if ((await window.title().catch(() => '')) === '曹二听说101') return window
  }
  throw new Error('Main application window was not found')
}

async function closeReleaseNotes(page: Page): Promise<void> {
  const closeButton = page.getByRole('button', { name: '关闭版本说明' })
  await expect(closeButton).toBeVisible()
  await closeButton.click()
}
