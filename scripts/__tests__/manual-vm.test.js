/*
 * The manual-test machines (infra/windows-vm/manual.mjs) are host tooling: they need VMware and
 * Vagrant, so nothing here boots a VM. What is worth pinning is the part a mistake would only show up
 * as a wasted half hour on the host:
 *
 *   - boot never reuses a machine, in any state, and reset is the explicit way to replace one;
 *   - the installer is packaged before the VM is touched, so a build failure cannot cost an existing
 *     machine;
 *   - the two machines share the acceptance run's base box but nothing else — not state, not ports,
 *     not the VMware display name.
 */
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')
const labRoot = path.join(root, 'infra/windows-vm')
// A relative specifier on purpose: Windows refuses an absolute path in `import()` with
// ERR_UNSUPPORTED_ESM_URL_SCHEME ("Received protocol 'd:'"), while POSIX accepts it — the asymmetry that
// let this file pass in the container and fail on the host.
const manual = import('../../infra/windows-vm/manual.mjs')
const manualVagrantfile = path.join(labRoot, 'manual/Vagrantfile')
const acceptanceVagrantfile = path.join(labRoot, 'Vagrantfile')

test('the manual actions name a role and an action, and never the disposable machine', async () => {
  const { parseManualAction, manualActions } = await manual
  assert.deepEqual(parseManualAction([]), { action: 'help' })
  assert.deepEqual(parseManualAction(['--help']), { action: 'help' })
  assert.deepEqual(parseManualAction(['teacher:boot']), {
    role: 'teacher',
    action: 'boot',
    build: true
  })
  assert.deepEqual(parseManualAction(['student:reset', '--no-build']), {
    role: 'student',
    action: 'reset',
    build: false
  })
  assert.deepEqual(manualActions, ['boot', 'reset', 'delete', 'status'])
  // `default` is the disposable acceptance VM; reusing the name would bind the two together.
  for (const invalid of [
    ['default:boot'],
    ['teacher:up'],
    ['teacher'],
    ['teacher:boot', 'teacher'],
    ['teacher:boot', '--force'],
    [''],
    ['TEACHER:BOOT']
  ])
    assert.throws(
      () => parseManualAction(invalid),
      new RegExp('Manual-test machines'),
      invalid.join(' ')
    )
})

test('each machine has its own identity, ports and desktop entry', async () => {
  const { manualMachine } = await manual
  const teacher = manualMachine('teacher')
  const student = manualMachine('student')
  assert.equal(teacher.name, 'teacher')
  assert.equal(student.name, 'student')
  assert.notEqual(teacher.name, 'default')
  assert.equal(teacher.hostname, 'ls101-teacher')
  assert.equal(teacher.displayName, 'ls101-manual-teacher')
  assert.equal(student.displayName, 'ls101-manual-student')
  assert.equal(teacher.opensServicePort, true)
  // Only the machine that hosts the service needs the HTTPS port opened for the other one.
  assert.equal(student.opensServicePort, false)
  assert.notEqual(teacher.desktopShortcut, student.desktopShortcut)
  assert.throws(() => manualMachine('gateway'), /Unknown role/)
})

test('the per-role state directories are separate from the acceptance run and from each other', async () => {
  const { manualStateDirectory, manualEnvironment } = await manual
  const teacher = manualStateDirectory('/lab', 'teacher')
  const student = manualStateDirectory('/lab', 'student')
  assert.match(teacher, /vagrant-state-manual-teacher$/)
  assert.match(student, /vagrant-state-manual-student$/)
  assert.notEqual(teacher, student)
  assert.doesNotMatch(teacher, /vagrant-state$/)
  const env = manualEnvironment('/lab', 'teacher', { VAGRANT_HOME: '/lab/.local/vagrant-home' })
  // The box registration and the WinRM credentials come from the shared VAGRANT_HOME: one base image.
  assert.equal(env.VAGRANT_HOME, '/lab/.local/vagrant-home')
  assert.equal(env.LS101_MANUAL_ROLE, 'teacher')
  assert.match(env.VAGRANT_CWD, /manual$/)
  assert.match(env.VAGRANT_DOTFILE_PATH, /vagrant-state-manual-teacher$/)
})

