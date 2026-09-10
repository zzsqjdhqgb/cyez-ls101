$ErrorActionPreference = 'Stop'
$iso = 'C:\Windows\Temp\vmware-tools.iso'
if ((Get-FileHash -LiteralPath $iso -Algorithm SHA256).Hash -ine $env:LS101_TOOLS_SHA256) {
    throw 'VMware Tools ISO checksum mismatch inside guest'
}
$mounted = Mount-DiskImage -ImagePath $iso -PassThru
try {
    $volume = $mounted | Get-Volume
    $setup = "$($volume.DriveLetter):\setup64.exe"
    $signature = Get-AuthenticodeSignature -LiteralPath $setup
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'VMware|Broadcom') {
        throw 'VMware Tools setup64.exe signature is not a valid VMware/Broadcom signature'
    }
    $installer = Start-Process -FilePath $setup -ArgumentList '/S /v"/qn REBOOT=R"' -Wait -PassThru
    if ($installer.ExitCode -notin @(0, 3010)) { throw "VMware Tools install failed: $($installer.ExitCode)" }
} finally { Dismount-DiskImage -ImagePath $iso }
Remove-Item -LiteralPath $iso -Force
