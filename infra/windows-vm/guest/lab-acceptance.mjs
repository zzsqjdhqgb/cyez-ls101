/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Lab acceptance phase 1 (docs/lab-vm-acceptance-design.md, milestone M1), running inside the
 * disposable VM.
 *
 * Orchestration and every comparison live here, in Node, so they are covered by `yarn vm:test` in the
 * container. PowerShell is invoked only through lab-probes.ps1, which collects structured data and makes
 * no decisions.
 *
 * The run is a scheduled task in the interactive session at the highest run level, so it is an elevated
 * administrator exactly like an administrator at the console.
 *
 * Secrets: the invitation code is read by manager-driver.mjs from a file and deleted once the service
 * consumed it; the management password is generated here, written to a file outside the results
 * directory, and removed in a finally block. Neither is ever logged, and the last step proves it.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import {
  assertNone,
  assertSome,
  assertThat,
  asArray,
  extractJsonPayload,
  extractProbePayload,
  LabRun,
  parseConfig,
  readArgument,
  runProcess,
  writeStartupRecord
} from './lab-harness.mjs'

const configArgument = readArgument(process.argv.slice(2), '--config')
const resultsArgument = readArgument(process.argv.slice(2), '--results-dir')
if (!configArgument) throw new Error('--config <path> is required')

// Written before the configuration is read, using only the path the host passed, so a run that cannot
// start still says what it was given.
writeStartupRecord(resultsArgument ?? 'C:\\ls101-lab\\results', configArgument)

const config = parseConfig(readFileSync(configArgument, 'utf8'))
const run = new LabRun(config.resultsDir)
// The drivers and probes live beside the phase script, so their directory is also where the run keeps
// its short-lived work files: the host created it and the run owns it.
const workDir = dirname(config.probes)
const managementPasswordFile = join(workDir, `ls101-mgmt-${process.pid}.txt`)
const initializeArgument = join(workDir, `ls101-initialize-${process.pid}.json`)
const initializeResult = join(workDir, `ls101-initialize-${process.pid}-result.json`)

const recordPath = join(config.programDir, 'installation.json')
const state = {
  runtime: '',
  server: '',
  manager: '',
  runtimeNode: '',
  pipeName: '',
  fingerprint: '',
  serverId: '',
  licenseExpiresAt: '',
  servicePid: undefined
}

async function probe(name, extra = []) {
  const result = await runProcess(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      config.probes,
      '-Probe',
      name,
      ...extra
    ],
    { timeoutMs: 180000 }
  )
  if (result.code !== 0) {
    throw new Error(
      `probe '${name}' failed with exit code ${result.code}\n${result.stderr || result.stdout}`
    )
  }
  return extractProbePayload(result.stdout)
}

// Native output is evidence, so it is recorded verbatim before any comparison happens.
async function native(file, args, { timeoutMs = 120000, input } = {}) {
  const result = await runProcess(file, args, { timeoutMs, input })
  run.log(`$ ${file} ${args.join(' ')} (exit ${result.code})`)
  const text = `${result.stdout}${result.stderr}`.trim()
  if (text) run.log(text)
  return result
}

