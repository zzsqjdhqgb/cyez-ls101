import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { info } = vi.hoisted(() => ({ info: vi.fn() }))
vi.mock('@playwright/test', () => ({ test: { info } }))
vi.mock('../../integration/support/electron-app', () => ({}))

function screenshot(color: number, width = 8): Buffer {
  const png = new PNG({ width, height: 8 })
  for (let index = 0; index < png.data.length; index += 4) {
    png.data.fill(color, index, index + 3)
    png.data[index + 3] = 255
  }
  return PNG.sync.write(png)
}

describe('visual check diagnostics', () => {
  let directory: string
  let baseline: string
  let output: string
  const attach = vi.fn()

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-diagnostics-'))
    baseline = path.join(directory, 'tests/visual/baselines/UI-WB-01/default.png')
    output = path.join(directory, 'test-results/visual/failing-test')
    await mkdir(path.dirname(baseline), { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    vi.stubEnv('LS101_VISUAL_MODE', 'check')
    vi.stubEnv('LS101_VISUAL_CANONICAL', '1')
    attach.mockReset()
    info.mockReturnValue({ outputPath: (name: string) => path.join(output, name), attach })
    vi.resetModules()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })

  async function capture(actual: Buffer): Promise<string> {
    const { captureState } = await import('./visual-app')
    const page = {
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(actual)
    } as unknown as Page
    return captureState(page, 'UI-WB-01', 'default')
  }

  it('keeps the baseline unchanged and attaches actual, expected and pixel diff on failure', async () => {
    const expected = screenshot(255)
    const actual = screenshot(0)
    await writeFile(baseline, expected)

    await expect(capture(actual)).rejects.toThrow('视觉回归差异')

    expect(await readFile(baseline)).toEqual(expected)
    expect(await readFile(path.join(output, 'UI-WB-01-default-actual.png'))).toEqual(actual)
    expect(await readFile(path.join(output, 'UI-WB-01-default-expected.png'))).toEqual(expected)
    const diff = PNG.sync.read(await readFile(path.join(output, 'UI-WB-01-default-diff.png')))
    expect([diff.width, diff.height]).toEqual([8, 8])
    expect([...diff.data.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect(attach.mock.calls.map(([name]) => name)).toEqual([
      'UI-WB-01-default-actual',
      'UI-WB-01-default-expected',
      'UI-WB-01-default-diff'
    ])
    for (const [, attachment] of attach.mock.calls) {
      expect(attachment.contentType).toBe('image/png')
      expect(await readFile(attachment.path)).toBeInstanceOf(Buffer)
    }
  })

  it('does not create failure artifacts when the screenshot matches', async () => {
    const image = screenshot(255)
    await writeFile(baseline, image)
    await expect(capture(image)).resolves.toBe(baseline)
    expect(attach).not.toHaveBeenCalled()
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains the actual screenshot without creating a missing baseline', async () => {
    const actual = screenshot(0)
    await expect(capture(actual)).rejects.toThrow('缺少视觉基线')
    expect(await readFile(path.join(output, 'UI-WB-01-default-actual.png'))).toEqual(actual)
    expect(await readdir(output)).toEqual(['UI-WB-01-default-actual.png'])
    await expect(readFile(baseline)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['different dimensions', screenshot(255, 12)],
    ['an unreadable baseline', Buffer.from('invalid PNG')]
  ])('retains both inputs without a diff for %s', async (_reason, expected) => {
    const actual = screenshot(0)
    await writeFile(baseline, expected)
    await expect(capture(actual)).rejects.toThrow('视觉回归差异')
    expect(await readFile(baseline)).toEqual(expected)
    expect(await readdir(output)).toEqual([
      'UI-WB-01-default-actual.png',
      'UI-WB-01-default-expected.png'
    ])
    expect(await readFile(path.join(output, 'UI-WB-01-default-actual.png'))).toEqual(actual)
    expect(await readFile(path.join(output, 'UI-WB-01-default-expected.png'))).toEqual(expected)
  })
})
