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
import { randomBytes, randomUUID, createHash } from 'node:crypto'
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
// Milestone M4: the backup password and the upgrade preparation record. Both are secrets or
// service-owned state, so both live outside the results directory and are removed at the end.
const backupPasswordFile = join(workDir, `ls101-backup-${process.pid}.txt`)
const upgradeReadyFile = join(config.dataDir, 'upgrade-ready.json')

const recordPath = join(config.programDir, 'installation.json')
// The invitation code is read once, before it is handed to the service, so the leak scan can look for
// it in the artefacts after the file itself is gone. It is never logged, and only its length is
// reported.
let invitationCodeValue = ''
const state = {
  runtime: '',
  server: '',
  manager: '',
  runtimeNode: '',
  pipeName: '',
  fingerprint: '',
  serverId: '',
  licenseExpiresAt: '',
  servicePid: undefined,
  // The milestone-M2 steps chain: registration writes the device credential, and every later case that
  // has to act as that device reads it from this one file.
  deviceState: '',
  deviceId: '',
  // Set by the exam step, read by the maintenance-admission step, which starts a practice against it.
  exam: null,
  // The batch whose closure the negatives step proves, kept so the two steps cannot disagree about it.
  enrollmentBatch: null,
  practice: null,
  // Milestone M4. The installed application directory is discovered once (the install directory is
  // named after the executable), and the release the client was installed from is what the upgrade
  // steps have to compare against.
  applicationDirectory: '',
  installedRelease: ''
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

// An installer's verdict is the exit code before the diagnosis runs, so the diagnosis has to be
// answerable from the same result. A silent NSIS install that never returns is a distinct product
// finding from one that returns non-zero: the first has no output at all, and reporting it as "exit 1"
// would hide the hang that docs/lab-vm-acceptance-design.md section 11 keeps open.
function installerFailure(result, seconds) {
  return [
    `exit=${result.code} timedOut=${result.timedOut} after ${seconds}s`,
    `stdout=${JSON.stringify(result.stdout.slice(-2000))}`,
    `stderr=${JSON.stringify(result.stderr.slice(-2000))}`
  ].join('\n')
}

// Runs a full installer/uninstaller silently and records the raw outcome. The timeout is deliberately
// generous: the package is large and the NSIS wizard runs the service installer inside itself.
async function runInstaller(file, args, timeoutMs = 900000) {
  const startedAt = Date.now()
  const result = await native(file, args, { timeoutMs })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  run.log(`${file} ${args.join(' ')} -> ${installerFailure(result, seconds)}`)
  return { result, seconds: Number(seconds) }
}

// --- protocol driver (milestone M2) -------------------------------------------------------------
//
// The driver speaks the real protocol through the product's own client stack; the phase script makes
// every judgement. See tests/lab-vm/protocol/context.ts for the shared runtime and
// docs/lab-vm-acceptance-design.md section 6 (Tier 2) for the cases.
//
// The service is reached on 127.0.0.1 here on purpose: the deployment firewall rule is added by the
// host *after* this phase, so the guest's own LAN address is not reachable yet. The genuinely remote
// peer is the host itself, which runs the same bundle once this run is over.
function loopbackUrl() {
  return `https://127.0.0.1:${config.port}/`
}

// `fingerprint` and `url` are overridable rather than appendable: the driver reads the *first* match of
// an option, so passing a second `--fingerprint` in `extra` would silently keep the correct one. That is
// exactly how the wrong-pin negative first failed — it was answered as an expired batch instead of as a
// pin refusal, which looked like a product answer rather than a harness mistake.
async function protocol(
  command,
  extra = [],
  { allowFailure = false, timeoutMs = 300000, fingerprint, url } = {}
) {
  const args = [
    command,
    '--url',
    url ?? loopbackUrl(),
    '--fingerprint',
    fingerprint ?? state.fingerprint,
    '--version',
    config.releaseVersion,
    ...extra
  ]
  const result = await runProcess(config.node, [config.protocolDriver, ...args], { timeoutMs })
  run.log(`$ protocol ${args.join(' ')} (exit ${result.code})`)
  const text = `${result.stdout}${result.stderr}`.trim()
  if (text) run.log(text)
  if (result.code !== 0 && !allowFailure)
    throw new Error(`protocol driver '${command}' failed with exit code ${result.code}: ${text}`)
  return result
}

// Runs a protocol command and returns the JSON object it printed. The driver prints exactly one line of
// JSON per command, and only for a completed observation: a non-zero exit means the driver itself could
// not finish, which is never a product verdict.
async function protocolResult(command, extra = [], options = {}) {
  const result = await protocol(command, extra, options)
  if (result.code !== 0) return { driverFailed: true, exitCode: result.code, output: result.stderr }
  try {
    return extractJsonPayload(result.stdout)
  } catch (error) {
    throw new Error(`protocol driver '${command}' printed no JSON result: ${error.message}`)
  }
}

// `driver` treats a non-zero exit as a harness failure because most steps cannot continue without the
// result. Milestone M4 has two cases where the refusal *is* the result — a running service refusing to
// be uninstalled, and an install refused for a missing preparation — so the raw outcome is returned
// here and the caller decides. The JSON line is preserved rather than reduced to an exit code, because
// the code is what the assertion is about.
async function rawDriver(args) {
  const result = await runProcess(config.node, [config.driver, ...args], { timeoutMs: 180000 })
  run.log(`$ driver ${args.join(' ')} (exit ${result.code})`)
  const text = `${result.stdout}${result.stderr}`.trim()
  if (text) run.log(text)
  return { ...result, text, parsed: parseJsonLine(text) }
}

function parseJsonLine(text) {
  for (const line of String(text).split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch {
      // Not the payload; keep looking upwards.
    }
  }
  return undefined
}

// The management password is generated by the install step and lives only in this file. The local
// proof is the other way in, and it is deliberately short-lived: the service issues it for 30 s and
// accepts it once, so it is fetched immediately before the command that uses it.
// A local proof is accepted exactly once, so the caller decides which proof it is spending rather than
// this helper deciding for it.
function teacherCredentialArguments(proofFile) {
  return proofFile ? ['--local-proof-file', proofFile] : ['--password-file', managementPasswordFile]
}

// The runtime hands out local proofs over the control channel rather than over HTTP, which is the whole
// point of the exemption this case is about: something that can already talk to the service as an
// administrator on this machine does not need the password as well.
// Every file that holds something a driver must not print is registered here, so `forgetSecrets` can
// remove it without anyone having to remember a second list.
const protocolSecretFiles = []
function protocolFile(name) {
  const file = join(workDir, `ls101-${name}-${process.pid}`)
  protocolSecretFiles.push(file)
  return file
}

//
// Each proof is accepted exactly once, so a case that needs three of them (loopback, LAN, and the LAN
// attempt with a forged forwarding header) asks three times and spends them in that order.
async function fetchLocalProof(index = 0) {
  const resultFile = join(workDir, `ls101-proof-${index}-${process.pid}.json`)
  try {
    await driver([
      'manage',
      '--manager',
      state.manager,
      '--runtime',
      state.runtime,
      '--operation',
      'connection',
      // `connection` takes no input, and the control channel distinguishes "no input" from "{}": the
      // runtime requires `input === undefined` for the parameterless operations.
      '--input-none',
      '--result',
      resultFile
    ])
    const helper = JSON.parse(readFileSync(resultFile, 'utf8'))
    assertThat(helper.ok === true, 'the helper returned the service connection details', helper)
    const value = helper.value
    assertThat(
      typeof value?.localProof === 'string' && value.localProof.length > 0,
      'the service issued a local proof',
      { keys: Object.keys(value ?? {}) }
    )
    // Written to its own file because that is how the protocol driver receives every secret: never on a
    // command line, never in an argument list that another process could read.
    const proofFile = protocolFile(`local-proof-${index}`)
    writeFileSync(proofFile, value.localProof)
    return {
      baseUrl: value.baseUrl,
      serverId: value.serverId,
      fingerprint: value.fingerprint,
      proofBytes: value.localProof.length,
      proofFile,
      resultFile
    }
  } finally {
    rmSync(resultFile, { force: true })
  }
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
  for (const file of [
    managementPasswordFile,
    backupPasswordFile,
    initializeArgument,
    initializeResult,
    ...protocolSecretFiles
  ]) {
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
    // Read here, before the service consumes it, so the leak scan can look for the value after the file
    // is deleted. It stays in memory and is never logged.
    invitationCodeValue = readFileSync(config.invitationFile, 'utf8').trim()
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

// The stop path is the one place where "the SCM never reported STOPPED" has several very different
// causes, and each of them is answered by a different question. This must run after serviceDiagnostics,
// because the manual shutdown below changes the very state that check reads.
async function stopDiagnostics() {
  run.log('--- stop diagnostics ---')
  try {
    // Is the bundled runtime still alive after the SCM was asked to stop it? This single field separates
    // "close() never completed" from "close() completed but the process will not exit".
    run.log(
      `runtime after the stop request: ${JSON.stringify(await probe('process', ['-Name', 'node.exe', '-Match', 'server.cjs']))}`
    )
    run.log(
      `wrapper after the stop request: ${JSON.stringify(await probe('process', ['-Name', 'LS101Lab.exe']))}`
    )
    // A control channel that still answers proves the process is up.
    const status = await runProcess(
      state.runtimeNode,
      [state.server, 'status', '--data-dir', config.dataDir],
      {
        timeoutMs: 15000
      }
    )
    run.log(
      `control channel after the stop request: exit=${status.code}${status.timedOut ? ' (timed out)' : ''} ${(status.stdout || status.stderr).trim()}`
    )
    // Run exactly what the wrapper runs on stop, and time it. A hang here is the product's stop path; a
    // quick exit means the process outlives its own shutdown.
    const startedAt = Date.now()
    const shutdown = await runProcess(
      state.runtimeNode,
      [state.server, 'shutdown', '--data-dir', config.dataDir],
      {
        timeoutMs: 45000
      }
    )
    run.log(
      `manual shutdown: exit=${shutdown.code} timedOut=${shutdown.timedOut} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s ${(shutdown.stdout || shutdown.stderr).trim()}`
    )
    run.log(
      `runtime after the manual shutdown: ${JSON.stringify(await probe('process', ['-Name', 'node.exe', '-Match', 'server.cjs']))}`
    )
  } catch (error) {
    run.log(`stop diagnostics could not be collected: ${error.message}`)
  }
  run.log('--- end stop diagnostics ---')
}

// --- S14: the SCM stop/start cycle preserves identity and data ------------------------------------
async function stepRestart() {
  return run.step('restart-survives', async () => {
    try {
      return await restartService()
    } catch (error) {
      // A stop that never completes does not time out: WinSW only applies <stoptimeout> when it kills
      // the process itself, and with <stoparguments> it waits on the service process in a loop that
      // reports STOP_PENDING forever. So this state has to be captured here and now.
      await serviceDiagnostics()
      await stopDiagnostics()
      throw error
    }
  })
}

// The wrapper logs "Started process <pid>" when it runs its stop executable and never says what it
// started, and the stop executable is short lived, so a poll from here would miss it. A dedicated
// sampler therefore runs beside the restart and polls the process table far faster than a probe can be
// spawned. It stops when the file it watches appears, so a fast restart does not wait out a fixed window.
const PROCESS_SAMPLER_STOP = 'process-sampler.stop'

function processSamplerScript(stopFile) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$stopFile = '${stopFile}'
$seen = [ordered]@{}
$deadline = (Get-Date).AddSeconds(240)
while (-not (Test-Path -LiteralPath $stopFile) -and (Get-Date) -lt $deadline) {
  foreach ($candidate in Get-CimInstance Win32_Process -Filter "Name='node.exe'") {
    $commandLine = [string]$candidate.CommandLine
    if ($seen.Contains($commandLine)) { continue }
    $seen[$commandLine] = [pscustomobject]@{
      processId   = $candidate.ProcessId
      parentId    = $candidate.ParentProcessId
      seenAt      = (Get-Date).ToString('HH:mm:ss.fff')
      commandLine = $commandLine
    }
  }
  Start-Sleep -Milliseconds 100
}
$seen.Values | ConvertTo-Json -Compress
`
}

async function restartService() {
  const restartArguments = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Restart-Service -Name '${config.serviceName}'`
  ]
  const samplerStop = join(config.resultsDir, PROCESS_SAMPLER_STOP)
  rmSync(samplerStop, { force: true })
  const samplerArguments = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    processSamplerScript(samplerStop)
  ]
  const sampler = runProcess('powershell.exe', samplerArguments, { timeoutMs: 300000 })
  // The sampler is given a moment to reach its first poll so the runtime's original command line, not
  // just the ones the restart produces, is part of the record.
  await sleep(1000)
  run.log(`$ powershell.exe ${restartArguments.join(' ')}`)
  const restart = runProcess('powershell.exe', restartArguments, { timeoutMs: 120000 })
  const restarted = await restart
  writeFileSync(samplerStop, 'stop\n')
  const observed = await sampler
  run.log(`--- process table while the service was stopping (sampler exit ${observed.code}) ---`)
  try {
    for (const match of asArray(extractJsonPayload(observed.stdout))) {
      run.log(
        `observed: seen ${match.seenAt} pid ${match.processId} (parent ${match.parentId}) :: ${match.commandLine}`
      )
    }
  } catch (error) {
    run.log(`the process sampler produced no usable output: ${error.message}`)
    run.log(`${observed.stdout}${observed.stderr}`.trim())
  }
  run.log('--- end process table ---')
  rmSync(samplerStop, { force: true })
  const restartText = `${restarted.stdout}${restarted.stderr}`.trim()
  if (restartText)
    run.log(`Restart-Service: exit=${restarted.code} timedOut=${restarted.timedOut} ${restartText}`)
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
//
// The design lists three secrets that must not reach an artefact: the management password, the
// invitation code and the one-time local proof. All are scanned by value: the passwords from the files
// this run generated, the invitation code from the copy read before the service consumed it, and the
// proof from the files the protocol driver received it in.
//
// The scan runs twice, because the set of secrets that exist grows during the run. The first pass has
// the management password and the invitation code; the local proof and the device secret only appear
// once the protocol cases have run, and the backup password once the upgrade case has prepared its
// backup. Whichever pass sees a value asserts that it is absent from every artefact, and a pass that
// expects a secret which is not there fails rather than scanning for nothing.
async function scanForSecrets(entries) {
  const scannedValues = []
  for (const { label, file, value } of entries) {
    const secret = value ?? (file && existsSync(file) ? readFileSync(file, 'utf8').trim() : '')
    assertThat(secret.length > 0, `the ${label} is available for the leak scan`, { label, file })
    scannedValues.push({ label, value: secret })
  }
  const scanned = [run.logPath, run.progressPath, run.resultsPath].filter((file) =>
    existsSync(file)
  )
  // The log and the progress file are written from the first phase, so an empty scan set would mean the
  // artefacts were not where this step thinks they are.
  assertThat(scanned.length >= 2, 'the log and the progress file exist for the leak scan', scanned)
  for (const file of scanned) {
    const text = readFileSync(file, 'utf8')
    for (const { label, value } of scannedValues)
      assertThat(!text.includes(value), `no ${label} leaked into ${file}`, file)
  }
  return { scanned: scanned.length, secrets: scannedValues.map((entry) => entry.label) }
}

// The proof files are named by `protocolFile()`; the device secrets by their own suffixes. Only files
// that still hold a value are used, and a spent proof file is skipped rather than read as an empty
// string.
function protocolSecretEntries() {
  const entries = []
  for (const file of protocolSecretFiles) {
    if (!/local-proof|device-secret/.test(file) || !existsSync(file)) continue
    const value = readFileSync(file, 'utf8').trim()
    if (value.length > 0) entries.push({ label: `secret file ${file}`, value })
  }
  return entries
}

async function stepSecretScan() {
  return run.step('secret-scan', async () => {
    assertThat(
      existsSync(managementPasswordFile),
      'the management password is available for the leak scan',
      managementPasswordFile
    )
    return scanForSecrets([
      { label: 'management password', file: managementPasswordFile },
      // Captured before the service consumed it, because the file itself is deleted by then.
      { label: 'invitation code', value: invitationCodeValue }
    ])
  })
}

// The second pass, after the upgrade cases have created their own secrets. It covers what did not exist
// at the first one: the archive password and every credential the protocol driver received.
async function stepFinalSecretScan() {
  return run.step('secret-scan-final', async () => {
    return scanForSecrets([
      { label: 'management password', file: managementPasswordFile },
      { label: 'invitation code', value: invitationCodeValue },
      { label: 'backup password', file: backupPasswordFile },
      ...protocolSecretEntries()
    ])
  })
}

// --- N1: the pin is checked before any HTTP request or credential exists --------------------------
async function stepProtocolPin() {
  return run.step('protocol-pin', async () => {
    const observed = await protocolResult('pin')
    const double = observed.double
    assertThat(double?.rightPin?.opened === true, 'the correct pin opens a connection', observed)
    // The refusal is the product's own: it comes from the transport, before any request object exists.
    assertThat(double?.wrongPin?.refused === true, 'a wrong pin is refused', observed)
    // A connection was accepted, so the refusal happened at the pin check and not because nothing was
    // listening. The completed-handshake count is deliberately not asserted: the client destroys the
    // socket as soon as it has read the certificate, so whether the server got that far is a race.
    assertThat(double.connections >= 1, 'the refused attempt still reached the service', double)
    // The heart of the case: nothing was written to the socket, so no headers and no credentials left.
    assertThat(
      double.requests === 0 && double.requestBytes === 0,
      'the refused attempt sent no HTTP request and no bytes',
      double
    )
    // And the same driver, in the same process, reaches the service under test with the real pin.
    assertThat(
      observed.real?.opened === true,
      'the service under test answers on the real pin',
      observed
    )
    assertThat(
      observed.real.serverId === state.serverId,
      'the identity the driver saw is the identity the control channel reported',
      { driver: observed.real.serverId, control: state.serverId }
    )
    return {
      wrongPin: double.wrongPin.message,
      connections: double.connections,
      handshakes: double.handshakes,
      requests: double.requests,
      requestBytes: double.requestBytes,
      serverId: observed.real.serverId
    }
  })
}

// --- N2 (loopback half): the ways into a teacher session, and what each one is worth --------------
async function stepProtocolAuth() {
  return run.step('protocol-auth', async () => {
    // One proof per use: the loopback case, the LAN case, and the LAN attempt that forges a forwarding
    // header. They are issued back to back because each expires 30 s after it is issued.
    const proofs = [await fetchLocalProof(0), await fetchLocalProof(1), await fetchLocalProof(2)]
    run.log(
      `local proofs issued for ${proofs[0].baseUrl} (${proofs.map((proof) => proof.proofBytes).join('/')} bytes)`
    )
    const observed = await protocolResult('login', [
      ...teacherCredentialArguments(),
      ...proofs.flatMap((proof) => ['--local-proof-file', proof.proofFile]),
      // The guest's own LAN address is only reachable once the host adds the deployment firewall rule,
      // which happens after this phase. The attempt is therefore evidence when it answers and not a
      // failure when it does not; the genuinely remote peer is the host, which runs this same command.
      '--url-lan',
      `https://${guestAddress()}:${config.port}/`
    ])
    const cases = observed.cases ?? {}
    assertThat(
      cases.noCredential?.status === 401 && cases.noCredential.code === 'AUTH_REQUIRED',
      'an unauthenticated session request is refused with AUTH_REQUIRED',
      cases.noCredential
    )
    assertThat(
      cases.noCredential.tokenIssued === false,
      'a refused session request issues no token',
      cases.noCredential
    )
    assertThat(
      cases.password?.status === 200 && cases.password.tokenIssued === true,
      'the management password issues a teacher session',
      cases.password
    )
    assertThat(
      cases.localProof?.status === 200 && cases.localProof.tokenIssued === true,
      'a local proof issues a teacher session over loopback',
      cases.localProof
    )
    // The three LAN cases are the interesting ones when the firewall happens to allow them: the local
    // proof must lose its value the moment the source is not loopback, and a forged forwarding header
    // must not restore it.
    const lan = ['lanNoCredential', 'lanLocalProof', 'lanForgedForwardedFor'].filter(
      (name) => cases[name] && cases[name].refused === undefined
    )
    for (const name of lan) {
      assertThat(
        cases[name].status === 401,
        `from the LAN address, '${name}' is refused`,
        cases[name]
      )
      assertThat(
        cases[name].tokenIssued === false,
        `from the LAN address, '${name}' issues no token`,
        cases[name]
      )
    }
    return {
      noCredential: cases.noCredential,
      password: { status: cases.password?.status, tokenIssued: cases.password?.tokenIssued },
      localProofOverLoopback: cases.localProof?.status,
      lanAttempted: lan.length,
      lanOutcomes: lan.map((name) => ({
        name,
        status: cases[name].status,
        code: cases[name].code
      })),
      lanRefused: ['lanNoCredential', 'lanLocalProof', 'lanForgedForwardedFor']
        .filter((name) => cases[name]?.refused !== undefined)
        .map((name) => cases[name].refused)
    }
  })
}

// --- N3: a batch, two processes that must not share an identity, and a replay -------------------
async function stepEnrollmentBatch() {
  return run.step('enrollment-batch', async () => {
    const batchFile = protocolFile('enrollment-a')
    const batch = await protocolResult('enroll-issue', [
      ...teacherCredentialArguments(),
      '--out',
      batchFile
    ])
    assertThat(batch.status === 201, 'the service issued an enrollment batch', batch)
    // Issuing a batch is what puts the service into maintenance mode: enrollment is a deployment step,
    // not something a classroom can do while a lesson is running.
    assertThat(
      batch.mode === 'maintenance',
      'enrollment is only possible in maintenance mode',
      batch
    )
    assertThat(
      batch.sha256 === batch.downloadSha256,
      'the enrollment file on disk is the stream the service signed',
      batch
    )
    assertThat(
      batch.listed?.registeredCount === 0,
      'a freshly issued batch has no registered device',
      batch.listed
    )

    // Two registrations in two processes, with two installation identities and two secrets.
    const deviceA = protocolFile('device-a.json')
    const secretA = protocolFile('device-a-secret')
    const deviceB = protocolFile('device-b.json')
    const secretB = protocolFile('device-b-secret')
    const first = await protocolResult('enroll-register', [
      '--enroll-file',
      batchFile,
      '--installation-id',
      randomUUID(),
      '--state-out',
      deviceA,
      '--device-secret-file',
      secretA,
      '--computer-name',
      'ls101-lab-a',
      '--platform',
      'win32'
    ])
    assertThat(first.status === 201, 'the first device registered', first)
    assertThat(first.duplicate === false, 'the first registration is not a duplicate', first)
    const second = await protocolResult('enroll-register', [
      '--enroll-file',
      batchFile,
      '--installation-id',
      randomUUID(),
      '--state-out',
      deviceB,
      '--device-secret-file',
      secretB,
      '--computer-name',
      'ls101-lab-b',
      '--platform',
      'win32'
    ])
    assertThat(second.status === 201, 'the second device registered', second)
    assertThat(second.deviceId !== first.deviceId, 'two installations get two device identities', {
      first: first.deviceId,
      second: second.deviceId
    })

    // Replaying the first installation with the same secret must return the same device, not a new one.
    const replay = await protocolResult('enroll-register', [
      '--enroll-file',
      batchFile,
      '--installation-id',
      first.installationId,
      '--state-out',
      protocolFile('device-a-replay.json'),
      '--device-secret-file',
      secretA,
      '--computer-name',
      'ls101-lab-a',
      '--platform',
      'win32'
    ])
    assertThat(replay.status === 200, 'the replay is answered as a duplicate', replay)
    assertThat(replay.duplicate === true, 'the replay reports itself as a duplicate', replay)
    assertThat(
      replay.deviceId === first.deviceId,
      'the replay returns the device that already exists',
      { replay: replay.deviceId, first: first.deviceId }
    )

    // The teacher's own list is where "no second device appeared" has to be visible.
    const devices = await protocolResult('device-list', [...teacherCredentialArguments()])
    const ids = asArray(devices.items).map((item) => item.id)
    assertThat(ids.includes(first.deviceId), 'the first device is listed', ids)
    assertThat(ids.includes(second.deviceId), 'the second device is listed', ids)
    const occurrences = ids.filter((id) => id === first.deviceId).length
    assertThat(occurrences === 1, 'the replayed installation produced no extra device', ids)

    state.deviceState = deviceA
    state.enrollmentBatch = { id: batch.enrollmentId, file: batchFile }
    return {
      enrollmentId: batch.enrollmentId,
      mode: batch.mode,
      fileBytes: batch.bytes,
      devices: [first.deviceId, second.deviceId],
      replay: { status: replay.status, duplicate: replay.duplicate },
      listed: ids.length
    }
  })
}

// --- N4/N5: every way an enrollment file can be wrong, and one byte of difference ----------------
async function stepEnrollmentNegatives() {
  return run.step('enrollment-negatives', async () => {
    const outcome = {}
    const attempt = async (name, extra) => {
      const observed = await protocolResult('enroll-reject', [
        '--installation-id',
        randomUUID(),
        ...extra
      ])
      outcome[name] = observed
      run.log(`enrollment negative '${name}': ${JSON.stringify(observed)}`)
      return observed
    }

    // The batch issued for the identity cases is still open, and an open enrollment is itself a resource
    // that keeps the service in maintenance. Two things follow, and both are asserted rather than
    // assumed: the open batch blocks the exit, and it has to be closed before this step can issue a batch
    // of its own — the service allows exactly one open enrollment at a time (409 RESOURCE_BUSY
    // otherwise), which is what the previous run of this suite ran into.
    const blocked = await protocolResult('maintenance-exit', [
      ...teacherCredentialArguments(),
      '--attempts',
      '1'
    ])
    const blockedKinds = asArray(blocked.attempts).flatMap((attempt) =>
      asArray(attempt.blockers).map((blocker) => blocker.kind)
    )
    assertThat(
      blocked.final?.status === 409 && blockedKinds.includes('enrollment'),
      'an open enrollment keeps the service in maintenance',
      { final: blocked.final, kinds: blockedKinds }
    )
    const closed = await protocolResult('enroll-reject', [
      '--enroll-file',
      state.enrollmentBatch.file,
      '--installation-id',
      randomUUID(),
      '--revoke-first',
      '--enrollment-id',
      state.enrollmentBatch.id,
      ...teacherCredentialArguments()
    ])
    assertThat(closed.revoke?.status === 204, 'the identity batch was closed', closed.revoke)
    const exited = await protocolResult('maintenance-exit', [
      ...teacherCredentialArguments(),
      '--attempts',
      '5',
      '--interval-ms',
      '1000'
    ])
    assertThat(
      exited.final?.status === 200 && exited.final?.mode === 'normal',
      'closing the batch lets the service leave maintenance',
      exited
    )
    // Issuing a batch forces maintenance mode, but asking for it explicitly keeps this step readable:
    // registration is only possible there, and the failure that follows if it is not is confusing.
    const reentered = await protocolResult('mode', [
      ...teacherCredentialArguments(),
      '--set',
      'maintenance'
    ])
    assertThat(reentered.mode === 'maintenance', 'the service is back in maintenance', reentered)

    // Batch A is valid: the negative is the file, not the batch.
    const batchA = protocolFile('enrollment-reject-a')
    const issuedA = await protocolResult('enroll-issue', [
      ...teacherCredentialArguments(),
      '--out',
      batchA
    ])
    assertThat(issuedA.status === 201, 'a batch was issued for the negative cases', issuedA)

    // N5: exactly one byte away from the signed file. The service rejects it, and the mutation is
    // reported byte by byte so the rejection can be attributed to the file rather than to the attempt.
    const mutated = await attempt('one-byte-mutation', [
      '--enroll-file',
      batchA,
      '--mutate',
      'one-byte'
    ])
    assertThat(mutated.accepted === false, 'a one-byte mutation is refused', mutated)
    assertThat(
      mutated.status === 403 && mutated.code === 'ENROLLMENT_REJECTED',
      'the mutated file is refused as an enrollment, not as a malformed request',
      mutated
    )
    assertThat(
      mutated.mutation?.before !== mutated.mutation?.after,
      'the rejection is attributed to a real byte change',
      mutated.mutation
    )

    // The revoked variant: closing the batch is what the teacher's revoke button does.
    const revoked = await attempt('revoked-batch', [
      '--enroll-file',
      batchA,
      '--revoke-first',
      '--enrollment-id',
      issuedA.enrollmentId,
      ...teacherCredentialArguments()
    ])
    assertThat(revoked.accepted === false, 'a revoked batch is refused', revoked)
    assertThat(
      revoked.status === 403 && revoked.code === 'ENROLLMENT_REJECTED',
      'a revoked batch is refused as an enrollment',
      revoked
    )

    // A second, short-lived batch: the expired variant needs a batch the service considers old, and
    // only one batch may be open at a time.
    const batchB = protocolFile('enrollment-reject-b')
    const issuedB = await protocolResult('enroll-issue', [
      ...teacherCredentialArguments(),
      '--out',
      batchB,
      '--valid-for-seconds',
      '5'
    ])
    assertThat(issuedB.status === 201, 'a short-lived batch was issued', issuedB)

    const wrongVersion = await attempt('wrong-release-version', [
      '--enroll-file',
      batchB,
      '--release-version',
      '9.9.9'
    ])
    assertThat(
      wrongVersion.status === 409 && wrongVersion.code === 'VERSION_MISMATCH',
      'a registration from another release is refused as a version mismatch',
      wrongVersion
    )

    // A validly signed file from the batch that was just revoked, submitted while batch B is held.
    const otherBatch = await attempt('other-batch-file', [
      '--enroll-file',
      batchB,
      '--from-other-enrollment',
      batchA
    ])
    assertThat(otherBatch.accepted === false, "another batch's file is refused", otherBatch)
    assertThat(
      otherBatch.status === 403 && otherBatch.code === 'ENROLLMENT_REJECTED',
      "another batch's file is refused as an enrollment",
      otherBatch
    )

    run.log('waiting for the short-lived batch to expire on the service clock')
    await sleep(6500)
    const expired = await attempt('expired-batch', ['--enroll-file', batchB, '--expect-expired'])
    assertThat(expired.accepted === false, 'an expired batch is refused', expired)
    assertThat(
      expired.expired?.status === 403 && expired.expired.code === 'ENROLLMENT_REJECTED',
      'the expired batch is refused as an enrollment',
      expired
    )

    // The wrong pin fails before any HTTP request exists, so there is no status to report. The
    // fingerprint is replaced rather than appended, because a second `--fingerprint` would be ignored.
    const wrongPin = await protocolResult(
      'enroll-reject',
      ['--installation-id', randomUUID(), '--enroll-file', batchB],
      { fingerprint: `sha256:${'0'.repeat(64)}` }
    )
    outcome['wrong-pin'] = wrongPin
    run.log(`enrollment negative 'wrong-pin': ${JSON.stringify(wrongPin)}`)
    assertThat(wrongPin.accepted === false, 'a wrong pin is refused', wrongPin)
    assertThat(
      wrongPin.status === 0 && wrongPin.code === 'TLS_PIN_MISMATCH',
      'the wrong pin is refused at the handshake, before any request',
      wrongPin
    )
    assertThat(
      /public key/i.test(String(wrongPin.message)) && !/enrollment/i.test(String(wrongPin.message)),
      'the refusal names the pin and not the enrollment',
      wrongPin.message
    )

    // The design lists a wrong purpose/formatVersion variant. The driver cannot produce one: the
    // payload is signed with the service key, so the driver has no way to mint a differently-labelled
    // file. The gap is reported instead of being papered over.
    const notes = asArray(mutated.notes)
    assertThat(
      notes.some((note) => /purpose|formatVersion/i.test(String(note))),
      'the unreachable purpose/formatVersion variant is reported rather than silently skipped',
      notes
    )

    return {
      cases: Object.fromEntries(
        Object.entries(outcome).map(([name, value]) => [
          name,
          { status: value.status, code: value.code, accepted: value.accepted }
        ])
      ),
      notes,
      openEnrollmentBlockers: blockedKinds,
      closedBatch: closed.revoke?.status
    }
  })
}

// --- N6: online, offline, and the values that must survive going offline -------------------------
function deviceEntry(list, deviceId) {
  return asArray(list.items).find((item) => item.id === deviceId)
}

async function stepDeviceHeartbeat() {
  return run.step('device-heartbeat', async () => {
    const deviceState = state.deviceState
    assertThat(typeof deviceState === 'string', 'a registered device is available', deviceState)
    const first = await protocolResult('heartbeat', ['--state', deviceState, '--phase', 'idle'])
    assertThat(
      first.lastAccepted === true,
      'the first heartbeat for a fresh runtime is accepted',
      first
    )
    const online = await protocolResult('device-list', [...teacherCredentialArguments()])
    const seen = deviceEntry(online, first.deviceId)
    assertThat(seen?.online === true, 'the device is online after one heartbeat', seen)
    assertThat(
      typeof seen.lastSeenAt === 'string' && seen.lastSeenAt.length > 0,
      'the teacher list reports when the service last heard from the device',
      seen
    )

    // The service stores one heartbeat row per credential, so an older sequence must not overwrite a
    // newer one. It answers with the ordinary success status: staleness is not a request error.
    const stale = await protocolResult('heartbeat', ['--state', deviceState, '--stale'])
    assertThat(stale.lastStatus === 200, 'a stale heartbeat is answered normally', stale)
    assertThat(stale.lastAccepted === false, 'a stale heartbeat is not accepted', stale)

    // Nothing injects a clock here, so this waits out the service's real offline threshold.
    run.log('waiting 22 s for the service to consider the device offline')
    await sleep(22000)
    const offlineList = await protocolResult('device-list', [...teacherCredentialArguments()])
    const offline = deviceEntry(offlineList, first.deviceId)
    assertThat(
      offline?.online === false,
      'the device goes offline once it stops heartbeating',
      offline
    )
    assertThat(
      offline.lastSeenAt === seen.lastSeenAt,
      'the last known heartbeat time is kept, not cleared',
      { before: seen.lastSeenAt, after: offline.lastSeenAt }
    )
    // Offline is a derived state, not a wipe: the teacher must still see which device and number it was.
    assertThat(
      offline.number === seen.number && offline.phase === seen.phase,
      'the last known device values are kept, not zeroed',
      { before: { number: seen.number, phase: seen.phase }, after: offline }
    )

    // And a heartbeat brings it back, which is what makes the offline reading a threshold rather than
    // a one-way state.
    const resumed = await protocolResult('heartbeat', ['--state', deviceState, '--phase', 'idle'])
    assertThat(resumed.lastAccepted === true, 'heartbeating again is accepted', resumed)
    const recovered = deviceEntry(
      await protocolResult('device-list', [...teacherCredentialArguments()]),
      first.deviceId
    )
    assertThat(recovered?.online === true, 'the device is online again', recovered)

    state.deviceId = first.deviceId
    return {
      deviceId: first.deviceId,
      lastSeenAt: seen.lastSeenAt,
      stale: { status: stale.lastStatus, accepted: stale.lastAccepted },
      offlineRetained: { number: offline.number, phase: offline.phase },
      recovered: recovered.online
    }
  })
}

// --- N11: many short-lived connections, and what they do to the machine --------------------------
async function stepHeartbeatLoad() {
  return run.step('heartbeat-load', async () => {
    const clients = 32
    const seconds = 120
    const before = await probe('connections', ['-Port', String(config.port)])
    const load = await protocolResult(
      'heartbeat-load',
      [
        '--state',
        state.deviceState,
        '--clients',
        String(clients),
        '--seconds',
        String(seconds),
        '--interval-ms',
        '3000'
      ],
      { timeoutMs: 420000 }
    )
    const after = await probe('connections', ['-Port', String(config.port)])
    run.log(`connections before: ${JSON.stringify(before.byState)}`)
    run.log(`connections after: ${JSON.stringify(after.byState)}`)

    // Every request builds and destroys its own TLS socket, so the load is a port-churn test. What must
    // not happen is a transport error: a rejected heartbeat is the service correctly refusing to let an
    // older sequence overwrite a newer one, which concurrent clients sharing one credential will do.
    assertThat(load.errors.length === 0, 'no client failed at the transport level', load.errors)
    assertThat(load.clients === clients, 'every client ran', load)
    assertThat(load.sent >= clients * 10, 'the load actually produced sustained traffic', {
      sent: load.sent,
      clients
    })
    assertThat(load.accepted > 0, 'the service went on accepting heartbeats under load', load)

    // And the service is still the same service afterwards: same identity, still serving.
    const status = await native(state.runtimeNode, [
      state.server,
      'status',
      '--data-dir',
      config.dataDir
    ])
    assertThat(status.code === 0, 'the control channel still answers after the load', status)
    const parsed = extractJsonPayload(status.stdout)
    assertThat(
      parsed.fingerprint === state.fingerprint,
      'the service kept its identity through the load',
      parsed
    )
    return {
      clients: load.clients,
      seconds: load.seconds,
      sent: load.sent,
      accepted: load.accepted,
      rejected: load.rejected,
      throughputPerSecond: load.throughputPerSecond,
      statesBefore: before.byState,
      statesAfter: after.byState,
      servicePortStates: after.servicePort,
      dynamicPorts: after.dynamicPorts
    }
  })
}

// --- N12: the IPv6 boundaries, and the fact that they are refused rather than half-supported -----
async function stepProtocolIpv6() {
  return run.step('protocol-ipv6', async () => {
    const observed = await protocolResult('ipv6', [...teacherCredentialArguments()])
    const hosts = observed.hosts ?? {}
    // Two IPv4 literals and nothing else: the service cannot be asked to bind IPv6 at all.
    assertThat(
      hosts.zeroZeroZeroZero?.accepted === true && hosts.loopback?.accepted === true,
      'both documented hosts are accepted',
      hosts
    )
    assertThat(
      hosts.ipv6Literal?.accepted === false,
      'an IPv6 host is refused by the runtime configuration',
      hosts.ipv6Literal
    )
    // The client strips the brackets of an IPv6 literal, so the bracketed form is the one that gets as
    // far as an address; the unbracketed form is refused where the URL is parsed.
    assertThat(
      observed.targets?.bracketedIpv6?.accepted === true,
      'the client accepts a bracketed IPv6 literal',
      observed.targets
    )
    assertThat(
      observed.targets?.unbracketedIpv6?.accepted === false,
      'an unbracketed IPv6 literal is refused',
      observed.targets
    )
    // What the operator actually sees: a join file naming an IPv6 address must produce a diagnosis.
    for (const [name, value] of Object.entries(observed.joinFile ?? {})) {
      assertThat(
        value.accepted === false,
        `a join file naming an IPv6 address is refused (${name})`,
        value
      )
      assertThat(
        typeof value.message === 'string' && value.message.trim().length > 0,
        `the refusal is a readable message, not a bare code (${name})`,
        value
      )
    }
    // Anything the driver could not reach is reported rather than quietly dropped.
    return {
      hosts,
      targets: observed.targets,
      joinFile: observed.joinFile,
      advertisedBaseUrl: observed.settings?.advertisedBaseUrl ?? null,
      notes: observed.notes ?? []
    }
  })
}

// --- N8: what maintenance refuses, what it still accepts, and how a practice continues -----------
async function stepServiceModeAdmission() {
  return run.step('service-mode-admission', async () => {
    const exam = state.exam
    assertThat(typeof exam?.examId === 'string', 'a published exam is available', exam)
    const entered = await protocolResult('mode', [
      ...teacherCredentialArguments(),
      '--set',
      'maintenance'
    ])
    assertThat(
      entered.status === 200 && entered.mode === 'maintenance',
      'the teacher can put the service into maintenance',
      entered
    )

    // Maintenance is an admission rule, and it is applied before the exam, the archive or the candidate
    // is looked at: the refusal has to be about the mode, not about anything else in the request.
    const refusedStart = await protocolResult('practice', [
      '--state',
      state.deviceState,
      '--exam-id',
      exam.examId,
      '--archive-sha256',
      exam.sha256,
      '--expect-rejected'
    ])
    assertThat(
      refusedStart.status === 409 && refusedStart.code === 'SERVICE_MAINTENANCE',
      'a practice cannot start in maintenance',
      refusedStart
    )
    const refusedSubmit = await protocolResult('practice', [
      '--state',
      state.deviceState,
      '--submit',
      '--expect-rejected'
    ])
    assertThat(
      refusedSubmit.status === 409 && refusedSubmit.code === 'SERVICE_MAINTENANCE',
      'a formal submission is refused in maintenance',
      refusedSubmit
    )

    // Maintenance is not an outage: the classroom still has to be visible to the teacher.
    const beat = await protocolResult('heartbeat', [
      '--state',
      state.deviceState,
      '--phase',
      'maintenance-idle'
    ])
    assertThat(beat.lastAccepted === true, 'heartbeats are still accepted in maintenance', beat)

    const normal = await protocolResult('mode', [
      ...teacherCredentialArguments(),
      '--set',
      'normal'
    ])
    assertThat(
      normal.status === 200 && normal.mode === 'normal',
      'the teacher can leave maintenance',
      normal
    )

    const grantOut = protocolFile('practice-grant.json')
    const started = await protocolResult('practice', [
      '--state',
      state.deviceState,
      '--exam-id',
      exam.examId,
      '--archive-sha256',
      exam.sha256,
      '--grant-out',
      grantOut
    ])
    assertThat(started.status === 201, 'a practice starts once the service is normal', started)
    assertThat(
      typeof started.submissionId === 'string' && started.submissionId.length > 0,
      'the start produced a submission id',
      started
    )

    // "Continuing the original numbering" is a statement about that id: the service has no counter, so
    // the proof is that a second start reusing the id returns the original grant rather than making a
    // new one.
    // `--exam-id` is required even for a continuation: the command reuses the recorded submission id,
    // candidate and digest from the state file, but it still has to know which exam is being continued.
    const continued = await protocolResult('practice', [
      '--state',
      state.deviceState,
      '--exam-id',
      exam.examId,
      '--continuation',
      '--grant-out',
      protocolFile('practice-grant-continued.json')
    ])
    assertThat(
      continued.submissionId === started.submissionId,
      'continuing reuses the original submission id',
      { started: started.submissionId, continued: continued.submissionId }
    )
    // The service has no numbering counter, so the continuation is reported as what it actually is: the
    // same grant, returned again for the same client-supplied submission id.
    assertThat(
      continued.numbering?.reused === true && continued.numbering?.sameGrant === true,
      'the continuation returns the original grant rather than creating a new practice',
      continued.numbering
    )
    assertThat(
      continued.numbering?.serverCounter === false,
      'the driver says plainly that the service keeps no answer counter',
      continued.numbering
    )

    state.practice = { submissionId: started.submissionId, grantOut }
    return {
      entered: { status: entered.status, mode: entered.mode },
      refusedStart: { status: refusedStart.status, code: refusedStart.code },
      refusedSubmit: { status: refusedSubmit.status, code: refusedSubmit.code },
      heartbeatInMaintenance: beat.lastAccepted,
      submissionId: started.submissionId,
      numbering: continued.numbering
    }
  })
}

// --- N9: the two concurrency ceilings answer with two different codes -----------------------------
async function stepConcurrencyLimits() {
  return run.step('concurrency-limits', async () => {
    // The upload ceiling is a per-device reservation rule, so this needs the practice the previous step
    // started: without a grant there is nothing to race over.
    const uploads = await protocolResult(
      'concurrency',
      ['--state', state.deviceState, '--kind', 'uploads', '--count', '12'],
      { timeoutMs: 300000 }
    )
    assertThat(uploads.transportErrors === 0, 'no upload failed at the transport level', uploads)
    assertThat(
      Number(uploads.statuses?.['429'] ?? 0) >= 1 && Number(uploads.codes?.RATE_LIMITED ?? 0) >= 1,
      'the upload ceiling answers 429 RATE_LIMITED',
      { statuses: uploads.statuses, codes: uploads.codes }
    )
    // The ceiling is a ceiling, not a wall: at least one upload has to get through, or the case would
    // pass on a service that refuses everything.
    assertThat(
      Number(uploads.statuses?.['201'] ?? 0) >= 1,
      'one upload is admitted alongside the refusals',
      uploads.statuses
    )

    // The handler ceiling is a different resource with a different code. It is measured with requests
    // that hold a handler open, which is what makes 64 of them overlap.
    const handlers = await protocolResult(
      'concurrency',
      [
        '--state',
        state.deviceState,
        '--kind',
        'handlers',
        '--count',
        '80',
        '--keepalive-seconds',
        '2'
      ],
      { timeoutMs: 300000 }
    )
    assertThat(
      handlers.transportErrors === 0,
      'no handler request failed at the transport level',
      handlers
    )
    assertThat(
      Number(handlers.statuses?.['503'] ?? 0) >= 1 &&
        Number(handlers.codes?.SERVICE_NOT_READY ?? 0) >= 1,
      'the handler ceiling answers 503 SERVICE_NOT_READY',
      { statuses: handlers.statuses, codes: handlers.codes }
    )
    // The requests below the ceiling have to be *served*, not merely not-503. What a concurrent
    // heartbeat answers depends on the device's own history: with a heartbeat row already stored, 64
    // simultaneous beats carrying their own runtime ids are a legitimate 409 CONTENT_CONFLICT, so
    // requiring 200 here would be asserting the fixture rather than the ceiling. Every status must still
    // be a service answer, and 503 must be the only thing the door itself produces.
    const handlerStatuses = handlers.statuses ?? {}
    const served = Object.values(handlerStatuses).reduce((total, count) => total + Number(count), 0)
    assertThat(
      served >= 1 && served - Number(handlerStatuses['503'] ?? 0) >= 1,
      'the requests below the handler ceiling reach a handler',
      { statuses: handlerStatuses, served }
    )
    assertThat(
      Object.keys(handlerStatuses).every((status) => ['200', '409', '503'].includes(status)),
      'every handler request was answered by the service, at the ceiling or by a handler',
      handlerStatuses
    )

    // And the service is still healthy after both ceilings were touched.
    const status = await native(state.runtimeNode, [
      state.server,
      'status',
      '--data-dir',
      config.dataDir
    ])
    assertThat(status.code === 0, 'the service still answers after the concurrency cases', status)

    return {
      uploads: {
        statuses: uploads.statuses,
        codes: uploads.codes,
        transportErrors: uploads.transportErrors,
        elapsedMs: uploads.elapsedMs
      },
      handlers: {
        statuses: handlers.statuses,
        codes: handlers.codes,
        transportErrors: handlers.transportErrors,
        elapsedMs: handlers.elapsedMs
      }
    }
  })
}

// --- N7: publish, fetch, claim, upload, re-upload, download, delete, and what survives -----------
async function stepExamAndSubmission() {
  return run.step('exam-and-submission', async () => {
    // Enrollment leaves the service in maintenance, and the practice flow only runs in normal mode.
    const normal = await protocolResult('mode', [
      ...teacherCredentialArguments(),
      '--set',
      'normal'
    ])
    assertThat(
      normal.status === 200 && normal.mode === 'normal',
      'the service is normal before the practice cases',
      normal
    )
    const mirror = protocolFile('exam-mirror')
    // A real resource rather than a compressed placeholder: the archive has to be big enough that the
    // transfer is a transfer, and random bytes cannot deflate away to nothing.
    const published = await protocolResult('exam-publish', [
      ...teacherCredentialArguments(),
      '--out',
      mirror,
      '--title',
      'LS101 VM 验收试卷',
      '--resource-bytes',
      String(4 * 1024 * 1024),
      '--publish'
    ])
    // `assertThat` takes a real boolean, and `status === 201 && published.examId` is a string: the
    // comparison has to be spelled out or a successful publish is reported as a failure.
    assertThat(
      published.status === 201 && typeof published.examId === 'string',
      'the exam package was published',
      published
    )
    assertThat(published.published === true, 'the exam is visible to students', published)
    assertThat(
      published.visible?.listed === true,
      'the exam appears in the student list',
      published.visible
    )

    // A second, independent process lists and streams it down, then recomputes the digest from the bytes
    // on disk: the service's own digest header is not evidence about the bytes it actually served.
    const listed = await protocolResult('exam-list', ['--state', state.deviceState])
    assertThat(
      asArray(listed.items).some((item) => item.examId === published.examId),
      'the published exam is in the student list',
      listed
    )
    const fetchFile = protocolFile('fetched-exam.lsexam')
    const fetched = await protocolResult('exam-fetch', [
      '--state',
      state.deviceState,
      '--exam-id',
      published.examId,
      '--out',
      fetchFile
    ])
    assertThat(fetched.status === 200, 'the student can download the exam archive', fetched)
    assertThat(
      fetched.digestsMatch === true && fetched.sha256 === published.sha256,
      'the downloaded archive matches the published one byte for byte',
      { published: published.sha256, downloaded: fetched.sha256 }
    )
    assertThat(
      fetched.decoded?.packageId === published.packageId,
      'the archive decodes as a package',
      fetched.decoded
    )

    // Start a practice against the digest of what was actually downloaded.
    const grantFile = protocolFile('submission-grant.json')
    const claimed = await protocolResult('task-claim', [
      '--state',
      state.deviceState,
      '--exam-id',
      published.examId,
      '--archive-sha256',
      fetched.sha256,
      '--candidate-name',
      '验收考生',
      '--candidate-number',
      '0001',
      '--out',
      grantFile
    ])
    assertThat(claimed.grantState === 'granted', 'the practice grant was issued', claimed)

    // A large archive, then the receipt.
    const submissionFile = protocolFile('answer.lssubmission')
    const uploaded = await protocolResult('submission-upload', [
      '--state',
      state.deviceState,
      '--grant',
      grantFile,
      '--submission-file',
      submissionFile,
      '--recording-bytes',
      String(3 * 1024 * 1024),
      '--out',
      protocolFile('upload.json')
    ])
    assertThat(uploaded.status === 201, 'the submission archive was received', uploaded)
    assertThat(
      uploaded.receiptState === 'received',
      'the first upload produced a receipt',
      uploaded
    )
    assertThat(
      uploaded.digestsMatch === true && uploaded.archiveSha256 === uploaded.transportSha256,
      'the archive digest agrees on both sides of the transfer',
      uploaded
    )

    // The same bytes again, on a connection the first upload never used. The service answers from the
    // digest header, and it now reads the archive before answering, so the client always receives the
    // original receipt instead of losing it to a reset connection.
    let reupload = null
    for (let attempt = 0; attempt < 3 && !reupload; attempt += 1) {
      const again = await protocolResult('submission-upload', [
        '--state',
        state.deviceState,
        '--grant',
        grantFile,
        '--submission-file',
        submissionFile,
        '--out',
        protocolFile(`upload-again-${attempt}.json`)
      ])
      assertThat(again.status === 200, 'the identical re-upload is answered', again)
      assertThat(
        JSON.stringify(again.uploadReceipt) === JSON.stringify(uploaded.uploadReceipt),
        'the identical re-upload returns the original receipt',
        { first: uploaded.uploadReceipt, again: again.uploadReceipt }
      )
      reupload = again
    }

    // The record is what matters most: one submission, one digest, the original receipt.
    const receipt = await protocolResult('submission-receipt', [
      '--state',
      state.deviceState,
      '--submission-id',
      claimed.submissionId
    ])
    assertThat(receipt.status === 200, 'the receipt can be read after the re-upload', receipt)
    assertThat(
      JSON.stringify(receipt.receipt) === JSON.stringify(uploaded.receipt),
      'the submission still carries the original receipt',
      { original: uploaded.receipt, now: receipt.receipt }
    )

    // The teacher downloads the same archive and the digest is recomputed independently here.
    const downloadFile = protocolFile('teacher-download.lssubmission')
    const downloaded = await protocolResult('submission-download', [
      ...teacherCredentialArguments(),
      '--submission-id',
      claimed.submissionId,
      '--out',
      downloadFile
    ])
    assertThat(downloaded.status === 200, 'the teacher can download the submission', downloaded)
    assertThat(
      downloaded.sha256 === uploaded.archiveSha256,
      'the archive the teacher gets is the archive the student sent',
      { uploaded: uploaded.archiveSha256, downloaded: downloaded.sha256 }
    )
    assertThat(
      downloaded.decoded?.submissionId === claimed.submissionId,
      'the archive decodes as the submission it claims to be',
      downloaded.decoded
    )

    // Deleting it must not erase the record of it.
    const deleted = await protocolResult('submission-delete', [
      ...teacherCredentialArguments(),
      '--submission-id',
      claimed.submissionId
    ])
    assertThat(
      deleted.status === 204 || deleted.status === 200,
      'the submission was deleted',
      deleted
    )
    const afterDelete = await protocolResult('submission-receipt', [
      '--state',
      state.deviceState,
      '--submission-id',
      claimed.submissionId
    ])
    assertThat(afterDelete.status === 200, 'the receipt survives the deletion', afterDelete)
    assertThat(
      JSON.stringify(afterDelete.receipt) === JSON.stringify(uploaded.receipt),
      'the surviving receipt is the original one',
      { original: uploaded.receipt, now: afterDelete.receipt }
    )

    state.exam = {
      examId: published.examId,
      packageId: published.packageId,
      sha256: published.sha256
    }
    return {
      examId: published.examId,
      examBytes: published.bytes,
      examSha256: published.sha256,
      submissionId: claimed.submissionId,
      archiveBytes: uploaded.archiveBytes,
      archiveSha256: uploaded.archiveSha256,
      reupload: { status: reupload.status, connectionId: reupload.connectionId },
      receiptAfterDelete: afterDelete.receiptState
    }
  })
}

// --- N10: a lease, not a device, is what keeps the service in maintenance ------------------------
async function stepLeaseMaintenanceExit() {
  return run.step('lease-maintenance-exit', async () => {
    const deviceId = state.deviceId
    assertThat(typeof deviceId === 'string', 'the registered device id is known', deviceId)
    // A deployment test run only exists in maintenance, and the task it hands out is where the lease
    // comes from.
    const entered = await protocolResult('mode', [
      ...teacherCredentialArguments(),
      '--set',
      'maintenance'
    ])
    assertThat(entered.mode === 'maintenance', 'the service is in maintenance', entered)
    const created = await protocolResult('test-run', [
      ...teacherCredentialArguments(),
      '--device-id',
      deviceId,
      '--expires-seconds',
      '900'
    ])
    assertThat(created.status === 201, 'the deployment test run was created', created)
    const taskId = created.devices?.[0]?.taskId
    assertThat(typeof taskId === 'string', 'the run handed the device a task', created)

    const leaseFile = protocolFile('task-lease.json')
    const claim = await protocolResult('task-lease', [
      '--state',
      state.deviceState,
      '--task-id',
      taskId,
      '--lease-file',
      leaseFile
    ])
    assertThat(claim.leaseState === 'granted', 'the device holds the task lease', claim)

    // The device stops answering. Past the offline threshold the service can no longer ask it anything,
    // so the lease deadline is the only thing left that can bound the wait.
    run.log('waiting 22 s for the device to be considered offline')
    await sleep(22000)
    const cancelled = await protocolResult('test-run', [
      ...teacherCredentialArguments(),
      '--cancel',
      created.runId
    ])
    assertThat(
      cancelled.status === 204 || cancelled.status === 200,
      'the teacher cancelled the test run',
      cancelled
    )

    const blocked = await protocolResult('maintenance-exit', [
      ...teacherCredentialArguments(),
      '--attempts',
      '2',
      '--interval-ms',
      '500'
    ])
    const attempts = asArray(blocked.attempts)
    assertThat(attempts.length >= 1, 'the exit was attempted', blocked)
    for (const attempt of attempts) {
      assertThat(
        attempt.status === 409 && attempt.code === 'RESOURCE_BUSY',
        'leaving maintenance is refused while the offline device still holds a lease',
        attempt
      )
    }
    // The blocker has to name the resource, or an operator cannot tell what is holding the service.
    const kinds = attempts.flatMap((attempt) =>
      asArray(attempt.blockers).map((blocker) => blocker.kind)
    )
    assertThat(
      kinds.includes('active-task-lease'),
      'the refusal names the task lease as the blocking resource',
      { kinds, blockers: attempts[0]?.blockers }
    )

    // The lease is 30 s; nothing can shorten it, which is the whole point of the case.
    run.log('waiting 32 s for the task lease to expire')
    await sleep(32000)
    const exited = await protocolResult('maintenance-exit', [
      ...teacherCredentialArguments(),
      '--attempts',
      '5',
      '--interval-ms',
      '2000'
    ])
    assertThat(
      exited.final?.status === 200 && exited.final?.mode === 'normal',
      'the exit succeeds once the lease has expired',
      exited
    )
    return {
      runId: created.runId,
      taskId,
      leaseId: claim.lease?.leaseId ?? null,
      blockedKinds: kinds,
      blockedStatuses: attempts.map((attempt) => attempt.status),
      exitStatus: exited.final.status
    }
  })
}

// --- M4 helpers: the machine's own view of what is installed, and the three operations -------------
//
// Every one of these reports the product's answer rather than a reimplementation of it: the record is
// read from the file the installer writes, the service is asked through the same probe the earlier
// steps use, and the upgrade runs the packaged `manager.cjs` exactly as `install-windows.ps1` does.

function readInstallationRecord() {
  assertThat(existsSync(recordPath), 'the service installation record exists', recordPath)
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  assertThat(
    typeof record.release === 'string' && /^[0-9A-Za-z.+-]+$/.test(record.release),
    'the installation record names a release',
    record
  )
  return record
}

function writeInstallationRecord(record) {
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
}

// The service's own status, through the packaged runtime. `autostart` is part of the answer, which is
// what makes "the setting did not change" checkable without a second query.
async function helperStatus() {
  const result = await manageOperation('status')
  assertThat(result.ok === true, 'the manager helper read the service status', result)
  const value = result.value
  assertThat(value !== null && typeof value === 'object', 'the helper returned a status object', value)
  return value
}

async function manageOperation(operation, { allowFailure = false, raw = false } = {}) {
  const resultFile = join(workDir, `ls101-manage-${operation}-${process.pid}.json`)
  try {
    const args = [
      'manage',
      '--manager',
      state.manager,
      '--runtime',
      state.runtime,
      '--operation',
      operation,
      // `uninstall`, `status` and `start`/`stop` take no input, and the control channel distinguishes
      // "no input" from `{}`.
      '--input-none',
      '--result',
      resultFile,
      '--timeout-ms',
      '900000'
    ]
    if (raw) args.push('--raw')
    const outcome = raw ? await rawDriver(args) : await driver(args, { allowFailure })
    const parsed = raw
      ? outcome.parsed
      : existsSync(resultFile)
        ? JSON.parse(readFileSync(resultFile, 'utf8'))
        : undefined
    assertThat(
      parsed !== undefined && typeof parsed.ok === 'boolean',
      `the ${operation} helper returned a result`,
      { exitCode: outcome.code, stdout: outcome.stdout, stderr: outcome.stderr }
    )
    return parsed
  } finally {
    rmSync(resultFile, { force: true })
  }
}

// What the installer will decide when it starts: whether the release it carries is the one already
// installed (same manifest digest) and which application directory it will replace.
//
// The directory is passed in rather than discovered here. `findApplicationDirectory()` reads the
// uninstall registry entry, and the refused-install case runs the installer — which rewrites that entry
// before its custom install step aborts. Re-discovering the directory after a refused install would
// therefore measure the installer's leftovers instead of the release it was asked about.
async function reinstallTargets(label, applicationDirectory = state.applicationDirectory) {
  assertThat(
    typeof applicationDirectory === 'string' &&
      applicationDirectory.length > 0 &&
      existsSync(applicationDirectory),
    `the installed application directory was found for the ${label}`,
    applicationDirectory
  )
  const manifestPath = join(
    applicationDirectory,
    'resources',
    'lab-server',
    'runtime-manifest.json'
  )
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assertThat(
    manifest.format === 'ls101-service-runtime',
    'the installed application ships the service runtime',
    manifest
  )
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
  return {
    applicationDirectory,
    release: manifest.releaseVersion,
    sameRuntime:
      digest(manifestPath) === digest(join(state.runtime, 'runtime-manifest.json')),
    installBytes: statSync(config.installer).size
  }
}

async function waitForServiceState(expected, attempts = 120) {
  let service
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    service = await probe('service', ['-Name', config.serviceName])
    if (service.state === expected) return service
    await sleep(500)
  }
  return service
}

