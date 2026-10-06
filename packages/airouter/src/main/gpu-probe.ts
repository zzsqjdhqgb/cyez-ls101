import { spawn } from 'node:child_process'
import type { AIRouterGpuProbeResult } from '../shared'

export interface AIRouterGpuProbeOptions {
  spawnProcess?: typeof spawn
  timeoutMs?: number
}

const QUERY_ARGS = [
  '--query-gpu=name,compute_cap,memory.total,driver_version',
  '--format=csv,noheader,nounits'
]

/** Offline compilation for architectures before this compute capability no longer exists. */
const MIN_COMPUTE_CAPABILITY = 7.5
/** CUDA 12.8 first supports Blackwell (compute capability 12.0) and needs an R570+ driver. */
const MIN_DRIVER_MAJOR = 570
/** The shipped fp16 package is 4.55 GB; below this the card is workable but tight. */
const COMFORTABLE_VRAM_MIB = 7 * 1024
const DEFAULT_TIMEOUT_MS = 10_000

interface NvidiaSmiInfo {
  name?: string
  computeCapability?: string
  vramMiB?: number
  driverVersion?: string
  cudaRuntimeVersion?: string
}

export async function probeNvidiaGpu(
  options: AIRouterGpuProbeOptions = {}
): Promise<AIRouterGpuProbeResult> {
  const spawned = await runNvidiaSmi(QUERY_ARGS, options)
  const info = spawned ? parseQueryOutput(spawned) : null
  if (info) return recommend(info)

  // Older drivers do not support `compute_cap`; fall back to the human-readable table.
  const legacy = await runNvidiaSmi([], options)
  const legacyInfo = legacy ? parseLegacyOutput(legacy) : null
  if (legacyInfo) return recommend(legacyInfo)

  return {
    available: false,
    recommendedBackend: 'cpu',
    recommendedWeightType: 'f16',
    summary:
      '未检测到可用的 NVIDIA GPU。IndexTTS 2.5 只提供 CUDA 合成（fp16 模型包 4.55 GB），CPU 合成不在支持范围内。'
  }
}

function recommend(info: NvidiaSmiInfo): AIRouterGpuProbeResult {
  const base: AIRouterGpuProbeResult = {
    available: true,
    name: info.name,
    computeCapability: info.computeCapability,
    vramMiB: info.vramMiB,
    driverVersion: info.driverVersion,
    cudaRuntimeVersion: info.cudaRuntimeVersion,
    recommendedBackend: 'cuda',
    recommendedWeightType: 'f16',
    summary: ''
  }
  const capability = info.computeCapability ? Number.parseFloat(info.computeCapability) : undefined
  const driverMajor = info.driverVersion
    ? Number.parseInt(info.driverVersion.split('.')[0] ?? '', 10)
    : undefined

  if (
    capability !== undefined &&
    Number.isFinite(capability) &&
    capability < MIN_COMPUTE_CAPABILITY
  ) {
    return {
      ...base,
      available: false,
      recommendedBackend: 'cpu',
      summary: `检测到 ${describe(info)}，但计算能力 ${info.computeCapability} 低于 ${MIN_COMPUTE_CAPABILITY}，IndexTTS 的 CUDA 运行时无法覆盖该架构。`
    }
  }
  if (driverMajor !== undefined && Number.isFinite(driverMajor) && driverMajor < MIN_DRIVER_MAJOR) {
    return {
      ...base,
      available: false,
      recommendedBackend: 'cpu',
      summary: `检测到 ${describe(info)}，但驱动版本 ${info.driverVersion} 低于 CUDA 12.8 所需的 R${MIN_DRIVER_MAJOR}，请升级驱动。`
    }
  }

  const tight = info.vramMiB !== undefined && info.vramMiB < COMFORTABLE_VRAM_MIB
  return {
    ...base,
    summary: `检测到 ${describe(info)}，可使用 CUDA 合成与 fp16 模型包（4.55 GB）${
      tight ? '；显存偏紧，长文本会自动分段，建议 8 GB 以上' : ''
    }。`
  }
}

function describe(info: NvidiaSmiInfo): string {
  const parts = [info.name ?? 'NVIDIA GPU']
  if (info.vramMiB !== undefined) parts.push(formatVram(info.vramMiB))
  if (info.computeCapability) parts.push(`sm_${info.computeCapability.replace('.', '')}`)
  if (info.driverVersion) parts.push(`驱动 ${info.driverVersion}`)
  return parts.join(' / ')
}

function formatVram(vramMiB: number | undefined): string {
  if (vramMiB === undefined) return '显存未知'
  return `${(vramMiB / 1024).toFixed(1)} GB`
}

function runNvidiaSmi(args: string[], options: AIRouterGpuProbeOptions): Promise<string | null> {
  const spawnProcess = options.spawnProcess ?? spawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve) => {
    let settled = false
    const state: { timer?: NodeJS.Timeout } = {}
    let child: ReturnType<typeof spawn>
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      if (state.timer) clearTimeout(state.timer)
      resolve(value)
    }
    try {
      child = spawnProcess('nvidia-smi', args, { windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code === 0 && stdout.trim() ? stdout : null))
    state.timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeoutMs)
    if (typeof state.timer.unref === 'function') state.timer.unref()
  })
}

function parseQueryOutput(text: string): NvidiaSmiInfo | null {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0)
  if (!line) return null
  const fields = line.split(',').map((field) => field.trim())
  if (fields.length < 4) return null
  const [name, computeCapability, memory, driverVersion] = fields
  const vramMiB = Number.parseInt(memory, 10)
  return {
    name: name || undefined,
    computeCapability: computeCapability || undefined,
    vramMiB: Number.isFinite(vramMiB) ? vramMiB : undefined,
    driverVersion: driverVersion || undefined
  }
}

function parseLegacyOutput(text: string): NvidiaSmiInfo | null {
  const cudaMatch = text.match(/CUDA Version:\s*([0-9]+\.[0-9]+)/)
  const driverMatch = text.match(/Driver Version:\s*([0-9]+\.[0-9.]+)/)
  const nameMatch = text.match(/^\|\s*[0-9]+\s+([^|]+?)\s*\|/m)
  // In the process table the memory column reads "<used>MiB / <total>MiB"; elsewhere it is
  // a single total. Prefer the total, never the used value.
  const usedTotalMatch = text.match(/[0-9]+\s*MiB\s*\/\s*([0-9]+)\s*MiB/i)
  const singleMatch = usedTotalMatch ? null : text.match(/([0-9]+)\s*MiB/i)
  if (!cudaMatch && !driverMatch && !nameMatch) return null
  const vramMiB = Number.parseInt(usedTotalMatch?.[1] ?? singleMatch?.[1] ?? '', 10)
  return {
    name: nameMatch
      ? nameMatch[1]
          .replace(/\s+(On|Off|WDDM|Default|N\/A)\s*$/i, '')
          .replace(/^(NVIDIA|GeForce)\s+/i, '')
          .trim()
      : undefined,
    vramMiB: Number.isFinite(vramMiB) ? vramMiB : undefined,
    driverVersion: driverMatch ? driverMatch[1] : undefined,
    cudaRuntimeVersion: cudaMatch ? cudaMatch[1] : undefined
  }
}
