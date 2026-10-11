/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const commandOptions = { encoding: 'utf8', timeout: 2000, maxBuffer: 256 * 1024, windowsHide: true }

export async function sampleResources(
  pid,
  backend,
  { platform = process.platform, read = readFile, run = execute } = {}
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid helper PID')
  const sample = {
    residentMemoryBytes: null,
    peakResidentMemoryBytes: null,
    gpuProcesses: [],
    errors: []
  }
  await Promise.all([
    (async () => {
      try {
        if (platform === 'linux') {
          const status = await read(`/proc/${pid}/status`, 'utf8')
          const bytes = (key) => {
            const match = status.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm'))
            return match ? Number(match[1]) * 1024 : null
          }
          sample.residentMemoryBytes = bytes('VmRSS')
          sample.peakResidentMemoryBytes = bytes('VmHWM')
        } else if (platform === 'win32') {
          const { stdout } = await run(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `Get-Process -Id ${pid} -ErrorAction Stop | Select-Object WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress`
            ],
            commandOptions
          )
          const memory = JSON.parse(stdout)
          sample.residentMemoryBytes = Number.isFinite(memory.WorkingSet64)
            ? memory.WorkingSet64
            : null
          sample.peakResidentMemoryBytes = Number.isFinite(memory.PeakWorkingSet64)
            ? memory.PeakWorkingSet64
            : null
        }
      } catch (error) {
        sample.errors.push(`Process memory: ${error.message}`)
      }
    })(),
    (async () => {
      if (backend !== 'cuda') return
      try {
        const { stdout } = await run(
          'nvidia-smi',
          ['--query-compute-apps=pid,gpu_uuid,used_gpu_memory', '--format=csv,noheader,nounits'],
          commandOptions
        )
        for (const line of stdout.trim().split(/\r?\n/).filter(Boolean)) {
          const [processId, gpuUuid, memory] = line.split(',').map((value) => value.trim())
          if (Number(processId) !== pid) continue
          sample.gpuProcesses.push({
            gpuUuid,
            memoryBytes: /^\d+$/.test(memory) ? Number(memory) * 1024 ** 2 : null
          })
        }
      } catch (error) {
        sample.errors.push(`GPU memory: ${error.message}`)
      }
    })()
  ])
  return sample
}