async function waitForRuntimeStatus(attempts = 120) {
  let seen
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await runProcess(
      state.runtimeNode,
      [state.server, 'status', '--data-dir', config.dataDir],
      { timeoutMs: 30000 }
    )
    if (result.code === 0) {
      try {
        const parsed = extractJsonPayload(result.stdout)
        if (parsed.state === 'running') return parsed
        seen = parsed
      } catch {
        // A partial line during start-up is expected; the next poll reads a complete one.
      }
    }
    await sleep(500)
  }
  throw new Error(
    `the service did not report running within the wait: ${JSON.stringify(seen ?? null)}`
  )
}

// The client's own uninstaller, taken from the registry entry the installer wrote rather than guessed:
// the executable name carries the product name and the install directory is named after the app.
async function uninstallerPath() {
  const entries = asArray((await probe('uninstall-entry', ['-Match', 'LS101'])).entries)
  const entry = entries.find((candidate) => candidate.installLocation)
  assertThat(entry !== undefined, 'the client has an uninstall registry entry', entries)
  const quiet = typeof entry.quietUninstallString === 'string' ? entry.quietUninstallString : ''
  const fallback = join(String(entry.installLocation), 'Uninstall LS101 Lab Teacher.exe')
  const command = quiet || `"${fallback}"`
  const quoted = command.match(/"([^"]+)"/)
  return quoted ? quoted[1] : command.split(' ')[0]
}

