/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const CANONICAL_MARKER_PATH = '/etc/ls101-product-docs-renderer-version'
export const CANONICAL_DISPLAY = ':99'
export const CANONICAL_DISPLAY_SIZE = '1600x1200'
export const CANONICAL_DISPLAY_DEPTH = 24
export const CANONICAL_DISPLAY_DPI = 96

const REQUIRED_ENVIRONMENT = Object.freeze({
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  TZ: 'Etc/UTC',
  DISPLAY: CANONICAL_DISPLAY,
  GDK_BACKEND: 'x11',
  GDK_SCALE: '1',
  GDK_DPI_SCALE: '1',
  QT_QPA_PLATFORM: 'xcb',
  QT_SCALE_FACTOR: '1',
  LIBGL_ALWAYS_SOFTWARE: '1',
  MESA_LOADER_DRIVER_OVERRIDE: 'llvmpipe'
})

const REQUIRED_FONTS = Object.freeze([
  ['Inter', 'Inter'],
  ['Noto Sans', 'Noto Sans'],
  ['Noto Sans CJK SC', 'Noto Sans CJK SC'],
  ['Liberation Sans', 'Liberation Sans']
])

export function rendererVersionPath(repositoryRoot) {
  return path.join(repositoryRoot, 'docker', 'product-docs', 'renderer-version')
}

export function readRendererVersion(repositoryRoot) {
  const version = readFileSync(rendererVersionPath(repositoryRoot), 'utf8').trim()
  if (!/^\d+(?:\.\d+)*$/.test(version)) {
    throw new Error(`产品文档渲染器版本无效：${version || '(empty)'}`)
  }
  return version
}

export function verifyCanonicalEnvironment({
  repositoryRoot = process.cwd(),
  requireCanonicalFlag = false
} = {}) {
  const problems = []
  if (process.platform !== 'linux') {
    problems.push(`操作系统必须是 Linux，当前为 ${process.platform}`)
  }

  const expectedVersion = readRendererVersion(repositoryRoot)
  let markerStat = null
  let markerVersion = null
  try {
    markerStat = statSync(CANONICAL_MARKER_PATH)
    markerVersion = readFileSync(CANONICAL_MARKER_PATH, 'utf8').trim()
  } catch (error) {
    problems.push(
      `缺少专用渲染镜像标记 ${CANONICAL_MARKER_PATH}：${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (markerVersion !== null && markerVersion !== expectedVersion) {
    problems.push(`渲染器版本不匹配：仓库要求 ${expectedVersion}，镜像提供 ${markerVersion}`)
  }
  if (markerStat && (markerStat.uid !== 0 || (markerStat.mode & 0o777) !== 0o444)) {
    problems.push('渲染器标记必须由 root 拥有且权限为 0444')
  }

  for (const [name, expected] of Object.entries(REQUIRED_ENVIRONMENT)) {
    if (process.env[name] !== expected) {
      problems.push(`${name} 必须为 ${expected}，当前为 ${process.env[name] ?? '(unset)'}`)
    }
  }

  if (requireCanonicalFlag && process.env['PRODUCT_DOCS_CANONICAL'] !== '1') {
    problems.push('PRODUCT_DOCS_CANONICAL 必须由 canonical runner 设置为 1')
  }

  const charmap = commandOutput('locale', ['charmap'], problems)
  if (charmap && charmap.toUpperCase() !== 'UTF-8') {
    problems.push(`locale charmap 必须为 UTF-8，当前为 ${charmap}`)
  }

  const display = commandOutput('xdpyinfo', ['-display', CANONICAL_DISPLAY], problems)
  if (display) {
    if (!display.includes(`dimensions:    ${CANONICAL_DISPLAY_SIZE} pixels`)) {
      problems.push(`Xvfb 分辨率必须为 ${CANONICAL_DISPLAY_SIZE}`)
    }
    if (
      !display.includes(
        `resolution:    ${CANONICAL_DISPLAY_DPI}x${CANONICAL_DISPLAY_DPI} dots per inch`
      )
    ) {
      problems.push(`Xvfb DPI 必须为 ${CANONICAL_DISPLAY_DPI}`)
    }
    if (!display.includes(`depth of root window:    ${CANONICAL_DISPLAY_DEPTH} planes`)) {
      problems.push(`Xvfb 色深必须为 ${CANONICAL_DISPLAY_DEPTH}`)
    }
  }

  for (const [query, expectedFamily] of REQUIRED_FONTS) {
    const family = commandOutput('fc-match', ['--format=%{family}', query], problems)
    if (
      family &&
      !family
        .split(',')
        .map((item) => item.trim())
        .includes(expectedFamily)
    ) {
      problems.push(`字体 ${query} 必须解析为 ${expectedFamily}，当前为 ${family}`)
    }
  }

  try {
    statSync('/dev/dri')
    problems.push('专用渲染容器不得挂载主机 GPU 设备 /dev/dri')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (problems.length > 0) {
    throw new Error(`canonical 产品文档环境校验失败：\n- ${problems.join('\n- ')}`)
  }

  return { version: expectedVersion }
}

function commandOutput(command, args, problems) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  } catch (error) {
    problems.push(
      `无法执行 ${command} ${args.join(' ')}：${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}
