import { _electron as electron } from 'playwright'
import { PNG } from 'pngjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const reviewRoot = resolve(scriptDir, '..')
const workspace = resolve(reviewRoot, '../..')
const fitRoot = join(reviewRoot, 'outputs', 'fit_program')
const candidatesDir = join(fitRoot, 'candidates')
const rendersDir = join(fitRoot, 'renders')
mkdirSync(rendersDir, { recursive: true })

const palette = {
  blue: [2, 86, 191],
  gold: [253, 166, 22],
  orange: [253, 81, 8],
  red: [239, 34, 24],
  green: [10, 148, 34]
}

function classify(image) {
  const labels = new Int8Array(image.width * image.height).fill(-1)
  const hueCenters = [107, 19, 9, 1, 66]
  for (let pixel = 0, offset = 0; offset < image.data.length; pixel += 1, offset += 4) {
    const red = image.data[offset] / 255
    const green = image.data[offset + 1] / 255
    const blue = image.data[offset + 2] / 255
    const alpha = image.data[offset + 3]
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    const delta = maximum - minimum
    const saturation = maximum === 0 ? 0 : delta / maximum
    if (alpha <= 16 || maximum <= 55 / 255 || saturation <= 32 / 255) continue
    let hueDegrees = 0
    if (delta !== 0) {
      if (maximum === red) hueDegrees = 60 * (((green - blue) / delta) % 6)
      else if (maximum === green) hueDegrees = 60 * ((blue - red) / delta + 2)
      else hueDegrees = 60 * ((red - green) / delta + 4)
    }
    if (hueDegrees < 0) hueDegrees += 360
    const hue = hueDegrees / 2
    let best = Infinity
    let bestIndex = -1
    for (const [index, center] of hueCenters.entries()) {
      const direct = Math.abs(hue - center)
      const distance = Math.min(direct, 180 - direct)
      if (distance < best) {
        best = distance
        bestIndex = index
      }
    }
    if (best < 18) labels[pixel] = bestIndex
  }
  return labels
}

function metrics(source, rendered) {
  const sourceLabels = classify(source)
  const renderLabels = classify(rendered)
  const keys = Object.keys(palette)
  const perColor = {}
  let totalIntersection = 0
  let totalUnion = 0
  for (const [colorIndex, key] of keys.entries()) {
    let intersection = 0
    let union = 0
    let sourceOnly = 0
    let renderOnly = 0
    for (let pixel = 0; pixel < sourceLabels.length; pixel += 1) {
      const a = sourceLabels[pixel] === colorIndex
      const b = renderLabels[pixel] === colorIndex
      if (a && b) intersection += 1
      if (a || b) union += 1
      if (a && !b) sourceOnly += 1
      if (!a && b) renderOnly += 1
    }
    totalIntersection += intersection
    totalUnion += union
    perColor[key] = {
      iou: Number((intersection / union).toFixed(6)),
      source_only_px: sourceOnly,
      render_only_px: renderOnly
    }
  }
  const meanIou = keys.reduce((sum, key) => sum + perColor[key].iou, 0) / keys.length
  const overallIou = totalIntersection / totalUnion
  return {
    overall_iou: Number(overallIou.toFixed(6)),
    mean_color_iou: Number(meanIou.toFixed(6)),
    selection_score: Number((overallIou * 0.5 + meanIou * 0.5).toFixed(6)),
    per_color: perColor
  }
}

async function capture(app, page, url, output) {
  await page.goto(url)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  const bytes = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(output, Buffer.from(bytes, 'base64'))
}

const manifest = JSON.parse(readFileSync(join(fitRoot, 'manifest.json'), 'utf8'))
const sourcePath = resolve(workspace, manifest.source)
const source = PNG.sync.read(readFileSync(sourcePath))
const app = await electron.launch({
  executablePath: resolve(workspace, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', join(scriptDir, 'electron-launcher.cjs')]
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1254, height: 1254 })

const results = []
try {
  for (const candidate of manifest.candidates) {
    const svgPath = resolve(workspace, candidate.svg)
    const renderPath = join(rendersDir, `${candidate.name}.png`)
    await capture(app, page, pathToFileURL(svgPath).href, renderPath)
    const svg = readFileSync(svgPath, 'utf8')
    const rendered = PNG.sync.read(readFileSync(renderPath))
    results.push({
      ...candidate,
      cubic_commands: (svg.match(/[Cc]/g) ?? []).length,
      line_commands: (svg.match(/[LlHhVv]/g) ?? []).length,
      metrics: metrics(source, rendered),
      render: renderPath
    })
  }
} finally {
  await app.close()
}

results.sort((left, right) => right.metrics.selection_score - left.metrics.selection_score)
const report = { source: manifest.source, ranking: results }
writeFileSync(join(fitRoot, 'evaluation.json'), JSON.stringify(report, null, 2))
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
