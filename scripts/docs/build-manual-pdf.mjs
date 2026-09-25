#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * build-manual-pdf.mjs — 把产品说明书导出为 PDF
 *
 * 用仓库已有的渲染栈（Playwright Chromium + react-markdown）排版，不新增依赖：
 * markdown → HTML（remark-gfm 表格、代码块、配图）→ Chromium 打印样式 → A4 PDF。
 *
 * 用法：
 *   yarn manual:pdf                        # 源目录 docs/manual
 *   yarn manual:pdf --root <目录>          # 指定其它源目录
 *   yarn manual:pdf --out dist/说明书.pdf  # 指定输出文件
 *   yarn manual:pdf --title-page           # 另起一页标题页
 *   yarn manual:pdf --open                 # 生成后打开
 *
 * 约定：
 *   - 源目录下 `*.md` 按文件名排序后依次排版，`_` 开头的文件跳过；
 *   - 标题含「不属于说明书正文」的章节不进入 PDF（评审用的临时章节据此排除）；
 *   - 配图按行内相对路径解析到仓库内文件；缺失时在 PDF 中以占位框标出并汇总警告；
 *   - 默认输出到 test-results/manual-pdf/（已 gitignore，不污染仓库）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const OUTPUT_DIR = path.join(ROOT, 'test-results', 'manual-pdf')
const REVIEW_SECTION = /不属于说明书正文/

const FOOTER_TEMPLATE = `<div style="width:100%;padding:0 16mm;font:8pt sans-serif;color:#666;text-align:center;">
  第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页
</div>`

const PRINT_STYLE = `
@page { size: A4; }
html { font-size: 10.5pt; }
body {
  margin: 0;
  color: #111;
  font-family: "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
  line-height: 1.75;
}
h1 { font-size: 17pt; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 2px solid #333; break-before: page; }
h1:first-of-type { break-before: auto; }
h2 { font-size: 13.5pt; margin: 20px 0 8px; }
h3 { font-size: 11.5pt; margin: 16px 0 6px; }
p { margin: 8px 0; }
ul, ol { margin: 8px 0; padding-left: 22px; }
li { margin: 3px 0; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #9aa0a6; padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: #f1f3f4; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
code { font-family: "Noto Sans Mono CJK SC", Consolas, monospace; font-size: 9.5pt; background: #f5f5f5; padding: 0 3px; }
pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 9pt; }
blockquote { margin: 10px 0; padding: 2px 12px; border-left: 3px solid #c0c4c8; color: #444; }
hr { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
.figure { display: block; margin: 12px 0; text-align: center; break-inside: avoid; }
.figure img { max-width: 100%; border: 1px solid #ddd; }
.caption { display: block; margin-top: 4px; font-size: 9pt; color: #555; }
.missing-figure { display: block; padding: 24px; border: 1px dashed #b42318; color: #b42318; font-size: 9.5pt; }
.title-page { height: 240mm; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; }
.title-page h1 { border: none; font-size: 26pt; }
.title-page .subtitle { font-size: 13pt; color: #444; }
.title-page .date { font-size: 11pt; color: #666; }
`

await main()

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const sourceRoot = path.resolve(ROOT, options.root ?? defaultSourceRoot())
  const files = collectMarkdown(sourceRoot)

  if (files.length === 0) {
    console.error(`源目录没有 markdown 文件：${sourceRoot}`)
    process.exit(1)
  }

  const missingFigures = new Set()
  const chapters = files.map((file) => ({
    file,
    body: renderMarkdown(fs.readFileSync(file, 'utf8'), file, missingFigures)
  }))

  const title = options.title ?? documentTitle(chapters[0].body) ?? path.basename(sourceRoot)
  const version = packageVersion()
  const output = path.resolve(
    ROOT,
    options.out ?? path.join('test-results', 'manual-pdf', `${slugify(title)}.pdf`)
  )
  const htmlFile = path.join(OUTPUT_DIR, 'manual.html')

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(
    htmlFile,
    buildDocument({ title, version, chapters, titlePage: options.titlePage }),
    'utf8'
  )
  await renderPdf({ htmlFile, output, title, version })

  console.log(`已生成：${path.relative(ROOT, output)}`)
  console.log(`源目录：${path.relative(ROOT, sourceRoot)}（${files.length} 个文件）`)
  if (missingFigures.size > 0) {
    console.warn(`\n警告：${missingFigures.size} 张配图不存在，PDF 中显示为占位框：`)
    for (const figure of missingFigures) console.warn(`  - ${path.relative(ROOT, figure)}`)
    console.warn(
      '请先在 canonical 容器内运行 yarn manual:figures:publish，或运行 yarn test:manual-figures 生成预览。'
    )
  }
  if (options.open) openFile(output)
}

