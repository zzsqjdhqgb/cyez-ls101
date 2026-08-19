import { expect, test } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from './support/electron-app'

test('copies business data, switches directories after restart and retains the source', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-data-directory-integration-'))
  const targetParent = await mkdtemp(path.join(tmpdir(), 'ls101-data-directory-target-'))
  const target = path.join(targetParent, 'data')
  const source = path.join(userDataDir, 'data')
  const migrationId = '11111111-1111-4111-8111-111111111111'
  const staging = path.join(
    path.dirname(target),
    `.${path.basename(target)}.migrating-${migrationId}`
  )
  await mkdir(target)
  await mkdir(path.join(source, 'template-editor'), { recursive: true })
  await writeFile(
    path.join(source, '.ls101-data.json'),
    JSON.stringify({ formatVersion: 1, kind: 'ls101-data-directory' })
  )
  const sourceFile = path.join(source, 'template-editor', 'migration-test.json')
  await writeFile(sourceFile, '{"migrated":true}')
  await writeFile(
    path.join(userDataDir, 'data-location.json'),
    JSON.stringify({
      formatVersion: 1,
      state: 'migrating',
      migrationId,
      source,
      target,
      staging,
      mode: 'copy'
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

    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: /存储/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: '存储' })).toBeVisible()
    await expect(page.getByText(target)).toBeVisible()
    await expect(page.getByRole('button', { name: '更改位置' })).toBeEnabled()
  } finally {
    await electronApp.close().catch(() => undefined)
    await rm(userDataDir, { force: true, recursive: true })
    await rm(targetParent, { force: true, recursive: true })
  }
})
