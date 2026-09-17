param(
  [Parameter(Mandatory = $true)][string]$Node,
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$Config,
  [Parameter(Mandatory = $true)][string]$ResultsDir,
  [Parameter(Mandatory = $true)][string]$Output
)

# Starts the phase run as a child process and captures every stream into $Output.
#
# The scheduled task discards the output of the process it launches, and the phase run cannot report a
# failure that stops it from starting. Without this launcher a syntax error, a missing module or a
# failure in the first statements all look identical: the task exits non-zero and the results directory
# stays empty, with nothing to explain why. Redirecting here, in the parent, captures a child that never
# managed to run a single one of its own statements.
#
# This is the one place PowerShell still belongs in the launch path, because the redirection must happen
# outside the process being diagnosed.

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null

& $Node $Script --config $Config --results-dir $ResultsDir *> $Output
exit $LASTEXITCODE
