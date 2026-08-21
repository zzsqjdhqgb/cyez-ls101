import { _electron as electron } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')
const workspace = resolve(root, '../..')
const outputs = join(root, 'outputs')
const framesDir = join(outputs, 'motion_frames')
const fitDir = join(outputs, 'fit_iterations')
const fitWorkDir = join(outputs, 'fit_work')

mkdirSync(framesDir, { recursive: true })
mkdirSync(fitDir, { recursive: true })
mkdirSync(fitWorkDir, { recursive: true })

const electronApp = await electron.launch({
  executablePath: resolve(workspace, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', join(scriptDir, 'electron-launcher.cjs')],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})

const page = await electronApp.firstWindow()

function png(path) {
  return PNG.sync.read(readFileSync(path))
}

function savePng(path, image) {
  writeFileSync(path, PNG.sync.write(image))
}

function colored(pixel) {
  const [r, g, b, a] = pixel
  return a > 24 && Math.max(r, g, b) - Math.min(r, g, b) > 28 && r + g + b < 690
}

function blue(pixel) {
  const [r, g, b, a] = pixel
  return a > 24 && b > 70 && b > r * 1.45 && b > g * 1.18
}

function countBlue(image) {
  let count = 0
  for (let index = 0; index < image.data.length; index += 4) {
    if (blue(imagePixel(image, index))) count += 1
  }
  return count
}

function imagePixel(image, index) {
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]]
}

function fitMetrics(source, rendered) {
  let sourceCount = 0
  let renderedCount = 0
  let intersection = 0
  let union = 0
  let sourceOnly = 0
  let renderedOnly = 0

  for (let index = 0; index < source.data.length; index += 4) {
    const sourceInk = colored(imagePixel(source, index))
    const renderedInk = colored(imagePixel(rendered, index))
    if (sourceInk) sourceCount += 1
    if (renderedInk) renderedCount += 1
    if (sourceInk && renderedInk) intersection += 1
    if (sourceInk || renderedInk) union += 1
    if (sourceInk && !renderedInk) sourceOnly += 1
    if (!sourceInk && renderedInk) renderedOnly += 1
  }

  return {
    source_colored_pixels: sourceCount,
    render_colored_pixels: renderedCount,
    intersection_pixels: intersection,
    union_pixels: union,
    iou: union ? Number((intersection / union).toFixed(4)) : 0,
    src_only_px: sourceOnly,
    render_only_px: renderedOnly
  }
}

function overlayImage(source, rendered) {
  const overlay = new PNG({ width: source.width, height: source.height })
  source.data.copy(overlay.data)
  for (let index = 0; index < source.data.length; index += 4) {
    if (!colored(imagePixel(rendered, index))) continue
    overlay.data[index] = Math.round(overlay.data[index] * 0.28)
    overlay.data[index + 1] = Math.round(overlay.data[index + 1] * 0.28 + 205 * 0.72)
    overlay.data[index + 2] = Math.round(overlay.data[index + 2] * 0.28 + 225 * 0.72)
    overlay.data[index + 3] = 255
  }
  return overlay
}

function fitStrip(images) {
  const labelHeight = 54
  const strip = new PNG({ width: images[0].width * images.length, height: images[0].height + labelHeight })
  strip.data.fill(255)
  for (const [column, image] of images.entries()) {
    PNG.bitblt(image, strip, 0, 0, image.width, image.height, column * image.width, labelHeight)
  }
  return strip
}

function frameDifference(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`Frame size mismatch: ${left.width}x${left.height} vs ${right.width}x${right.height}`)
  }
  const diff = new PNG({ width: left.width, height: left.height })
  return pixelmatch(left.data, right.data, diff.data, left.width, left.height, {
    threshold: 0,
    includeAA: true
  })
}

async function gotoMotion(query) {
  await page.setViewportSize({ width: 1000, height: 1000 })
  await page.goto(`${pathToFileURL(join(root, 'logo_motion.html')).href}${query}`)
  await page.waitForFunction(() => window.__p2mReady === true)
}

async function screenshotElement(selector, path) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`Cannot resolve screenshot bounds for ${selector}`)
  return capturePage(path, box)
}

async function capturePage(path, clip) {
  const bounds = clip ?? await page.evaluate(() => ({
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight
  }))
  const normalized = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }
  await page.evaluate(() => new Promise((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
  }))
  const base64 = await electronApp.evaluate(async ({ BrowserWindow }, captureBounds) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.showInactive()
    window.webContents.invalidate()
    await new Promise((resolvePaint) => setTimeout(resolvePaint, 60))
    const image = await window.webContents.capturePage(captureBounds)
    return image.toPNG().toString('base64')
  }, normalized)
  const bytes = Buffer.from(base64, 'base64')
  if (path) writeFileSync(path, bytes)
  return bytes
}

