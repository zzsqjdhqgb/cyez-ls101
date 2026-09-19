param(
  [Parameter(Mandatory = $true)][string]$Probe,
  [string]$Path,
  [string]$Name,
  [string]$Match,
  [string]$User,
  [string]$PipeName,
  [string]$DataDir,
  [string[]]$Source,
  [int]$Port = 0,
  [int]$Minutes = 15,
  [int]$Tail = 60
)

# Data collection only. Every probe prints exactly one marked JSON line and makes no decision: the
# comparisons live in lab-acceptance.mjs, where they run under unit tests in the container instead of
# only inside a rebuilt VM. Nothing here may Write-Output anything else.
$ErrorActionPreference = 'Stop'
$MARKER = 'LS101PROBE|'

function Write-Probe($Value) {
  Write-Output ($MARKER + ($Value | ConvertTo-Json -Depth 6 -Compress))
}

# Native tools write progress and warnings to stderr, and $ErrorActionPreference = 'Stop' turns a single
# stderr line into a terminating error, so native calls run under 'Continue' and are judged by code.
function Invoke-NativeText([string]$File, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $lines = & $File @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ Code = $code; Text = ($lines | Out-String) }
}

switch ($Probe) {
  'elevation' {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $groupText = (Invoke-NativeText 'whoami.exe' @('/groups')).Text
    Write-Probe @{
      identity      = $identity.Name
      administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
      highIntegrity = $groupText -match 'S-1-16-12288'
      mediumIntegrity = $groupText -match 'S-1-16-8192'
    }
  }

  'acl' {
    if (-not (Test-Path -LiteralPath $Path)) { Write-Probe @{ path = $Path; exists = $false }; break }
    $acl = Get-Acl -LiteralPath $Path
    $rules = @(
      $acl.Access | ForEach-Object {
        @{
          identity  = $_.IdentityReference.Value
          rights    = $_.FileSystemRights.ToString()
          type      = $_.AccessControlType.ToString()
          inherited = $_.IsInherited
        }
      }
    )
    Write-Probe @{
      path      = $Path
      exists    = $true
      protected = $acl.AreAccessRulesProtected
      owner     = $acl.Owner
      rules     = $rules
    }
  }

  'service' {
    $service = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    if (-not $service) { Write-Probe @{ installed = $false }; break }
    Write-Probe @{
      installed               = $true
      state                   = $service.State
      startMode               = $service.StartMode
      startName               = $service.StartName
      pathName                = $service.PathName
      processId               = $service.ProcessId
      exitCode                = $service.ExitCode
      serviceSpecificExitCode = $service.ServiceSpecificExitCode
    }
  }

  'process' {
    $candidates = @(
      Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction SilentlyContinue |
        Where-Object { -not $Match -or $_.CommandLine -like "*$Match*" }
    )
    if ($candidates.Count -eq 0) { Write-Probe @{ found = $false; matches = @() }; break }
    # First match only: the service runs one bundled runtime, and reporting each candidate would make
    # the assertion depend on how many other node processes happen to exist.
    $found = $candidates | Select-Object -First 1
    $owner = Invoke-CimMethod -InputObject $found -MethodName GetOwner -ErrorAction SilentlyContinue
    # Every match is also returned, bounded, because a caller that samples the process list while the
    # service stops needs to see each command line the wrapper ran, not just the first one.
    $matches = @(
      $candidates | Select-Object -First 10 |
        ForEach-Object { @{ processId = $_.ProcessId; sessionId = $_.SessionId; commandLine = [string]$_.CommandLine } }
    )
    Write-Probe @{
      found       = $true
      count       = $candidates.Count
      processId   = $found.ProcessId
      sessionId   = $found.SessionId
      commandLine = $found.CommandLine
      domain      = $owner.Domain
      user        = $owner.User
      matches     = $matches
    }
  }

  'listener' {
    $listeners = @(
      Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        ForEach-Object { @{ localAddress = $_.LocalAddress; localPort = $_.LocalPort; owningProcess = $_.OwningProcess } }
    )
    Write-Probe @{ port = $Port; listeners = $listeners }
  }

  # Milestone M2 (N11): the load case has to show what the many short-lived TLS connections did to
  # the machine, which is a question only the guest can answer. Counts by state, plus the dynamic port
  # range the client side draws from, so a run that exhausts it says so instead of just timing out.
  'connections' {
    $byState = @(
      Get-NetTCPConnection -ErrorAction SilentlyContinue |
        Group-Object State |
        ForEach-Object { @{ state = $_.Name; count = $_.Count } }
    )
    $toService = @(
      Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Group-Object State |
        ForEach-Object { @{ state = $_.Name; count = $_.Count } }
    )
    $range = (netsh int ipv4 show dynamicport tcp) -join "`n"
    $dynamic = $null
    if ($range -match 'Start Port\s*:\s*(\d+)') { $dynamic = @{ start = [int]$Matches[1] } }
    if ($range -match 'Number of Ports\s*:\s*(\d+)') {
      if ($null -eq $dynamic) { $dynamic = @{} }
      $dynamic['count'] = [int]$Matches[1]
    }
    Write-Probe @{ port = $Port; byState = $byState; servicePort = $toService; dynamicPorts = $dynamic }
  }

  'firewall' {
    $inbound = @(Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue)
    $matching = @(
      $inbound |
        Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
        Where-Object { @($_.LocalPort) -contains $Port -or @($_.LocalPort) -contains "$Port" } |
        ForEach-Object { @{ instanceId = $_.InstanceID; localPort = @($_.LocalPort) -join ',' } }
    )
    Write-Probe @{ enabledInboundRules = $inbound.Count; port = $Port; matching = $matching }
  }

  'events' {
    $entries = @(
      Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddMinutes(-$Minutes) } -ErrorAction SilentlyContinue |
        Where-Object { -not $Match -or $_.Message -match $Match } |
        Select-Object -First 20 |
        ForEach-Object { @{ time = $_.TimeCreated.ToString('o'); provider = $_.ProviderName; message = ($_.Message -replace '\s+', ' ') } }
    )
    Write-Probe @{ minutes = $Minutes; events = $entries }
  }

  'wrapper-logs' {
    if (-not (Test-Path -LiteralPath $Path)) { Write-Probe @{ path = $Path; exists = $false; files = @() }; break }
    $files = @(
      Get-ChildItem -LiteralPath $Path -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 3 |
        ForEach-Object {
          # Each line is cast to a plain string. Get-Content decorates every line with the provider's note
          # properties (PSPath, PSProvider and the whole FileSystemProvider reflection dump) and
          # ConvertTo-Json serialises all of them: a sixty-line log arrived as fifteen megabytes and the
          # diagnostic was unreadable exactly when it mattered.
          @{
            name  = $_.Name
            bytes = $_.Length
            tail  = @(Get-Content -LiteralPath $_.FullName -Tail $Tail -ErrorAction SilentlyContinue | ForEach-Object { [string]$_ })
          }
        }
    )
    Write-Probe @{ path = $Path; exists = $true; files = $files }
  }

  'path' {
    if (-not (Test-Path -LiteralPath $Path)) { Write-Probe @{ path = $Path; exists = $false; children = @() }; break }
    $item = Get-Item -LiteralPath $Path
    $children = @()
    if ($item.PSIsContainer) {
      $children = @(Get-ChildItem -LiteralPath $Path -ErrorAction SilentlyContinue | Select-Object -First 40 | ForEach-Object { $_.Name })
    }
    Write-Probe @{ path = $Path; exists = $true; isDirectory = $item.PSIsContainer; bytes = $item.Length; children = $children }
  }

  'archive' {
    $sources = @($Source | Where-Object { Test-Path -LiteralPath $_ })
    if ($sources.Count -eq 0) { Write-Probe @{ created = $false; reason = 'no sources' }; break }
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
    Compress-Archive -Path $sources -DestinationPath $Path -Force
    Write-Probe @{ created = $true; bytes = (Get-Item -LiteralPath $Path).Length }
  }

  'standard-user' {
    # Creating a local account and running a probe under its token is the part PowerShell genuinely does
    # more cheaply than Node on Windows, so it stays here. The verdict is returned as data.
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = 'Aa1!' + [Convert]::ToBase64String($bytes).Replace('+', 'x').Replace('/', 'y').Replace('=', 'z')
    $existing = Get-LocalUser -Name $User -ErrorAction SilentlyContinue
    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    if ($existing) { Set-LocalUser -Name $User -Password $secure }
    else { New-LocalUser -Name $User -Password $secure -PasswordNeverExpires -AccountNeverExpires | Out-Null }

    # $Path is the writable directory this probe owns; $DataDir is what the standard user then tries to
    # read. Keeping them separate is what makes the denial meaningful.
    $probeDirectory = $Path
    New-Item -ItemType Directory -Force -Path $probeDirectory | Out-Null
    $grant = Invoke-NativeText 'icacls.exe' @($probeDirectory, '/grant', "${User}:(OI)(CI)M")

    $probeScript = Join-Path $probeDirectory 'probe.ps1'
    $probeOutput = Join-Path $probeDirectory 'probe.json'
    Remove-Item $probeOutput -Force -ErrorAction SilentlyContinue
    @'
param([string]$PipeName, [string]$DataDir, [string]$Output)
$result = [ordered]@{}
foreach ($name in @('control.key', 'service.sqlite')) {
  try {
    [IO.File]::ReadAllBytes((Join-Path $DataDir $name)) | Out-Null
    $result[$name] = 'readable'
  } catch {
    $result[$name] = 'denied'
    $result["$name-error"] = $_.Exception.GetType().Name
  }
}
try {
  $client = New-Object System.IO.Pipes.NamedPipeClientStream('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
  $client.Connect(3000)
  $client.Dispose()
  $result['pipe'] = 'open'
} catch {
  $result['pipe'] = 'denied'
  $result['pipe-error'] = $_.Exception.GetType().Name
  $result['pipe-message'] = $_.Exception.Message
}
$result | ConvertTo-Json -Compress | Set-Content -LiteralPath $Output -Encoding UTF8
'@ | Set-Content -LiteralPath $probeScript -Encoding UTF8

    $credential = New-Object System.Management.Automation.PSCredential($User, $secure)
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -PipeName "{1}" -DataDir "{2}" -Output "{3}"' -f $probeScript, $PipeName, $DataDir, $probeOutput
    # CreateProcessWithLogonW needs no "log on as a batch job" right, unlike a scheduled task with
    # stored credentials, so this depends on one fewer machine policy.
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Credential $credential -WindowStyle Hidden -Wait -PassThru

    $verdict = $null
    if (Test-Path -LiteralPath $probeOutput) {
      $verdict = Get-Content -LiteralPath $probeOutput -Raw | ConvertFrom-Json
    }
    Write-Probe @{
      user       = $User
      grantExit  = $grant.Code
      probeExit  = $process.ExitCode
      produced   = [bool]$verdict
      verdict    = $verdict
      directory  = $probeDirectory
    }
  }

  'uninstall-entry' {
    # The install directory is named after the executable rather than the product, so it is read from
    # the registry instead of being guessed.
    $entries = @(
      Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } |
        Where-Object { $_.DisplayName -and (-not $Match -or $_.DisplayName -like "*$Match*") } |
        ForEach-Object { @{ displayName = $_.DisplayName; installLocation = $_.InstallLocation; version = $_.DisplayVersion } }
    )
    Write-Probe @{ entries = $entries }
  }

  'find-executable' {
    # Fallback discovery for a packaged application whose uninstall entry is missing.
    $directories = @(
      Get-ChildItem -LiteralPath $Path -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $Name) } |
        ForEach-Object { $_.FullName }
    )
    Write-Probe @{ name = $Name; root = $Path; directories = $directories }
  }

  'delete-user' {
    Remove-LocalUser -Name $User -ErrorAction SilentlyContinue
    Write-Probe @{ user = $User; removed = -not (Get-LocalUser -Name $User -ErrorAction SilentlyContinue) }
  }

  default { throw "Unknown probe: $Probe" }
}
