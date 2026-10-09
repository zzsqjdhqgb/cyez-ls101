/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { main as download } from './download-release-assets.mjs'
import { buildPackage, parseOptions } from './build-package.mjs'

export async function preparePackage({ automatic = false } = {}) {
  if (process.env.LS101_SKIP_INDEX_TTS_DOWNLOAD === '1') return null
  if (automatic && !loadConfig().runtimeRelease.published) {
    console.log('[index-tts] automatic package preparation awaits the first pinned runtime release')
    return null
  }
  await download({ arguments: ['--models-only'] })
  return buildPackage(parseOptions([]))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--automatic')) throw new Error('Unknown IndexTTS prepare option')
  preparePackage({ automatic: args.includes('--automatic') }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