// =================================================================================================
// Milestone M4: upgrade, client uninstall, service uninstall and data retention (Tier 4)
// =================================================================================================
// The cases share one machine state and have to run in this order, because each one leaves behind
// something the next one asserts: the same-version reinstall proves no preparation is needed, the
// version change proves the preparation is required, the prepared case performs the upgrade, the client
// uninstall removes the application but not the service, and the service uninstall removes the
// registration while the business data survives (with removal while running refused first).
//
// Two facts decide whether an upgrade-preparation record is required at all, and both are read from the
// installed machine rather than assumed:
//   * `install-windows.ps1` compares the release it is replacing with the one it carries by manifest
//     digest. Identical digests mean "same runtime", which is why U1 needs no preparation.
//   * Everything else with existing business data needs `upgrade-ready.json` with a matching
//     `targetVersion` and a `preparedAt` inside 24 hours.

// Records what the later steps compare against: the release the client was installed from, the service
// identity and autostart state, and the raw SCM view. Taking this before anything destructive runs is
// what keeps a failure diagnosable.
async function stepUpgradeInitialState() {
  return run.step('upgrade-initial-state', async () => {
    const record = readInstallationRecord()
    state.installedRelease = record.release
    const applicationDirectory = await findApplicationDirectory()
    assertThat(
      typeof applicationDirectory === 'string' && existsSync(applicationDirectory),
      'the installed teacher application was found before the upgrade cases',
      applicationDirectory
    )
    state.applicationDirectory = applicationDirectory
    const service = await probe('service', ['-Name', config.serviceName])
    assertThat(service.installed === true, 'the service is registered before the upgrade cases', service)
    assertThat(service.state === 'Running', 'the service is running before the upgrade cases', service)
    const status = await helperStatus()
    assertThat(status.state === 'running', 'the control channel reports a running service', status)
    const exam = state.exam
    assertThat(typeof exam?.examId === 'string', 'a published exam is available for retention checks', exam)

    // The upgrade record itself is inspected: its `release` is what the installer compares against, and
    // recording the digest of the runtime manifest is how the version-change step can prove the
    // manifests differ without repeating the comparison by hand.
    const manifest = join(state.runtime, 'runtime-manifest.json')
    assertThat(existsSync(manifest), 'the installed release ships a runtime manifest', manifest)
    const manifestDigest = createHash('sha256').update(readFileSync(manifest)).digest('hex')
    assertThat(
      record.release === `${config.releaseVersion}-${manifestDigest.slice(0, 16)}`,
      'the installation record names the release this run built',
      { recorded: record.release, expectedPrefix: config.releaseVersion, manifestDigest }
    )
    return {
      applicationDirectory,
      release: record.release,
      serverId: status.info?.serverId ?? null,
      fingerprint: status.fingerprint ?? null,
      autostart: status.autostart,
      examId: exam.examId,
      examSha256: exam.sha256,
      manifestDigest
    }
  })
}

