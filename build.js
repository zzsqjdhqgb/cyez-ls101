/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const builder = require('electron-builder')

const BUILD_MODES = new Set(['local', 'dev', 'nightly', 'release'])
const BUILD_PLATFORMS = new Set(['win', 'linux'])

function safeRun(command, fallback = '') {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch {
    return fallback
  }
}

function getLocalDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function getSanitizedGitUser() {
  const rawUser = safeRun('git config user.name', 'unknown')
  return (
    rawUser
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown'
  )
}

function generateVersion(mode, baseVersion) {
  const date = getLocalDateString()
  const hash = safeRun('git rev-parse --short HEAD', 'nohash')
  const dirtySuffix = safeRun('git status --porcelain') ? '.dirty' : ''

  switch (mode) {
    case 'local':
      return `${baseVersion}-local.${getSanitizedGitUser()}.${date}.${hash}${dirtySuffix}`
    case 'dev':
      return `${baseVersion}-dev.${date}.${hash}${dirtySuffix}`
    case 'nightly':
      return `${baseVersion}-nightly.${date}`
    default:
      return baseVersion
  }
}

function parseArguments(args) {
  let mode = null
  let platform = null
  let dir = false
  let skipModelPackage = false
  let help = false

  const selectMode = (value) => {
    if (mode && mode !== value) throw new Error(`不能同时指定构建模式：${mode}、${value}`)
    mode = value
  }
  const selectPlatform = (value) => {
    if (!BUILD_PLATFORMS.has(value)) throw new Error(`不支持的构建平台：${value}`)
    if (platform && platform !== value) {
      throw new Error(`不能同时指定构建平台：${platform}、${value}`)
    }
    platform = value
  }

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--dir') dir = true
    else if (argument === '--skip-model-package') skipModelPackage = true
    else if (argument === '--help' || argument === '-h') help = true
    else if (argument === '--win') selectPlatform('win')
    else if (argument === '--linux') selectPlatform('linux')
    else if (argument === '--current-platform') selectPlatform(currentBuildPlatform())
    else if (argument.startsWith('--platform=')) {
      selectPlatform(normalizePlatform(argument.slice('--platform='.length)))
    } else if (argument === '--platform') {
      const value = args[++index]
      if (!value) throw new Error('--platform 需要 win、linux 或 current 参数')
      selectPlatform(normalizePlatform(value))
    } else if (argument.startsWith('--') && BUILD_MODES.has(argument.slice(2))) {
      selectMode(argument.slice(2))
    } else {
      throw new Error(`未知构建参数：${argument}`)
    }
  }

  return {
    mode: mode ?? 'local',
    platform: platform ?? 'win',
    dir,
    skipModelPackage,
    help
  }
}

function normalizePlatform(value) {
  if (value === 'current') return currentBuildPlatform()
  if (value === 'windows' || value === 'win32') return 'win'
  return value
}

function currentBuildPlatform() {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'linux') return 'linux'
  throw new Error(`当前操作系统不支持目录构建测试：${process.platform}`)
}

function electronBuilderPlatform(platform) {
  return platform === 'linux' ? builder.Platform.LINUX : builder.Platform.WINDOWS
}

function runApplicationBuild(root, skipQwenTtsDownload) {
  const options = {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      ...(skipQwenTtsDownload ? { LS101_SKIP_QWEN_TTS_DOWNLOAD: '1' } : {})
    }
  }
  if (process.platform === 'win32') {
    const commandInterpreter = process.env['ComSpec'] || process.env['COMSPEC'] || 'cmd.exe'
    execFileSync(commandInterpreter, ['/d', '/s', '/c', 'yarn build'], options)
    return
  }
  execFileSync('yarn', ['build'], options)
}

function printHelp() {
  console.log(`Usage: node build.js [options]

Build mode (default: --local):
  --local | --dev | --nightly | --release

Platform (default: --win):
  --win
  --linux
  --current-platform
  --platform <win|linux|current>

Output:
  --dir                 Build an unpacked application directory
  --skip-model-package  Do not build the separately distributed TTS model ZIP
  --help                Show this help`)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const root = __dirname
  const packagePath = path.join(root, 'package.json')
  if (!fs.existsSync(packagePath)) throw new Error(`找不到 package.json，路径：${packagePath}`)

  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
  const version = generateVersion(options.mode, packageJson.version)
  const targetName = options.dir ? 'dir' : 'configured targets'

  console.log(
    `\n[Build Info] Mode: ${options.mode} | Platform: ${options.platform} | Target: ${targetName} | Version: ${version}\n`
  )

  console.log('Running application build...')
  runApplicationBuild(root, options.skipModelPackage)

  console.log('Starting electron-builder...')
  const platform = electronBuilderPlatform(options.platform)
  const result = await builder.build({
    config: { extraMetadata: { version } },
    targets: platform.createTarget(options.dir ? 'dir' : undefined)
  })

  if (!options.skipModelPackage) {
    console.log('Building external TTS model package...')
    execFileSync(
      process.execPath,
      [path.join(root, 'scripts', 'build-tts-model-package.mjs'), version],
      { stdio: 'inherit', cwd: root }
    )
    console.log('Building external Qwen TTS model package...')
    execFileSync(
      process.execPath,
      [path.join(root, 'scripts', 'qwen-tts', 'prepare-package.mjs')],
      { stdio: 'inherit', cwd: root }
    )
  }

  console.log('Build completed successfully:', result)
}

main().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
