/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function cudaCompilerLauncher(cache, platform = process.platform) {
  if (!cache) return ''
  if (platform !== 'win32') return cache
  // CMake launchers are argument lists, so paths with spaces stay separate.
  return [process.execPath, fileURLToPath(import.meta.url), cache].join(';')
}

export function compilerInvocation(cache, compiler, args) {
  // Ninja passes the source separately even when flags use a response file.
  // Match the pinned GGML input, not defines or an output such as mmvf.cu.obj.
  const bypassCache = args.some(
    (arg) => !/^[-@]/.test(arg) && /(?:^|[\\/])ggml-cuda[\\/]mmvf\.cu$/i.test(arg)
  )
  return {
    command: bypassCache ? compiler : cache,
    args: bypassCache ? args : [compiler, ...args],
    bypassCache
  }
}

function main() {
  const [cache, compiler, ...args] = process.argv.slice(2)
  if (!cache || !compiler)
    throw new Error('Usage: cuda-compiler-launcher.mjs <sccache> <compiler> [compiler arguments]')
  const invocation = compilerInvocation(cache, compiler, args)
  if (invocation.bypassCache)
    console.log('[index-tts] ggml-cuda/mmvf.cu: bypassing sccache, compiling with nvcc directly')
  const result = spawnSync(invocation.command, invocation.args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`CUDA compiler terminated by ${result.signal}`)
  process.exitCode = result.status ?? 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(`[index-tts] CUDA compiler launcher failed: ${error.message}`)
    process.exitCode = 1
  }
}
