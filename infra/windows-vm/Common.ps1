Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-LabConfig {
    $path = Join-Path $PSScriptRoot 'config.local.psd1'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Copy config.example.psd1 to config.local.psd1 and review SOURCES.md first.'
    }
    return Import-PowerShellDataFile -LiteralPath $path
}

function Resolve-LabPath([string]$Path) {
    if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $Path))
}

function Assert-LabHash([string]$Path, [string]$Sha256) {
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Fill in the reviewed SHA-256 for $Path" }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing asset: $Path" }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Sha256) {
        throw "SHA-256 mismatch: $Path. No automatic replacement was performed."
    }
}

function Get-LabAsset([string]$Url, [string]$Path, [string]$Sha256) {
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Fill in the reviewed SHA-256 for $Url" }
    if (Test-Path -LiteralPath $Path) {
        Assert-LabHash $Path $Sha256
        return
    }
    New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).part"
    try {
        Write-Host "Downloading $Url"
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary
        Assert-LabHash $temporary $Sha256
        Move-Item -LiteralPath $temporary -Destination $Path
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Initialize-LabEnvironment {
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) {
        throw 'Use 64-bit PowerShell on a Windows x64 host, not WSL.'
    }
    $root = Join-Path $PSScriptRoot '.local'
    $directories = @{
        PACKER_CACHE_DIR = 'cache/packer'
        PACKER_PLUGIN_PATH = 'tools/packer-plugins'
        PACKER_CONFIG_DIR = 'config/packer'
        VAGRANT_HOME = 'vagrant-home'
        VAGRANT_DOTFILE_PATH = 'vagrant-state'
        TEMP = 'tmp'
        TMP = 'tmp'
    }
    foreach ($name in $directories.Keys) {
        $value = Join-Path $root $directories[$name]
        New-Item -ItemType Directory -Path $value -Force | Out-Null
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
    foreach ($name in @('downloads', 'build', 'boxes', 'vms', 'logs', 'generated', 'transfers')) {
        New-Item -ItemType Directory -Path (Join-Path $root $name) -Force | Out-Null
    }
    $env:VAGRANT_CWD = $PSScriptRoot
    $env:VAGRANT_DEFAULT_PROVIDER = 'vmware_desktop'
    $env:CHECKPOINT_DISABLE = '1'
    $env:PACKER_LOG = '1'
    $env:PACKER_LOG_PATH = Join-Path $root 'logs/packer.log'
    return $root
}

function Assert-LabExit([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

function Expand-LabTool([string]$Archive, [string]$Destination) {
    # Re-extract the verified ZIP so changed extracted executables are not silently reused.
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
}

function Assert-LabPassword([string]$Password) {
    if ($Password -eq 'REPLACE_WITH_A_LOCAL_LAB_PASSWORD' -or
        $Password -notmatch '^[A-Za-z0-9!#._-]{12,64}$' -or
        $Password -cnotmatch '[A-Z]' -or $Password -cnotmatch '[a-z]' -or
        $Password -notmatch '[0-9]' -or $Password -notmatch '[!#._-]') {
        throw 'Set GuestPassword to 12-64 allowed characters including uppercase, lowercase, digit and !#._-.'
    }
}