// --- U1: installing the same release again needs no upgrade preparation ---------------------------
async function stepReinstallSameVersion() {
  return run.step('upgrade-same-version-reinstall', async () => {
    // Same-version reinstall is the case where the installer's own digest comparison has to be the
    // reason no preparation is required. A preparation record would make the case pass for the wrong
    // reason, so its absence is asserted rather than tolerated.
    assertThat(
      !existsSync(upgradeReadyFile),
      'no upgrade preparation record exists before the same-version reinstall',
      upgradeReadyFile
    )
    const before = readInstallationRecord()
    const autostartBefore = (await helperStatus()).autostart
    const targets = await reinstallTargets('same-version reinstall')
    assertThat(
      targets.sameRuntime === true,
      'the release being installed has the same runtime manifest digest as the installed one',
      targets
    )
    assertThat(
      targets.applicationDirectory === state.applicationDirectory,
      'the reinstall targets the directory the client is installed in',
      { before: state.applicationDirectory, now: targets.applicationDirectory }
    )

    // The NSIS installer is what runs here, and the service is left running on purpose: this is also
    // the case that observes the silent-install path docs/lab-vm-acceptance-design.md section 11 keeps
    // open, where `teacher.nsh` reaches a MessageBox and Abort if the service install fails.
    const { result, seconds } = await runInstaller(config.installer, ['/S'])
    assertThat(
      result.code === 0 && !result.timedOut,
      'the same-version silent reinstall returned 0 without hanging',
      { seconds, ...result }
    )
    assertThat(!existsSync(upgradeReadyFile), 'the same-version reinstall wrote no preparation record')

    const record = readInstallationRecord()
    assertThat(
      record.release === before.release,
      'the installation record still names the same release',
      { before: before.release, after: record.release }
    )
    const service = await probe('service', ['-Name', config.serviceName])
    assertThat(
      service.installed === true && service.state === 'Running',
      'the service survived the same-version reinstall',
      service
    )
    // The service was never stopped, so this is also evidence about the silently-successful half of a
    // silent install: the installer did not leave the machine with the service down.
    const status = await helperStatus()
    assertThat(status.state === 'running', 'the service is running after the reinstall', status)
    assertThat(
      status.info?.serverId === state.serverId,
      'the reinstall kept the service identity',
      { before: state.serverId, after: status.info?.serverId }
    )
    assertThat(
      status.autostart === autostartBefore,
      'the reinstall left the autostart setting alone',
      { before: autostartBefore, after: status.autostart }
    )
    // Business data: an exam published before the reinstall is fetched again and the digest recomputed
    // from the bytes, so "retained" is a statement about content rather than about a file existing.
    const fetched = await protocolResult('exam-fetch', [
      '--state',
      state.deviceState,
      '--exam-id',
      state.exam.examId,
      '--out',
      protocolFile('post-reinstall-exam.lsexam')
    ])
    assertThat(fetched.status === 200, 'the published exam is still downloadable', fetched)
    assertThat(
      fetched.sha256 === state.exam.sha256,
      'the exam digest is unchanged after the same-version reinstall',
      { before: state.exam.sha256, after: fetched.sha256 }
    )
    return {
      seconds,
      release: record.release,
      serverId: status.info?.serverId ?? null,
      autostart: status.autostart,
      examSha256: fetched.sha256
    }
  })
}

