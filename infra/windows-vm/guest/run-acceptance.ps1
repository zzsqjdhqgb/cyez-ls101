$ErrorActionPreference = 'Stop'
$root = 'C:\ls101-lab\workspace'
$results = 'C:\ls101-lab\results'
New-Item -ItemType Directory -Force -Path $root, $results | Out-Null
if (-not (Test-Path 'C:\ls101-lab\source.tar.gz')) { throw 'source archive was not uploaded' }
tar.exe -xzf 'C:\ls101-lab\source.tar.gz' -C $root
Set-Location $root
$log = Join-Path $results 'acceptance.log'
try {
  & yarn.cmd install --immutable *>&1 | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "yarn install failed with exit code $LASTEXITCODE" }
  & yarn.cmd test:smoke *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "yarn test:smoke failed with exit code $LASTEXITCODE" }
  Set-Content (Join-Path $results 'status.txt') 'passed'
} catch {
  $_ | Out-String | Add-Content $log
  Set-Content (Join-Path $results 'status.txt') 'failed'
  throw
}
