/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import process from 'node:process'
import { FILE_TYPES, type FileType } from '../../shared/file-types'

function regAdd(key: string, value: string, data: string): void {
  try {
    execSync(`reg add "${key}" /v "${value}" /d "${data}" /f`, {
      encoding: 'utf-8',
      windowsHide: true
    })
  } catch {
    /* registry write may fail silently in restricted environments */
  }
}

function getFileIconPath(ext: string): string | null {
  const iconFileName = `${ext}.ico`
  const bundled = join(process.resourcesPath, 'assets', 'file-icons', iconFileName)
  if (existsSync(bundled)) return bundled
  const src = join(app.getAppPath(), 'assets', 'file-icons', iconFileName)
  if (existsSync(src)) return src
  return null
}

function registerOnWindows(exePath: string): void {
  const quoted = `"${exePath}"`
  for (const [, config] of Object.entries(FILE_TYPES)) {
    const ext = config.extension
    const progId = `cyez.${ext}`
    const extKey = `HKCU\\Software\\Classes\\.${ext}`
    const progKey = `HKCU\\Software\\Classes\\${progId}`
    const cmdKey = `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`
    const iconKey = `HKCU\\Software\\Classes\\${progId}\\DefaultIcon`
    const explorerExtKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}`

    regAdd(extKey, '', progId)
    regAdd(progKey, '', config.description)
    regAdd(cmdKey, '', `${quoted} "%1"`)

    const iconPath = getFileIconPath(ext)
    if (iconPath) {
      regAdd(iconKey, '', `"${iconPath}"`)
    } else {
      regAdd(iconKey, '', `${quoted},0`)
    }

    try {
      execSync(`reg delete "${explorerExtKey}" /f`, {
        encoding: 'utf-8',
        windowsHide: true
      })
    } catch {
      /* may not exist */
    }
  }
}

export function registerFileAssociations(): void {
  if (process.platform !== 'win32') return

  const exePath = app.getPath('exe')
  if (!exePath) return

  try {
    registerOnWindows(exePath)
  } catch {
    /* best-effort registration, don't crash the app */
  }
}

export function removeFileAssociations(): boolean {
  if (process.platform !== 'win32') return false

  let removed = false
  for (const [, config] of Object.entries(FILE_TYPES)) {
    const ext = config.extension
    const progId = `cyez.${ext}`
    const extKey = `HKCU\\Software\\Classes\\.${ext}`
    const progKey = `HKCU\\Software\\Classes\\${progId}`
    const explorerExtKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}`

    try {
      execSync(`reg delete "${extKey}" /f`, { encoding: 'utf-8', windowsHide: true })
      removed = true
    } catch {
      /* may not exist */
    }
    try {
      execSync(`reg delete "${progKey}" /f`, { encoding: 'utf-8', windowsHide: true })
      removed = true
    } catch {
      /* may not exist */
    }
    try {
      execSync(`reg delete "${explorerExtKey}" /f`, { encoding: 'utf-8', windowsHide: true })
    } catch {
      /* may not exist */
    }
  }
  return removed
}

export function resetFileAssociationCache(): boolean {
  if (process.platform !== 'win32') return false

  const psScript = [
    'ie4uinit.exe -show',
    'Stop-Process -Name explorer -Force 2>$null',
    'Start-Process explorer'
  ].join('; ')

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')

  try {
    execSync(
      `powershell -NoProfile -Command "Start-Process -Verb RunAs -WindowStyle Hidden -FilePath powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}'"`,
      { encoding: 'utf-8', windowsHide: true }
    )
    return true
  } catch {
    return false
  }
}

export function resolveFileType(filePath: string): FileType | null {
  const ext = filePath.split('.').pop()
  if (!ext) return null
  const lower = ext.toLowerCase()
  for (const [key, config] of Object.entries(FILE_TYPES)) {
    if (config.extension === lower) return key as FileType
  }
  return null
}
