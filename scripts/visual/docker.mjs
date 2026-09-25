/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * 视觉回归 Docker 入口（复用产品文档的 canonical 渲染镜像）。
 *
 *   node scripts/visual/docker.mjs build     # 构建/复用共享渲染镜像
 *   node scripts/visual/docker.mjs publish   # 容器内写入 tests/visual/baselines
 *   node scripts/visual/docker.mjs check     # 容器内校验基线与仓库一致
 *
 * 镜像的 ENTRYPOINT 固定为产品文档 runner，因此这里以 --entrypoint node 复用同一镜像。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dockerBuildArguments, imageName, runDocker } from '../product-docs/docker.mjs'
import { readRendererVersion } from '../product-docs/environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptDirectory, '..', '..')
const platform = 'linux/amd64'

export function parseVisualDockerAction(args) {
  if (args.length !== 1 || !['build', 'publish', 'check'].includes(args[0])) {
    throw new Error('用法：node scripts/visual/docker.mjs <build|publish|check>')
  }
  return args[0]
}

export function visualVolumePrefix(repositoryRoot = defaultRepositoryRoot) {
  const normalized =
    process.platform === 'win32'
      ? path.resolve(repositoryRoot).toLowerCase()
      : path.resolve(repositoryRoot)
  const digest = createHash('sha256').update(`${normalized}:visual`).digest('hex').slice(0, 12)
  return `ls101-visual-regression-${digest}-v${readRendererVersion(repositoryRoot).replaceAll('.', '-')}`
}

export function visualRunArguments(action, repositoryRoot = defaultRepositoryRoot) {
  if (!['publish', 'check'].includes(action)) throw new Error(`不支持的容器操作：${action}`)
  const prefix = visualVolumePrefix(repositoryRoot)
  return [
    'run',
    '--rm',
    '--platform',
    platform,
    '--shm-size',
    '1g',
    '--entrypoint',
    'node',
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
    'scripts/visual/container-runner.mjs',
    action
  ]
}

export function main(args = process.argv.slice(2), dependencies = {}) {
  const action = parseVisualDockerAction(args)
  const repositoryRoot = dependencies.repositoryRoot ?? defaultRepositoryRoot
  const spawn = dependencies.spawn ?? spawnSync
  const usePrebuiltImage =
    dependencies.usePrebuiltImage ?? process.env['LS101_VISUAL_PREBUILT_IMAGE'] === '1'

  const daemonStatus = runDocker(['version', '--format', '{{.Server.Version}}'], {
    repositoryRoot,
    spawn
  })
  if (daemonStatus !== 0) return daemonStatus

  const buildStatus = usePrebuiltImage
    ? runDocker(['image', 'inspect', imageName(repositoryRoot)], { repositoryRoot, spawn })
    : runDocker(dockerBuildArguments(repositoryRoot), { repositoryRoot, spawn })
  if (buildStatus !== 0 || action === 'build') return buildStatus

  return runDocker(visualRunArguments(action, repositoryRoot), { repositoryRoot, spawn })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