test('the manual machines get their own memory, and the acceptance VM keeps the larger one', async () => {
  const { manualEnvironment, manualMemoryMB, MANUAL_MEMORY_MB } = await manual
  assert.equal(MANUAL_MEMORY_MB, 4096)
  // A manual machine is driven by hand; the acceptance figure is sized for 32 concurrent client
  // connections. Two manual machines plus the acceptance VM have to fit on one host, so the manual
  // environment must not inherit MemoryMB.
  assert.equal(manualMemoryMB({}), 4096)
  assert.equal(manualMemoryMB({ MemoryMB: 8192 }), 4096)
  assert.equal(manualMemoryMB({ ManualMemoryMB: 3072 }), 3072)
  // An explicit null is "not configured" as far as `??` is concerned; anything else invalid is refused
  // before the machine is touched.
  assert.equal(manualMemoryMB({ ManualMemoryMB: null }), 4096)
  for (const invalid of [0, 2047, 262145, 4096.5, '4096', true, NaN])
    assert.throws(() => manualMemoryMB({ ManualMemoryMB: invalid }), /Invalid ManualMemoryMB/)
  // `vagrant up` is a separate process, so the value can only reach the Vagrantfile as an environment
  // variable — and it has to be there even when nothing is configured.
  assert.equal(manualEnvironment('/lab', 'teacher', {}, 3072).LS101_MANUAL_MEMORY, '3072')
  assert.equal(manualEnvironment('/lab', 'student', {}).LS101_MANUAL_MEMORY, '4096')
  const [manualFile, acceptanceFile] = await Promise.all([
    readFile(manualVagrantfile, 'utf8'),
    readFile(acceptanceVagrantfile, 'utf8')
  ])
  assert.match(manualFile, /ENV\['LS101_MANUAL_MEMORY'\]/)
  assert.match(manualFile, /vmware\.vmx\['memsize'\] = manual_memory/)
  assert.doesNotMatch(manualFile, /memsize'\] = credentials\.fetch/)
  // The Vagrantfile's fallback is a second spelling of the default above, and the two have to agree.
  assert.match(manualFile, /'4096'/)
  assert.match(acceptanceFile, /vmware\.vmx\['memsize'\] = credentials\.fetch\('memory', 8192\)/)
})

test('machine state is read from the machine-readable status, and anything but not_created exists', async () => {
  const { machineState, machineExists } = await manual
  const line = (state) =>
    `1789000000,teacher,state,${state}\n1789000000,teacher,provider-name,vmware_desktop\n`
  assert.equal(machineState(line('not_created'), 'teacher'), 'not_created')
  assert.equal(machineExists(line('not_created'), 'teacher'), false)
  // A halted or saved machine still holds the previous installer and the previous Windows state, which
  // is why boot refuses it and reset destroys it.
  for (const state of ['running', 'poweroff', 'saved', 'aborted', 'paused', 'stopping'])
    assert.equal(machineExists(line(state), 'teacher'), true, state)
  assert.throws(() => machineState('', 'teacher'), /did not report a state/)
})

// A runner that answers `vagrant status` from a table and records everything it was asked to do.
function fakeHost(state, name = 'teacher') {
  const calls = []
  const steps = []
  const spawn = (command, args) => {
    calls.push([path.basename(command), ...args].join(' '))
    if (args.includes('status'))
      return {
        status: 0,
        stdout: `1789000000,${name},state,${state}\n1789000000,${name},provider-name,vmware_desktop\n`,
        stderr: ''
      }
    return { status: 0, stdout: '', stderr: '' }
  }
  return {
    calls,
    steps,
    spawn,
    // The same runner, wrapped the way `main` wraps it, so `withMachine` can be driven directly.
    run: (command, args, options) => {
      const result = spawn(command, args)
      if (result.status !== 0) throw new Error(`${command} failed`)
      return options?.capture ? result.stdout : ''
    },
    preflight: async () => steps.push('preflight'),
    package: async (role) => {
      steps.push(`package:${role}`)
      return { name: `${role}.exe`, file: `/dist/${role}.exe`, version: '0.0.0', bytes: 1 }
    }
  }
}

test('boot refuses an existing machine before it builds anything or touches the VM', async () => {
  const { withMachine } = await manual
  const host = fakeHost('running')
  await assert.rejects(
    withMachine('teacher', 'boot', {
      root: labRoot,
      run: host.run,
      build: true,
      config: { GuestPassword: 'Aa1!test-password' },
      preflight: host.preflight,
      package: host.package
    }),
    /already exists \(running\)/,
    'boot must refuse a machine that exists in any state'
  )
  // Not merely "did not destroy": boot must not even spend two minutes packaging, and must not boot.
  assert.deepEqual(host.steps, [], 'boot must not build or preflight a machine it refuses')
  for (const forbidden of ['destroy', 'up'])
    assert.equal(
      host.calls.some((call) => call.split(' ').includes(forbidden)),
      false,
      `boot must not run ${forbidden}: ${host.calls.join(' | ')}`
    )
  assert.match(
    host.calls.join(' | '),
    /status teacher --machine-readable/,
    'boot must ask about the machine before deciding'
  )
})

test('reset builds before it destroys, so a failed build cannot cost the machine', async () => {
  const { main } = await manual
  const { withMachine } = await manual
  const host = fakeHost('poweroff', 'student')
  const failure = new Error('packaging failed')
  await assert.rejects(
    withMachine('student', 'reset', {
      root: labRoot,
      run: host.run,
      build: true,
      config: { GuestPassword: 'Aa1!test-password' },
      preflight: async () => host.steps.push('preflight'),
      package: async () => {
        host.steps.push('package')
        throw failure
      }
    }),
    /packaging failed/
  )
  assert.deepEqual(host.steps, ['preflight', 'package'])
  assert.equal(
    host.calls.some((call) => call.split(' ').includes('destroy')),
    false,
    `reset must not destroy a machine before the build that replaces it: ${host.calls.join(' | ')}`
  )
})

test('reset does not require a machine to exist', async () => {
  const { main } = await manual
  const order = []
  const spawn = (command, args) => {
    order.push([path.basename(command), ...args].join(' '))
    if (args.includes('status'))
      return {
        status: 0,
        stdout:
          '1789000000,student,state,not_created\n1789000000,student,provider-name,vmware_desktop\n',
        stderr: ''
      }
    if (args.includes('up')) throw new Error('stopped after the first VM command')
    return { status: 0, stdout: '', stderr: '' }
  }
  await assert.rejects(
    main(['student:reset'], {
      root: labRoot,
      platform: 'win32',
      arch: 'x64',
      spawn,
      preflight: async () => order.push('preflight'),
      package: async () => {
        order.push('package')
        return { name: 'student.exe', file: '/dist/student.exe', version: '0', bytes: 1 }
      }
    }),
    /stopped after the first VM command/
  )
  // Nothing to remove, so reset must not ask Vagrant to destroy a machine that is not there: that call
  // is an error in Vagrant, and the action is documented as "destroy if it exists, then boot".
  assert.equal(
    order.some((call) => call.split(' ').includes('destroy')),
    false,
    `reset must tolerate a missing machine: ${order.join(' | ')}`
  )
  assert.ok(
    order.some((call) => call.split(' ').includes('up')),
    `reset must still create the machine: ${order.join(' | ')}`
  )
})

test('reset destroys the old machine and boots a fresh one', async () => {
  const { main } = await manual
  const host = fakeHost('poweroff')
  // `up` and the desktop-session helpers run for real here, so the run is stopped right after its first
  // VM command once the ordering has been observed.
  const order = []
  const spawn = (command, args) => {
    order.push([path.basename(command), ...args].join(' '))
    if (args.includes('status'))
      return {
        status: 0,
        stdout: '1789000000,student,state,poweroff\n1789000000,student,provider-name,v\n',
        stderr: ''
      }
    if (args.includes('up')) throw new Error('stopped after the first VM command')
    return { status: 0, stdout: '', stderr: '' }
  }
  await assert.rejects(
    main(['student:reset'], {
      root: labRoot,
      platform: 'win32',
      arch: 'x64',
      spawn,
      preflight: async () => order.push('preflight'),
      package: async () => {
        order.push('package')
        return { name: 'student.exe', file: '/dist/student.exe', version: '0', bytes: 1 }
      }
    }),
    /stopped after the first VM command/
  )
  const destroy = order.findIndex((call) => call.split(' ').includes('destroy'))
  const up = order.findIndex((call) => call.split(' ').includes('up'))
  assert.ok(
    destroy > order.indexOf('package'),
    `destroy must follow the build: ${order.join(' | ')}`
  )
  assert.ok(up > destroy, `up must follow destroy: ${order.join(' | ')}`)
})

test('the guest file server script is uploaded before the task that runs it', async () => {
  const source = await readFile(path.join(labRoot, 'manual.mjs'), 'utf8')
  // A scheduled task that points at a script the guest does not have starts, fails, and leaves the host
  // waiting for a port that never opens — which is what the first real boot of this code did.
  const upload = source.indexOf("path.join(labRoot, 'guest', 'fileserver.mjs')")
  const task = source.indexOf('guestCommand(filesServerTaskScript(config))')
  assert.ok(upload > 0, 'the file server script must be uploaded')
  assert.ok(task > 0, 'the file server task must be registered')
  assert.ok(upload < task, 'the script has to be in the guest before its task is registered')
  // A timeout from the host has to carry the guest-side reason with it.
  assert.match(source, /Get-ScheduledTaskInfo -TaskName 'ls101-files'/)
  assert.match(source, /fileserver\.log/)
})

test('both machines come from the acceptance base box, with nothing else shared', async () => {
  const [manualFile, acceptanceFile] = await Promise.all([
    readFile(manualVagrantfile, 'utf8'),
    readFile(acceptanceVagrantfile, 'utf8')
  ])
  const boxLine = (text) => text.split(/\r?\n/).find((line) => line.includes('config.vm.box ='))
  const boxUrl = (text) => text.split(/\r?\n/).find((line) => line.includes('config.vm.box_url ='))
  // Same image, built once: the manual machines may not introduce a second box.
  assert.equal(boxLine(manualFile), boxLine(acceptanceFile))
  assert.equal(boxUrl(manualFile), boxUrl(acceptanceFile))
  // The role is the machine name, and the machine has to be *defined* under it. Without
  // `config.vm.define` the environment's machine stays `default`, `vagrant status teacher` fails before
  // anything else can happen, and the manual machine would share the acceptance VM's identity — which is
  // the bug this test missed while it accepted `Vagrant.configure` as an alternative spelling.
  assert.match(manualFile, /ENV\['LS101_MANUAL_ROLE'\]/)
  assert.match(manualFile, /config\.vm\.define role do \|machine\|/)
  assert.match(manualFile, /machine\.vm\.hostname = "ls101-#\{role\}"/)
  assert.match(manualFile, /machine\.vm\.network 'forwarded_port'/)
  assert.match(manualFile, /machine\.vm\.provider 'vmware_desktop'/)
  assert.match(manualFile, /ls101-manual-#\{role\}/)
  assert.match(manualFile, /role == 'teacher' \? 55996 : 55997/)
  assert.match(manualFile, /vmware\.gui = true/)
  assert.match(
    manualFile,
    /abort 'Run through yarn vm:teacher:<action> or yarn vm:student:<action>\.'/
  )
  // Every VM setting belongs inside the define block; nothing may configure the implicit machine.
  assert.doesNotMatch(manualFile, /^\s{2}config\.vm\.hostname/)
  assert.doesNotMatch(manualFile, /config\.vm\.define 'default'/)
})

test('the guest login is printed for manual use and stays out of the host result file', async () => {
  const source = await readFile(path.join(labRoot, 'manual.mjs'), 'utf8')
  // These machines exist to be logged into by hand, so the credential has to be on screen. It must not
  // travel as a command argument: the runner records every argument and every decoded PowerShell script
  // in the host result file, which is exactly how a password ends up in an artefact.
  assert.match(source, /guest login\s*: vagrant \/ \$\{config\.GuestPassword\}/)
  assert.match(source, /console\.log\(`guest login: vagrant \/ \$\{config\.GuestPassword\}`\)/)
  // The automatic-logon script is written and uploaded as a file by the shared helper (whose WinRM
  // command carries only the path), so the password never appears in a recorded command line.
  assert.match(source, /await enableDesktopSession\(config, run\)/)
  assert.doesNotMatch(source, /guestCommand\([^)]*GuestPassword/)
})

test('a failing step fails the boot instead of being downgraded', async () => {
  const { desktopEntryScript, desktopEntryTaskScript } = await manual
  const source = await readFile(path.join(labRoot, 'manual.mjs'), 'utf8')
  // The desktop entry either works or the boot stops: an earlier version fell back to a .cmd launcher and
  // carried on, which produces a machine that looks prepared and is not.
  const script = desktopEntryScript('teacher', 'C:/ls101-lab/transfers/x.exe')
  assert.match(script, /New-Object -ComObject WScript\.Shell/)
  assert.match(script, /\$link\.Save\(\)/)
  // No third option: on failure it records the reason and rethrows.
  assert.match(script, /catch \{/)
  assert.match(script, /Set-Content -LiteralPath \$log/)
  assert.match(script, /throw/)
  assert.doesNotMatch(script, /@echo off/)
  // It runs in the console session, because a WinRM logon has no interactive profile and that is what the
  // first two real boots failed on.
  const task = desktopEntryTaskScript('teacher', 'C:/ls101-lab/transfers/x.exe')
  assert.match(task, /-LogonType Interactive/)
  assert.match(task, /Start-ScheduledTask -TaskName 'ls101-desktop-entry'/)
  assert.match(source, /await waitForDesktopEntry\(\{ run \}\)/)
  // No step of the manual boot may swallow its own failure. The only permitted catch blocks are the one
  // that collects guest diagnostics before rethrowing and the one that records the report, so every catch
  // body has to end in a throw or record the failure. Blocks are taken by matching braces: a regex that
  // stops at the first `}` cuts a nested try out of the body and misjudges the block.
  const blocks = []
  for (const match of source.matchAll(/catch \(error\) \{/g)) {
    let depth = 0
    let index = match.index + match[0].length - 1
    for (; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    blocks.push(source.slice(match.index, index + 1))
  }
  assert.ok(blocks.length >= 2, 'the file is expected to have a diagnostics and a report catch')
  for (const block of blocks)
    assert.ok(
      /throw error|report\.error =/.test(block),
      `a catch block swallows its failure:\n${block}`
    )
  // `console.warn` is how the earlier version carried on after a step it could not complete.
  assert.doesNotMatch(source, /console\.warn\(/)
})

test('every helper the module uses is declared, and every name it declares exists', async () => {
  const module = await manual
  const source = await readFile(path.join(labRoot, 'manual.mjs'), 'utf8')
  // The first real run of this file died with "manualPreflight is not defined": an edit removed the
  // helper while its call site stayed, and nothing in the suite noticed because the tests inject that
  // step. The two checks below are cheap and would have caught it.
  const declared = new Set(
    [...source.matchAll(/(?:export )?(?:async )?function ([A-Za-z_][A-Za-z0-9_]*)/g)].map(
      (m) => m[1]
    )
  )
  // The public surface, plus the internal steps that must exist even though nothing imports them.
  const exported = [
    'manualStateDirectory',
    'manualEnvironment',
    'manualMemoryMB',
    'parseManualAction',
    'manualMachine',
    'machineState',
    'machineExists',
    'desktopEntryScript',
    'desktopEntryTaskScript',
    'desktopEntryProbeScript',
    'manualPreflight',
    'withMachine',
    'main'
  ]
  const internal = ['startMachine', 'packageInstaller', 'waitForDesktopEntry']
  for (const name of [...exported, ...internal])
    assert.ok(declared.has(name), `${name} must be declared in manual.mjs`)
  for (const name of exported)
    assert.equal(typeof module[name], 'function', `${name} must be exported`)
  // "Calls a name that no longer exists" needs real scope analysis — parameters, destructuring and
  // multi-line imports all defeat a regex. The compiler that ships with the repository does it properly:
  // only TS2304/TS2552 ("cannot find name") are read, because the rest of the output is pre-existing
  // JSDoc-inference noise in lab.mjs and assets.mjs.
  const tsc = require.resolve('typescript/bin/tsc')
  const { stdout, stderr } = await new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        tsc,
        '--noEmit',
        '--allowJs',
        '--checkJs',
        '--target',
        'esnext',
        '--module',
        'esnext',
        '--moduleResolution',
        'bundler',
        '--skipLibCheck',
        path.join(labRoot, 'manual.mjs')
      ],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ stdout, stderr, error })
    )
  })
  const missing = `${stdout}${stderr}`
    .split(/\r?\n/)
    .filter((line) => /error TS(2304|2552):/.test(line))
  assert.deepEqual(
    missing,
    [],
    `manual.mjs refers to names that do not exist:\n${missing.join('\n')}`
  )
})

