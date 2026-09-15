$ErrorActionPreference = 'Stop'
$root = 'C:\ls101-lab\workspace'
$results = 'C:\ls101-lab\results'
New-Item -ItemType Directory -Force -Path $root, $results | Out-Null
if (-not (Test-Path 'C:\ls101-lab\source.zip')) { throw 'source archive was not uploaded' }
Expand-Archive -Path 'C:\ls101-lab\source.zip' -DestinationPath $root -Force
Set-Location $root
$log = Join-Path $results 'acceptance.log'
$node = Get-ChildItem 'C:\ls101-lab\tools' -Directory -Filter 'node-v*-win-x64' | Select-Object -First 1
if (-not $node) { throw 'Node runtime was not prepared in the base box' }
$env:Path = "$($node.FullName);$env:Path"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$env:YARN_ENABLE_GLOBAL_CACHE = 'true'
$env:YARN_GLOBAL_FOLDER = 'C:\ls101-lab\cache\yarn\global'
$env:YARN_CACHE_FOLDER = 'C:\ls101-lab\cache\yarn'
$corepack = Join-Path $node.FullName 'corepack.cmd'
if (-not (Test-Path $corepack)) { throw 'Corepack was not prepared in the base box' }
try {
  & $corepack enable --install-directory $node.FullName *>&1 | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "corepack enable failed with exit code $LASTEXITCODE" }
  & $corepack prepare yarn@4.15.0 --activate *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "corepack yarn preparation failed with exit code $LASTEXITCODE" }
  & $corepack yarn install --immutable *>&1 | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "yarn install failed with exit code $LASTEXITCODE" }
  & $corepack yarn test:smoke *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "yarn test:smoke failed with exit code $LASTEXITCODE" }
  Set-Content (Join-Path $results 'status.txt') 'passed'
} catch {
  $_ | Out-String | Add-Content $log
  Set-Content (Join-Path $results 'status.txt') 'failed'
  throw
}