async function driver(args, { allowFailure = false } = {}) {
  const result = await runProcess(config.node, [config.driver, ...args], { timeoutMs: 180000 })
  run.log(`$ driver ${args.join(' ')} (exit ${result.code})`)
  const text = `${result.stdout}${result.stderr}`.trim()
  if (text) run.log(text)
  if (!allowFailure && result.code !== 0)
    throw new Error(`the manager driver failed with exit code ${result.code}`)
  return result
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

// The base box keeps only the NAT adapter, so the first non-internal IPv4 address is the one a remote
// peer can reach. Node reports it directly, which avoids a probe for something the runtime already knows.
function guestAddress() {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
  assertThat(addresses.length > 0, 'the guest reported a non-loopback IPv4 address', addresses)
  return addresses[0]
}

// A service that will not start is a product finding, and the reason is never in the assertion that
// noticed it: the SCM, the WinSW wrapper log and the System event log each hold a different part.
async function serviceDiagnostics() {
  run.log('--- service diagnostics ---')
  try {
    run.log(`scm ${JSON.stringify(await probe('service', ['-Name', config.serviceName]))}`)
    run.log(
      `wrapper logs ${JSON.stringify(await probe('wrapper-logs', ['-Path', join(config.dataRoot, 'logs'), '-Tail', '60']), null, 2)}`
    )
    run.log(
      `system events ${JSON.stringify(await probe('events', ['-Minutes', '15', '-Match', 'LS101']), null, 2)}`
    )
    run.log(`data directory ${JSON.stringify(await probe('path', ['-Path', config.dataDir]))}`)
  } catch (error) {
    run.log(`service diagnostics could not be collected: ${error.message}`)
  }
  run.log('--- end service diagnostics ---')
}

// The install directory is named after the executable, not after the product, so it is discovered
// rather than assumed: guessing the product name once produced a confidently wrong conclusion.
async function findApplicationDirectory() {
  const uninstall = await probe('uninstall-entry', ['-Match', 'LS101'])
  const listed = asArray(uninstall.entries).find((entry) => entry.installLocation)
  if (listed?.installLocation && existsSync(listed.installLocation)) return listed.installLocation
  const search = await probe('find-executable', [
    '-Name',
    'ls101-lab-teacher.exe',
    '-Path',
    // The packaged application lands beside the service program directory, not inside it.
    dirname(config.programDir)
  ])
  return asArray(search.directories)[0] ?? null
}

function installRuntime(release) {
  state.runtime = join(config.programDir, 'releases', release)
  state.server = join(state.runtime, 'server.cjs')
  state.manager = join(state.runtime, 'manager.cjs')
  state.runtimeNode = join(state.runtime, 'runtime', 'node.exe')
  for (const [label, file] of [
    ['server.cjs', state.server],
    ['manager.cjs', state.manager],
    ['its bundled Node runtime', state.runtimeNode]
  ]) {
    assertThat(existsSync(file), `the installed release ships ${label}`, file)
  }
  const manifest = JSON.parse(readFileSync(join(state.runtime, 'runtime-manifest.json'), 'utf8'))
  assertThat(manifest.nodeVersion === '24.20.0', 'the packaged runtime is Node 24.20.0', manifest)
  return { release, nodeVersion: manifest.nodeVersion }
}

function forgetSecrets() {
  for (const file of [managementPasswordFile, initializeArgument, initializeResult]) {
    try {
      rmSync(file, { force: true })
    } catch {
      // Best effort: a leftover file in a disposable VM is not worth failing the run over.
    }
  }
}

// --- Elevation: every later step assumes an elevated administrator. An unelevated per-machine
// installer relaunches itself through UAC and the original process returns 0 immediately, which an
// unattended run cannot tell apart from a successful install, so this is asserted first.
async function stepElevation() {
  return run.step('elevation', async () => {
    const elevation = await probe('elevation')
    run.log(
      `identity=${elevation.identity} administrator=${elevation.administrator} highIntegrity=${elevation.highIntegrity} mediumIntegrity=${elevation.mediumIntegrity}`
    )
    assertThat(
      elevation.administrator === true,
      `the run is elevated (identity ${elevation.identity})`,
      elevation
    )
    assertThat(
      elevation.highIntegrity === true,
      'the process token is at the high integrity level',
      elevation
    )
    return elevation
  })
}

// --- S1: silent install ------------------------------------------------------------------------
async function stepInstall() {
  return run.step('install-teacher', async () => {
    assertThat(existsSync(config.installer), 'the teacher installer was uploaded', config.installer)
    // The step asserts what the installer produced, so it needs a machine where the service is not
    // already installed. Without this guard a second run on a preserved VM would pass on the previous
    // run's record and silently stop testing the installer at all.
    assertThat(
      !existsSync(recordPath),
      `the service is already installed at ${config.programDir}; the install assertion needs a clean machine. Run yarn vm:destroy then yarn vm:lab.`
    )

    const startedAt = Date.now()
    const installed = await native(config.installer, ['/S'], { timeoutMs: 900000 })
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    const packageMiB = Math.round(statSync(config.installer).size / (1024 * 1024))
    run.log(
      `teacher installer exit code ${installed.code} after ${seconds}s for a ${packageMiB} MiB package`
    )
    assertThat(installed.code === 0, 'the silent install exited 0', installed)

    // The verdict is fixed before any diagnosis runs: the step must report what the installer did, not
    // what this script could achieve by repeating its work.
    const publishedByInstaller = existsSync(recordPath)
    const appDirectory = await findApplicationDirectory()
    run.log(`application directory: ${appDirectory ?? 'not found'}`)
    if (appDirectory) {
      const listing = await probe('path', ['-Path', appDirectory])
      run.log(`installed entries: ${asArray(listing.children).join(', ')}`)
    }
    if (!publishedByInstaller) {
      // teacher.nsh runs install-windows.ps1 from its own resources through nsExec and discards both
      // streams, so a failed service installation is otherwise invisible. Running the identical script
      // here reproduces the stage and message it reports; the assertion below still judges the installer.
      const serviceInstaller =
        appDirectory && join(appDirectory, 'resources', 'lab-server', 'install-windows.ps1')
      if (serviceInstaller && existsSync(serviceInstaller)) {
        for (const extra of [['-Verify'], []]) {
          await native('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            serviceInstaller,
            ...extra
          ])
        }
      } else {
        run.log(`service installer not found at ${serviceInstaller}`)
      }
    }
    assertThat(publishedByInstaller, 'the installer published installation.json')

    const record = JSON.parse(readFileSync(recordPath, 'utf8'))
    assertThat(
      typeof record.release === 'string',
      'the installation record names a release',
      record
    )
    assertThat(
      record.release.startsWith(`${config.releaseVersion}-`),
      `the installed release matches ${config.releaseVersion}`,
      record
    )
    run.log(`installed release: ${record.release}`)
    return installRuntime(record.release)
  })
}