// --- U2 part one: a version change with an expired preparation must not install -------------------
async function stepUpgradeWithoutPreparation() {
  return run.step('upgrade-without-preparation', async () => {
    const service = await probe('service', ['-Name', config.serviceName])
    assertThat(service.state === 'Running', 'the service runs before the refused install', service)

    // A different release is read into the installation record. The directory the digest names is real
    // and holds a real runtime, so what the installer replaces is a genuine installation of another
    // release — not a record pointing at nothing.
    //
    // The alternate version deliberately avoids the hyphen: `install-windows.ps1` validates the
    // installed release with `^[0-9A-Za-z.+-]+$` (a range, so no literal hyphen), and a version this
    // machine could not have been installed with is exactly what this case needs.
    const previous = readInstallationRecord()
    const olderManifest = join(state.runtime, 'runtime-manifest.json')
    const olderBytes = readFileSync(olderManifest)
    const olderDigest = createHash('sha256').update(olderBytes).digest('hex')
    const olderRelease = `0.4.0.${olderDigest.slice(0, 12)}`
    const olderDirectory = join(config.programDir, 'releases', olderRelease)
    const copied = await native('cmd.exe', [
      '/c',
      'robocopy',
      state.runtime,
      olderDirectory,
      '/E',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP'
    ])
    assertThat(
      copied.code === 0 || copied.code === 1,
      'the alternate release directory was copied',
      copied
    )
    writeFileSync(join(olderDirectory, 'runtime-manifest.json'), olderBytes)
    writeInstallationRecord({ release: olderRelease })
    try {
      const fake = readInstallationRecord()
      assertThat(
        fake.release === olderRelease,
        'the installation record now names the alternate release',
        fake
      )
      const targets = await reinstallTargets('refused version change')
      assertThat(
        targets.sameRuntime === false,
        'the installer sees a different runtime from the installed one',
        targets
      )
      // The durable preparation is what the guard reads, and it has two failure shapes: absent, and
      // present but naming a different target. Both are exercised, because they are different mistakes
      // an operator can make — "I never prepared this upgrade" and "I prepared the last one".
      assertThat(
        !existsSync(upgradeReadyFile),
        'the refused install starts with no preparation record at all',
        upgradeReadyFile
      )
      const active = await helperStatus()
      assertThat(active.state === 'running', 'the service still runs before the install attempt', active)
      const missingPreparation = await runInstaller(config.installer, ['/S'])
      assertThat(
        missingPreparation.result.code !== 0 && !missingPreparation.result.timedOut,
        'an install with no preparation record is refused instead of succeeding or hanging',
        missingPreparation
      )
      // That attempt ran the product's own preparation, so a record now exists — for the release
      // already installed. The second attempt is the case where a preparation exists and names the
      // wrong target; it is also the state a previous failed upgrade leaves behind.
      assertThat(
        existsSync(upgradeReadyFile),
        'the attempted install produced the preparation the version change needs',
        JSON.parse(readFileSync(upgradeReadyFile, 'utf8'))
      )
      const prepared = JSON.parse(readFileSync(upgradeReadyFile, 'utf8'))
      assertThat(
        prepared.targetVersion !== targets.release,
        'the preparation names the release already installed, not the one being installed',
        { prepared: prepared.targetVersion, installing: targets.release }
      )
      // The refusal has to be attributable, and an installer that silently skipped its service step
      // would satisfy every "nothing changed" assertion below for the wrong reason. Every successful
      // install replaces the record through `[IO.File]::Replace`, which writes `installation.json.previous`
      // — and that runs five stages *after* the preparation guard, so a fresh write proves the run under
      // test reached that point. The marker is compared by content rather than deleted, because an
      // earlier install leaves its own copy behind.
      const rejectionFile = join(config.programDir, 'installation.json.previous')
      const markerBefore = existsSync(rejectionFile)
        ? `${statSync(rejectionFile).mtimeMs}:${statSync(rejectionFile).size}`
        : 'absent'
      const rejection = await runInstaller(config.installer, ['/S'])
      assertThat(
        rejection.result.code !== 0 && !rejection.result.timedOut,
        'an install whose preparation names another release is refused',
        rejection
      )
      const markerAfter = existsSync(rejectionFile)
        ? `${statSync(rejectionFile).mtimeMs}:${statSync(rejectionFile).size}`
        : 'absent'
      assertThat(
        markerAfter !== markerBefore && markerAfter !== 'absent',
        'the refused install reached the service installation stage before it refused',
        { rejectionFile, markerBefore, markerAfter }
      )

      // The old installation has to be intact: the program record is unchanged, the runtime that the
      // service actually loaded is the one this run installed, and the control channel still answers.
      const record = readInstallationRecord()
      assertThat(
        record.release === olderRelease,
        'a refused install did not replace the installation record',
        record
      )
      const serviceAfter = await probe('service', ['-Name', config.serviceName])
      assertThat(
        serviceAfter.installed === true && serviceAfter.state === 'Running',
        'the old service kept running through the refused install',
        serviceAfter
      )
      const status = await helperStatus()
      assertThat(status.state === 'running', 'the control channel still reports running', status)
      assertThat(
        status.info?.serverId === state.serverId,
        'the refused install did not touch the service identity',
        { before: state.serverId, after: status.info?.serverId }
      )
      return {
        refusedInstallSeconds: missingPreparation.seconds,
        refusedWrongPreparationSeconds: rejection.seconds,
        installRecord: record.release,
        alternateRelease: olderRelease,
        preparation: prepared.targetVersion,
        serviceState: serviceAfter.state,
        serverId: status.info?.serverId ?? null
      }
    } finally {
      // Whichever way the step ended, the machine is put back: the preparation record it wrote, the
      // record it changed and the replacement marker all have to be gone before the next case measures
      // anything.
      rmSync(upgradeReadyFile, { force: true })
      rmSync(join(config.programDir, 'installation.json.previous'), { force: true })
      writeInstallationRecord({ release: previous.release })
    }
  })
}

