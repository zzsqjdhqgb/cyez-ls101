/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const outputPath = path.join(repositoryRoot, 'docs', 'engineering', 'testing', 'inventory.md')

const configurations = [
  {
    config: 'playwright.config.ts',
    title: 'Electron 集成测试',
    description: '打包应用中的 renderer、preload、main、IPC 和持久化跨层回归。'
  },
  {
    config: 'playwright.components.config.ts',
    title: 'Renderer 组件测试',
    description: '浏览器环境中的组件语义、键盘、焦点、响应式布局和可见状态。'
  }
]

const groups = configurations.map((configuration) => ({
  ...configuration,
  files: listTests(configuration.config)
}))

const lines = [
  '<!-- 此文件由 Playwright 测试发现结果自动生成，请勿手工编辑。 -->',
  '',
  '# Playwright 技术测试清单',
  '',
  '本页只提供技术回归测试的当前盘点和源码入口，不重复维护操作步骤与断言说明。',
  ''
]

for (const group of groups) {
  const testCount = group.files.reduce((count, file) => count + file.tests.length, 0)
  lines.push(`## ${group.title}`, '', `${group.description}当前共 ${testCount} 条测试。`, '')

  for (const file of group.files) {
    const sourcePath = normalizePath(path.join('..', '..', '..', file.file))
    lines.push(
      `### [${path.basename(file.file)}](${sourcePath})`,
      '',
      ...file.tests.map((item) => `- ${item}`),
      ''
    )
  }
}

const total = groups.reduce(
  (count, group) =>
    count + group.files.reduce((fileCount, file) => fileCount + file.tests.length, 0),
  0
)
lines.push(`合计：${total} 条 Playwright 技术回归测试。`, '')

mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${lines.join('\n').trimEnd()}\n`, 'utf8')

function listTests(configFile) {
  const result = spawnSync(
    process.execPath,
    [playwrightCli, 'test', `--config=${configFile}`, '--list', '--reporter=json'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  const report = JSON.parse(result.stdout)
  const files = new Map()
  collectSuites(report.suites ?? [], files, report.config.rootDir)
  return [...files.entries()]
    .map(([file, tests]) => ({ file, tests }))
    .sort((left, right) => left.file.localeCompare(right.file))
}

function collectSuites(suites, files, rootDir, inheritedFile = null) {
  for (const suite of suites) {
    const file = suite.file || inheritedFile
    if (file && Array.isArray(suite.specs) && suite.specs.length > 0) {
      const repositoryRelativeFile = normalizePath(
        path.relative(repositoryRoot, path.resolve(rootDir, file))
      )
      const existing = files.get(repositoryRelativeFile) ?? []
      existing.push(...suite.specs.map((spec) => spec.title))
      files.set(repositoryRelativeFile, existing)
    }
    collectSuites(suite.suites ?? [], files, rootDir, file)
  }
}

function normalizePath(value) {
  return value.split(path.sep).join('/')
}