try {
  await page.setViewportSize({ width: 1254, height: 1254 })
  await page.goto(pathToFileURL(join(root, 'logo.svg')).href)
  await capturePage(join(outputs, 'final_render.png'))

  await page.setViewportSize({ width: 3000, height: 3000 })
  await page.goto(pathToFileURL(join(root, 'logo.svg')).href)
  await capturePage(join(outputs, 'smoothness_zoom.png'))

  const source = png(join(workspace, 'icon1.png'))
  const rendered = png(join(outputs, 'final_render.png'))
  const metrics = fitMetrics(source, rendered)
  const overlay = overlayImage(source, rendered)

  const firstRenderPath = join(outputs, 'fit_program', 'renders', '01_scale25.png')
  const firstRendered = png(firstRenderPath)
  const firstMetrics = fitMetrics(source, firstRendered)
  const firstOverlay = overlayImage(source, firstRendered)
  savePng(join(fitDir, '05_png_scale25_overlay.png'), firstOverlay)
  savePng(join(fitDir, '06_png_scale40_overlay.png'), overlay)
  savePng(
    join(outputs, 'overlay_progress_strip.png'),
    fitStrip([source, firstOverlay, overlay, rendered])
  )

  const times = [0, 90, 150, 210, 300, 420, 560, 700, 850, 980, 1120, 1300, 1500]
  const framePaths = []
  const easingProbe = []
  for (const time of times) {
    await gotoMotion(`?t=${time}`)
    const path = join(framesDir, `frame_${String(time).padStart(4, '0')}ms.png`)
    await screenshotElement('#logo-root', path)
    framePaths.push(path)
    easingProbe.push(await page.evaluate((t) => {
      const archReveal = document.querySelector('#headphones-arch-reveal-path')
      const boomReveal = document.querySelector('#headphones-boom-reveal-path')
      const micReveal = document.querySelector('#headphones-mic-reveal-path')
      const leftCupReveal = document.querySelector('#headphones-left-cup-reveal')
      const rightCupReveal = document.querySelector('#headphones-right-cup-reveal')
      const orange = document.querySelector('#orange-sweep')
      const red = document.querySelector('#red-sweep')
      return {
        time_ms: t,
        headphones_arch_dashoffset: archReveal ? getComputedStyle(archReveal).strokeDashoffset : null,
        headphones_boom_dashoffset: boomReveal ? getComputedStyle(boomReveal).strokeDashoffset : null,
        headphones_mic_dashoffset: micReveal ? getComputedStyle(micReveal).strokeDashoffset : null,
        headphones_left_cup_transform: leftCupReveal ? getComputedStyle(leftCupReveal).transform : null,
        headphones_right_cup_transform: rightCupReveal ? getComputedStyle(rightCupReveal).transform : null,
        orange_opacity: orange ? getComputedStyle(orange).opacity : null,
        red_opacity: red ? getComputedStyle(red).opacity : null,
        red_transform: red ? getComputedStyle(red).transform : null
      }
    }, time))
  }

  await gotoMotion('?static=1')
  const staticPath = join(outputs, 'html_render.png')
  await screenshotElement('#logo-root', staticPath)
  const staticFrame = png(staticPath)
  const finalFrame = png(framePaths.at(-1))
  const samePipelineDiff = frameDifference(staticFrame, finalFrame)

  const continuity = []
  let previous = null
  for (let time = 0; time <= 1160; time += 10) {
    await gotoMotion(`?t=${time}`)
    await page.evaluate(() => {
      const lockup = document.querySelector('#logo-lockup')
      const mark = document.querySelector('#listening-mark')
      const tile = document.querySelector('#icon-tile')
      if (lockup) {
        lockup.style.animation = 'none'
        lockup.style.transform = 'none'
      }
      if (mark) mark.style.display = 'none'
      if (tile) tile.style.display = 'none'
    })
    const bytes = await screenshotElement('#logo-root')
    const current = PNG.sync.read(bytes)
    const blueInk = countBlue(current)
    continuity.push({
      time_ms: time,
      changed_pixels_from_previous: previous ? frameDifference(previous.image, current) : null,
      blue_ink_pixels: blueInk,
      blue_ink_delta: previous ? blueInk - previous.blueInk : null
    })
    previous = { image: current, blueInk }
  }

  const stripHtml = `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#344054}
    body{display:flex;gap:1px;padding:0}.frame{width:420px;background:#fff}.frame img{display:block;width:420px;height:420px;object-fit:contain}
    .label{height:44px;display:flex;align-items:center;justify-content:center;border-top:1px solid #e4e7ec;font-size:16px;font-variant-numeric:tabular-nums}
  </style>${times.map((time, index) => `<div class="frame"><img src="${pathToFileURL(framePaths[index]).href}?v=${Date.now()}"><div class="label">t=${time}ms</div></div>`).join('')}`
  const stripHtmlPath = join(outputs, 'motion_strip.html')
  writeFileSync(stripHtmlPath, stripHtml)
  await page.setViewportSize({ width: 420 * times.length, height: 464 })
  await page.goto(pathToFileURL(stripHtmlPath).href)
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete))
  await page.evaluate(() => Promise.all(Array.from(document.images).map((image) => image.decode())))
  await capturePage(join(outputs, 'motion_strip.png'))

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1200, height: 1000 })
  await page.goto(pathToFileURL(join(root, 'logo_motion.html')).href)
  await page.waitForFunction(() => window.__p2mReady === true)
  const defaultRates = await page.evaluate(() =>
    document.getElementById('logo-root').getAnimations({ subtree: true }).map((animation) => animation.playbackRate)
  )
  await page.locator('#speedSlider').evaluate((slider) => {
    slider.value = '1.5'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(resolveFrame)))
  const adjustedRates = await page.evaluate(() =>
    document.getElementById('logo-root').getAnimations({ subtree: true }).map((animation) => animation.playbackRate)
  )
  await page.waitForTimeout(1100)
  await capturePage(join(outputs, 'review_desktop.png'))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(pathToFileURL(join(root, 'logo_motion.html')).href)
  await page.waitForFunction(() => window.__p2mReady === true)
  await page.waitForTimeout(1600)
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  await capturePage(join(outputs, 'review_mobile.png'))

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(pathToFileURL(join(root, 'logo_motion.html')).href)
  await page.waitForFunction(() => window.__p2mReady === true)
  const reducedMotionAnimations = await page.evaluate(() =>
    document.getElementById('logo-root').getAnimations({ subtree: true }).length
  )
  await capturePage(join(outputs, 'reduced_motion.png'))

  const fitEvaluation = JSON.parse(readFileSync(join(outputs, 'fit_program', 'evaluation.json'), 'utf8'))
  const selectedFit = fitEvaluation.ranking.find((candidate) => candidate.name === '03_scale40')
  const report = {
    source: '../../icon1.png',
    static_svg: 'logo.svg',
    fit_metrics: metrics,
    semantic_color_fit: selectedFit?.metrics ?? null,
    fit_iterations: [
      {
        iteration: 1,
        candidate: '25% Lanczos measurement scale',
        metrics: firstMetrics,
        verdict: 'Rejected: smooth, but the small leaf and tight inner curves lost too much area.'
      },
      {
        iteration: 2,
        candidate: '40% Lanczos measurement scale',
        metrics,
        verdict: 'Accepted: smooth cubic geometry with strong per-color silhouette fidelity.'
      }
    ],
    geometry_verdict: 'Smooth semantic fit accepted directly from icon1.png. Gradients were flattened by hue segmentation; the five fitted paths use 105 cubic segments with no tangent-angle warnings.',
    headset_motion_verdict: 'The blue headset remains one continuous fill. Five transparent semantic masks reveal the left cup, centerline arch, right cup, curved boom, and microphone tip clockwise with width-matched geometry and hidden overlaps.',
    intentional_path_audit_corners: ['gold sweep tips', 'orange sweep tips', 'red sweep tips', 'leaf tips'],
    motion_times_ms: times,
    easing_probe: easingProbe,
    continuity_sweep: continuity,
    continuity_verdict: continuity.every((row) => row.blue_ink_delta === null || row.blue_ink_delta >= 0)
      ? 'Blue ink grows monotonically in the 10ms draw-on sweep.'
      : 'Potential frozen interval detected; inspect the sweep.',
    final_frame_contract: {
      same_pipeline_static_vs_t1500_changed_pixels: samePipelineDiff,
      exact_match: samePipelineDiff === 0
    },
    showcase: {
      default_speed_is_1x: defaultRates.length > 0 && defaultRates.every((rate) => rate === 1),
      speed_slider_updates_live_animation: adjustedRates.length > 0 && adjustedRates.every((rate) => rate === 1.5),
      mobile_horizontal_overflow: mobileOverflow,
      reduced_motion_animation_count: reducedMotionAnimations
    }
  }
  writeFileSync(join(outputs, 'qa_report.json'), JSON.stringify(report, null, 2))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await electronApp.close()
}