// --- S2/S3: SCM registration, account and start mode -------------------------------------------
async function stepServiceRegistration() {
  return run.step('service-registration', async () => {
    await native('sc.exe', ['qc', config.serviceName])
    const sidType = await native('sc.exe', ['qsidtype', config.serviceName])
    assertThat(sidType.code === 0, 'sc.exe qsidtype succeeded', sidType)
    assertThat(
      /UNRESTRICTED/.test(sidType.stdout),
      'the service SID type is unrestricted',
      sidType.stdout
    )

    const service = await probe('service', ['-Name', config.serviceName])
    assertThat(service.installed === true, 'the service is registered with the SCM', service)
    assertThat(service.state === 'Stopped', 'the installer left the service stopped', service)
    // `startmode=Manual` in LS101Lab.xml and no sc.exe change: installing must not enable autostart.
    assertThat(service.startMode === 'Manual', 'autostart is unchanged (demand start)', service)
    assertThat(
      String(service.startName).toLowerCase() === config.serviceAccount.toLowerCase(),
      `the service runs as ${config.serviceAccount}`,
      service
    )
    // A path with spaces only survives the SCM if it is quoted, which is why the installer uses CIM.
    assertThat(
      /^".*LS101Lab\.exe"$/.test(service.pathName),
      'the service binary path is quoted',
      service
    )
    assertThat(
      service.pathName.includes(config.programDir),
      'the binary lives under the program directory',
      service
    )
    return service
  })
}

// --- S4: data parent ACL ------------------------------------------------------------------------
async function stepDataAcl() {
  return run.step('data-acl', async () => {
    // The installer hardens the data *parent* directory; the `data` child under it is created by the
    // service on first start, so only the parent is asserted here.
    const acl = await probe('acl', ['-Path', config.dataRoot])
    assertThat(acl.exists === true, 'the installer created the data parent directory', acl)
    const child = await probe('path', ['-Path', config.dataDir])
    run.log(`data child exists before the service first runs: ${child.exists}`)
    const logs = await probe('path', ['-Path', join(config.dataRoot, 'logs')])
    assertThat(logs.exists === true, 'the installer created the log directory', logs)

    run.log(`data parent ACL: ${JSON.stringify(acl, null, 2)}`)
    assertThat(acl.protected === true, 'inheritance is disabled on the data parent directory', acl)
    const identities = asArray(acl.rules).map((rule) => rule.identity)
    assertNone(
      identities,
      (identity) => /BUILTIN\\Users$|Authenticated Users|Everyone/i.test(identity),
      'no standard-user group holds a data parent rule'
    )
    assertSome(
      identities,
      (identity) => /NT AUTHORITY\\SYSTEM/i.test(identity),
      'SYSTEM retains access'
    )
    assertSome(
      identities,
      (identity) => /BUILTIN\\Administrators/i.test(identity),
      'Administrators retain access'
    )
    assertSome(
      identities,
      (identity) => /LS101Lab/i.test(identity),
      'the service SID holds a data parent rule'
    )
    return acl
  })
}

