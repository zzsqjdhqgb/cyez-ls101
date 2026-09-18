/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CANONICAL_DISPLAY,
  CANONICAL_DISPLAY_DEPTH,
  CANONICAL_DISPLAY_DPI,
  CANONICAL_DISPLAY_SIZE,
  verifyCanonicalEnvironment,
  readRendererVersion,
  CANONICAL_MARKER_PATH
} from './environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..', '..')

export function parseContainerAction(args) {
  if (args.length !== 1 || !['publish', 'check'].includes(args[0])) {
    throw new Error('用法：node scripts/product-docs/container-runner.mjs <publish|check>')
  }
  return args[0]
}

export async function main(args = process.argv.slice(2)) {
  const action = parseContainerAction(args)
  if (
    process.env['PRODUCT_DOCS_CANONICAL'] !== undefined ||
    process.env['PRODUCT_DOCS_CANONICAL_RUNNER'] !== undefined
  ) {
    throw new Error('canonical runner 环境变量只能由内部发布流程设置，不能从容器外部传入')
  }
  assertRendererIdentity()

  mkdirSync(process.env['XDG_RUNTIME_DIR'] ?? '/tmp/ls101-product-docs-runtime', {
    recursive: true,
    mode: 0o700
  })
  const xvfb = startXvfb()
  try {
    await waitForXvfb(xvfb)
    const { version } = verifyCanonicalEnvironment({ repositoryRoot })
    console.log(`使用产品文档渲染器 ${version}`)

    run('yarn', ['install', '--immutable'])
    run('yarn', ['build:test'])
    run(process.execPath, [path.join(repositoryRoot, 'scripts', 'run-product-docs.mjs'), 'publish'])

    if (action === 'check') assertCanonicalFilesClean()
  } finally {
    xvfb.kill('SIGTERM')
  }
}

function assertRendererIdentity() {
  if (process.platform !== 'linux') throw new Error('canonical 产品文档只能在 Linux 专用容器中发布')
  const expectedVersion = readRendererVersion(repositoryRoot)
  let markerVersion
  try {
    markerVersion = readFileSync(CANONICAL_MARKER_PATH, 'utf8').trim()
  } catch {
    throw new Error(`缺少专用渲染镜像标记 ${CANONICAL_MARKER_PATH}，拒绝启动产品文档测试`)
  }
  if (markerVersion !== expectedVersion) {
    throw new Error(`渲染器版本不匹配：仓库要求 ${expectedVersion}，镜像提供 ${markerVersion}`)
  }
}

function startXvfb() {
  const [width, height] = CANONICAL_DISPLAY_SIZE.split('x')
  return spawn(
    'Xvfb',
    [
      CANONICAL_DISPLAY,
      '-screen',
      '0',
      `${width}x${height}x${CANONICAL_DISPLAY_DEPTH}`,
      '-dpi',
      String(CANONICAL_DISPLAY_DPI),
      '-nolisten',
      'tcp',
      '-noreset'
    ],
    { cwd: repositoryRoot, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] }
  )
}

async function waitForXvfb(xvfb) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (xvfb.exitCode !== null) throw new Error(`Xvfb 启动失败，退出码 ${xvfb.exitCode}`)
    const probe = spawnSync('xdpyinfo', ['-display', CANONICAL_DISPLAY], { stdio: 'ignore' })
    if (probe.status === 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Xvfb ${CANONICAL_DISPLAY} 在 5 秒内未就绪`)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} 失败，退出码 ${result.status ?? 1}`)
}

function assertCanonicalFilesClean() {
  const result = spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${repositoryRoot}`,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      'docs/product'
    ],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git status 失败，退出码 ${result.status ?? 1}`)
  if (result.stdout.trim()) {
    console.error('canonical 产品文档重新生成后存在差异：')
    console.error(result.stdout.trimEnd())
    throw new Error('canonical 产品文档检查失败')
  }
  console.log('canonical 产品文档与仓库内容一致')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