// --- U2 part two: the real upgrade, through the product's own preparation and stop/start ----------
async function stepPreparedUpgrade() {
  return run.step('upgrade-prepared', async () => {
    // The refusal outside maintenance is asserted in the container lane
    // (tests/lab-vm/protocol/backup.test.ts) where the mode can be set without a restart; what this
    // step has to establish is the opposite state: maintenance, plus the durable precondition a real
    // upgrade needs. Both are created here rather than assumed, because without them the only thing
    // this case could prove is that the refusal works.
    //
    // A real password, too: the service encrypts the archive with it and `prepare-upgrade` verifies the
    // published bytes against the recorded digest before it will write the preparation record.
    writeFileSync(backupPasswordFile, `Aa1!${randomBytes(24).toString('base64url')}`)
    const entered = await protocolResult('mode', [
      ...teacherCredentialArguments(),
      '--set',
      'maintenance'
    ])
    assertThat(
      entered.status === 200 && entered.mode === 'maintenance',
      'the service is in maintenance for the upgrade',
      entered
    )
    const backup = await protocolResult('backup', [
      ...teacherCredentialArguments(),
      '--backup-password-file',
      backupPasswordFile
    ])
    assertThat(backup.status === 202, 'the service accepted the backup', backup)
    assertThat(backup.backupStatus === 'ready', 'the backup reached ready before the upgrade', backup)
    assertThat(backup.readable === true, 'the backup has the three fields an upgrade requires', backup)
    assertThat(
      Number(backup.archiveBytes) > 0 && /^[0-9a-f]{64}$/.test(String(backup.archiveSha256)),
      'the published backup names its bytes and digest',
      backup
    )

    // The upgrade is performed by running the installer directly, which is what the acceptance
    // checklist asks for ("run the new teacher NSIS installer without first running the new unpacked
    // directory"): `teacher.nsh`'s customInstall calls the service installer from the package's own
    // resources, that script asks the *installed* service to prepare and stop itself (which writes the
    // preparation record this step's backup made possible), and only then replaces the program
    // directory. The service therefore stops at the installer's hand, not at this script's.
    assertThat(
      !existsSync(upgradeReadyFile),
      'nothing is prepared before the installer is asked to upgrade',
      upgradeReadyFile
    )
    const before = readInstallationRecord()
    const { result, seconds } = await runInstaller(config.installer, ['/S'])
    assertThat(result.code === 0 && !result.timedOut, 'the product upgrade completed', {
      seconds,
      ...result
    })

    // The service the installer replaced came back up as the release this run built.
    const record = readInstallationRecord()
    assertThat(
      record.release !== before.release,
      'the installation record now names the upgraded release',
      { before: before.release, after: record.release }
    )
    assertThat(
      record.release.startsWith(`${config.releaseVersion}-`),
      `the upgraded release is ${config.releaseVersion}`,
      record
    )
    assertThat(
      !existsSync(upgradeReadyFile),
      'the upgraded runtime consumed the preparation record',
      upgradeReadyFile
    )
    const status = await waitForRuntimeStatus()
    assertThat(
      status.info?.serverId === state.serverId,
      'the upgrade kept the service identity',
      { before: state.serverId, after: status.info?.serverId }
    )
    assertThat(
      status.fingerprint === state.fingerprint,
      'the upgrade kept the service certificate',
      { before: state.fingerprint, after: status.fingerprint }
    )
    const fetched = await protocolResult('exam-fetch', [
      '--state',
      state.deviceState,
      '--exam-id',
      state.exam.examId,
      '--out',
      protocolFile('post-upgrade-exam.lsexam')
    ])
    assertThat(fetched.status === 200, 'the exam is downloadable after the upgrade', fetched)
    assertThat(
      fetched.sha256 === state.exam.sha256,
      'the upgrade kept the published exam byte for byte',
      { before: state.exam.sha256, after: fetched.sha256 }
    )
    // A receipt is durable business data in a different table from the exam: the submission the earlier
    // milestone deleted still has to answer with its receipt after the runtime was replaced.
    const receipt = await protocolResult('submission-receipt', [
      '--state',
      state.deviceState,
      '--submission-id',
      state.practice?.submissionId ?? ''
    ])
    assertThat(receipt.status === 200, 'the submission record survived the upgrade', receipt)
    assertThat(
      /^(deleted|received)$/.test(String(receipt.receiptState)),
      'the surviving receipt still reports a terminal state',
      receipt
    )
    return {
      seconds,
      backup: {
        id: backup.id,
        snapshotAt: backup.snapshotAt,
        bytes: backup.archiveBytes,
        waitingMs: backup.waitingMs
      },
      release: record.release,
      serverId: status.info?.serverId ?? null,
      examSha256: fetched.sha256,
      receiptState: receipt.receiptState
    }
  })
}

