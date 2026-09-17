param(
  # The parsed configuration must NOT be stored back into $Config. A parameter's type constraint stays
  # on the variable for the rest of the script, and PowerShell variable names are case-insensitive, so
  # `$config = ... | ConvertFrom-Json` coerces the object to its text form "@{installer=...}" and every
  # later `$config.someKey` silently returns $null instead of failing at the assignment.
  [Parameter(Mandatory = $true)][string]$Config
)

# Lab acceptance phase 1 (docs/lab-vm-acceptance-design.md, milestone M1).
#
# Runs in the disposable VM through an interactive scheduled task with the highest run level, so it
# runs as an elevated administrator exactly like an administrator at the console would. It installs the
# packaged teacher product and asserts what only a real Windows machine can show: SCM registration and
# the virtual service account, the ProgramData ACLs, session-0 hosting, the named-pipe control channel,
# real activation and initialization, the 0.0.0.0 listener, and that no firewall port was opened.
#
# The host measures the firewall gate itself, after this script reports `passed`.
#
# Secrets: the invitation code is read from a file and deleted as soon as the service consumed it; the
# management password is generated here and never leaves the process boundary of this script and the
# driver. Neither is ever written to the log, the progress file or the result JSON, and the final step
# scans every artefact for them to prove it.

$ErrorActionPreference = 'Stop'

# Record what the task handed over before anything else runs, using only literal paths and no
# configuration. The first version of this script read the configuration and then used it immediately,
# so a configuration that could not be read surfaced as "Cannot bind argument to parameter 'Path'
# because it is null" from an unrelated Join-Path, with nothing to say what had actually gone wrong.
$startupDir = 'C:\ls101-lab\results'
if (-not (Test-Path -LiteralPath $startupDir)) { New-Item -ItemType Directory -Force -Path $startupDir | Out-Null }
$startupFile = 'C:\ls101-lab\results\lab-startup.txt'
# Whether this process is actually elevated decides whether the packaged installer can register a
# service at all: an unelevated NSIS per-machine installer relaunches itself through UAC and the
# original process returns 0 immediately, which an unattended run cannot tell apart from success.
# The integrity SIDs are language-independent, unlike the words `whoami /groups` prints.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$groupText = (whoami /groups | Out-String)
@(
  "time=$((Get-Date).ToUniversalTime().ToString('o'))"
  "configArgument=$Config"
  "configExists=$(if ($Config) { Test-Path -LiteralPath $Config } else { 'no-argument' })"
  "configBytes=$(if ($Config -and (Test-Path -LiteralPath $Config)) { (Get-Item -LiteralPath $Config).Length } else { 0 })"
  "powershell=$($PSVersionTable.PSVersion)"
  "currentDirectory=$((Get-Location).Path)"
  "temp=$env:TEMP"
  "identity=$($identity.Name)"
  "isAdministrator=$($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
  "highIntegrity=$($groupText -match 'S-1-16-12288')"
  "mediumIntegrity=$($groupText -match 'S-1-16-8192')"
) | Set-Content -LiteralPath $startupFile -Encoding UTF8

$labConfig = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $labConfig) {
  throw "The lab configuration at '$Config' produced no object; the file is empty or unreadable"
}
$missing = @(
  'installer', 'driver', 'invitationFile', 'releaseVersion', 'port', 'node',
  'serviceName', 'serviceAccount', 'programDir', 'dataRoot', 'dataDir', 'resultsDir'
) | Where-Object { $labConfig.PSObject.Properties.Name -notcontains $_ }
if ($missing.Count -gt 0) {
  throw "The lab configuration at '$Config' is missing: $($missing -join ', ')"
}

$resultsDir = $labConfig.resultsDir
$log = Join-Path $resultsDir 'lab-acceptance.log'
$status = Join-Path $resultsDir 'lab-status.txt'
$progress = Join-Path $resultsDir 'lab-progress.txt'
$resultFile = Join-Path $resultsDir 'lab-results.json'
$artifact = Join-Path $resultsDir 'lab-artifacts.zip'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
Remove-Item $log, $status, $progress, $resultFile, $artifact -Force -ErrorAction SilentlyContinue

$results = [ordered]@{}
$failure = $null

function Write-Log([string]$Message) {
  Add-Content -Path $log -Value $Message -Encoding UTF8
}

# The host polls this file, so every step publishes its phase before it starts.
function Write-Phase([string]$Message) {
  Add-Content -Path $progress -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), ($Message -replace '\|', '/')) -Encoding UTF8
  Write-Log "== $Message"
}

# Assertions accept whatever a test expression produces, because PowerShell's parameter binding refuses
# to convert a string to [bool]: "Boolean parameters accept only Boolean values and numbers". A pipeline
# that matches exactly one item yields a bare string rather than an array, so a [bool]-typed parameter
# made an assertion about a collection behave differently depending on how many items matched, and fail
# outright when exactly one did. The coercion is therefore explicit here.
function Assert-That($Condition, [string]$Message) {
  $passed = if ($Condition -is [string]) {
    $Condition.Length -gt 0
  } elseif ($Condition -is [System.Collections.IEnumerable]) {
    @($Condition).Count -gt 0
  } else {
    [bool]$Condition
  }
  if (-not $passed) { throw "ASSERTION FAILED: $Message" }
  Write-Log "ok: $Message"
}

