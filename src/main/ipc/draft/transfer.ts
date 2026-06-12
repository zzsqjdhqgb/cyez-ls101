/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcMain, dialog } from 'electron'
import { rmSync, existsSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { getMainWindow } from '../../win'
import { ensureDir, copyDirRecursive, getDraftsPath } from '../../utils'
import { app } from 'electron'
import { getFileFilter, getExtension } from '../../../shared/file-types'

export function registerDraftTransferHandlers(): void {
  ipcMain.handle('draft:import', async () => {
    const win = getMainWindow()
    if (!win) return
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入草稿',
      filters: [getFileFilter('draft')],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return

    try {
      const tempDir = join(app.getPath('temp'), `draft-import-${randomUUID()}`)
      ensureDir(tempDir)
      new AdmZip(filePaths[0]).extractAllTo(tempDir, true)

      if (
        !existsSync(join(tempDir, 'template.json')) ||
        !existsSync(join(tempDir, 'draftState.json'))
      ) {
        const subs = readdirSync(tempDir, { withFileTypes: true }).filter((d) => d.isDirectory())
        if (subs.length === 1) {
          const possibleDir = join(tempDir, subs[0].name)
          if (
            existsSync(join(possibleDir, 'template.json')) &&
            existsSync(join(possibleDir, 'draftState.json'))
          ) {
            for (const entry of readdirSync(possibleDir, { withFileTypes: true })) {
              const src = join(possibleDir, entry.name)
              const dest = join(tempDir, entry.name)
              if (entry.isDirectory()) copyDirRecursive(src, dest)
              else copyFileSync(src, dest)
            }
          }
        }
      }

      if (
        !existsSync(join(tempDir, 'template.json')) ||
        !existsSync(join(tempDir, 'draftState.json'))
      ) {
        rmSync(tempDir, { recursive: true, force: true })
        dialog.showErrorBox('导入失败', '无效的草稿包，缺少 template.json 或 draftState.json')
        return
      }

      const draftId = randomUUID()
      const targetDir = join(getDraftsPath(), draftId)
      ensureDir(targetDir)
      copyFileSync(join(tempDir, 'template.json'), join(targetDir, 'template.json'))
      copyFileSync(join(tempDir, 'draftState.json'), join(targetDir, 'draftState.json'))
      if (existsSync(join(tempDir, 'media'))) {
        copyDirRecursive(join(tempDir, 'media'), join(targetDir, 'media'))
      }
      if (existsSync(join(tempDir, 'uploads'))) {
        copyDirRecursive(join(tempDir, 'uploads'), join(targetDir, 'uploads'))
      }

      rmSync(tempDir, { recursive: true, force: true })
    } catch (err) {
      dialog.showErrorBox('导入草稿失败', String(err))
    }
  })

  ipcMain.handle('draft:exportDraft', async (_event, draftId: string) => {
    const win = getMainWindow()
    if (!win) return
    const draftDir = join(getDraftsPath(), draftId)
    if (!existsSync(draftDir)) {
      dialog.showErrorBox('导出失败', '草稿不存在')
      return
    }
    try {
      const zip = new AdmZip()
      const files = readdirSync(draftDir, { recursive: true, withFileTypes: true })
      for (const f of files) {
        if (f.isFile()) {
          const fullPath = join(f.parentPath ?? draftDir, f.name)
          const relative = fullPath.replace(draftDir + '/', '').replace(draftDir + '\\', '')
          zip.addLocalFile(fullPath, '', relative.replace(/\\/g, '/'))
        }
      }
      const buffer = zip.toBuffer()

      const { filePath } = await dialog.showSaveDialog(win, {
        title: '导出草稿包',
        defaultPath: `草稿_${draftId.substring(0, 8)}.${getExtension('draft')}`,
        filters: [getFileFilter('draft')]
      })
      if (!filePath) return

      writeFileSync(filePath, buffer)
    } catch (err) {
      dialog.showErrorBox('导出草稿失败', String(err))
    }
  })
}
