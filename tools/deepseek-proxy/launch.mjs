#!/usr/bin/env node
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * deepseek_key_proxy.py 的跨平台启动器，供 package.json 里的 yarn 脚本使用。
 *
 * 为什么需要它：Windows 上解释器叫 python（或 py），Linux/macOS 上是 python3；
 * 直接用 `python xxx.py` 写在 package.json 里，换一个平台就跑不起来。
 * 这里按平台顺序探测解释器，并把参数、标准输入输出、退出码原样透传
 * （代理需要交互式读 Key，所以必须 stdio: 'inherit'）。
 *
 * 用法：
 *   node tools/deepseek-proxy/launch.mjs [代理参数...]
 *   node tools/deepseek-proxy/launch.mjs --diagnose [诊断参数...]
 *   node tools/deepseek-proxy/launch.mjs --usage [统计参数...]
 *   node tools/deepseek-proxy/launch.mjs --test [unittest 参数...]
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 子命令 → Python 脚本；没有子命令就是启动代理本身。 */
const MODES = {
  '--diagnose': 'diagnose.py',
  '--usage': 'usage_report.py',
  '--test': 'test_deepseek_key_proxy.py'
}

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const script = join(here, MODES[argv[0]] ?? 'deepseek_key_proxy.py')
const passthrough = MODES[argv[0]] ? argv.slice(1) : argv

/** 按平台给出候选解释器；py 需要 -3 才是 Python 3。 */
const CANDIDATES =
  process.platform === 'win32'
    ? [
        { command: 'python', prefix: [] },
        { command: 'py', prefix: ['-3'] },
        { command: 'python3', prefix: [] }
      ]
    : [
        { command: 'python3', prefix: [] },
        { command: 'python', prefix: [] }
      ]

let lastError = null
for (const { command, prefix } of CANDIDATES) {
  // -X utf8：Windows 重定向输出时默认是 cp936，中文与 ⚠/≈ 会编码失败
  const args = [...prefix, '-X', 'utf8', script, ...passthrough]
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    lastError = result.error
    if (result.error.code === 'ENOENT') continue
    console.error(`启动 ${command} 失败：${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status === null ? 1 : result.status)
}

const tried = CANDIDATES.map((candidate) => candidate.command).join(', ')
console.error(`没有找到可用的 Python 3 解释器（尝试过：${tried}）。`)
console.error(
  '请安装 Python 3.8+ 后重试：Windows 见 https://www.python.org/downloads/ ，Linux 可 apt-get install -y python3 。'
)
if (lastError) console.error(`最后一次错误：${lastError.message}`)
process.exit(1)
