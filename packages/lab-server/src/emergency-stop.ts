import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { directoryPaths, lockDirectory } from './directory-lock'
import { durableWrite } from './durable-files'
import { serviceRegistration } from './local-status'
import type { ManagerPaths } from './local-manager'

const UNIT = 'ls101-lab.service'
const fail = (code: string): Error => Object.assign(new Error(code), { code })

export function emergencyStopMarker(root: string): string {
  // Keep the marker outside the directory that offline restore can replace.
  return `${directoryPaths(root).prefix}.emergency-stop.json`
}

async function run(file: string, args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error)
          reject(
            fail(
              stderr?.includes('LOCAL_SERVICE_IDENTITY_MISMATCH')
                ? 'LOCAL_SERVICE_IDENTITY_MISMATCH'
                : 'LOCAL_FORCE_STOP_FAILED'
            )
          )
        else resolve(stdout.trim())
      }
    )
  })
}

async function waitStopped(attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const status = await serviceRegistration()
    if (status.installed && status.stopped) return true
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`

// The helper supplies the installed path, never a renderer-selected PID or executable.
// Keep a process handle open during revalidation and taskkill to prevent PID reuse.
export function windowsEmergencyStopScript(runtime: string): string {
  return `
$ErrorActionPreference = 'Stop'
$expected = ${quote(join(runtime, 'LS101Lab.exe'))}
function Registration { Get-CimInstance Win32_Service -Filter "Name='LS101Lab'" }
function Verify($service) {
  if ($null -eq $service -or $service.ServiceType -ne 'Own Process' -or
      -not [String]::Equals($service.PathName.Trim().Trim('"'), $expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'LOCAL_SERVICE_IDENTITY_MISMATCH'
  }
}
$service = Registration
Verify $service
& sc.exe config LS101Lab start= disabled | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot disable automatic startup' }
if ($service.State -ne 'Stopped') {
  & sc.exe stop LS101Lab | Out-Null
  if ($LASTEXITCODE -notin @(0, 1061, 1062)) { throw 'Cannot request service stop' }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $service = Registration
    Verify $service
    if ($service.State -eq 'Stopped') { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($service.State -ne 'Stopped') {
    $servicePid = [int]$service.ProcessId
    if ($servicePid -le 0) { throw 'LOCAL_SERVICE_IDENTITY_MISMATCH' }
    $target = Get-Process -Id $servicePid
    try {
      $heldHandle = $target.Handle
      if (-not [String]::Equals($target.Path, $expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'LOCAL_SERVICE_IDENTITY_MISMATCH'
      }
      $current = Registration
      Verify $current
      if ($current.State -ne 'Stopped') {
        if ($current.ProcessId -ne $servicePid -or $target.HasExited) { throw 'LOCAL_SERVICE_IDENTITY_MISMATCH' }
        $owners = @(Get-CimInstance Win32_Service -Filter "ProcessId=$servicePid")
        if ($owners.Count -ne 1 -or $owners[0].Name -ne 'LS101Lab') { throw 'LOCAL_SERVICE_IDENTITY_MISMATCH' }
        & taskkill.exe /PID $servicePid /T /F /FI "SERVICES eq LS101Lab" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot terminate service process tree' }
      }
    } finally { $target.Dispose() }
  }
}
$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  $service = Registration
  Verify $service
  if ($service.State -eq 'Stopped' -and $service.ProcessId -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Service is still running'
`
}

export async function emergencyStop(paths: ManagerPaths): Promise<unknown> {
  if (!['linux', 'win32'].includes(process.platform)) throw fail('UNSUPPORTED_PLATFORM')
  // Serialize emergency operations separately from the daemon's lifetime lock.
  const operation = await lockDirectory(`${paths.root}.emergency`)
  try {
    if (process.platform === 'linux')
      await run('chown', ['ls101-lab:ls101-lab', directoryPaths(`${paths.root}.emergency`).lock])
    const registration = await serviceRegistration()
    if (!registration.installed) throw fail('LOCAL_SERVICE_NOT_INSTALLED')
    if (process.platform === 'linux') {
      const actual = await run('systemctl', ['show', UNIT, '--property=FragmentPath', '--value'])
      if (actual !== (paths.unit ?? '/etc/systemd/system/ls101-lab.service'))
        throw fail('LOCAL_SERVICE_IDENTITY_MISMATCH')
      const start = await run('systemctl', ['show', UNIT, '--property=ExecStart', '--value'])
      const node = join(paths.runtime, 'runtime/node')
      const argv = `${node} ${join(paths.runtime, 'server.cjs')} serve --data-dir ${paths.root}`
      if (!start.includes(`path=${node} ; argv[]=${argv} ;`))
        throw fail('LOCAL_SERVICE_IDENTITY_MISMATCH')
    }
    const marker = emergencyStopMarker(paths.root)
    await durableWrite(marker, JSON.stringify({ requestedAt: new Date().toISOString() }))
    // Startup only stats this marker; it does not need to read an administrator-owned file.
    if (process.platform === 'linux') {
      await run('systemctl', ['disable', UNIT])
      // A stop job suppresses Restart=on-failure while SIGKILL drains the unit's cgroup.
      await run('systemctl', ['stop', '--no-block', UNIT])
      if (!(await waitStopped(30))) {
        await run('systemctl', ['kill', '--signal=SIGKILL', '--kill-who=all', UNIT])
        if (!(await waitStopped(10))) throw fail('LOCAL_FORCE_STOP_INCOMPLETE')
      }
    } else {
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(windowsEmergencyStopScript(paths.runtime), 'utf16le').toString('base64')
        ],
        60000
      )
    }
    // SCM may report the wrapper stopped while its child still owns the data.
    // Never return success in that case or clear any lock files by hand.
    const lifetime = await lockDirectory(`${paths.root}.runtime`)
    try {
      const data = await lockDirectory(paths.root)
      try {
        if (process.platform === 'linux')
          await run('chown', [
            'ls101-lab:ls101-lab',
            directoryPaths(`${paths.root}.runtime`).lock,
            directoryPaths(paths.root).lock
          ])
        const final = await serviceRegistration()
        if (!final.installed || !final.stopped) throw fail('LOCAL_FORCE_STOP_INCOMPLETE')
        await stat(marker)
        return {
          state: 'stopped',
          autostart: final.autostart,
          releaseVersion: null,
          license: null,
          info: null,
          port: null,
          error: null
        }
      } finally {
        data.close()
      }
    } finally {
      lifetime.close()
    }
  } finally {
    operation.close()
  }
}