test('every manual action is reachable from the yarn scripts the help promises', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  for (const role of ['teacher', 'student'])
    for (const action of ['boot', 'reset', 'delete', 'status'])
      assert.equal(
        manifest.scripts[`vm:${role}:${action}`],
        `chcp 65001 && node infra/windows-vm/manual.mjs ${role}:${action}`,
        `vm:${role}:${action}`
      )
})

test('the desktop entry result is read over WinRM, not the bulk channel', async () => {
  const { desktopEntryProbeScript } = await manual
  const source = await readFile(path.join(labRoot, 'manual.mjs'), 'utf8')
  const probe = desktopEntryProbeScript()
  // One line of text does not belong on the bulk file channel: that channel is what died in the run this
  // replaced, and WinRM was working throughout it.
  assert.match(probe, /'result='/)
  assert.match(probe, /'result=pending'/)
  assert.match(probe, /\$task\.State/)
  assert.match(probe, /Get-ScheduledTask -TaskName 'ls101-desktop-entry'/)
  assert.doesNotMatch(source, /getGuestFile/)
  // The failure paths are distinct, so the message says which one happened.
  assert.match(source, /finished without writing a result/)
  assert.match(source, /produced no result within 60 s/)
  assert.match(source, /The desktop entry was not created:/)
})

