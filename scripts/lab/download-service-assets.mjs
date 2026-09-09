/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { setGlobalProxyFromEnv } from 'node:http'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

export const WINSW_ASSET = Object.freeze({
  filename: 'WinSW.NET461.exe',
  url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
  sha256: 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f'
})
const projectRoot = resolve(import.meta.dirname, '../..')

export function serviceWrapperPath(root = projectRoot, asset = WINSW_ASSET) {
  return resolve(root, 'externals/lab/windows', asset.filename)
}

function verify(bytes, asset) {
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error(`WinSW SHA-256 校验失败（应为 ${asset.sha256}）`)
}

export async function readServiceWrapper(root = projectRoot, asset = WINSW_ASSET) {
  const filename = serviceWrapperPath(root, asset)
  try {
    const stat = await lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('不是普通文件')
    const bytes = await readFile(filename)
    verify(bytes, asset)
    return bytes
  } catch (cause) {
    throw new Error(
      `WinSW 本地资产缺失或无效：${filename}。请运行 yarn setup，或单独运行 node scripts/lab/download-service-assets.mjs。构建不会下载资产。`,
      { cause }
    )
  }
}

export async function setupServiceAssets(argv = [], options = {}) {
  for (const argument of argv)
    if (!['--verify', '--verify-upstream'].includes(argument))
      throw new Error(`未知参数：${argument}`)
  if ((options.platform ?? process.platform) !== 'win32') {
    console.log('[lab] 当前平台无需 WinSW，跳过下载')
    return 'skipped'
  }
  const root = options.root ?? projectRoot
  const asset = options.asset ?? WINSW_ASSET
  const filename = serviceWrapperPath(root, asset)
  if (!argv.includes('--verify-upstream')) {
    try {
      await readServiceWrapper(root, asset)
      console.log('[lab] WinSW 本地 SHA-256 校验通过')
      return 'verified'
    } catch {
      // Setup repairs missing or invalid assets; builds only read verified assets.
    }
  }
  await mkdir(dirname(filename), { recursive: true })
  let bytes
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[lab] 下载 WinSW (${attempt}/3)：${asset.url}`)
    try {
      const response = await (options.fetch ?? fetch)(asset.url, {
        signal: AbortSignal.timeout(30000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      bytes = Buffer.from(await response.arrayBuffer())
      break
    } catch (cause) {
      const reason = cause.cause?.code ?? cause.code ?? cause.message
      if (attempt === 3)
        throw new Error(
          `WinSW 下载失败（${reason}）：${asset.url}。请检查网络或 HTTPS_PROXY 后重试 setup；也可手动下载到 ${filename}，随后重新运行 setup 校验。`,
          { cause }
        )
      console.warn(`[lab] WinSW 下载中断（${reason}），即将重试`)
      await delay((options.retryDelayMs ?? 1000) * attempt)
    }
  }
  verify(bytes, asset)
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, filename)
  } finally {
    await rm(temporary, { force: true })
  }
  console.log('[lab] WinSW 下载并校验完成')
  return 'downloaded'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform === 'win32') setGlobalProxyFromEnv()
    await setupServiceAssets(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