// --- U3: uninstalling the client leaves the service and the business data alone --------------------
async function stepClientUninstall() {
  return run.step('client-uninstall-keeps-service', async () => {
    const before = readInstallationRecord()
    const autostartBefore = (await helperStatus()).autostart
    const applicationDirectory = state.applicationDirectory
    const uninstaller = await uninstallerPath()
    assertThat(
      existsSync(join(applicationDirectory, 'ls101-lab-teacher.exe')),
      'the installed client is present before the uninstall',
      applicationDirectory
    )

    // `teacher.nsh` declares no customUnInstall, so the NSIS uninstaller removes the application and
    // nothing else. The service registration, the program directory and the business data are the
    // three things that must survive it.
    const { result, seconds } = await runInstaller(uninstaller, ['/S'])
    assertThat(
      result.code === 0 && !result.timedOut,
      'the silent client uninstall returned 0 without hanging',
      { seconds, ...result }
    )
    assertThat(
      !existsSync(join(applicationDirectory, 'ls101-lab-teacher.exe')),
      'the uninstall removed the installed client executable',
      applicationDirectory
    )
    const service = await probe('service', ['-Name', config.serviceName])
    assertThat(
      service.installed === true && service.state === 'Running',
      'the client uninstall left the service registered and running',
      service
    )
    assertThat(
      existsSync(recordPath),
      'the client uninstall left the service installation record',
      recordPath
    )
    const record = readInstallationRecord()
    assertThat(
      record.release === before.release,
      'the service installation record is unchanged',
      { before: before.release, after: record.release }
    )
    const status = await helperStatus()
    assertThat(
      status.state === 'running' && status.info?.serverId === state.serverId,
      'the service is the same service after the client was uninstalled',
      status
    )
    assertThat(
      status.autostart === autostartBefore,
      'the client uninstall left the autostart setting alone',
      { before: autostartBefore, after: status.autostart }
    )
    const fetched = await protocolResult('exam-fetch', [
      '--state',
      state.deviceState,
      '--exam-id',
      state.exam.examId,
      '--out',
      protocolFile('post-uninstall-exam.lsexam')
    ])
    assertThat(
      fetched.status === 200 && fetched.sha256 === state.exam.sha256,
      'the business data is intact after the client uninstall',
      { before: state.exam.sha256, after: fetched.sha256 }
    )
    return {
      seconds,
      uninstaller,
      serviceState: service.state,
      release: record.release,
      examSha256: fetched.sha256
    }
  })
}

