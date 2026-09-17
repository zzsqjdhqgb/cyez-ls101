param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$Config,
  [Parameter(Mandatory = $true)][string]$Output
)

# Starts the lab phase script as a child process and captures every stream into $Output.
#
# The scheduled task discards the output of the process it launches, and the phase script cannot report
# a failure that stops it from starting. Without this launcher a parse error, a missing file or a
# failure in the first statements all look identical: the task exits non-zero and the results directory
# stays empty, with nothing to explain why. Redirecting in the parent captures a child that never
# managed to run a single one of its own statements.
#
# The child is invoked as a real process rather than dot-sourced so that its parse errors are written
# to the stream this file redirects.

$ErrorActionPreference = 'Continue'
$directory = Split-Path -Parent $Output
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }

$shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $shell)) { $shell = 'powershell.exe' }

& $shell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Script -Config $Config *> $Output
$code = $LASTEXITCODE
exit $code