// --- S7/S8: start, session 0, and no listener before initialization ------------------------------
async function stepServiceStart() {
  return run.step('service-start', async () => {
    try {
      const started = await native('sc.exe', ['start', config.serviceName])
      assertThat(started.code === 0, 'the SCM accepted the start request', started)

      // The SCM reports a WinSW service as running as soon as the wrapper starts, but the wrapper then
      // starts the bundled runtime as a child, so the process appears a moment later. Polling with a
      // bound is both faster and far less flaky than a fixed sleep.
      let service
      for (let attempt = 0; attempt < 60; attempt += 1) {
        service = await probe('service', ['-Name', config.serviceName])
        if (service.state === 'Running') break
        await sleep(500)
      }
      assertThat(service.state === 'Running', 'the service reached Running', service)

      let hosted = { found: false }
      for (let attempt = 0; attempt < 60 && hosted.found !== true; attempt += 1) {
        hosted = await probe('process', ['-Name', 'node.exe', '-Match', 'server.cjs'])
        if (hosted.found !== true) await sleep(500)
      }
      assertThat(hosted.found === true, 'the service hosts the bundled Node process', hosted)
      run.log(
        `service process: pid ${hosted.processId}, session ${hosted.sessionId}, owner ${hosted.domain}\\${hosted.user}`
      )
      assertThat(hosted.sessionId === 0, 'the service process runs in session 0', hosted)
      assertThat(
        /LS101Lab/i.test(`${hosted.domain}\\${hosted.user}`),
        'the service process runs as the service account',
        hosted
      )
      state.servicePid = hosted.processId

      const listeners = await probe('listener', ['-Port', String(config.port)])
      assertThat(
        asArray(listeners.listeners).length === 0,
        'no HTTPS listener exists before initialization',
        listeners
      )
      return {
        pid: hosted.processId,
        sessionId: hosted.sessionId,
        owner: `${hosted.domain}\\${hosted.user}`
      }
    } catch (error) {
      await serviceDiagnostics()
      throw error
    }
  })
}

// --- S9: the real named-pipe control channel, from a separate process ---------------------------
async function stepControlChannel() {
  return run.step('control-channel-status', async () => {
    try {
      // The pipe name comes from the product's own controlPath(), so the probe cannot drift from the
      // name the service actually creates.
      state.pipeName = (await driver(['pipe-name', '--root', config.dataDir])).stdout.trim()
      run.log(`control pipe: ${state.pipeName}`)
      assertThat(
        /^ls101-lab-[a-f0-9]{32}$/.test(state.pipeName),
        'the control pipe name has the documented shape',
        state.pipeName
      )

      const status = await native(state.runtimeNode, [
        state.server,
        'status',
        '--data-dir',
        config.dataDir
      ])
      assertThat(
        status.code === 0,
        'server.cjs status succeeded over the local control channel',
        status
      )
      const parsed = extractJsonPayload(status.stdout)
      assertThat(parsed.state === 'uninitialized', 'the service reports uninitialized', parsed)
      assertThat(
        parsed.license.state === 'not-activated',
        'the license is not activated yet',
        parsed
      )
      state.licenseExpiresAt = parsed.license.expiresAt
      return parsed
    } catch (error) {
      await serviceDiagnostics()
      throw error
    }
  })
}