test('what is sent to the guest is pure ASCII', async () => {
  const { desktopEntryScript, desktopEntryTaskScript, desktopEntryProbeScript, manualMachine } =
    await manual
  // Non-ASCII survived neither the Set-Content/-File round trip nor the WinRM output stream: the shortcut
  // name came back as `?????`, and WScript.Shell refused to save a file whose name contains `?`.
  for (const role of ['teacher', 'student']) {
    for (const [label, text] of [
      ['desktopEntryScript', desktopEntryScript(role, 'C:/ls101-lab/transfers/x.exe')],
      ['desktopEntryTaskScript', desktopEntryTaskScript(role, 'C:/ls101-lab/transfers/x.exe')]
    ])
      assert.doesNotMatch(text, /[^\x00-\x7F]/, `${label} for ${role} must be ASCII`)
    assert.match(manualMachine(role).desktopShortcut, /^[\x20-\x7E]+$/)
  }
  assert.match(desktopEntryProbeScript(), /^[\x00-\x7F]*$/)
  // The task no longer writes a script file first: the encoded command is carried by the action itself.
  const task = desktopEntryTaskScript('teacher', 'C:/ls101-lab/transfers/x.exe')
  assert.match(task, /-EncodedCommand [A-Za-z0-9+/=]+/)
  assert.doesNotMatch(task, /Set-Content.*make-desktop-entry/)
})
