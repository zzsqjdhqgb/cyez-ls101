# Runs only inside the disposable VM, after unattended installation.
$ErrorActionPreference = 'Stop'
Start-Transcript -Path 'C:\Windows\Temp\ls101-bootstrap.log' -Append
try {
    # Keep UAC/Defender enabled. Allow this local admin's remote WinRM token only.
    $policy = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
    New-ItemProperty -Path $policy -Name LocalAccountTokenFilterPolicy -Value 1 -PropertyType DWord -Force | Out-Null
    Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private
    Enable-PSRemoting -SkipNetworkProfileCheck -Force
    Get-ChildItem WSMan:\localhost\Listener | Where-Object { $_.Keys -contains 'Transport=HTTP' } |
        Remove-Item -Recurse -Force
    $certificate = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\LocalMachine\My
    New-Item WSMan:\localhost\Listener -Transport HTTPS -Address '*' -CertificateThumbPrint $certificate.Thumbprint -Force | Out-Null
    Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true
    Set-Item WSMan:\localhost\Service\AllowUnencrypted -Value $false
    Set-Service WinRM -StartupType Automatic
    Set-LocalUser -Name vagrant -PasswordNeverExpires $true
    powercfg.exe /change standby-timeout-ac 0
    powercfg.exe /change hibernate-timeout-ac 0
    Restart-Service WinRM
    # Open the port last so Packer cannot start uploading during the restart above.
    New-NetFirewallRule -Name LS101-Lab-WinRM-HTTPS -DisplayName 'LS101 Lab WinRM HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5986 -RemoteAddress LocalSubnet | Out-Null
} finally { Stop-Transcript }