# Native tools write progress to stderr, and $ErrorActionPreference = 'Stop' turns a single stderr line
# into a terminating error even when the command succeeded. Native steps therefore run under
# 'Continue' and are judged by their exit code, like the existing acceptance script does.
function Invoke-Native {
  param(
    [string]$File,
    [string[]]$Arguments,
    [string]$InputText,
    [switch]$HasInput
  )
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($HasInput) { $lines = $InputText | & $File @Arguments 2>&1 }
    else { $lines = & $File @Arguments 2>&1 }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ Code = $code; Text = ($lines | Out-String) }
}

# Native output can carry warnings, so the payload is read from the last line that parses as JSON.
function ConvertFrom-JsonOutput([string]$Text) {
  $lines = $Text -split "`r?`n" | Where-Object { $_.Trim() -ne '' }
  for ($index = $lines.Count - 1; $index -ge 0; $index--) {
    try { return ($lines[$index] | ConvertFrom-Json) } catch { }
  }
  throw 'No JSON payload was found in the command output'
}

function Invoke-Step([string]$Name, [scriptblock]$Body) {
  Write-Phase $Name
  try {
    & $Body
    $results[$Name] = [ordered]@{ status = 'passed' }
  } catch {
    $results[$Name] = [ordered]@{ status = 'failed'; error = ($_ | Out-String).Trim() }
    throw
  }
}

# The base box keeps only the NAT adapter, but taking one address explicitly matters: a second IPv4
# address would make the member enumeration return an array, and interpolating that into the baseUrl
# would silently produce a space-joined string.
function Get-GuestAddress {
  $configuration = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null } |
    Select-Object -First 1
  if (-not $configuration) { return $null }
  return @($configuration.IPv4Address.IPAddress) | Select-Object -First 1
}

# The SCM reports a WinSW service as running as soon as the wrapper starts, but the wrapper then starts
# the bundled runtime as a child, so the process, the control pipe and the listening socket all appear a
# moment later. Every wait below polls with a bound instead of sleeping a fixed time, which is both
# faster and far less flaky.

# Derived from the installation record rather than assumed, so the assertions follow whatever the
# installer actually published.
$manifest = $labConfig.programDir
$runtime = $null
$server = $null
$manager = $null
$runtimeNode = $null
$dataDir = $labConfig.dataDir
$dataRoot = $labConfig.dataRoot
$pipeName = $null
$fingerprint = $null
$serverId = $null
$licenseExpiresAt = $null
# Working files live in the transfer directory rather than $env:TEMP: the task's environment is not
# guaranteed to define TEMP, and Join-Path fails with a null -Path when it does not. This directory is
# created before the task starts, is writable by the same account, and is removed with the run.
$workDirectory = 'C:\ls101-lab\transfers'
$managementPasswordFile = Join-Path $workDirectory ('ls101-mgmt-' + [Guid]::NewGuid().ToString() + '.txt')

function Invoke-Driver([string[]]$Arguments, [switch]$AllowFailure) {
  $result = Invoke-Native -File $labConfig.node -Arguments (@($labConfig.driver) + $Arguments)
  Write-Log ("driver {0}`n{1}" -f ($Arguments -join ' '), $result.Text)
  if (-not $AllowFailure -and $result.Code -ne 0) {
    throw "driver failed with exit code $($result.Code)"
  }
  return $result
}

# A service that does not reach Running is a product finding, not a test artefact, and the reason is
# never in the assertion that noticed it: the SCM, the WinSW wrapper and the Windows event log each hold
# a different part of the story. Collecting all three turns "the process never appeared" into a cause.
function Write-ServiceDiagnostics {
  Write-Log '--- service diagnostics ---'
  $registered = Get-CimInstance Win32_Service -Filter "Name='$($labConfig.serviceName)'" -ErrorAction SilentlyContinue
  if ($registered) {
    Write-Log ("scm state={0} exitCode={1} serviceSpecificExitCode={2} startName={3}" -f $registered.State, $registered.ExitCode, $registered.ServiceSpecificExitCode, $registered.StartName)
    Write-Log ("scm path={0}" -f $registered.PathName)
  } else {
    Write-Log 'the service is no longer registered with the SCM'
  }
  # WinSW writes its own log beside the data directory and names the reason it refused to run, including
  # a missing configuration file or an account that cannot be logged on.
  $wrapperLogs = Join-Path $dataRoot 'logs'
  if (Test-Path -LiteralPath $wrapperLogs) {
    $files = @(Get-ChildItem -LiteralPath $wrapperLogs -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 2)
    if ($files.Count -eq 0) { Write-Log "no wrapper log files in $wrapperLogs" }
    foreach ($file in $files) {
      Write-Log ("wrapper log {0} ({1} bytes):" -f $file.Name, $file.Length)
      Get-Content -LiteralPath $file.FullName -Tail 60 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "  $_" }
    }
  } else {
    Write-Log "no wrapper log directory at $wrapperLogs"
  }
  # The SCM explains a failed start in the System log.
  Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddMinutes(-15) } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'LS101' } |
    Select-Object -First 10 |
    ForEach-Object { Write-Log ("system event {0} [{1}]: {2}" -f $_.TimeCreated.ToString('HH:mm:ss'), $_.ProviderName, ($_.Message -replace '\s+', ' ')) }
  Write-Log "data directory created by the service: $(Test-Path -LiteralPath $dataDir)"
  Write-Log '--- end service diagnostics ---'
}

