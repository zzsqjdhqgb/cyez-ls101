# Downloads reviewed assets and installs Packer plugins locally. Does not create a VM.
[CmdletBinding()]
param()
. "$PSScriptRoot/Common.ps1"
$config = Get-LabConfig
$localRoot = Initialize-LabEnvironment
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$packerZip = Join-Path $localRoot "downloads/packer_$($config.PackerVersion)_windows_amd64.zip"
Get-LabAsset "https://releases.hashicorp.com/packer/$($config.PackerVersion)/packer_$($config.PackerVersion)_windows_amd64.zip" $packerZip $config.PackerSha256
$packerDirectory = Join-Path $localRoot "tools/packer-$($config.PackerVersion)"
Expand-LabTool $packerZip $packerDirectory

$nodeZip = Join-Path $localRoot "downloads/node-v$($config.NodeVersion)-win-x64.zip"
Get-LabAsset "https://nodejs.org/dist/v$($config.NodeVersion)/node-v$($config.NodeVersion)-win-x64.zip" $nodeZip $config.NodeSha256
$gitZip = Join-Path $localRoot "downloads/MinGit-$($config.MinGitVersion)-64-bit.zip"
Get-LabAsset "https://github.com/git-for-windows/git/releases/download/$($config.MinGitRelease)/MinGit-$($config.MinGitVersion)-64-bit.zip" $gitZip $config.MinGitSha256
Expand-LabTool $gitZip (Join-Path $localRoot "tools/mingit-$($config.MinGitVersion)")

Assert-LabHash (Resolve-LabPath $config.WindowsIso) $config.WindowsIsoSha256
Assert-LabHash (Resolve-LabPath $config.VMwareToolsIso) $config.VMwareToolsIsoSha256

# Packer verifies plugin release checksums. The pinned plugin publishers are in windows.pkr.hcl.
# Archives, temporary files and installed plugin EXEs stay under .local via the environment above.
Push-Location $PSScriptRoot
try {
    & (Join-Path $packerDirectory 'packer.exe') init './packer'
    Assert-LabExit 'packer init'
} finally { Pop-Location }

$inventory = Get-ChildItem -LiteralPath (Join-Path $localRoot 'downloads'), (Join-Path $localRoot 'tools') -Recurse -File |
    ForEach-Object {
        [PSCustomObject]@{
            Path = $_.FullName
            Bytes = $_.Length
            SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }
$inventory | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $localRoot 'logs/asset-inventory.json') -Encoding UTF8
Write-Host 'Prepared. Review .local/logs/asset-inventory.json before Build.ps1.'
