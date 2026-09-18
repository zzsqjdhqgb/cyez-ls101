/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRendererVersion } from './environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptDirectory, '..', '..')
const imageRepository = 'ls101-product-docs-renderer'
const platform = 'linux/amd64'

export function parseDockerAction(args) {
  if (args.length !== 1 || !['build', 'publish', 'check'].includes(args[0])) {
    throw new Error('用法：node scripts/product-docs/docker.mjs <build|publish|check>')
  }
  return args[0]
}

export function imageName(repositoryRoot = defaultRepositoryRoot) {
  return `${imageRepository}:${readRendererVersion(repositoryRoot)}`
}

export function volumePrefix(repositoryRoot = defaultRepositoryRoot) {
  const normalized =
    process.platform === 'win32'
      ? path.resolve(repositoryRoot).toLowerCase()
      : path.resolve(repositoryRoot)
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12)
  return `ls101-product-docs-${digest}-v${readRendererVersion(repositoryRoot).replaceAll('.', '-')}`
}

export function dockerBuildArguments(repositoryRoot = defaultRepositoryRoot) {
  return [
    'build',
    '--platform',
    platform,
    '--file',
    path.join(repositoryRoot, 'docker', 'product-docs', 'Dockerfile'),
    '--tag',
    imageName(repositoryRoot),
    repositoryRoot
  ]
}

export function dockerRunArguments(action, repositoryRoot = defaultRepositoryRoot) {
  if (!['publish', 'check'].includes(action)) throw new Error(`不支持的容器操作：${action}`)
  const prefix = volumePrefix(repositoryRoot)
  return [
    'run',
    '--rm',
    '--platform',
    platform,
    '--shm-size',
    '1g',
    '--mount',
    `type=bind,source=${path.resolve(repositoryRoot)},target=/workspace`,
    '--mount',
    `type=volume,source=${prefix}-node-modules,target=/workspace/node_modules`,
    '--mount',
    `type=volume,source=${prefix}-dist,target=/workspace/dist`,
    '--mount',
    `type=volume,source=${prefix}-out,target=/workspace/out`,
    '--mount',
    `type=volume,source=${prefix}-assets,target=/workspace/assets`,
    '--mount',
    `type=volume,source=${prefix}-qwen-tts,target=/workspace/externals/ai/qwen3-tts`,
    '--mount',
    `type=volume,source=${prefix}-yarn-cache,target=/yarn/cache`,
    imageName(repositoryRoot),
    action
  ]
}

export function runDocker(
  args,
  { repositoryRoot = defaultRepositoryRoot, spawn = spawnSync } = {}
) {
  const result = spawn('docker', args, { cwd: repositoryRoot, stdio: 'inherit' })
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('找不到 Docker CLI。请安装并启动 Docker Desktop 或 Docker Engine。')
    }
    throw result.error
  }
  return result.status ?? 1
}

export function main(args = process.argv.slice(2), dependencies = {}) {
  const action = parseDockerAction(args)
  const repositoryRoot = dependencies.repositoryRoot ?? defaultRepositoryRoot
  const spawn = dependencies.spawn ?? spawnSync
  const usePrebuiltImage =
    dependencies.usePrebuiltImage ?? process.env['LS101_PRODUCT_DOCS_PREBUILT_IMAGE'] === '1'

  const daemonStatus = runDocker(['version', '--format', '{{.Server.Version}}'], {
    repositoryRoot,
    spawn
  })
  if (daemonStatus !== 0) return daemonStatus

  const buildStatus = usePrebuiltImage
    ? runDocker(['image', 'inspect', imageName(repositoryRoot)], { repositoryRoot, spawn })
    : runDocker(dockerBuildArguments(repositoryRoot), { repositoryRoot, spawn })
  if (buildStatus !== 0 || action === 'build') return buildStatus

  return runDocker(dockerRunArguments(action, repositoryRoot), { repositoryRoot, spawn })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
