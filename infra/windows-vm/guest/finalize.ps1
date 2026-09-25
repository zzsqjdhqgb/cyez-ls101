$ErrorActionPreference = 'Stop'
$winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty -Path $winlogon -Name AutoAdminLogon -Value '0'
foreach ($name in @('DefaultPassword', 'AutoLogonCount')) {
    Remove-ItemProperty -Path $winlogon -Name $name -ErrorAction SilentlyContinue
}
# Remove the installation answer files containing the lab password from the guest.
foreach ($path in @(
    'C:\Windows\Panther\Unattend.xml',
    'C:\Windows\Panther\Unattend\Unattend.xml',
    'C:\Windows\System32\Sysprep\unattend.xml'
)) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}
if ((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA -ne 1) {
    throw 'UAC must remain enabled in the test image'
}
Get-Service VMTools, WinRM | Select-Object Name, Status, StartType | Format-Table
