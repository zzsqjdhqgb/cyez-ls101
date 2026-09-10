[CmdletBinding()]
param([switch]$ValidateOnly)
. "$PSScriptRoot/Common.ps1"
$config = Get-LabConfig
$localRoot = Initialize-LabEnvironment
Assert-LabPassword $config.GuestPassword
$packerZip = Join-Path $localRoot "downloads/packer_$($config.PackerVersion)_windows_amd64.zip"
Assert-LabHash $packerZip $config.PackerSha256
$packerDirectory = Join-Path $localRoot "tools/packer-$($config.PackerVersion)"
Expand-LabTool $packerZip $packerDirectory
$iso = Resolve-LabPath $config.WindowsIso
$tools = Resolve-LabPath $config.VMwareToolsIso
$nodeZip = Join-Path $localRoot "downloads/node-v$($config.NodeVersion)-win-x64.zip"
$gitZip = Join-Path $localRoot "downloads/MinGit-$($config.MinGitVersion)-64-bit.zip"
Assert-LabHash $iso $config.WindowsIsoSha256
Assert-LabHash $tools $config.VMwareToolsIsoSha256
Assert-LabHash $nodeZip $config.NodeSha256
Assert-LabHash $gitZip $config.MinGitSha256

$variables = @{
    windows_iso = $iso.Replace('\', '/')
    windows_iso_sha256 = $config.WindowsIsoSha256
    tools_iso = $tools.Replace('\', '/')
    tools_iso_sha256 = $config.VMwareToolsIsoSha256
    node_zip = $nodeZip.Replace('\', '/')
    node_sha256 = $config.NodeSha256
    node_version = $config.NodeVersion
    git_zip = $gitZip.Replace('\', '/')
    git_sha256 = $config.MinGitSha256
    image_index = [int]$config.WindowsImageIndex
    guest_password = $config.GuestPassword
    cpus = [int]$config.Cpus
    memory = [int]$config.MemoryMB
    disk_size = [int]$config.DiskMB
    output_directory = (Join-Path $localRoot 'build/windows-server-2022').Replace('\', '/')
    box_output = (Join-Path $localRoot 'boxes/ls101-windows-server-2022-vmware.box').Replace('\', '/')
}
if (-not $ValidateOnly -and ((Test-Path -LiteralPath $variables.output_directory) -or (Test-Path -LiteralPath $variables.box_output))) {
    throw 'Build output already exists. Archive or remove it explicitly before rebuilding; no automatic overwrite.'
}
$varsPath = Join-Path $localRoot 'generated/build.pkrvars.json'
[IO.File]::WriteAllText($varsPath, ($variables | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
# Vagrant consumes the same local credentials as the answer file. Never commit this directory.
[IO.File]::WriteAllText((Join-Path $localRoot 'generated/guest.json'), (@{
    username = 'vagrant'; password = $config.GuestPassword
    cpus = [int]$config.Cpus; memory = [int]$config.MemoryMB
} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Push-Location $PSScriptRoot
try {
    $packer = Join-Path $packerDirectory 'packer.exe'
    & $packer validate "-var-file=$varsPath" './packer'
    Assert-LabExit 'packer validate'
    if (-not $ValidateOnly) {
        & $packer build "-var-file=$varsPath" './packer'
        Assert-LabExit 'packer build'
        (Get-FileHash -LiteralPath $variables.box_output -Algorithm SHA256).Hash.ToLowerInvariant() |
            Set-Content -LiteralPath "$($variables.box_output).sha256" -Encoding ASCII
    }
} finally { Pop-Location }
