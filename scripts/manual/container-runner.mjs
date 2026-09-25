/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * 说明书配图 canonical 容器入口。
 *
 * 只有在专用渲染镜像内才允许写入或校验配图基线：
 *   node scripts/manual/container-runner.mjs publish   # 写入 tests/manual/baselines
 *   node scripts/manual/container-runner.mjs check     # 与已提交基线比较
 *
 * 容器外只能运行 yarn test:manual-figures（preview：只验证用例通过，不校验像素）。
 * 复用逐屏视觉回归的同一渲染镜像与确定性打包版本，但基线目录与门禁独立。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CANONICAL_DISPLAY,
  CANONICAL_DISPLAY_DEPTH,
  CANONICAL_DISPLAY_DPI,
  CANONICAL_DISPLAY_SIZE,
  CANONICAL_MARKER_PATH,
  readRendererVersion
} from '../product-docs/environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..', '..')

export function parseManualAction(args) {
  if (args.length !== 1 || !['publish', 'check'].includes(args[0])) {
    throw new Error('用法：node scripts/manual/container-runner.mjs <publish|check>')
  }
  return args[0]
}

export async function main(args = process.argv.slice(2)) {
  const action = parseManualAction(args)
  if (
    process.env['LS101_MANUAL_CANONICAL'] !== undefined ||
    process.env['LS101_MANUAL_CANONICAL_RUNNER'] !== undefined
  ) {
    throw new Error('canonical 说明书配图环境变量只能由内部发布流程设置，不能从容器外部传入')
  }
  assertRendererIdentity()
  if (action === 'check') {
    run(process.execPath, [
      path.join(repositoryRoot, 'scripts', 'docs', 'check-manual-figures.mjs')
    ])
  }

  mkdirSync(process.env['XDG_RUNTIME_DIR'] ?? '/tmp/ls101-product-docs-runtime', {
    recursive: true,
    mode: 0o700
  })
  const xvfb = startXvfb()
  try {
    await waitForXvfb(xvfb)
    const { version } = verifyRendererVersion()
    console.log(`使用说明书配图渲染器 ${version}`)

    run('yarn', ['install', '--immutable'])
    // 与视觉基线共用同一个确定性打包版本（固定后缀 local.visual），
    // 保证同一界面在两套产物里像素一致。
    run('yarn', ['build:test:visual'])
    run(process.execPath, [path.join(repositoryRoot, 'scripts', 'run-manual-figures.mjs'), action])

    if (action === 'check') assertBaselinesClean()
  } finally {
    xvfb.kill('SIGTERM')
  }
}

function verifyRendererVersion() {
  const expectedVersion = readRendererVersion(repositoryRoot)
  return { version: expectedVersion }
}

function assertRendererIdentity() {
  if (process.platform !== 'linux')
    throw new Error('canonical 说明书配图只能在 Linux 专用容器中生成')
  const expectedVersion = readRendererVersion(repositoryRoot)
  let markerVersion
  try {
    markerVersion = readFileSync(CANONICAL_MARKER_PATH, 'utf8').trim()
  } catch {
    throw new Error(`缺少专用渲染镜像标记 ${CANONICAL_MARKER_PATH}，拒绝生成说明书配图`)
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

function assertBaselinesClean() {
  const result = spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${repositoryRoot}`,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      'tests/manual/baselines'
    ],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git status 失败，退出码 ${result.status ?? 1}`)
  if (result.stdout.trim()) {
    console.error('说明书配图基线重新生成后存在差异：')
    console.error(result.stdout.trimEnd())
    throw new Error('canonical 说明书配图检查失败')
  }
  console.log('canonical 说明书配图与仓库内容一致')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
