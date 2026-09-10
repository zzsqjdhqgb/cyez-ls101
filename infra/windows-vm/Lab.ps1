# Always use this wrapper, so Vagrant boxes/plugins/VM disks/temp files stay project-local.
[CmdletBinding()]
param([Parameter(Position = 0, ValueFromRemainingArguments = $true)][string[]]$VagrantArgs)
. "$PSScriptRoot/Common.ps1"
$localRoot = Initialize-LabEnvironment
if (-not $VagrantArgs -or $VagrantArgs.Count -eq 0) { $VagrantArgs = @('status') }
Get-Command vagrant.exe -ErrorAction Stop | Out-Null
Push-Location $PSScriptRoot
try {
    & vagrant.exe @VagrantArgs
    Assert-LabExit 'vagrant'
} finally { Pop-Location }
