const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { copyFile, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

async function check(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-visual-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const checker = path.join(root, 'scripts', 'docs', 'check-visual.mjs')
  await mkdir(path.dirname(checker), { recursive: true })
  await copyFile(path.join(__dirname, '..', 'docs', 'check-visual.mjs'), checker)

  const screens = path.join(root, 'docs', 'ui', 'screens')
  await mkdir(screens, { recursive: true })
  const visual = options.visual ?? 'VR-WB-01（tests/visual/workbench/UI-WB-01.spec.ts）'
  const declaration = options.declaration ?? '  visual-states: [default]\n'
  await writeFile(
    path.join(screens, 'UI-WB-01.md'),
    `# 工作台\n\n\`\`\`yaml\nanchors:\n  visual: ${visual}\n${declaration}\`\`\`\n`
  )

  if (!options.missingTest) {
    const spec = path.join(root, 'tests', 'visual', 'workbench', 'UI-WB-01.spec.ts')
    await mkdir(path.dirname(spec), { recursive: true })
    await writeFile(spec, options.source ?? "await captureState(page, 'UI-WB-01', 'default')\n")
  }
  if (!options.noBaselines) {
    const baselines = path.join(root, 'tests', 'visual', 'baselines')
    await mkdir(baselines, { recursive: true })
    if (!options.missingBaselineDirectory) {
      const screenBaselines = path.join(baselines, 'UI-WB-01')
      await mkdir(screenBaselines, { recursive: true })
      for (const state of options.baselines ?? ['default']) {
        await writeFile(path.join(screenBaselines, `${state}.png`), 'pairing checks filenames only')
      }
    }
  }

  const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}

test('accepts matching specification, capture and baseline state sets', async (t) => {
  const result = await check(t, {
    declaration: '  visual-states: [default, validation-error]\n',
    source: `await captureState(page, 'UI-WB-01', 'default')
await captureState(
  page,
  "UI-WB-01",
  "validation-error",
)`,
    baselines: ['validation-error', 'default']
  })
  assert.equal(result.status, 0, result.output)
})

test('rejects coordinated test and baseline renaming without a specification update', async (t) => {
  const result = await check(t, {
    source: "await captureState(page, 'UI-WB-01', 'renamed')",
    baselines: ['renamed']
  })
  assert.equal(result.status, 1)
  assert.match(result.output, /规格声明状态 default 未在测试中捕获/)
  assert.match(result.output, /测试捕获了规格未声明的状态 renamed/)
})

test('rejects a declared state that the test does not capture', async (t) => {
  const result = await check(t, {
    declaration: '  visual-states: [default, empty]\n',
    baselines: ['default', 'empty']
  })
  assert.equal(result.status, 1)
  assert.match(result.output, /规格声明状态 empty 未在测试中捕获/)
})

for (const declaration of ['', '  visual-states: []\n', '  visual-states: [default, default]\n']) {
  test(`rejects missing, empty or duplicate state declarations: ${declaration.trim()}`, async (t) => {
    const result = await check(t, { declaration })
    assert.equal(result.status, 1)
    assert.match(result.output, /anchors.visual-states 必须为非空、无重复的状态列表/)
  })
}

test('rejects a missing baseline image', async (t) => {
  const result = await check(t, { baselines: [] })
  assert.equal(result.status, 1)
  assert.match(result.output, /缺少基线 default.png/)
})

test('rejects a stale baseline image', async (t) => {
  const result = await check(t, { baselines: ['default', 'obsolete'] })
  assert.equal(result.status, 1)
  assert.match(result.output, /基线 obsolete.png 未在规格中声明/)
})

test('rejects a missing screen directory once the baseline root exists', async (t) => {
  const result = await check(t, { missingBaselineDirectory: true })
  assert.equal(result.status, 1)
  assert.match(result.output, /缺少基线目录 tests\/visual\/baselines\/UI-WB-01/)
})

test('allows bootstrapping before the entire baseline root exists', async (t) => {
  const result = await check(t, { noBaselines: true })
  assert.equal(result.status, 0, result.output)
})

test('still rejects missing captures before baseline generation', async (t) => {
  const result = await check(t, { noBaselines: true, source: '' })
  assert.equal(result.status, 1)
  assert.match(result.output, /规格声明状态 default 未在测试中捕获/)
})

test('rejects a missing referenced test', async (t) => {
  const result = await check(t, { missingTest: true })
  assert.equal(result.status, 1)
  assert.match(result.output, /visual 锚点指向的测试不存在/)
})

test('rejects captures for a different screen', async (t) => {
  const result = await check(t, { source: "await captureState(page, 'UI-WB-02', 'default')" })
  assert.equal(result.status, 1)
  assert.match(result.output, /测试捕获了其他界面 UI-WB-02/)
})

for (const visual of ['unverified', 'n/a（无界面入口）']) {
  test(`allows an explicit ${visual} exemption without state declarations`, async (t) => {
    const result = await check(t, { visual, declaration: '', missingTest: true, noBaselines: true })
    assert.equal(result.status, 0, result.output)
  })
}
