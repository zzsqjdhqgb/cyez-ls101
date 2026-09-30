import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { windowsEmergencyStopScript } from '../emergency-stop'

// Execute the actual PowerShell decision logic on Windows CI, replacing only OS commands.
// No test here changes a real service or kills a process.
describe.skipIf(process.platform !== 'win32')('Windows emergency stop script', () => {
  it.each([
    'graceful',
    'kill',
    'wrong-path',
    'changed-pid',
    'shared',
    'kill-failed',
    'still-running'
  ])(
    '%s verifies ownership and only reports an observed stop',
    async (scenario) => {
      const harness = `
$scenario = '${scenario}'
$script:state = 'Running'
$script:opened = $false
function Get-CimInstance($ClassName, $Filter) {
  if ($Filter -like 'ProcessId=*') {
    if ($scenario -eq 'shared') { [pscustomobject]@{ Name = 'Other' } }
    return [pscustomobject]@{ Name = 'LS101Lab' }
  }
  $servicePid = if ($script:state -eq 'Stopped') { 0 } elseif ($script:opened -and $scenario -eq 'changed-pid') { 4321 } else { 1234 }
  [pscustomobject]@{ Name='LS101Lab'; State=$script:state; ProcessId=$servicePid; ServiceType='Own Process'; PathName='"' + $expected + '"' }
}
function sc.exe {
  Write-Output ('SC:' + ($args -join ' ')) | Out-Host
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'stop') { $script:state = if ($scenario -eq 'graceful') { 'Stopped' } else { 'Stop Pending' } }
}
function Start-Sleep { }
function Get-Process($Id) {
  $script:opened = $true
  $target = [pscustomobject]@{ Handle=1; HasExited=$false; Path=$(if ($scenario -eq 'wrong-path') { 'C:\\unrelated.exe' } else { $expected }) }
  $target | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
  return $target
}
function taskkill.exe {
  Write-Output ('KILL:' + ($args -join ' ')) | Out-Host
  $global:LASTEXITCODE = if ($scenario -eq 'kill-failed') { 1 } else { 0 }
  if ($scenario -eq 'kill') { $script:state = 'Stopped' }
}
`
      const script =
        harness +
        windowsEmergencyStopScript("C:\\Program Files\\O'Brien\\service")
          .replaceAll('AddSeconds(30)', 'AddSeconds(0)')
          .replaceAll('AddSeconds(10)', 'AddSeconds(0)')
      const result = await new Promise<{ code: number; output: string }>((resolve) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64')
          ],
          { timeout: 15000, encoding: 'utf8' },
          (error, stdout, stderr) =>
            resolve({ code: error ? Number(error.code) || 1 : 0, output: stdout + stderr })
        )
      })
      expect(result.code, result.output).toBe(['graceful', 'kill'].includes(scenario) ? 0 : 1)
      expect(result.output).toContain('SC:config LS101Lab start= disabled')
      if (['graceful', 'wrong-path', 'changed-pid', 'shared'].includes(scenario))
        expect(result.output).not.toContain('KILL:')
      else expect(result.output).toContain('KILL:/PID 1234 /T /F /FI SERVICES eq LS101Lab')
    },
    20000
  )
})
