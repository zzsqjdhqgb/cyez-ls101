$ErrorActionPreference = 'Stop'
$iso = 'C:\Windows\Temp\vmware-tools.iso'
$expectedHash = $env:LS101_TOOLS_SHA256
if ($expectedHash -notmatch '^[a-fA-F0-9]{64}$') {
    throw 'LS101_TOOLS_SHA256 must contain the verified host ISO SHA-256'
}
$isoFile = Get-Item -LiteralPath $iso
Write-Host ("Verifying VMware Tools ISO: {0} ({1} bytes)" -f $iso, $isoFile.Length)
$actualHash = (Get-FileHash -LiteralPath $iso -Algorithm SHA256).Hash
Write-Host "VMware Tools ISO SHA-256: $actualHash"
if ($actualHash -ine $expectedHash) {
    throw "VMware Tools ISO checksum mismatch inside guest: expected $expectedHash; actual $actualHash"
}
$mounted = Mount-DiskImage -ImagePath $iso -PassThru
try {
    # Get-Volume can observe the Mount-DiskImage object before its drive letter
    # is populated. Resolve the mounted image again, then prefer the installer
    # name used by current VMware Tools releases (setup.exe).
    $volume = $mounted | Get-Volume
    if (-not $volume.DriveLetter) {
        Start-Sleep -Seconds 2
        $volume = (Get-DiskImage -ImagePath $iso | Get-Disk | Get-Partition | Get-Volume |
            Where-Object DriveLetter | Select-Object -First 1)
    }
    if (-not $volume.DriveLetter) { throw 'VMware Tools ISO mounted without a drive letter' }
    $drive = $volume.DriveLetter
    $setup = @("${drive}:\setup.exe", "${drive}:\setup64.exe") |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $setup) {
        $entries = (Get-ChildItem -LiteralPath "${drive}:\" -Name -ErrorAction SilentlyContinue) -join ', '
        throw "VMware Tools installer was not found at the ISO root. Entries: $entries"
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $setup
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'VMware|Broadcom') {
        throw "VMware Tools installer signature is not a valid VMware/Broadcom signature: $setup"
    }
    $installer = Start-Process -FilePath $setup -ArgumentList '/S /v"/qn REBOOT=R"' -Wait -PassThru
    if ($installer.ExitCode -notin @(0, 3010)) { throw "VMware Tools install failed: $($installer.ExitCode)" }
} finally { Dismount-DiskImage -ImagePath $iso }
Remove-Item -LiteralPath $iso -Force