// --- U4: the service can only be uninstalled stopped, and a reinstall keeps the data --------------
async function stepServiceUninstallAndReinstall() {
  return run.step('service-uninstall-and-reinstall', async () => {
    // Turn autostart on first. The acceptance checklist asks for the *setting* to survive, and a
    // default of "off" would make "unchanged" indistinguishable from "reset".
    const enabled = await native('sc.exe', ['config', config.serviceName, 'start=', 'auto'])
    assertThat(enabled.code === 0, 'autostart was enabled for the retention case', enabled)
    const configured = await probe('service', ['-Name', config.serviceName])
    assertThat(configured.startMode === 'Auto', 'the service reports automatic start', configured)

    // Running: removal has to be refused. The refusal code is read from the helper result because the
    // guest-level API contract is "a code", not "an exit status".
    const refused = await manageOperation('uninstall', { allowFailure: true, raw: true })
    assertThat(
      refused.ok === false && refused.error === 'RESOURCE_BUSY',
      'uninstalling a running service is refused with RESOURCE_BUSY',
      refused
    )
    const stillThere = await probe('service', ['-Name', config.serviceName])
    assertThat(
      stillThere.installed === true && stillThere.state === 'Running',
      'the refused uninstall left the service running',
      stillThere
    )

    const stopped = await native('sc.exe', ['stop', config.serviceName])
    assertThat(stopped.code === 0, 'the SCM accepted the stop request', stopped)
    const afterStop = await waitForServiceState('Stopped')
    assertThat(afterStop.state === 'Stopped', 'the service stopped before removal', afterStop)

    const removed = await manageOperation('uninstall')
    assertThat(removed.ok === true, 'the service uninstall succeeded', removed)
    const gone = await probe('service', ['-Name', config.serviceName])
    assertThat(gone.installed !== true, 'the service is no longer registered', gone)
    assertThat(
      existsSync(recordPath) && existsSync(state.runtime),
      'the service uninstall kept the program directory and its record',
      { recordPath, runtime: state.runtime }
    )
    const data = await probe('path', ['-Path', config.dataDir])
    assertThat(data.exists === true, 'the service uninstall kept the business data', data)

    // Reinstall from the same package. The installed program is still a genuine release for this data,
    // so no upgrade preparation is involved; the service is registered again and stays stopped.
    const reinstalled = await runInstaller(config.installer, ['/S'])
    assertThat(
      reinstalled.result.code === 0 && !reinstalled.result.timedOut,
      'the reinstall returned 0 without hanging',
      reinstalled
    )
    const record = readInstallationRecord()
    assertThat(
      record.release.startsWith(`${config.releaseVersion}-`),
      'the reinstall published an installation record for this release',
      record
    )
    const registered = await probe('service', ['-Name', config.serviceName])
    assertThat(
      registered.installed === true && registered.state === 'Stopped',
      'the reinstall registered the service and left it stopped',
      registered
    )
    assertThat(
      registered.startMode === 'Manual',
      'the reinstall left autostart at its default, not the setting the uninstall removed',
      registered
    )

    // Start it again: the data has to be there, including the record of the submission the earlier
    // steps deleted, and the same service identity has to come back.
    const started = await native('sc.exe', ['start', config.serviceName])
    assertThat(started.code === 0, 'the SCM accepted the start request after the reinstall', started)
    const running = await waitForServiceState('Running')
    assertThat(running.state === 'Running', 'the reinstalled service started', running)
    const status = await waitForRuntimeStatus()
    assertThat(
      status.info?.serverId === state.serverId,
      'the reinstalled service kept the original identity',
      { before: state.serverId, after: status.info?.serverId }
    )
    const fetched = await protocolResult('exam-fetch', [
      '--state',
      state.deviceState,
      '--exam-id',
      state.exam.examId,
      '--out',
      protocolFile('post-reinstall-again-exam.lsexam')
    ])
    assertThat(
      fetched.status === 200 && fetched.sha256 === state.exam.sha256,
      'the business data survived the uninstall and reinstall',
      { before: state.exam.sha256, after: fetched.sha256 }
    )
    const receipt = await protocolResult('submission-receipt', [
      '--state',
      state.deviceState,
      '--submission-id',
      state.practice?.submissionId ?? ''
    ])
    assertThat(receipt.status === 200, 'the submission record survived the reinstall', receipt)

    // Leave the machine as the checklist expects to find it: installed, running, autostart off.
    const disabled = await native('sc.exe', ['config', config.serviceName, 'start=', 'demand'])
    assertThat(disabled.code === 0, 'autostart was returned to demand start', disabled)
    const final = await probe('service', ['-Name', config.serviceName])
    assertThat(
      final.startMode === 'Manual',
      'the machine is left with autostart disabled',
      final
    )
    return {
      refusedCode: refused.error,
      reinstalledRelease: record.release,
      startedState: running.state,
      serverId: status.info?.serverId ?? null,
      examSha256: fetched.sha256,
      receiptState: receipt.receiptState,
      autostart: final.startMode
    }
  })
}

// --- M4 setup check: the student installer arrived and the client uninstaller is discoverable -----
async function stepUpgradePackages() {
  return run.step('upgrade-packages', async () => {
    assertThat(
      existsSync(config.studentInstaller),
      'the student installer was uploaded for this run',
      config.studentInstaller
    )
    assertThat(
      statSync(config.studentInstaller).size > 0,
      'the student installer is not empty',
      config.studentInstaller
    )
    const uninstaller = await uninstallerPath()
    assertThat(
      existsSync(uninstaller),
      'the installed client publishes a silent uninstaller',
      uninstaller
    )
    return {
      studentInstallerBytes: statSync(config.studentInstaller).size,
      uninstaller
    }
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
    await stepProtocolPin()
    await stepProtocolAuth()
    await stepProtocolIpv6()
    await stepEnrollmentBatch()
    await stepEnrollmentNegatives()
    await stepDeviceHeartbeat()
    await stepHeartbeatLoad()
    await stepExamAndSubmission()
    await stepServiceModeAdmission()
    await stepLeaseMaintenanceExit()
    await stepConcurrencyLimits()
    // Milestone M4. It runs last because it is the only group that stops, uninstalls and reinstalls the
    // product; every earlier case depends on the service being the one the install step produced.
    await stepUpgradePackages()
    await stepUpgradeInitialState()
    await stepReinstallSameVersion()
    await stepUpgradeWithoutPreparation()
    await stepPreparedUpgrade()
    await stepClientUninstall()
    await stepServiceUninstallAndReinstall()
    // The last leak pass. It runs after M4 because the archive password and the credentials the
    // protocol driver received only exist once those cases have run; the early pass at step 15 covers
    // what exists before them.
    await stepFinalSecretScan()
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