function renderMarkdown(markdown, file, missingFigures) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: {
          img: ({ src, alt }) => renderFigure(src, alt, path.dirname(file), missingFigures)
        }
      },
      stripReviewSections(markdown)
    )
  )
}

async function renderPdf({ htmlFile, output, title, version }) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' })
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete))
    fs.mkdirSync(path.dirname(output), { recursive: true })
    await page.pdf({
      path: output,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(title, version),
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: '20mm', bottom: '18mm', left: '16mm', right: '16mm' }
    })
  } finally {
    await browser.close()
  }
}

function renderFigure(src, alt, currentDir, missingFigures) {
  const absolute = src ? path.resolve(currentDir, decodeURIComponent(src)) : null
  const exists = absolute !== null && fs.existsSync(absolute)
  if (absolute && !exists) missingFigures.add(absolute)
  const image = exists
    ? createElement('img', { src: pathToFileURL(absolute).href, alt: alt ?? '' })
    : createElement('span', { className: 'missing-figure' }, `［缺图：${src}］`)
  return createElement(
    'span',
    { className: 'figure' },
    image,
    alt ? createElement('span', { className: 'caption' }, alt) : null
  )
}

function collectMarkdown(directory) {
  if (!fs.existsSync(directory)) return []
  const names = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('_'))
    // README 是封面与修订记录，固定排在最前；其余章节按文件名排序。
    .sort((left, right) => {
      if (left === 'README.md') return -1
      if (right === 'README.md') return 1
      return left.localeCompare(right, 'zh-Hans-CN')
    })
  return names.map((name) => path.join(directory, name))
}

/** 评审暂存区的样例说明与待确认事项不属于说明书正文，排版前删除。 */
function stripReviewSections(markdown) {
  const kept = []
  let skipping = false
  for (const line of markdown.split('\n')) {
    if (/^#\s/.test(line)) skipping = REVIEW_SECTION.test(line)
    if (!skipping) kept.push(line)
  }
  return kept
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, (block) => (REVIEW_SECTION.test(block) ? '' : block))
    .trim()
}

function documentTitle(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : null
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
}

/** 说明书正文在 docs/manual；`--root` 可指向别处（例如只导出某一章）。 */
function defaultSourceRoot() {
  return 'docs/manual'
}

function slugify(value) {
  return value.replace(/\s+/g, '-').replace(/[\\/:*?"<>|]/g, '') || 'manual'
}

function headerTemplate(documentTitleText, documentVersion) {
  return `<div style="width:100%;padding:0 16mm;font:8pt sans-serif;color:#666;display:flex;justify-content:space-between;">
    <span>${escapeHtml(documentTitleText)}</span><span>V${escapeHtml(documentVersion)}</span>
  </div>`
}

function buildDocument({ title, version, chapters, titlePage }) {
  // 每章以 h1 开头，由 CSS 的 `h1 { break-before: page }` 保证另起一页；
  // 多文件与单文件（评审暂存区）两种组织方式都适用。
  const body = chapters.map((chapter) => chapter.body).join('\n')
  const cover = titlePage
    ? `<section class="title-page">
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">版本 V${escapeHtml(version)}</p>
  <p class="date">${new Date().toISOString().slice(0, 10)}</p>
</section>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_STYLE}</style>
</head>
<body>
${cover}
${body}
</body>
</html>`
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  )
}

function parseArguments(argv) {
  const parsed = {
    root: undefined,
    out: undefined,
    title: undefined,
    titlePage: false,
    open: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--root') parsed.root = argv[(index += 1)]
    else if (argument.startsWith('--root=')) parsed.root = argument.slice('--root='.length)
    else if (argument === '--out') parsed.out = argv[(index += 1)]
    else if (argument.startsWith('--out=')) parsed.out = argument.slice('--out='.length)
    else if (argument === '--title') parsed.title = argv[(index += 1)]
    else if (argument.startsWith('--title=')) parsed.title = argument.slice('--title='.length)
    else if (argument === '--title-page') parsed.titlePage = true
    else if (argument === '--open') parsed.open = true
    else if (argument === '--help' || argument === '-h') {
      console.log(
        '用法：node scripts/docs/build-manual-pdf.mjs [--root <目录>] [--out <文件>] [--title <标题>] [--title-page] [--open]'
      )
      process.exit(0)
    } else {
      console.error(`未知参数：${argument}`)
      process.exit(1)
    }
  }
  return parsed
}

function openFile(file) {
  const command =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', file]]
      : process.platform === 'darwin'
        ? ['open', [file]]
        : ['xdg-open', [file]]
  try {
    spawn(command[0], command[1], { stdio: 'ignore', detached: true }).unref()
  } catch {
    console.log(`无法自动打开，请手动查看：${file}`)
  }
}
