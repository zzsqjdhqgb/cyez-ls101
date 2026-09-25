const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { copyFile, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const BASELINE = '../../tests/manual/baselines/FIG-DEMO/default.png'

async function check(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-manual-figures-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const checker = path.join(root, 'scripts', 'docs', 'check-manual-figures.mjs')
  await mkdir(path.dirname(checker), { recursive: true })
  await copyFile(path.join(__dirname, '..', 'docs', 'check-manual-figures.mjs'), checker)

  const manualDir = path.join(root, 'docs', 'manual')
  await mkdir(manualDir, { recursive: true })
  await writeFile(
    path.join(manualDir, 'demo.md'),
    `# 说明书\n\n${options.reference ?? `![图 1-1 示例](${BASELINE})`}\n`
  )

  const specDir = path.join(root, 'tests', 'manual', 'figures')
  await mkdir(specDir, { recursive: true })
  await writeFile(
    path.join(specDir, 'demo.spec.ts'),
    options.source ?? "await captureFigure(page, 'FIG-DEMO')\n"
  )

  if (!options.noBaselines) {
    const baselineRoot = path.join(root, 'tests', 'manual', 'baselines')
    for (const relative of options.baselines ?? ['FIG-DEMO/default.png']) {
      const file = path.join(baselineRoot, relative)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, 'pairing checks filenames only')
    }
    if ((options.baselines ?? ['FIG-DEMO/default.png']).length === 0) {
      await mkdir(path.join(baselineRoot, 'FIG-DEMO'), { recursive: true })
    }
  }

  const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}

test('accepts matching manual reference, capture and baseline', async (t) => {
  const result = await check(t)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /正文引用 1 张；用例捕获 1 张；磁盘基线 1 张/)
})

test('rejects a referenced figure without a baseline', async (t) => {
  const result = await check(t, { baselines: [] })
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /引用的配图缺少基线 -> FIG-DEMO\/default\.png/)
})

test('rejects a baseline that no manual page references', async (t) => {
  const result = await check(t, { baselines: ['FIG-DEMO/default.png', 'FIG-OTHER/default.png'] })
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /FIG-OTHER\/default\.png: 未被任何说明书引用（孤儿配图）/)
})

test('rejects a baseline without a matching capture', async (t) => {
  const result = await check(t, { source: "await captureFigure(page, 'FIG-DEMO', 'other')\n" })
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /FIG-DEMO\/default\.png: 没有对应用例捕获（陈旧基线）/)
})

test('recognises composed captures whose first argument is a nested call', async (t) => {
  const result = await check(t, {
    source: "await captureComposedFigure(composeSplitTheme(light, dark), 'FIG-DEMO')\n"
  })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /用例捕获 1 张/)
})

test('rejects references to the per-screen visual baselines', async (t) => {
  const result = await check(t, {
    reference: '![图 1-1 示例](../../tests/visual/baselines/UI-WB-01/default.png)'
  })
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /不得引用逐屏视觉基线/)
})

test('checks references against captures before the first canonical publish', async (t) => {
  const passing = await check(t, { noBaselines: true })
  assert.equal(passing.status, 0, passing.output)
  assert.match(passing.output, /基线目录尚未建立/)

  const failing = await check(t, {
    noBaselines: true,
    reference: '![图 1-1 示例](../../tests/manual/baselines/FIG-OTHER/default.png)'
  })
  assert.equal(failing.status, 1, failing.output)
  assert.match(failing.output, /正文引用了 FIG-OTHER\/default\.png，但没有配图用例捕获它/)
})

test('warns when one baseline is referenced more than once', async (t) => {
  const result = await check(t, {
    reference: `![图 1-1 示例](${BASELINE})\n\n![图 1-2 同一张图](${BASELINE})`
  })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /重复配图/)
})
