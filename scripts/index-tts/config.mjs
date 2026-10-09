/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const root = path.resolve(import.meta.dirname, '..', '..')
export const externalRoot = path.join(root, 'externals', 'ai', 'index-tts')

export function loadConfig() {
  const config = JSON.parse(readFileSync(path.join(import.meta.dirname, 'assets.json'), 'utf8'))
  if (
    config.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(config.runtime?.revision ?? '') ||
    !/^[a-f0-9]{40}$/.test(config.runtime?.ggmlTree ?? '') ||
    !/^[a-f0-9]{40}$/.test(config.model?.ggufRevision ?? '') ||
    !/^[a-f0-9]{64}$/.test(config.model?.sha256 ?? '') ||
    !Number.isSafeInteger(config.model?.size) ||
    config.model.size <= 0
  ) {
    throw new Error('Invalid IndexTTS asset configuration')
  }
  return config
}

export function modelAsset(config = loadConfig()) {
  const model = config.model
  return {
    name: model.file,
    path: model.file,
    size: model.size,
    sha256: model.sha256,
    url: `https://huggingface.co/${model.ggufRepository}/resolve/${model.ggufRevision}/${model.upstreamPath}`
  }
}

export function runtimeTarget(platform = process.platform, arch = process.arch) {
  return arch === 'x64' && ['linux', 'win32'].includes(platform) ? `${platform}-${arch}` : null
}
