/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const builder = require('electron-builder')

// ==========================================
// 1. 工具函数
// ==========================================

/**
 * 安全执行 Shell 命令，失败时返回默认值
 * @param {string} cmd
 * @param {string} fallback
 */
function safeRun(cmd, fallback = '') {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch {
    return fallback
  }
}

/**
 * 格式化当前本地日期为 YYYYMMDD
 */
function getLocalDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/**
 * 清洗并格式化 Git 用户名
 */
function getSanitizedGitUser() {
  const rawUser = safeRun('git config user.name', 'unknown')
  return (
    rawUser
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown'
  )
}

/**
 * 根据模式生成最终的版本号
 */
function generateVersion(mode, baseVersion) {
  const dateStr = getLocalDateString()
  const hash = safeRun('git rev-parse --short HEAD', 'nohash')
  const isDirty = !!safeRun('git status --porcelain', '')
  const dirtySuffix = isDirty ? '.dirty' : ''

  switch (mode) {
    case 'local': {
      const gitUser = getSanitizedGitUser()
      return `${baseVersion}-local.${gitUser}.${dateStr}.${hash}${dirtySuffix}`
    }
    case 'dev':
      return `${baseVersion}-dev.${dateStr}.${hash}${dirtySuffix}`
    case 'nightly':
      return `${baseVersion}-nightly.${dateStr}`
    case 'release':
    default:
      return baseVersion
  }
}

// ==========================================
// 2. 主流程
// ==========================================

async function main() {
  const args = process.argv.slice(2)

  // 解析命令行参数
  const dirBuild = args.includes('--dir')
  let mode = 'local'
  if (args.includes('--dev')) mode = 'dev'
  else if (args.includes('--nightly')) mode = 'nightly'
  else if (args.includes('--release')) mode = 'release'

  const root = __dirname
  const pkgPath = path.join(root, 'package.json')

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`找不到 package.json，路径：${pkgPath}`)
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const version = generateVersion(mode, pkg.version)

  console.log(`\n[Build Info] Mode: ${mode} | Version: ${version}\n`)

  // 1. 构建前端产物
  console.log('Running frontend build...')
  execSync('yarn build', { stdio: 'inherit', cwd: root })

  // 2. 配置 Electron 编译选项
  const buildOptions = {
    config: {
      extraMetadata: { version }
    },
    targets: builder.Platform.WINDOWS.createTarget(dirBuild ? 'dir' : undefined)
  }

  // 3. 执行打包
  console.log('Starting electron-builder...')
  const result = await builder.build(buildOptions)
  console.log('Build completed successfully:', result)
}

// 启动执行
main().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
