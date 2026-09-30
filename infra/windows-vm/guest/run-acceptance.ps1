$ErrorActionPreference = 'Stop'
$root = 'C:\ls101-lab\workspace'
$results = 'C:\ls101-lab\results'
$transfers = 'C:\ls101-lab\transfers'
New-Item -ItemType Directory -Force -Path $root, $results | Out-Null
# The snapshot and this script arrive over the guest file server, which the host fills and then
# reads back; WinRM only carries the control commands.
if (-not (Test-Path "$transfers\source.zip")) { throw 'source archive was not uploaded' }
$log = Join-Path $results 'acceptance.log'
$status = Join-Path $results 'status.txt'
$progress = Join-Path $results 'progress.txt'
Remove-Item $log, $status, $progress -Force -ErrorAction SilentlyContinue

# The host polls this file while the suite runs, so every step publishes its phase before starting.
function Write-Phase([string]$message) {
  Add-Content -Path $progress -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), ($message -replace '\|', '/'))
}

Write-Phase 'expanding source archive'
Expand-Archive -Path "$transfers\source.zip" -DestinationPath $root -Force
Set-Location $root
$node = Get-ChildItem 'C:\ls101-lab\tools' -Directory -Filter 'node-v*-win-x64' | Select-Object -First 1
if (-not $node) { throw 'Node runtime was not prepared in the base box' }
$env:Path = "$($node.FullName);$env:Path"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$env:YARN_ENABLE_GLOBAL_CACHE = 'true'
$env:YARN_GLOBAL_FOLDER = 'C:\ls101-lab\cache\yarn\global'
$env:YARN_CACHE_FOLDER = 'C:\ls101-lab\cache\yarn'
# The product documentation suite only needs the packaging assets: the lightweight Qwen TTS
# runtime, the lab service assets and the generated file icons. This setup mode skips the
# multi-gigabyte model downloads that the acceptance run does not exercise.
$env:LS101_SETUP_MODE = 'product-docs'
# Surface Electron and Chromium output in the captured log, which is the only evidence available
# when the packaged application fails to show its window.
$env:ELECTRON_ENABLE_LOGGING = '1'
$env:DEBUG = 'pw:browser*'
$corepack = Join-Path $node.FullName 'corepack.cmd'
if (-not (Test-Path $corepack)) { throw 'Corepack was not prepared in the base box' }

$failure = $null
try {
  # Native commands write progress to stderr. With $ErrorActionPreference = 'Stop' a single stderr
  # line terminates the run even when the command succeeded, so the native steps below run under
  # 'Continue' and are judged by their exit code instead.
  $ErrorActionPreference = 'Continue'
  $sessionInfo = 'unavailable'
  try { $sessionInfo = (qwinsta 2>&1 | Out-String) } catch { $sessionInfo = "qwinsta failed: $_" }
  # Every log write states its encoding: Tee-Object in Windows PowerShell has no -Encoding parameter
  # and used to append UTF-16LE, which the host then read as NUL-separated text.
  Add-Content -Path $log -Value "=== desktop session ===`r`n$sessionInfo" -Encoding UTF8
  Write-Phase 'corepack enable'
  & $corepack enable --install-directory $node.FullName *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "corepack enable failed with exit code $LASTEXITCODE" }
  Write-Phase 'preparing yarn 4.15.0'
  & $corepack prepare yarn@4.15.0 --activate *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "corepack yarn preparation failed with exit code $LASTEXITCODE" }
  Write-Phase 'yarn install'
  & $corepack yarn install --immutable *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "yarn install failed with exit code $LASTEXITCODE" }
  # `yarn test:smoke` and `yarn test:product-docs` both start with `yarn build:test`, so the
  # application is packaged once here and both suites run through their run-only entry points:
  # test:smoke runs playwright with the electron-app spec, test:product-docs:run renders the
  # preview. Sharing one build keeps both suites on the same artifact and saves a second packaging.
  Write-Phase 'yarn build:test'
  & $corepack yarn build:test *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "yarn build:test failed with exit code $LASTEXITCODE" }
  Write-Phase 'yarn test:smoke'
  & $corepack yarn test:playwright:electron tests/integration/electron-app.spec.ts *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "smoke tests failed with exit code $LASTEXITCODE" }
  Write-Phase 'yarn test:product-docs'
  & $corepack yarn test:product-docs:run *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "product documentation tests failed with exit code $LASTEXITCODE" }
} catch {
  $failure = $_
  Add-Content -Path $log -Value ($_ | Out-String) -Encoding UTF8
  # Yarn only prints the path of a failed package build; copy the tail of those logs so the reason
  # (for example a failed Electron binary download) travels back with the rest of the evidence.
  Get-ChildItem -Path (Join-Path $env:TEMP 'xfs-*') -Filter 'build.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 3 | ForEach-Object {
      Add-Content -Path $log -Value "=== yarn build log: $($_.FullName) ===" -Encoding UTF8
      Get-Content -LiteralPath $_.FullName -Tail 200 | Add-Content -Path $log -Encoding UTF8
    }
} finally {
  $ErrorActionPreference = 'Stop'
}

# Export the preview documentation and the failure evidence before publishing the status file:
# the host treats status.txt as the completion marker and collects artifacts afterwards.
Write-Phase 'exporting artifacts'
$sources = @(
  (Join-Path $root 'test-results\product-docs-preview'),
  (Join-Path $root 'test-results\product-docs'),
  (Join-Path $root 'test-results\integration'),
  $log,
  $progress
) | Where-Object { Test-Path $_ }
if ($sources.Count -gt 0) {
  $artifact = Join-Path $results 'acceptance-artifacts.zip'
  if (Test-Path $artifact) { Remove-Item $artifact -Force }
  Compress-Archive -Path $sources -DestinationPath $artifact -Force
}

if ($failure) {
  Write-Phase 'failed'
  Set-Content -Path $status -Value 'failed'
  throw $failure
}
Write-Phase 'passed'
Set-Content -Path $status -Value 'passed'