// --- H3: the VM clock must be usable before any later failure is read as a product defect ---------
async function stepClockWindow() {
  return run.step('clock-and-license-window', async () => {
    const guestNow = new Date()
    const hostNow = new Date(config.hostTime)
    assertThat(
      !Number.isNaN(hostNow.getTime()),
      'the host clock was passed in the configuration',
      config.hostTime
    )
    const skewMinutes = Math.abs(guestNow.getTime() - hostNow.getTime()) / 60000
    run.log(
      `guest clock ${guestNow.toISOString()}, host clock ${hostNow.toISOString()}, skew ${skewMinutes.toFixed(1)} min`
    )
    // The service certificate is valid one day either side of its issue time, so a larger skew breaks
    // TLS, enrollment expiry, heartbeat windows and the licence check at the same time.
    assertThat(
      skewMinutes < 1440,
      `LICENSE_WINDOW: the guest clock is ${Math.round(skewMinutes)} minutes away from the host clock; fix the VM clock before reading any later failure as a product defect`
    )
    assertThat(
      typeof state.licenseExpiresAt === 'string',
      'the service reported a licence expiry',
      state.licenseExpiresAt
    )
    assertThat(
      guestNow < new Date(state.licenseExpiresAt),
      `LICENSE_WINDOW: the guest clock ${guestNow.toISOString()} is at or past the licence expiry ${state.licenseExpiresAt}; supply a current invitation code or fix the VM clock`
    )
    return {
      guest: guestNow.toISOString(),
      host: hostNow.toISOString(),
      skewMinutes,
      licenseExpiresAt: state.licenseExpiresAt
    }
  })
}

// --- S10a: a wrong invitation code must not activate anything -----------------------------------
async function stepActivationRejected() {
  return run.step('activation-rejected', async () => {
    const rejected = await native(
      state.runtimeNode,
      [state.server, 'activate', '--data-dir', config.dataDir],
      {
        input: JSON.stringify('LS101-NOT-A-REAL-INVITATION-CODE')
      }
    )
    assertThat(rejected.code === 0, 'the activate command itself succeeded', rejected)
    assertThat(
      extractJsonPayload(rejected.stdout).activated === false,
      'a wrong invitation code is rejected'
    )
    const status = await native(state.runtimeNode, [
      state.server,
      'status',
      '--data-dir',
      config.dataDir
    ])
    const parsed = extractJsonPayload(status.stdout)
    assertThat(
      parsed.license.state === 'not-activated',
      'a rejected activation left no receipt behind',
      parsed
    )
    return parsed.license
  })
}

// --- S10b/S11: real activation and initialization through the real elevated helper ---------------
async function stepInitialize() {
  return run.step('initialize-service', async () => {
    assertThat(
      existsSync(config.invitationFile),
      'the invitation code was uploaded',
      config.invitationFile
    )
    try {
      // A management password is required by the product and must never be logged or persisted.
      writeFileSync(managementPasswordFile, `Aa1!${randomBytes(24).toString('base64url')}`)
      const address = guestAddress()
      writeFileSync(
        initializeArgument,
        JSON.stringify({
          name: 'LS101 Lab',
          baseUrl: `https://${address}:${config.port}/`,
          port: config.port
        })
      )
      const result = await driver([
        'manage',
        '--manager',
        state.manager,
        '--runtime',
        state.runtime,
        '--operation',
        'initialize',
        '--input-file',
        initializeArgument,
        '--activation-file',
        config.invitationFile,
        '--password-file',
        managementPasswordFile,
        '--result',
        initializeResult
      ])
      assertThat(result.code === 0, 'the elevated helper initialized the service', result)
      const helper = JSON.parse(readFileSync(initializeResult, 'utf8'))
      assertThat(helper.ok === true, 'the helper reported success', helper)
      const status = helper.value
      assertThat(
        status.state === 'running',
        'the service reports running after initialization',
        status
      )
      assertThat(status.info?.readiness === 'ready', 'the service reports ready', status)
      assertThat(
        /^sha256:[a-f0-9]{64}$/.test(status.fingerprint),
        'the service published a public key fingerprint',
        status
      )
      state.fingerprint = status.fingerprint
      state.serverId = status.info.serverId
      return {
        state: status.state,
        readiness: status.info.readiness,
        serverId: state.serverId,
        fingerprint: state.fingerprint,
        port: status.port
      }
    } finally {
      rmSync(initializeArgument, { force: true })
      rmSync(initializeResult, { force: true })
      // The invitation code is single-use for this run: remove it once the service consumed it.
      rmSync(config.invitationFile, { force: true })
    }
  })
}

async function stepInvitationRemoved() {
  return run.step('invitation-removed', async () => {
    assertThat(
      !existsSync(config.invitationFile),
      'the invitation code was removed from the guest',
      config.invitationFile
    )
  })
}

