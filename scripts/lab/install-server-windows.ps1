param([switch]$Verify)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = $PSScriptRoot
$manifestPath = Join-Path $source 'runtime-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.format -ne 'ls101-service-runtime' -or $manifest.platform -ne 'win32' -or $manifest.arch -ne 'x64' -or $manifest.nodeVersion -ne '24.20.0' -or $manifest.releaseVersion -notmatch '^[0-9A-Za-z.+-]+$') { throw 'Incompatible service runtime' }
if ($manifest.files.Count -gt 32) { throw 'Invalid runtime manifest' }
$seen = @{}
foreach ($file in $manifest.files) {
  if ($file.path -notmatch '^[A-Za-z0-9_./-]+$' -or $file.path.StartsWith('/') -or ($file.path.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' }) -or $seen.ContainsKey($file.path)) { throw 'Invalid runtime path' }
  $seen[$file.path] = $true
  $path = Join-Path $source $file.path
  $item = Get-Item -LiteralPath $path
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Runtime digest mismatch' }
}
foreach ($required in @('server.cjs', 'manager.cjs', 'runtime/node.exe', 'LS101Lab.exe', 'LS101Lab.xml')) {
  if (-not $seen.ContainsKey($required)) { throw 'Incomplete service runtime' }
}
if ((& (Join-Path $source 'runtime/node.exe') --version) -ne 'v24.20.0' -or $LASTEXITCODE -ne 0) { throw 'Incorrect packaged Node version' }
if ($Verify) { Write-Output 'Service runtime verified.'; exit 0 }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator required' }
& (Join-Path $source 'runtime/node.exe') (Join-Path $source 'manager.cjs') --prepare-install
if ($LASTEXITCODE -ne 0) { throw 'Service upgrade preparation failed. Check maintenance mode, active devices and the latest backup.' }
$service = Get-Service -Name LS101Lab -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') { throw 'Stop the service before installation or upgrade' }
$program = Join-Path $env:ProgramFiles 'LS101LabService'
$data = Join-Path $env:ProgramData 'LS101Lab'
if (Test-Path -LiteralPath (Join-Path $data 'data\service.sqlite')) {
  $ready = Get-Content -LiteralPath (Join-Path $data 'data\upgrade-ready.json') -Raw | ConvertFrom-Json
  if ($ready.targetVersion -ne $manifest.releaseVersion -or [DateTime]::Parse($ready.preparedAt).ToUniversalTime() -lt [DateTime]::UtcNow.AddDays(-1)) { throw 'Prepare the upgrade with a current backup before installation' }
}
function Set-PrivateDirectory([string]$Path, [string]$ServiceSid, [bool]$Readable) {
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path | Out-Null }
  if ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected reparse point' }
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  if ($ServiceSid) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($ServiceSid), 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')) }
  if ($Readable) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')) }
  Set-Acl -LiteralPath $Path -AclObject $acl
}
Set-PrivateDirectory $program '' $true
$digest = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0,16)
$identifier = "$($manifest.releaseVersion)-$digest"
$destination = Join-Path $program "releases\$identifier"
if (Test-Path -LiteralPath $destination) {
  if ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected release reparse point' }
  if ((Get-FileHash -LiteralPath (Join-Path $destination 'runtime-manifest.json')).Hash -ne (Get-FileHash -LiteralPath $manifestPath).Hash) { throw 'Existing release is incomplete or different' }
  foreach ($file in $manifest.files) {
    $installed = Get-Item -LiteralPath (Join-Path $destination $file.path)
    if ($installed.PSIsContainer -or ($installed.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-FileHash -LiteralPath $installed.FullName).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Existing release integrity mismatch' }
  }
} else {
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($file in $manifest.files) {
  $target = Join-Path $destination $file.path
  New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $source $file.path) -Destination $target
}
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $destination 'runtime-manifest.json')
}
$wrapper = Join-Path $destination 'LS101Lab.exe'
if (-not $service) { & $wrapper install; if ($LASTEXITCODE -ne 0) { throw 'Service registration failed' } }
$serviceSid = ([Security.Principal.NTAccount]::new('NT SERVICE', 'LS101Lab')).Translate([Security.Principal.SecurityIdentifier]).Value
Set-PrivateDirectory $data $serviceSid $false
New-Item -ItemType Directory -Path (Join-Path $data 'logs') -Force | Out-Null
& sc.exe config LS101Lab binPath= ('"' + $wrapper + '"') obj= 'NT SERVICE\LS101Lab' password= ''
if ($LASTEXITCODE -ne 0) { throw 'Service account configuration failed' }
& sc.exe sidtype LS101Lab unrestricted
if ($LASTEXITCODE -ne 0) { throw 'Service SID configuration failed' }
$record = Join-Path $program 'installation.json'
$temporary = Join-Path $program ('installation-' + [Guid]::NewGuid().ToString() + '.json')
[IO.File]::WriteAllText($temporary, (@{ release = $identifier } | ConvertTo-Json -Compress))
if (Test-Path -LiteralPath $record) { [IO.File]::Replace($temporary, $record, ($record + '.previous')) } else { [IO.File]::Move($temporary, $record) }
Write-Output 'Service installed and stopped. Autostart is unchanged.'