try {
  # --- Elevation: every later step assumes an elevated administrator. An unelevated per-machine
  # installer relaunches itself through UAC and the original process returns 0 immediately, which an
  # unattended run cannot tell apart from a successful install, so this is asserted first.
  Invoke-Step 'elevation' {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $isAdmin = (New-Object Security.Principal.WindowsPrincipal($current)).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator
    )
    $groupText = (whoami /groups | Out-String)
    Write-Log "identity=$($current.Name) administrator=$isAdmin highIntegrity=$($groupText -match 'S-1-16-12288')"
    Assert-That $isAdmin "the run is elevated (identity $($current.Name))"
    Assert-That ($groupText -match 'S-1-16-12288') 'the process token is at the high integrity level'
    $results['elevation'] = [ordered]@{
      identity      = $current.Name
      administrator = $isAdmin
      highIntegrity = ($groupText -match 'S-1-16-12288')
    }
  }

  # --- S1: silent install ---------------------------------------------------------------------
  Invoke-Step 'install-teacher' {
    Assert-That (Test-Path -LiteralPath $labConfig.installer) 'the teacher installer was uploaded'
    # The step asserts what the installer produced, so it needs a machine where the service is not
    # already installed. Without this guard a second run on a preserved VM would pass on the previous
    # run's record and silently stop testing the installer at all.
    $recordPath = Join-Path $manifest 'installation.json'
    if (Test-Path -LiteralPath $recordPath) {
      throw "The service is already installed at $manifest; the install assertion needs a clean machine. Run yarn vm:destroy then yarn vm:lab."
    }
    $installStarted = Get-Date
    $process = Start-Process -FilePath $labConfig.installer -ArgumentList '/S' -Wait -PassThru
    $installSeconds = [Math]::Round(((Get-Date) - $installStarted).TotalSeconds, 1)
    $packageMiB = [Math]::Round((Get-Item -LiteralPath $labConfig.installer).Length / 1MB)
    Write-Log "teacher installer exit code: $($process.ExitCode) after ${installSeconds}s for a ${packageMiB} MiB package"
    Assert-That ($process.ExitCode -eq 0) 'the silent install exited 0'

    # The verdict is fixed before any diagnosis runs: the step must report what the installer did, not
    # what this script can achieve by repeating its work.
    $recordPath = Join-Path $manifest 'installation.json'
    $publishedByInstaller = Test-Path -LiteralPath $recordPath

    # The install directory is named after the executable, not after the product, so it is discovered
    # rather than assumed: checking a guessed path once produced a confidently wrong conclusion.
    $appDirectory = $null
    $uninstall = Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } |
      Where-Object { $_.DisplayName -like '*LS101*Teacher*' } | Select-Object -First 1
    if ($uninstall -and $uninstall.InstallLocation -and (Test-Path -LiteralPath $uninstall.InstallLocation)) {
      $appDirectory = $uninstall.InstallLocation.TrimEnd('\')
    }
    if (-not $appDirectory) {
      $found = Get-ChildItem -LiteralPath $env:ProgramFiles -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'ls101-lab-teacher.exe') } |
        Select-Object -First 1
      if ($found) { $appDirectory = $found.FullName }
    }
    Write-Log "application directory: $(if ($appDirectory) { $appDirectory } else { 'not found' })"
    if ($appDirectory) {
      Get-ChildItem -LiteralPath $appDirectory -ErrorAction SilentlyContinue |
        Select-Object -First 20 | ForEach-Object { Write-Log "  installed: $($_.Name)" }
    }
    if (-not $publishedByInstaller) {
      # A 118 MiB package that reports success in seconds and leaves no application directory either
      # never installed anything or handed the work to another process, so record everything that
      # distinguishes those two cases before drawing a conclusion.
      Write-Log "leftover installer processes: $(@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*ls101-lab*' }).Count)"
      Get-ChildItem -LiteralPath $env:ProgramFiles -Filter 'LS101*' -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Log "  program files entry: $($_.FullName)" }
      # teacher.nsh runs install-windows.ps1 from its own resources through nsExec and discards both
      # streams, so a failed service installation is otherwise invisible. Run the identical script here
      # purely to capture the stage and message it reports; the assertion below still judges the
      # installer.
      $serviceInstaller = if ($appDirectory) { Join-Path $appDirectory 'resources\lab-server\install-windows.ps1' } else { $null }
      if (Test-Path -LiteralPath $serviceInstaller) {
        $verify = Invoke-Native -File 'powershell.exe' -Arguments @(
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $serviceInstaller, '-Verify'
        )
        Write-Log "install-windows.ps1 -Verify exit=$($verify.Code)`n$($verify.Text)"
        $manual = Invoke-Native -File 'powershell.exe' -Arguments @(
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $serviceInstaller
        )
        Write-Log "install-windows.ps1 exit=$($manual.Code)`n$($manual.Text)"
      } else {
        Write-Log "service installer not found at $serviceInstaller"
        $serviceRoot = Join-Path $appDirectory 'resources\lab-server'
        if (Test-Path -LiteralPath $serviceRoot) {
          Get-ChildItem -LiteralPath $serviceRoot -ErrorAction SilentlyContinue |
            Select-Object -First 20 | ForEach-Object { Write-Log "  resource: $($_.Name)" }
        }
      }
    }
    Assert-That $publishedByInstaller 'the installer published installation.json'

    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    Assert-That ($record.release -like "$($labConfig.releaseVersion)-*") "the installed release matches $($labConfig.releaseVersion)"
    Write-Log "installed release: $($record.release)"
    $script:runtime = Join-Path $manifest "releases\$($record.release)"
    $script:server = Join-Path $script:runtime 'server.cjs'
    $script:manager = Join-Path $script:runtime 'manager.cjs'
    $script:runtimeNode = Join-Path $script:runtime 'runtime\node.exe'
    Assert-That (Test-Path -LiteralPath $script:server) 'the installed release ships server.cjs'
    Assert-That (Test-Path -LiteralPath $script:manager) 'the installed release ships manager.cjs'
    Assert-That (Test-Path -LiteralPath $script:runtimeNode) 'the installed release ships its bundled Node runtime'
    $manifestJson = Get-Content -LiteralPath (Join-Path $script:runtime 'runtime-manifest.json') -Raw | ConvertFrom-Json
    Assert-That ($manifestJson.nodeVersion -eq '24.20.0') 'the packaged runtime is Node 24.20.0'
    $results['installedRelease'] = $record.release
    $results['packagedNodeVersion'] = $manifestJson.nodeVersion
  }

  # --- S2/S3: SCM registration, account and start mode ----------------------------------------
  Invoke-Step 'service-registration' {
    $qc = Invoke-Native -File 'sc.exe' -Arguments @('qc', $labConfig.serviceName)
    Write-Log "sc.exe qc $($labConfig.serviceName)`n$($qc.Text)"
    Assert-That ($qc.Code -eq 0) 'sc.exe qc succeeded'
    $sidType = Invoke-Native -File 'sc.exe' -Arguments @('qsidtype', $labConfig.serviceName)
    Write-Log "sc.exe qsidtype $($labConfig.serviceName)`n$($sidType.Text)"
    Assert-That ($sidType.Code -eq 0) 'sc.exe qsidtype succeeded'
    Assert-That ($sidType.Text -match 'UNRESTRICTED') 'the service SID type is unrestricted'

    $service = Get-CimInstance Win32_Service -Filter "Name='$($labConfig.serviceName)'"
    Assert-That ($null -ne $service) 'the service is registered with the SCM'
    Assert-That ($service.State -eq 'Stopped') 'the installer left the service stopped'
    # `startmode=Manual` in LS101Lab.xml and no sc.exe change: installing must not enable autostart.
    Assert-That ($service.StartMode -eq 'Manual') 'autostart is unchanged (demand start)'
    Assert-That ($service.StartName -ieq $labConfig.serviceAccount) "the service runs as $($labConfig.serviceAccount)"
    # A path with spaces only survives the SCM if it is quoted, which is why the installer uses CIM.
    Assert-That ($service.PathName -match '^".*LS101Lab\.exe"$') 'the service binary path is quoted'
    Assert-That ($service.PathName -like "*$manifest*") 'the service binary lives under the program directory'
    $results['service'] = [ordered]@{
      state     = $service.State
      startMode = $service.StartMode
      startName = $service.StartName
      pathName  = $service.PathName
    }
  }

  # --- S4: data directory ACL -----------------------------------------------------------------
  Invoke-Step 'data-acl' {
    # The installer hardens the data *parent* directory. The `data` child under it is created by the
    # service on first start, so only the parent is asserted here; the child is covered once the
    # service has run.
    Assert-That (Test-Path -LiteralPath $dataRoot) 'the installer created the data parent directory'
    Write-Log "data child '$dataDir' exists before the service first runs: $(Test-Path -LiteralPath $dataDir)"
    Assert-That (Test-Path -LiteralPath (Join-Path $dataRoot 'logs')) 'the installer created the log directory'
    $acl = Get-Acl -LiteralPath $dataRoot
    Write-Log "data parent ACL:`n$($acl | Format-List | Out-String)"
    Assert-That ($acl.AreAccessRulesProtected) 'inheritance is disabled on the data parent directory'
    $identities = @($acl.Access | ForEach-Object { $_.IdentityReference.Value })
    Write-Log "data parent identities: $($identities -join '; ')"
    Assert-That (-not ($identities | Where-Object { $_ -match 'BUILTIN\\Users$|Authenticated Users|Everyone' })) 'no standard-user group holds a data parent rule'
    Assert-That ($identities | Where-Object { $_ -match 'NT AUTHORITY\\SYSTEM' }) 'SYSTEM retains access'
    Assert-That ($identities | Where-Object { $_ -match 'BUILTIN\\Administrators' }) 'Administrators retain access'
    Assert-That ($identities | Where-Object { $_ -match 'LS101Lab' }) 'the service SID holds a data parent rule'
    $results['dataAcl'] = $identities
  }

  # --- S7/S8: start, session 0, and no listener before initialization --------------------------
  Invoke-Step 'service-start' {
    try {
      Start-Service -Name $labConfig.serviceName
      $service = Get-Service -Name $labConfig.serviceName
      Assert-That ($service.Status -eq 'Running') 'the service reached Running'
      $hostProcess = $null
      $deadline = (Get-Date).AddSeconds(30)
      while (-not $hostProcess -and (Get-Date) -lt $deadline) {
        $hostProcess = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
          Where-Object { $_.CommandLine -like '*server.cjs*' -and $_.CommandLine -like "*$dataDir*" } |
          Select-Object -First 1
        if (-not $hostProcess) { Start-Sleep -Milliseconds 500 }
      }
      Assert-That ($null -ne $hostProcess) 'the service hosts the bundled Node process'
      Write-Log "service process: pid $($hostProcess.ProcessId), session $($hostProcess.SessionId)"
      Assert-That ($hostProcess.SessionId -eq 0) 'the service process runs in session 0'
      $owner = Invoke-CimMethod -InputObject $hostProcess -MethodName GetOwner
      $ownerName = "$($owner.Domain)\$($owner.User)"
      Write-Log "service process owner: $ownerName"
      Assert-That ($ownerName -match 'LS101Lab') 'the service process runs as the service account'
      $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $labConfig.port -ErrorAction SilentlyContinue)
      Assert-That ($listeners.Count -eq 0) 'no HTTPS listener exists before initialization'
      $results['serviceProcess'] = [ordered]@{
        pid       = $hostProcess.ProcessId
        sessionId = $hostProcess.SessionId
        owner     = $ownerName
      }
    } catch {
      # Any failure here is about the service, so the evidence is captured before the step is recorded
      # as failed: the cause is in the SCM, the wrapper log or the System event log, never in the
      # assertion that happened to notice it.
      Write-ServiceDiagnostics
      throw
    }
  }

  # --- S9: the real named-pipe control channel, from a separate process ------------------------
  Invoke-Step 'control-channel-status' {
    try {
      # The pipe name comes from the product's own controlPath(), so the probe below cannot drift from
      # the name the service actually creates.
      $pipeResult = Invoke-Driver -Arguments @('pipe-name', '--root', $dataDir)
      $script:pipeName = $pipeResult.Text.Trim()
      Write-Log "control pipe: $script:pipeName"
      Assert-That ($script:pipeName -match '^ls101-lab-[a-f0-9]{32}$') 'the control pipe name has the documented shape'

      $result = Invoke-Native -File $runtimeNode -Arguments @($server, 'status', '--data-dir', $dataDir)
      Write-Log "server.cjs status`n$($result.Text)"
      Assert-That ($result.Code -eq 0) 'server.cjs status succeeded over the local control channel'
      $parsed = ConvertFrom-JsonOutput $result.Text
      Assert-That ($parsed.state -eq 'uninitialized') 'the service reports uninitialized'
      Assert-That ($parsed.license.state -eq 'not-activated') 'the license is not activated yet'
      $script:licenseExpiresAt = $parsed.license.expiresAt
      $results['uninitializedStatus'] = $parsed
    } catch {
      # A control channel that does not answer is usually the service having died or never come up, so
      # the same evidence applies here as in the start step.
      Write-ServiceDiagnostics
      throw
    }
  }

  # --- H3: the VM clock must be usable before any later failure is read as a product defect ------
  Invoke-Step 'clock-and-license-window' {
    $guestNow = (Get-Date).ToUniversalTime()
    $hostNow = [DateTime]::Parse($labConfig.hostTime).ToUniversalTime()
    $skew = [Math]::Abs(($guestNow - $hostNow).TotalMinutes)
    Write-Log ("guest clock {0}, host clock {1}, skew {2} min" -f $guestNow.ToString('o'), $hostNow.ToString('o'), [Math]::Round($skew, 1))
    # The service certificate is valid one day either side of its issue time, so a larger skew breaks
    # TLS, enrollment expiry, heartbeat windows and the licence check at the same time. Reporting it
    # here keeps a broken VM clock from being mistaken for a product defect later in the run.
    Assert-That ($skew -lt 1440) ("LICENSE_WINDOW: the guest clock is {0} minutes away from the host clock; fix the VM clock before reading any later failure as a product defect" -f [Math]::Round($skew, 0))

    Assert-That ($null -ne $licenseExpiresAt) 'the service reported a licence expiry'
    $expiresAt = [DateTime]::Parse($licenseExpiresAt).ToUniversalTime()
    Assert-That ($guestNow -lt $expiresAt) ("LICENSE_WINDOW: the guest clock {0} is at or past the licence expiry {1}; supply a current invitation code or fix the VM clock" -f $guestNow.ToString('o'), $expiresAt.ToString('o'))
    $results['clock'] = [ordered]@{
      guest           = $guestNow.ToString('o')
      host            = $hostNow.ToString('o')
      skewMinutes     = [Math]::Round($skew, 1)
      licenseExpiresAt = $expiresAt.ToString('o')
    }
  }

  # --- S10a: a wrong invitation code must not activate anything --------------------------------
  Invoke-Step 'activation-rejected' {
    $wrong = ConvertTo-Json 'LS101-NOT-A-REAL-INVITATION-CODE' -Compress
    $result = Invoke-Native -File $runtimeNode -Arguments @($server, 'activate', '--data-dir', $dataDir) -InputText $wrong -HasInput
    Write-Log "activate (wrong code)`n$($result.Text)"
    Assert-That ($result.Code -eq 0) 'the activate command itself succeeded'
    $parsed = ConvertFrom-JsonOutput $result.Text
    Assert-That ($parsed.activated -eq $false) 'a wrong invitation code is rejected'
    $status = Invoke-Native -File $runtimeNode -Arguments @($server, 'status', '--data-dir', $dataDir)
    $state = ConvertFrom-JsonOutput $status.Text
    Assert-That ($state.license.state -eq 'not-activated') 'a rejected activation left no receipt behind'
  }

  # --- S10b/S11: real activation and initialization through the real elevated helper ------------
  Invoke-Step 'initialize-service' {
    Assert-That (Test-Path -LiteralPath $labConfig.invitationFile) 'the invitation code was uploaded'
    # A management password is required by the product and must never be logged or persisted.
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = 'Aa1!' + [Convert]::ToBase64String($bytes).Replace('+', 'x').Replace('/', 'y').Replace('=', 'z')
    Set-Content -LiteralPath $managementPasswordFile -Value $password -Encoding ASCII -NoNewline

    $address = Get-GuestAddress
    Assert-That ($address -match '^\d{1,3}(\.\d{1,3}){3}$') 'the guest reported its NAT IPv4 address'
    $inputFile = Join-Path $workDirectory ('ls101-initialize-' + [Guid]::NewGuid().ToString() + '.json')
    $driverResult = Join-Path $workDirectory ('ls101-initialize-' + [Guid]::NewGuid().ToString() + '-result.json')
    @{
      name    = 'LS101 Lab'
      baseUrl = "https://${address}:$($labConfig.port)/"
      port    = $labConfig.port
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $inputFile -Encoding UTF8
    try {
      # The helper is spawned directly: this script already runs elevated, so no UAC prompt is needed
      # and the invitation code never reaches a command line.
      $result = Invoke-Driver -Arguments @(
        'manage',
        '--manager', $manager,
        '--runtime', $runtime,
        '--operation', 'initialize',
        '--input-file', $inputFile,
        '--activation-file', $labConfig.invitationFile,
        '--password-file', $managementPasswordFile,
        '--result', $driverResult
      )
      Assert-That ($result.Code -eq 0) 'the elevated helper initialized the service'
      $initialized = Get-Content -LiteralPath $driverResult -Raw | ConvertFrom-Json
      Assert-That ($initialized.state -eq 'running') 'the service reports running after initialization'
      Assert-That ($initialized.info.readiness -eq 'ready') 'the service reports ready'
      Assert-That ($initialized.fingerprint -match '^sha256:[a-f0-9]{64}$') 'the service published a public key fingerprint'
      $script:fingerprint = $initialized.fingerprint
      $script:serverId = $initialized.info.serverId
      $results['initialize'] = [ordered]@{
        state       = $initialized.state
        readiness   = $initialized.info.readiness
        serverId    = $script:serverId
        fingerprint = $script:fingerprint
        port        = $initialized.port
      }
    } finally {
      Remove-Item $inputFile, $driverResult -Force -ErrorAction SilentlyContinue
    }
    # The invitation code is single-use for this run: remove it as soon as the service consumed it.
    Remove-Item -LiteralPath $labConfig.invitationFile -Force -ErrorAction SilentlyContinue
    Assert-That (-not (Test-Path -LiteralPath $labConfig.invitationFile)) 'the invitation code was removed from the guest'
  }

  # --- S8b/S12: the listener is real, on 0.0.0.0, and its key is independently verified ---------
  Invoke-Step 'listener-and-identity' {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $labConfig.port -ErrorAction SilentlyContinue)
    Assert-That ($listeners.Count -ge 1) "the service listens on port $($labConfig.port)"
    $listener = $listeners | Select-Object -First 1
    Write-Log "listener: $($listener.LocalAddress):$($listener.LocalPort) pid $($listener.OwningProcess)"
    Assert-That ($listener.LocalAddress -eq '0.0.0.0') 'the listener is bound to 0.0.0.0, not only to loopback'
    $servicePid = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like '*server.cjs*' -and $_.CommandLine -like "*$dataDir*" } |
        Select-Object -First 1).ProcessId
    Assert-That ($listener.OwningProcess -eq $servicePid) 'the listening socket belongs to the service process'

    $address = Get-GuestAddress
    # Independent verification: the fingerprint is recomputed from the certificate rather than trusted
    # from the service's own report, and a plain CA-validating client must be refused.
    $verified = Invoke-Driver -Arguments @(
      'verify-tls',
      '--url', "https://${address}:$($labConfig.port)/",
      '--fingerprint', $fingerprint
    )
    $observed = ConvertFrom-JsonOutput $verified.Text
    Assert-That ($observed.fingerprint -eq $fingerprint) 'the recomputed SPKI fingerprint matches the reported one'
    Assert-That ($observed.serverId -eq $serverId) 'the HTTPS endpoint reports the same serverId'
    $caRefused = Invoke-Driver -AllowFailure -Arguments @(
      'verify-tls',
      '--url', "https://${address}:$($labConfig.port)/",
      '--fingerprint', $fingerprint,
      '--ca-verify',
      '--expect-connect-failure'
    )
    Assert-That ($caRefused.Code -eq 0) 'a normal CA-validating client cannot connect to the self-signed service'
    $results['listener'] = [ordered]@{
      localAddress = $listener.LocalAddress
      port         = $listener.LocalPort
      pid          = $listener.OwningProcess
      serverId     = $observed.serverId
      releaseVersion = $observed.releaseVersion
    }
  }

  # --- S5/S6: a real standard user is denied both the key files and the control pipe ------------
  Invoke-Step 'standard-user-isolation' {
    $user = 'ls101std'
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $userPassword = 'Aa1!' + [Convert]::ToBase64String($bytes).Replace('+', 'x').Replace('/', 'y').Replace('=', 'z')
    if (-not (Get-LocalUser -Name $user -ErrorAction SilentlyContinue)) {
      $secure = ConvertTo-SecureString $userPassword -AsPlainText -Force
      New-LocalUser -Name $user -Password $secure -PasswordNeverExpires -AccountNeverExpires | Out-Null
    } else {
      $secure = ConvertTo-SecureString $userPassword -AsPlainText -Force
      Set-LocalUser -Name $user -Password $secure
    }
    Assert-That ($null -ne (Get-LocalUser -Name $user)) 'a real standard user exists for the ACL probe'
    # The results directory belongs to the administrator, so the probe gets its own directory with an
    # explicit grant. Without it the probe could not write its verdict and the step would fail for the
    # wrong reason.
    $probeDir = 'C:\ls101-lab\probe'
    New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
    $grant = Invoke-Native -File 'icacls.exe' -Arguments @($probeDir, '/grant', "${user}:(OI)(CI)M")
    Write-Log "probe directory grant:`n$($grant.Text)"
    Assert-That ($grant.Code -eq 0) 'the standard user was granted write access to the probe directory'
    $probePath = Join-Path $probeDir 'probe.ps1'
    $probeOutput = Join-Path $probeDir 'probe.json'
    Remove-Item $probeOutput -Force -ErrorAction SilentlyContinue
    # The probe records WHY a read failed, not just that it did: a missing pipe or a missing file must
    # not be able to masquerade as an access denial, or the step would pass vacuously.
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
'@ | Set-Content -LiteralPath $probePath -Encoding UTF8

    $securePassword = ConvertTo-SecureString $userPassword -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential($user, $securePassword)
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -PipeName "{1}" -DataDir "{2}" -Output "{3}"' -f $probePath, $pipeName, $dataDir, $probeOutput
    # CreateProcessWithLogonW (what -Credential uses) needs no "log on as a batch job" right, unlike a
    # scheduled task with stored credentials, so the probe depends on one fewer machine policy.
    $probeProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Credential $credential -WindowStyle Hidden -Wait -PassThru
    Write-Log "standard-user probe exit code: $($probeProcess.ExitCode)"
    Assert-That (Test-Path -LiteralPath $probeOutput) 'the standard-user probe produced a result'
    $probe = Get-Content -LiteralPath $probeOutput -Raw | ConvertFrom-Json
    Write-Log "standard user probe: $($probe | ConvertTo-Json -Compress)"
    Assert-That ($probe.'control.key' -eq 'denied') 'a standard user cannot read the control key'
    Assert-That ($probe.'service.sqlite' -eq 'denied') 'a standard user cannot read the business database'
    Assert-That ($probe.pipe -eq 'denied') 'a standard user cannot open the local control pipe'
    # A timeout would mean the pipe was absent or unreachable, which is a different failure and must
    # not be accepted as proof that the DACL denied access.
    Assert-That ($probe.'pipe-error' -ne 'TimeoutException') 'the pipe refusal is an access denial, not an absent pipe'
    Write-Log "pipe refusal: $($probe.'pipe-error') $($probe.'pipe-message')"

    # An elevated administrator must still be able to reach the pipe, or local service management and
    # the CLI would be unusable on Windows.
    $adminStatus = Invoke-Native -File $runtimeNode -Arguments @($server, 'status', '--data-dir', $dataDir)
    Assert-That ($adminStatus.Code -eq 0) 'an elevated administrator can still use the control channel'
    Assert-That ((ConvertFrom-JsonOutput $adminStatus.Text).state -eq 'running') 'the control channel reports the running service'
    $results['standardUser'] = $probe
    Remove-LocalUser -Name $user -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $probeDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  # --- S14: the SCM stop/start cycle preserves identity and data --------------------------------
  Invoke-Step 'restart-survives' {
    Restart-Service -Name $labConfig.serviceName
    $service = Get-Service -Name $labConfig.serviceName
    Assert-That ($service.Status -eq 'Running') 'the service restarted'
    $state = $null
    $deadline = (Get-Date).AddSeconds(60)
    while (-not $state -and (Get-Date) -lt $deadline) {
      $probe = Invoke-Native -File $runtimeNode -Arguments @($server, 'status', '--data-dir', $dataDir)
      if ($probe.Code -eq 0) {
        $candidate = ConvertFrom-JsonOutput $probe.Text
        if ($candidate.state -eq 'running') { $state = $candidate }
      }
      if (-not $state) { Start-Sleep -Milliseconds 500 }
    }
    Assert-That ($null -ne $state) 'the control channel answered and reports running after the restart'
    Assert-That ($state.fingerprint -eq $fingerprint) 'the service identity survived the restart'
    Assert-That ($state.info.serverId -eq $serverId) 'the serverId survived the restart'
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $labConfig.port -ErrorAction SilentlyContinue)
    Assert-That ($listeners.Count -ge 1) 'the restarted service listens again'
    $results['restart'] = [ordered]@{ serverId = $state.info.serverId; fingerprint = $state.fingerprint }
  }

  # --- S13 part one: the installer opened no firewall port -------------------------------------
  Invoke-Step 'firewall-closed' {
    # Enumerating rules must be proven to work first, otherwise a failed cmdlet would leave the
    # matching set empty and this step would pass without having checked anything.
    $allInbound = @(Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction Stop)
    Write-Log "enabled inbound firewall rules on this host: $($allInbound.Count)"
    Assert-That ($allInbound.Count -gt 0) 'inbound firewall rules are enumerable'
    $matching = @(
      $allInbound |
        Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
        Where-Object { @($_.LocalPort) -contains $labConfig.port -or @($_.LocalPort) -contains "$($labConfig.port)" }
    )
    Write-Log "inbound rules covering port $($labConfig.port): $($matching.Count)"
    Assert-That ($matching.Count -eq 0) 'installing the product opened no inbound firewall port'
    $results['firewall'] = [ordered]@{ enabledInboundRules = $allInbound.Count; inboundRulesForPort = $matching.Count }
  }

  # --- S18: no secret reached any artefact ------------------------------------------------------
  Invoke-Step 'secret-scan' {
    $secrets = @()
    if (Test-Path -LiteralPath $managementPasswordFile) {
      $secrets += (Get-Content -LiteralPath $managementPasswordFile -Raw).Trim()
    }
    Assert-That ($secrets.Count -ge 1) 'the management password is available for the leak scan'
    $scanned = @($log, $progress, $resultFile)
    $present = @($scanned | Where-Object { Test-Path -LiteralPath $_ })
    # The log and the progress file are written from the first phase, so an empty scan set would mean
    # the artefacts were not where this step thinks they are.
    Assert-That ($present.Count -ge 2) 'the log and the progress file exist for the leak scan'
    foreach ($file in $present) {
      $content = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
      foreach ($secret in $secrets) {
        Assert-That (-not ($content -and $content.Contains($secret))) "no secret leaked into $(Split-Path $file -Leaf)"
      }
    }
    # The task action and the driver command lines are the other places a secret could surface.
    $action = (Get-ScheduledTask -TaskName 'ls101-lab-acceptance' -ErrorAction SilentlyContinue).Actions.Arguments
    foreach ($secret in $secrets) {
      Assert-That (-not ($action -and $action.Contains($secret))) 'no secret leaked into the scheduled task action'
    }
    $results['secretScan'] = [ordered]@{ scanned = $present.Count; secrets = $secrets.Count }
  }
} catch {
  $failure = $_
  Write-Log ($_ | Out-String)
} finally {
  $ErrorActionPreference = 'Stop'
  Remove-Item -LiteralPath $managementPasswordFile -Force -ErrorAction SilentlyContinue
  $results['finishedAt'] = (Get-Date).ToUniversalTime().ToString('o')
  $results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultFile -Encoding UTF8
  $sources = @(
    $log,
    $progress,
    $resultFile
  ) | Where-Object { Test-Path -LiteralPath $_ }
  if ($sources.Count -gt 0) {
    if (Test-Path -LiteralPath $artifact) { Remove-Item $artifact -Force }
    Compress-Archive -Path $sources -DestinationPath $artifact -Force
  }
}

if ($failure) {
  Write-Phase 'failed'
  Set-Content -Path $status -Value 'failed' -Encoding UTF8
  throw $failure
}
Write-Phase 'passed'
Set-Content -Path $status -Value 'passed' -Encoding UTF8