// --- S8b/S12: the listener is real, on 0.0.0.0, and its key is independently verified -------------
async function stepListenerAndIdentity() {
  return run.step('listener-and-identity', async () => {
    const listeners = await probe('listener', ['-Port', String(config.port)])
    const listener = asArray(listeners.listeners)[0]
    assertThat(listener !== undefined, `the service listens on port ${config.port}`, listeners)
    run.log(
      `listener: ${listener.localAddress}:${listener.localPort} pid ${listener.owningProcess}`
    )
    assertThat(
      listener.localAddress === '0.0.0.0',
      'the listener is bound to 0.0.0.0, not only to loopback',
      listener
    )
    assertThat(
      listener.owningProcess === state.servicePid,
      'the listening socket belongs to the service process',
      {
        listener,
        servicePid: state.servicePid
      }
    )

    const address = guestAddress()
    // Independent verification: the fingerprint is recomputed from the certificate rather than trusted
    // from the service's own report, and a plain CA-validating client must be refused.
    const verified = await driver([
      'verify-tls',
      '--url',
      `https://${address}:${config.port}/`,
      '--fingerprint',
      state.fingerprint,
      // Every operation declares this header; the service answers 400 without it.
      '--version',
      config.releaseVersion
    ])
    const observed = extractJsonPayload(verified.stdout)
    assertThat(
      observed.fingerprint === state.fingerprint,
      'the recomputed SPKI fingerprint matches the reported one',
      observed
    )
    assertThat(
      observed.serverId === state.serverId,
      'the HTTPS endpoint reports the same serverId',
      observed
    )
    const refused = await driver(
      [
        'verify-tls',
        '--url',
        `https://${address}:${config.port}/`,
        '--fingerprint',
        state.fingerprint,
        '--version',
        config.releaseVersion,
        '--ca-verify',
        '--expect-connect-failure'
      ],
      { allowFailure: true }
    )
    assertThat(
      refused.code === 0,
      'a normal CA-validating client cannot connect to the self-signed service',
      refused
    )
    return listener
  })
}

// --- S5/S6: a real standard user is denied both the key files and the control pipe ----------------
async function stepStandardUser() {
  return run.step('standard-user-isolation', async () => {
    const probeDirectory = join(workDir, 'std-user-probe')
    try {
      const outcome = await probe('standard-user', [
        '-User',
        'ls101std',
        '-PipeName',
        state.pipeName,
        '-DataDir',
        config.dataDir,
        '-Path',
        probeDirectory
      ])
      run.log(`standard-user probe: ${JSON.stringify(outcome, null, 2)}`)
      assertThat(
        outcome.grantExit === 0,
        'the standard user was granted access to the probe directory',
        outcome
      )
      assertThat(outcome.produced === true, 'the standard-user probe produced a result', outcome)
      const verdict = outcome.verdict
      assertThat(
        verdict['control.key'] === 'denied',
        'a standard user cannot read the control key',
        verdict
      )
      assertThat(
        verdict['service.sqlite'] === 'denied',
        'a standard user cannot read the business database',
        verdict
      )
      assertThat(
        verdict.pipe === 'denied',
        'a standard user cannot open the local control pipe',
        verdict
      )
      // A timeout would mean the pipe was absent or unreachable, which is a different failure and must
      // not be accepted as proof that the DACL denied access.
      assertThat(
        verdict['pipe-error'] !== 'TimeoutException',
        'the pipe refusal is an access denial, not an absent pipe',
        verdict
      )

      // An elevated administrator must still be able to reach the pipe, or local service management and
      // the CLI would be unusable on Windows.
      const adminStatus = await native(state.runtimeNode, [
        state.server,
        'status',
        '--data-dir',
        config.dataDir
      ])
      assertThat(
        adminStatus.code === 0,
        'an elevated administrator can still use the control channel',
        adminStatus
      )
      assertThat(
        extractJsonPayload(adminStatus.stdout).state === 'running',
        'the control channel reports the running service'
      )
      return verdict
    } finally {
      await probe('delete-user', ['-User', 'ls101std']).catch(() => undefined)
      rmSync(probeDirectory, { recursive: true, force: true })
    }
  })
}

