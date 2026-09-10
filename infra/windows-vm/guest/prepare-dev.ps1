$ErrorActionPreference = 'Stop'
foreach ($asset in @(
    @{ Path = 'C:\Windows\Temp\node.zip'; Hash = $env:LS101_NODE_SHA256 },
    @{ Path = 'C:\Windows\Temp\mingit.zip'; Hash = $env:LS101_GIT_SHA256 }
)) {
    if ((Get-FileHash -LiteralPath $asset.Path -Algorithm SHA256).Hash -ine $asset.Hash) {
        throw "Guest asset checksum mismatch: $($asset.Path)"
    }
}
$root = 'C:\ls101-lab'
New-Item -ItemType Directory -Path "$root\tools", "$root\workspace", "$root\cache", "$root\results" -Force | Out-Null
Expand-Archive -LiteralPath 'C:\Windows\Temp\node.zip' -DestinationPath "$root\tools" -Force
Expand-Archive -LiteralPath 'C:\Windows\Temp\mingit.zip' -DestinationPath "$root\tools\mingit" -Force
$nodePath = "$root\tools\node-v${env:LS101_NODE_VERSION}-win-x64"
$gitPath = "$root\tools\mingit\cmd"
$oldPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
[Environment]::SetEnvironmentVariable('Path', "$nodePath;$gitPath;$oldPath", 'Machine')
$env:Path = "$nodePath;$gitPath;$env:Path"
foreach ($entry in @{
    COREPACK_HOME = "$root\cache\corepack"
    npm_config_cache = "$root\cache\npm"
    YARN_CACHE_FOLDER = "$root\cache\yarn"
    ELECTRON_CACHE = "$root\cache\electron"
    ELECTRON_BUILDER_CACHE = "$root\cache\electron-builder"
    PLAYWRIGHT_BROWSERS_PATH = "$root\cache\playwright"
}.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Machine')
}
& "$nodePath\corepack.cmd" enable --install-directory $nodePath
if ($LASTEXITCODE -ne 0) { throw 'corepack enable failed' }
# Yarn itself is downloaded only when the user explicitly runs Yarn in the guest.
& "$nodePath\node.exe" --version
if ($LASTEXITCODE -ne 0) { throw 'Node failed to start' }
& "$gitPath\git.exe" --version
if ($LASTEXITCODE -ne 0) { throw 'Git failed to start' }
Remove-Item -LiteralPath 'C:\Windows\Temp\node.zip', 'C:\Windows\Temp\mingit.zip' -Force