// --- S14: the SCM stop/start cycle preserves identity and data ------------------------------------
async function stepRestart() {
  return run.step('restart-survives', async () => {
    const restarted = await native('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Restart-Service -Name '${config.serviceName}'`
    ])
    assertThat(restarted.code === 0, 'the service restarted', restarted)

    // Restart-Service returns as soon as the SCM reports the wrapper running, but the bundled runtime and
    // its control pipe come up a moment later, so the channel is polled rather than assumed.
    let status
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const probeStatus = await runProcess(
        state.runtimeNode,
        [state.server, 'status', '--data-dir', config.dataDir],
        { timeoutMs: 30000 }
      )
      if (probeStatus.code === 0) {
        try {
          const parsed = extractJsonPayload(probeStatus.stdout)
          if (parsed.state === 'running') {
            status = parsed
            break
          }
        } catch {
          // A partial line during start-up is expected; the next poll reads a complete one.
        }
      }
      await sleep(500)
    }
    assertThat(
      status !== undefined,
      'the control channel answered and reports running after the restart'
    )
    assertThat(
      status.fingerprint === state.fingerprint,
      'the service identity survived the restart',
      status
    )
    assertThat(status.info.serverId === state.serverId, 'the serverId survived the restart', status)
    const listeners = await probe('listener', ['-Port', String(config.port)])
    assertThat(
      asArray(listeners.listeners).length >= 1,
      'the restarted service listens again',
      listeners
    )
    return { serverId: status.info.serverId, fingerprint: status.fingerprint }
  })
}

// --- S13 part one: the installer opened no firewall port ------------------------------------------
async function stepFirewallClosed() {
  return run.step('firewall-closed', async () => {
    const firewall = await probe('firewall', ['-Port', String(config.port)])
    // Enumerating rules must be proven to work first, otherwise a failed cmdlet would leave the matching
    // set empty and this step would pass without having checked anything.
    run.log(`enabled inbound rules: ${firewall.enabledInboundRules}`)
    assertThat(firewall.enabledInboundRules > 0, 'inbound firewall rules are enumerable', firewall)
    assertThat(
      asArray(firewall.matching).length === 0,
      'installing the product opened no inbound firewall port',
      firewall
    )
    return firewall
  })
}

// --- S18: no secret reached any artefact ----------------------------------------------------------
async function stepSecretScan() {
  return run.step('secret-scan', async () => {
    assertThat(
      existsSync(managementPasswordFile),
      'the management password is available for the leak scan',
      managementPasswordFile
    )
    const secret = readFileSync(managementPasswordFile, 'utf8')
    const scanned = [run.logPath, run.progressPath, run.resultsPath].filter((file) =>
      existsSync(file)
    )
    // The log and the progress file are written from the first phase, so an empty scan set would mean the
    // artefacts were not where this step thinks they are.
    assertThat(
      scanned.length >= 2,
      'the log and the progress file exist for the leak scan',
      scanned
    )
    for (const file of scanned) {
      assertThat(
        !readFileSync(file, 'utf8').includes(secret),
        `no secret leaked into ${file}`,
        file
      )
    }
    return { scanned: scanned.length }
  })
}

async function main() {
  let failure
  try {
    await stepElevation()
    await stepInstall()
    await stepServiceRegistration()
    await stepDataAcl()
    await stepServiceStart()
    await stepControlChannel()
    await stepClockWindow()
    await stepActivationRejected()
    await stepInitialize()
    await stepInvitationRemoved()
    await stepListenerAndIdentity()
    await stepStandardUser()
    await stepRestart()
    await stepFirewallClosed()
    await stepSecretScan()
  } catch (error) {
    failure = error
    run.log(String(error?.stack ?? error))
  } finally {
    forgetSecrets()
  }

  run.finish()
  run.phase(failure ? 'failed' : 'passed')
  run.status(failure ? 'failed' : 'passed')

  // The archive is a convenience for the host and is written last so it always holds a complete outcome.
  try {
    await probe('archive', [
      '-Path',
      join(config.resultsDir, 'lab-artifacts.zip'),
      '-Source',
      run.logPath,
      run.progressPath,
      run.resultsPath
    ])
  } catch (error) {
    run.log(`the artifact archive could not be created: ${error.message}`)
  }

  if (failure) process.exitCode = 1
}

await main()
