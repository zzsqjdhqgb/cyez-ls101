const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const directories = []
const api = import('../../infra/windows-vm/lab.mjs')
const example = path.resolve(__dirname, '../../infra/windows-vm/config.example.json')
const boxName = 'ls101-windows-server-2022-vmware.box'

afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-vm space-'))
  directories.push(root)
  const { initializeEnvironment, sha256 } = await api
  await initializeEnvironment(root)
  const config = JSON.parse(await readFile(example, 'utf8'))
  config.GuestPassword = 'Test-Password123!'
  const downloads = path.join(root, '.local', 'downloads')
  const assets = [
    ['PackerSha256', path.join(downloads, `packer_${config.PackerVersion}_windows_amd64.zip`)],
    ['NodeSha256', path.join(downloads, `node-v${config.NodeVersion}-win-x64.zip`)],
    ['MinGitSha256', path.join(downloads, `MinGit-${config.MinGitVersion}-64-bit.zip`)],
    ['WindowsIsoSha256', path.resolve(root, config.WindowsIso)],
    ['VMwareToolsIsoSha256', path.resolve(root, config.VMwareToolsIso)]
  ]
  for (const [key, file] of assets) {
    await writeFile(file, `fixture: ${key}`)
    config[key] = await sha256(file)
  }
  await writeFile(path.join(root, 'config.local.json'), JSON.stringify(config))
  return { root, config }
}

test('CLI rejects extra arguments including destructive flags; init never overwrites credentials', async () => {
  const { parseAction, main } = await api
  assert.equal(parseAction([]), 'help')
  assert.equal(parseAction(['destroy']), 'destroy')
  assert.throws(() => parseAction(['destroy', '--all']))
  const { root } = await fixture()
  await writeFile(path.join(root, 'config.example.json'), await readFile(example))
  const original = await readFile(path.join(root, 'config.local.json'), 'utf8')
  await assert.rejects(main(['init'], { root }), { code: 'EEXIST' })
  assert.equal(await readFile(path.join(root, 'config.local.json'), 'utf8'), original)
  const freshRoot = path.join(root, 'new')
  await mkdir(freshRoot)
  await writeFile(path.join(freshRoot, 'config.example.json'), await readFile(example))
  await main(['init'], { root: freshRoot })
  const generated = JSON.parse(await readFile(path.join(freshRoot, 'config.local.json')))
  assert.match(generated.GuestPassword, /^Aa1![a-f0-9]{36}$/)
})

test('invalid hashes, sizing and shell/XML characters in config are rejected', async () => {
  const { validateConfig } = await api
  const { config } = await fixture()
  assert.equal(validateConfig(config), config)
  for (const [key, value] of [
    ['WindowsIsoSha256', 'REPLACE'],
    ['GuestPassword', 'Bad<&Password123'],
    ['Cpus', 1.5],
    ['MemoryMB', 0],
    ['DiskMB', -1],
    ['WindowsImageIndex', '2'],
    ['PackerVersion', '1.14.2'],
    ['NodeVersion', '../escape'],
    ['MinGitRelease', 'v2;echo']
  ])
    assert.throws(() => validateConfig({ ...config, [key]: value }), undefined, key)
})

test('Vagrant storage and Vagrantfile override inherited global locations without changing process env', async () => {
  const { initializeEnvironment } = await api
  const { root } = await fixture()
  const inherited = {
    VAGRANT_HOME: '/outside',
    VAGRANT_VAGRANTFILE: '/outside/Vagrantfile',
    HOME: '/keep-home'
  }
  const env = await initializeEnvironment(root, inherited)
  assert.equal(env.VAGRANT_HOME, path.join(root, '.local', 'vagrant-home'))
  assert.equal(env.VAGRANT_DOTFILE_PATH, path.join(root, '.local', 'vagrant-state'))
  assert.equal(env.VAGRANT_VAGRANTFILE, 'Vagrantfile')
  assert.equal(env.VAGRANT_CWD, root)
  assert.equal(env.HOME, '/keep-home')
  assert.match(env.NO_PROXY, /127\.0\.0\.1/)
  assert.match(env.no_proxy, /localhost/)
  assert.equal(inherited.VAGRANT_HOME, '/outside')
})

test('operation lock prevents simultaneous destroy/build and releases after failure', async () => {
  const { withLock, exists } = await api
  const { root } = await fixture()
  const local = path.join(root, '.local')
  await assert.rejects(
    withLock(local, async () => {
      await assert.rejects(
        withLock(local, () => assert.fail('must not run')),
        /Another lab operation/
      )
      throw new Error('original failure')
    }),
    /original failure/
  )
  assert.equal(await exists(path.join(local, 'operation.lock')), false)
  await withLock(local, async () => {})
})

test('taking the lock creates the directory it lives in', async () => {
  const { withLock } = await api
  // A fresh checkout has no `.local`: the lock has to create it, because `open(file, 'wx')` reports a
  // missing parent as ENOENT rather than as the EEXIST this helper is about. `fixture()` cannot show
  // that — it runs `initializeEnvironment` first, which is the implicit dependency that hid the bug on
  // every developer machine while a GitHub runner (and a clone that only ran `yarn vm:init`) failed.
  const fresh = await mkdtemp(path.join(tmpdir(), 'ls101-lock-'))
  directories.push(fresh)
  const local = path.join(fresh, '.local')
  let ran = false
  await withLock(local, async () => {
    ran = true
  })
  assert.equal(ran, true)
  assert.equal((await stat(local)).isDirectory(), true)
})

test('asset verification detects tampering without replacing the existing asset', async () => {
  const { verifyHash } = await api
  const { root, config } = await fixture()
  const iso = path.resolve(root, config.WindowsIso)
  await writeFile(iso, 'tampered')
  await assert.rejects(verifyHash(iso, config.WindowsIsoSha256), /SHA-256 mismatch/)
  assert.equal(await readFile(iso, 'utf8'), 'tampered')
})

test('validation leaves published credentials intact and does not build; existing output refuses rebuild', async () => {
  const { buildBox } = await api
  const { root, config } = await fixture()
  const guest = path.join(root, '.local', 'generated', 'guest.json')
  await writeFile(guest, 'existing credentials')
  const calls = []
  await buildBox(root, config, (...args) => calls.push(args), true)
  assert.equal(await readFile(guest, 'utf8'), 'existing credentials')
  assert.deepEqual(
    calls.map((call) => call[1][0]),
    ['-NoLogo', 'validate']
  )
  const vars = JSON.parse(
    await readFile(path.join(root, '.local', 'generated', 'build.pkrvars.json'))
  )
  assert.equal(vars.guest_password, config.GuestPassword)
  assert.equal(
    Object.keys(vars).some((key) => /repo|source|application/.test(key)),
    false
  )
  await assert.rejects(
    buildBox(root, config, () => assert.fail('must not run'), false),
    /already exists/
  )
})

test('failed build requests preservation of the VM and does not publish box credentials', async () => {
  const { buildBox, exists } = await api
  const { root, config } = await fixture()
  await assert.rejects(
    buildBox(
      root,
      config,
      (_command, args) => {
        if (args[0] === 'build') {
          assert.ok(args.includes('-on-error=abort'), 'Packer must not delete the failed VM')
          throw new Error('Packer failed')
        }
      },
      false
    ),
    /Packer failed/
  )
  assert.equal(await exists(path.join(root, '.local', 'generated', 'guest.json')), false)
})

test('successful build binds credentials to actual box bytes; up rejects a changed box', async () => {
  const { buildBox, verifyBox } = await api
  const { root, config } = await fixture()
  const box = path.join(root, '.local', 'boxes', boxName)
  // The runner is synchronous just like spawnSync.
  await buildBox(
    root,
    config,
    (_command, args) => {
      if (args[0] === 'build') require('node:fs').writeFileSync(box, 'fake box bytes')
    },
    false
  )
  await verifyBox(root)
  await writeFile(box, 'changed box')
  await assert.rejects(verifyBox(root), /SHA-256 mismatch/)
})

test('provider setup reuses pinned plugin and refuses incompatible installed versions', async () => {
  const { ensureProvider } = await api
  const calls = []
  ensureProvider((_command, args) => {
    calls.push(args)
    return 'vagrant-vmware-desktop (3.0.5, global)\n'
  })
  assert.equal(calls.length, 1)
  assert.throws(
    () => ensureProvider(() => 'vagrant-vmware-desktop (3.0.4, global)'),
    /Expected VMware provider/
  )
  calls.length = 0
  ensureProvider((_command, args) => {
    calls.push(args)
    return ''
  })
  assert.deepEqual(calls[1].slice(0, 5), [
    'plugin',
    'install',
    'vagrant-vmware-desktop',
    '--plugin-version',
    '3.0.5'
  ])
})

test('VMware Utility check starts the host service and rejects unavailable services', async () => {
  const { ensureVmwareUtility } = await api
  const calls = []
  ensureVmwareUtility((_command, args) => {
    calls.push(args)
    return 'Running\n'
  })
  assert.equal(calls[0][0], '-NoLogo')
  assert.match(calls[0].at(-1), /Start-Service/)
  assert.throws(
    () =>
      ensureVmwareUtility(() => {
        throw new Error('service missing')
      }),
    /127\.0\.0\.1:9922/
  )
})

test('cycle refuses to touch an existing VM and does not clean up on failed preflight', async () => {
  const { lifecycle } = await api
  const calls = []
  const run = (_command, args) => {
    calls.push(args)
    return '123,default,state,running\n'
  }
  await assert.rejects(
    lifecycle('cycle', run, async () => {}),
    /requires no existing VM/
  )
  assert.deepEqual(calls, [['status', '--machine-readable']])
  calls.length = 0
  await assert.rejects(
    lifecycle('cycle', run, async () => {
      throw new Error('bad checksum')
    }),
    /bad checksum/
  )
  assert.deepEqual(calls, [])
})

test('cycle destroys after both boot and shutdown fail and preserves every failure', async () => {
  const { lifecycle } = await api
  const calls = []
  await assert.rejects(
    lifecycle(
      'cycle',
      (_command, args) => {
        calls.push(args)
        if (args[0] === 'status') return '123,default,state,not_created\n'
        if (args[0] === 'up') throw new Error('boot failure')
        if (args[0] === 'halt') throw new Error('halt failure')
      },
      async () => {}
    ),
    (error) => {
      assert.deepEqual(
        error.errors.map((item) => item.message),
        ['boot failure', 'halt failure']
      )
      return true
    }
  )
  assert.deepEqual(
    calls.map((args) => args[0]),
    ['status', 'up', 'halt', 'destroy']
  )
  assert.deepEqual(calls.at(-1), ['destroy', '--force'])
})

test('successful lifecycle cycle orders operations and individual halt/destroy need no build config', async () => {
  const { lifecycle } = await api
  const calls = []
  const run = (_command, args) => {
    calls.push(args)
    return '123,default,state,not_created\n'
  }
  await lifecycle('cycle', run, async () => calls.push(['preflight']))
  assert.deepEqual(
    calls.map((args) => args[0]),
    ['preflight', 'status', 'up', 'halt', 'destroy']
  )
  calls.length = 0
  for (const action of ['status', 'halt', 'destroy']) {
    await lifecycle(action, run, () => assert.fail('no box/config required'))
  }
  assert.deepEqual(calls, [['status'], ['halt'], ['destroy', '--force']])
})

test('native process failures, missing tools and signals cannot be reported as success', async () => {
  const { createRunner } = await api
  for (const result of [
    { status: 9 },
    { status: null, signal: 'SIGINT' },
    { error: { code: 'ENOENT' } }
  ]) {
    const report = { steps: [] }
    const run = createRunner(
      '/repo with spaces',
      { VAGRANT_HOME: '/local' },
      report,
      (_command, args, options) => {
        assert.equal(options.shell, false)
        assert.deepEqual(args, ['up', '--provider', 'vmware_desktop'])
        assert.equal(options.env.VAGRANT_HOME, '/local')
        return result
      }
    )
    assert.throws(() => run('vagrant.exe', ['up', '--provider', 'vmware_desktop']), /failed/)
    assert.equal(report.steps.length, 1)
    assert.ok(report.steps[0].finishedAt)
  }
})

test('failed and successful operations both write host reports without credentials; non-Windows stops before spawn', async () => {
  const { main } = await api
  const { root, config } = await fixture()
  let calls = 0
  const dependencies = {
    root,
    platform: 'win32',
    arch: 'x64',
    spawn: () => {
      calls++
      return { status: 5 }
    }
  }
  await assert.rejects(main(['halt'], dependencies), /failed/)
  dependencies.spawn = () => ({ status: 0 })
  await main(['destroy'], dependencies)
  const results = path.join(root, '.local', 'results')
  const reports = await Promise.all(
    (await readdir(results)).map(async (file) => {
      const content = await readFile(path.join(results, file), 'utf8')
      assert.equal(content.includes(config.GuestPassword), false)
      return JSON.parse(content)
    })
  )
  assert.equal(reports.find((report) => report.action === 'halt').success, false)
  assert.equal(reports.find((report) => report.action === 'destroy').success, true)
  await assert.rejects(
    main(['up'], {
      ...dependencies,
      platform: 'linux',
      spawn: () => assert.fail('must not spawn')
    }),
    /Windows x64/
  )
  assert.equal(calls, 1)
})

const downloadApi = import('../../infra/windows-vm/assets.mjs')
function isoBytes(marker = 1) {
  const bytes = Buffer.alloc(40 * 1024, marker)
  bytes.write('CD001', 16 * 2048 + 1, 'ascii')
  return bytes
}
function isoConfig(config, defaults) {
  return {
    ...config,
    WindowsIso: '.local/auto/windows.iso',
    VMwareToolsIso: '.local/auto/tools.iso',
    WindowsIsoUrl: defaults.WindowsIso,
    VMwareToolsIsoUrl: defaults.VMwareToolsIso,
    WindowsIsoSha256: 'auto',
    VMwareToolsIsoSha256: 'auto'
  }
}

test('official ISO downloads stream to nested directories and persist hashes for offline reuse/build', async () => {
  const { prepareIsos, resolveIsoHashes, defaultIsoUrls } = await downloadApi
  const { root, config } = await fixture()
  const configured = isoConfig(config, defaultIsoUrls)
  let calls = 0
  const options = {
    progress: () => {},
    fetcher: async () => {
      calls++
      const bytes = isoBytes(calls)
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    }
  }
  await assert.rejects(resolveIsoHashes(root, configured), /vm:prepare/)
  const inventory = await prepareIsos(root, configured, options)
  assert.equal(calls, 2)
  assert.equal(inventory.length, 2)
  assert.equal(inventory[0].verification, 'first-download-from-official-https')
  const resolved = await resolveIsoHashes(root, configured)
  assert.equal(resolved.WindowsIsoSha256, inventory[0].hash)
  assert.equal(configured.WindowsIsoSha256, 'auto')
  await prepareIsos(root, configured, {
    progress: () => {},
    fetcher: () => assert.fail('must reuse offline')
  })
  await writeFile(path.resolve(root, configured.WindowsIso), 'modified')
  await assert.rejects(prepareIsos(root, configured, options), /SHA-256 mismatch/)
  assert.equal(calls, 2)
})

test('completed ISO survives failure of the second download and retry only downloads the missing ISO', async () => {
  const { prepareIsos, defaultIsoUrls } = await downloadApi
  const { root, config } = await fixture()
  const configured = isoConfig(config, defaultIsoUrls)
  const seen = []
  await assert.rejects(
    prepareIsos(root, configured, {
      progress: () => {},
      fetcher: async (url) => {
        seen.push(url)
        if (url === defaultIsoUrls.VMwareToolsIso) throw new Error('network interrupted')
        return new Response(isoBytes())
      }
    }),
    /network interrupted/
  )
  const files = await readdir(path.join(root, '.local', 'auto'))
  assert.deepEqual(files, ['windows.iso'])
  await prepareIsos(root, configured, {
    progress: () => {},
    fetcher: async (url) => {
      seen.push(url)
      return new Response(isoBytes())
    }
  })
  assert.deepEqual(seen, [
    defaultIsoUrls.WindowsIso,
    defaultIsoUrls.VMwareToolsIso,
    defaultIsoUrls.VMwareToolsIso
  ])
})

test('auto hashes reject arbitrary URLs, credentials, HTTP, changed lock sources and unrecorded local files', async () => {
  const { prepareIsos, defaultIsoUrls, validateIsoConfig } = await downloadApi
  const { root, config } = await fixture()
  const configured = isoConfig(config, defaultIsoUrls)
  for (const url of [
    'https://example.com/windows.iso',
    'http://example.com/windows.iso',
    'https://user:password@example.com/windows.iso',
    'file:///tmp/image.iso'
  ]) {
    assert.throws(() => validateIsoConfig({ ...configured, WindowsIsoUrl: url }))
  }
  await mkdir(path.dirname(path.resolve(root, configured.WindowsIso)), { recursive: true })
  await writeFile(path.resolve(root, configured.WindowsIso), isoBytes())
  await assert.rejects(
    prepareIsos(root, configured, { fetcher: () => assert.fail('must not fetch') }),
    /no recorded SHA-256/
  )
  await writeFile(
    path.join(root, '.local', 'generated', 'iso-lock.json'),
    JSON.stringify({
      version: 1,
      assets: { WindowsIso: { url: 'https://example.com/changed.iso', sha256: 'a'.repeat(64) } }
    })
  )
  await assert.rejects(prepareIsos(root, configured), /does not match iso-lock/)
})

test('HTML, partial responses, truncated bodies and wrong hashes never publish a downloaded ISO', async () => {
  const { downloadAsset } = await downloadApi
  const { root } = await fixture()
  const destination = path.join(root, 'download-tests', 'image.iso')
  for (const response of [
    new Response('<html>login required</html>'),
    new Response(isoBytes(), { status: 206 }),
    new Response(isoBytes(), { headers: { 'content-length': '999999' } }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(isoBytes())
          controller.error(new Error('stream interrupted'))
        }
      })
    )
  ]) {
    await assert.rejects(
      downloadAsset('https://example.com/image.iso', destination, null, {
        iso: true,
        progress: () => {},
        fetcher: async () => response
      })
    )
    assert.deepEqual(await readdir(path.dirname(destination)), [])
  }
  await assert.rejects(
    downloadAsset('https://example.com/image.iso', destination, 'a'.repeat(64), {
      iso: true,
      progress: () => {},
      fetcher: async () => new Response(isoBytes())
    }),
    /SHA-256 mismatch/
  )
  assert.deepEqual(await readdir(path.dirname(destination)), [])
})

test('auto official downloads reject cross-host redirects before fetching the new host', async () => {
  const { downloadAsset, defaultIsoUrls } = await downloadApi
  const { root } = await fixture()
  let calls = 0
  await assert.rejects(
    downloadAsset(defaultIsoUrls.WindowsIso, path.join(root, 'redirect.iso'), null, {
      iso: true,
      officialHost: new URL(defaultIsoUrls.WindowsIso).hostname,
      progress: () => {},
      fetcher: async () => {
        calls++
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/other.iso' }
        })
      }
    }),
    /different host/
  )
  assert.equal(calls, 1)
})

test('custom ISO HTTPS redirects require the configured hash and existing local ISOs work without a URL', async () => {
  const { downloadAsset, prepareIsos } = await downloadApi
  const { root, config } = await fixture()
  const bytes = isoBytes()
  const digest = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
  const requested = []
  await downloadAsset('https://example.com/start', path.join(root, 'custom.iso'), digest, {
    iso: true,
    progress: () => {},
    fetcher: async (url) => {
      requested.push(url)
      return requested.length === 1
        ? new Response(null, { status: 302, headers: { location: '/final' } })
        : new Response(bytes)
    }
  })
  assert.deepEqual(requested, ['https://example.com/start', 'https://example.com/final'])
  delete config.WindowsIsoUrl
  delete config.VMwareToolsIsoUrl
  const inventory = await prepareIsos(root, config, {
    fetcher: () => assert.fail('local hash verified files need no network')
  })
  assert.equal(inventory[0].verification, 'configured-sha256')
})

test('setup initializes missing config and orders prepare/build without replacing an existing password', async () => {
  const { setup, initializeEnvironment } = await api
  const { root } = await fixture()
  const fresh = path.join(root, 'fresh')
  await initializeEnvironment(fresh)
  await writeFile(path.join(fresh, 'config.example.json'), await readFile(example))
  const calls = []
  const operations = {
    prepare: async (_root, config) => {
      calls.push(['prepare', config.GuestPassword])
    },
    buildBox: async (_root, config, _run, validateOnly) => {
      calls.push(['build', config.GuestPassword])
      assert.equal(validateOnly, false)
    }
  }
  await setup(fresh, () => assert.fail('mock operations only'), operations)
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['prepare', 'build']
  )
  assert.match(calls[0][1], /^Aa1![a-f0-9]{36}$/)
  assert.equal(calls[0][1], calls[1][1])
  const original = await readFile(path.join(fresh, 'config.local.json'), 'utf8')
  await setup(fresh, () => {}, operations)
  assert.equal(await readFile(path.join(fresh, 'config.local.json'), 'utf8'), original)
})

test('setup stops at prepare failure and refuses incomplete build output before downloads', async () => {
  const { setup } = await api
  const { root } = await fixture()
  await assert.rejects(
    setup(root, () => {}, {
      prepare: async () => {
        throw new Error('download failed')
      },
      buildBox: () => assert.fail('must not build after failure')
    }),
    /download failed/
  )
  await mkdir(path.join(root, '.local', 'build', 'windows-server-2022'))
  await assert.rejects(
    setup(root, () => {}, {
      prepare: () => assert.fail('must not download with incomplete output')
    }),
    /Incomplete base-box/
  )
})

test('setup reuses a verified box without downloads and rejects tampering instead of rebuilding', async () => {
  const { setup, buildBox } = await api
  const { root, config } = await fixture()
  const box = path.join(root, '.local', 'boxes', boxName)
  await buildBox(
    root,
    config,
    (_command, args) => {
      if (args[0] === 'build') require('node:fs').writeFileSync(box, 'box fixture')
    },
    false
  )
  const operations = {
    prepare: () => assert.fail('must reuse'),
    buildBox: () => assert.fail('must not rebuild')
  }
  await setup(root, () => assert.fail('no process needed'), operations)
  await writeFile(box, 'modified')
  await assert.rejects(
    setup(root, () => {}, operations),
    /SHA-256 mismatch/
  )
})

test('Packer validate/build resolve every HCL resource from an absolute template root with spaces', async () => {
  const { buildBox } = await api
  const { root, config } = await fixture()
  const fs = require('node:fs')
  const source = path.resolve(__dirname, '../../infra/windows-vm')
  for (const directory of ['packer', 'guest']) {
    fs.cpSync(path.join(source, directory), path.join(root, directory), { recursive: true })
  }
  const operations = []
  await buildBox(
    root,
    config,
    (_command, args) => {
      if (!['validate', 'build'].includes(args[0])) return
      operations.push(args[0])
      const templateRoot = args.at(-1)
      assert.ok(path.isAbsolute(templateRoot), 'path.root must not be a relative directory')
      const hcl = fs.readFileSync(path.join(templateRoot, 'windows.pkr.hcl'), 'utf8')
      const references = [...hcl.matchAll(/"\$\{path\.root\}([^"\n]+)"/g)]
      assert.ok(references.length >= 5, 'include answer file, bootstrap and provisioner scripts')
      for (const [, suffix] of references) {
        // Packer evaluates file/templatefile relative to its template base directory.
        const resolved = path.resolve(templateRoot, templateRoot + suffix)
        assert.ok(fs.statSync(resolved).isFile(), `Missing HCL resource: ${resolved}`)
      }
      if (args[0] === 'build') {
        fs.writeFileSync(path.join(root, '.local', 'boxes', boxName), 'box fixture')
      }
    },
    false
  )
  assert.deepEqual(operations, ['validate', 'build'])
})

// Decodes the encoded PowerShell payload that lab.mjs sends through `vagrant winrm`.
const guestScriptOf = (args) =>
  Buffer.from(/-EncodedCommand (\S+)/.exec(args.at(-1))[1], 'base64').toString('utf16le')

test('encoded guest commands are logged as decoded scripts, not base64', async () => {
  const { createRunner, decodeGuestCommand, describeStep, firstScriptLine } = await api
  const script = "Get-Content -LiteralPath 'C:\\ls101-lab\\results\\status.txt' -Raw"
  const args = [
    'winrm',
    '--command',
    `powershell -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
  ]
  const hidden = args[2].split(' ').at(-1)
  const printed = []
  const original = console.log
  console.log = (line) => printed.push(line)
  let report
  try {
    report = { steps: [] }
    const spawn = () => ({ status: 0, stdout: '', stderr: '', error: null })
    createRunner('/tmp', {}, report, spawn)('vagrant.exe', args, { capture: true, quiet: false })
  } finally {
    console.log = original
  }
  assert.equal(decodeGuestCommand(args), script)
  assert.equal(report.steps[0].script, script, 'the report keeps a readable copy of the script')
  const output = printed.join('\n')
  assert.match(output, /encoded PowerShell, 1 lines/)
  assert.match(output, /Get-Content -LiteralPath/)
  assert.ok(!output.includes(hidden), 'the base64 blob is replaced by the decoded script')
  assert.equal(describeStep('vagrant.exe', ['status'], null), 'vagrant.exe status')
  assert.match(firstScriptLine(`\n\n  echo hi  \n`), /^echo hi$/)
  assert.equal(firstScriptLine(''), '')
})

test('runner failures name the decoded script that failed', async () => {
  const { createRunner } = await api
  const script = "Get-Content -LiteralPath 'C:\\missing.log' -Raw"
  const args = [
    'winrm',
    '--command',
    `powershell -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
  ]
  const run = createRunner('/tmp', {}, { steps: [] }, () => ({ status: 1, stdout: '', stderr: '' }))
  assert.throws(
    () => run('vagrant.exe', args, { capture: true }),
    /script: Get-Content -LiteralPath/
  )
})

test('guest acceptance builds once and runs both Windows suites in order', async () => {
  const script = await readFile(
    path.resolve(__dirname, '../../infra/windows-vm/guest/run-acceptance.ps1'),
    'utf8'
  )
  // Both `yarn test:smoke` and `yarn test:product-docs` rebuild the application, so the guest
  // script packages it once and calls the run-only entry points instead.
  assert.equal(
    (script.match(/&\s*\$corepack yarn build:test\s/g) ?? []).length,
    1,
    'the application must be packaged exactly once for both suites'
  )
  assert.match(
    script,
    /&\s*\$corepack yarn test:playwright:electron tests\/integration\/electron-app\.spec\.ts/
  )
  assert.match(script, /&\s*\$corepack yarn test:product-docs:run\s/)
  assert.ok(
    script.indexOf("Write-Phase 'yarn test:smoke'") <
      script.indexOf("Write-Phase 'yarn test:product-docs'"),
    'smoke reports first so a startup failure is visible before the longer suite'
  )
  assert.match(script, /LS101_SETUP_MODE = 'product-docs'/)
  assert.match(script, /test-results\\integration/, 'smoke evidence travels with the artifacts')
  assert.match(script, /Set-Content -Path \$status -Value 'passed'/)
})

test('guest file server moves bytes over HTTP in both directions', async () => {
  const { createFileServer } = await import('../../infra/windows-vm/guest/fileserver.mjs')
  const { putGuestFile, getGuestFile, waitForGuestFileServer } = await api
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-vm files-'))
  directories.push(root)
  const uploads = path.join(root, 'transfers')
  const results = path.join(root, 'results')
  await mkdir(results, { recursive: true })
  const server = createFileServer({ uploads, results })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal(await waitForGuestFileServer({ baseUrl, timeoutMs: 5000, intervalMs: 10 }), true)

    const payload = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(600 * 1024, 7)])
    const local = path.join(root, 'source.zip')
    await writeFile(local, payload)
    assert.equal(await putGuestFile(local, 'source.zip', { baseUrl }), payload.length)
    assert.deepEqual(await readFile(path.join(uploads, 'source.zip')), payload)

    const downloaded = path.join(root, 'downloaded.zip')
    assert.equal(
      await getGuestFile('source.zip', downloaded, { baseUrl, kind: 'files', zip: true }),
      downloaded
    )
    assert.deepEqual(await readFile(downloaded), payload)

    await writeFile(path.join(results, 'acceptance.log'), 'yarn install\n')
    const log = path.join(root, 'acceptance.log')
    assert.equal(await getGuestFile('acceptance.log', log, { baseUrl }), log)
    assert.equal(await readFile(log, 'utf8'), 'yarn install\n')
    assert.equal(
      await getGuestFile('missing.log', path.join(root, 'missing.log'), { baseUrl }),
      null,
      'a missing guest file is not an error'
    )

    // Directory traversal and non-archive payloads must both be refused.
    await assert.rejects(() => putGuestFile(local, '../escape.zip', { baseUrl }), /rejected/)
    await assert.rejects(
      () => getGuestFile('acceptance.log', path.join(root, 'wrong'), { baseUrl, zip: true }),
      /not a ZIP archive/
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('the guest file server task exposes only the forwarded port', async () => {
  const { filesServerTaskScript } = await api
  const script = filesServerTaskScript({ NodeVersion: '22.20.0' })
  assert.match(script, /New-NetFirewallRule -Name 'LS101-Lab-FileServer'/)
  assert.match(script, /-LocalPort 8765 -RemoteAddress LocalSubnet/)
  assert.match(script, /-Execute 'C:\\ls101-lab\\tools\\node-v22\.20\.0-win-x64\\node\.exe'/)
  assert.match(script, /--uploads C:\\ls101-lab\\transfers --results C:\\ls101-lab\\results/)
  assert.match(script, /-LogonType Interactive/)
  assert.match(script, /Start-ScheduledTask -TaskName 'ls101-files'/)
})

test('the guest address is read from the NAT adapter that owns the default route', async () => {
  const { guestAddressScript, parseGuestAddress } = await api
  assert.match(guestAddressScript(), /IPv4DefaultGateway/)
  assert.equal(parseGuestAddress('192.168.164.128\r\n'), '192.168.164.128')
  assert.equal(parseGuestAddress('warning: something\r\n10.0.2.15\r\n'), '10.0.2.15')
  assert.equal(parseGuestAddress('no address reported'), null)
})

test('an unreachable guest file server fails fast instead of hanging', async () => {
  const { waitForGuestFileServer } = await api
  let elapsed = 0
  await assert.rejects(
    () =>
      waitForGuestFileServer({
        baseUrl: 'http://127.0.0.1:1',
        timeoutMs: 200,
        intervalMs: 1,
        now: () => (elapsed += 100)
      }),
    /not reachable/
  )
})

function artifactRun(payload, { override = null } = {}) {
  const requested = []
  const run = (_command, args) => {
    const script = guestScriptOf(args)
    if (script.includes('Get-Item')) return `${payload.length}\r\n`
    const offset = Number(/Position = (\d+)/.exec(script)[1])
    const length = Number(/byte\[\] (\d+)/.exec(script)[1])
    requested.push(length)
    const chunk = override ?? payload.subarray(offset, offset + length)
    return `${chunk.toString('base64')}\r\n`
  }
  return { run, requested, size: payload.length }
}

test('acceptance artifacts are reassembled from bounded WinRM commands', async () => {
  const { collectGuestArtifact } = await api
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-vm artifact-'))
  directories.push(root)
  const payload = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(600 * 1024, 7)])
  const { run, requested } = artifactRun(payload)
  const local = path.join(root, 'acceptance-artifacts.zip')
  assert.equal(
    await collectGuestArtifact(run, 'C:/ls101-lab/results/acceptance-artifacts.zip', local),
    local
  )
  assert.deepEqual(await readFile(local), payload)
  assert.equal(requested.length, Math.ceil(payload.length / (512 * 1024)))
  assert.ok(
    requested.every((length) => length <= 512 * 1024),
    'each WinRM command stays bounded'
  )
  const absent = await collectGuestArtifact(
    () => '\r\n',
    'C:/ls101-lab/results/acceptance-artifacts.zip',
    path.join(root, 'missing.zip')
  )
  assert.equal(absent, null, 'a missing guest artifact is not an error')
})

test('guest text decoding survives every PowerShell log encoding', async () => {
  const { decodeGuestText } = await api
  const text = 'yarn install\n'
  const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
  const utf16Bom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  assert.equal(decodeGuestText(Buffer.from(text, 'utf8')), text)
  assert.equal(decodeGuestText(utf8Bom), text)
  assert.equal(decodeGuestText(utf16Bom), text)
  assert.equal(
    decodeGuestText(Buffer.from(text, 'utf16le')),
    text,
    'Windows PowerShell wrote UTF-16LE without a BOM'
  )
})

test('chunked collection fetches plain text without the ZIP check', async () => {
  const { collectGuestArtifact } = await api
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-vm log-'))
  directories.push(root)
  const payload = Buffer.from('=== desktop session ===\r\n>console vagrant 1 Active\r\n', 'utf8')
  const local = path.join(root, 'acceptance.log')
  assert.equal(
    await collectGuestArtifact(
      artifactRun(payload).run,
      'C:/ls101-lab/results/acceptance.log',
      local,
      { zip: false }
    ),
    local
  )
  assert.deepEqual(await readFile(local), payload)
})

test('acceptance artifact export rejects non-ZIP and truncated payloads', async () => {
  const { collectGuestArtifact } = await api
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-vm artifact-'))
  directories.push(root)
  const local = path.join(root, 'acceptance-artifacts.zip')
  const notZip = artifactRun(Buffer.from('<html>not an archive</html>'))
  await assert.rejects(
    () => collectGuestArtifact(notZip.run, 'C:/results/acceptance-artifacts.zip', local),
    /not a ZIP archive/
  )
  const payload = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(600 * 1024, 7)])
  const truncated = artifactRun(payload, { override: payload.subarray(0, 2) })
  await assert.rejects(
    () => collectGuestArtifact(truncated.run, 'C:/results/acceptance-artifacts.zip', local),
    /truncated/
  )
})

test('interactive desktop detection requires a session with a logged-on user', async () => {
  const { hasInteractiveSession } = await api
  const header = ' SESSIONNAME       USERNAME                 ID  STATE   TYPE        DEVICE\r\n'
  assert.equal(
    hasInteractiveSession(
      `${header} services                                    0  Disc\r\n>console                                     1  Conn\r\n`
    ),
    false,
    'a console without a user is not a desktop session'
  )
  assert.equal(
    hasInteractiveSession(
      `${header} services                                    0  Disc\r\n>console           vagrant                   1  Active\r\n`
    ),
    true
  )
})

test('desktop session script enables console logon without accepting unsafe passwords', async () => {
  const { desktopSessionScript } = await api
  const script = desktopSessionScript('Test-Password123!')
  assert.match(script, /AutoAdminLogon -Value '1'/)
  assert.match(script, /DefaultUserName -Value 'vagrant'/)
  assert.match(script, /DefaultPassword -Value 'Test-Password123!'/)
  assert.match(script, /Remove-ItemProperty -Path \$winlogon -Name AutoLogonCount/)
  assert.match(script, /DoNotOpenServerManagerAtLogon/)
  assert.match(script, /if \(-not \(Test-Path -LiteralPath \$serverManager\)\)/)
  assert.doesNotMatch(script, /New-Item -Path \$serverManager -Force/)
  assert.throws(
    () => desktopSessionScript("Test'; Remove-Item C:\\ -Recurse"),
    /cannot be embedded/
  )
})

test('desktop session polling stops once the console session appears', async () => {
  const { waitForInteractiveSession } = await api
  let polls = 0
  const run = () => {
    polls += 1
    return polls < 3
      ? ' services                                    0  Disc\r\n'
      : '>console           vagrant                   1  Active\r\n'
  }
  const sessions = await waitForInteractiveSession(run, {
    timeoutMs: 60_000,
    intervalMs: 1,
    delay: async () => undefined
  })
  assert.match(sessions, /vagrant/)
  assert.equal(polls, 3)

  let elapsed = 0
  const never = await waitForInteractiveSession(() => ' services  0  Disc\r\n', {
    timeoutMs: 1_000,
    intervalMs: 1,
    delay: async () => undefined,
    now: () => (elapsed += 400)
  })
  assert.equal(never, null)
})

// The host reads guest state from a single encoded PowerShell command, so tests decode the
// payload instead of matching the base64 blob.
test('guest state parsing reads the marker line and tolerates WinRM noise', async () => {
  const { parseGuestState } = await api
  assert.deepEqual(
    parseGuestState('warning: something\r\nLS101STATE|passed|12:01:02 yarn install|Ready|0||\r\n'),
    {
      status: 'passed',
      phase: '12:01:02 yarn install',
      state: 'Ready',
      result: 0,
      lastRun: '',
      tail: ''
    }
  )
  const missing = parseGuestState('no marker here')
  assert.equal(missing.status, '')
  assert.equal(missing.state, '')
  assert.ok(Number.isNaN(missing.result))
})

// Field order matches guestStateScript: status | phase | task state | result | last run | log tail.
const stateOutput = ({ status = '', phase = '', task = 'Running|267009|', tail = '' } = {}) =>
  `LS101STATE|${status}|${phase}|${task}|${tail}\r\n`

test('acceptance polling stays quiet, reports progress and fails fast', async () => {
  const { waitForAcceptanceStatus } = await api
  const statusRun = (states) => (_command, args) => {
    assert.match(guestScriptOf(args), /Get-ScheduledTask/)
    return states.shift() ?? stateOutput()
  }
  const lines = []
  const options = {
    timeoutMs: 60_000,
    intervalMs: 1,
    delay: async () => undefined,
    log: (line) => lines.push(line)
  }

  assert.equal(
    await waitForAcceptanceStatus(
      statusRun([
        stateOutput({ phase: '12:00:01 yarn install', tail: 'YN0000: Installing' }),
        stateOutput({ phase: '12:00:01 yarn install', tail: 'YN0000: Installing' }),
        stateOutput({ status: 'passed', task: 'Ready|0|' })
      ]),
      options
    ),
    'passed'
  )
  assert.equal(
    await waitForAcceptanceStatus(statusRun([stateOutput({ status: 'failed' })]), options),
    'failed'
  )
  assert.equal(lines.length, 1, 'identical polls must not repeat the progress line')
  assert.match(lines[0], /12:00:01 yarn install/)

  await assert.rejects(
    () => waitForAcceptanceStatus(statusRun([stateOutput({ task: 'missing|0|' })]), options),
    /Acceptance task is missing/
  )
  await assert.rejects(
    () => waitForAcceptanceStatus(statusRun([stateOutput({ task: 'Ready|2147943645|' })]), options),
    /interactive desktop session is unavailable/
  )
  await assert.rejects(
    () => waitForAcceptanceStatus(statusRun([stateOutput({ task: 'Ready|1|' })]), options),
    /ended without publishing a status/
  )
  // Task Scheduler informational results must not be mistaken for failures.
  assert.equal(
    await waitForAcceptanceStatus(
      statusRun([stateOutput({ task: 'Ready|267011|' }), stateOutput({ status: 'passed' })]),
      options
    ),
    'passed'
  )
  let elapsed = 0
  await assert.rejects(
    () =>
      waitForAcceptanceStatus(statusRun([]), {
        ...options,
        timeoutMs: 1_000,
        now: () => (elapsed += 600)
      }),
    /did not finish within/
  )
})

test('acceptance task script registers an interactive task and clears stale status', async () => {
  const { acceptanceTaskScript } = await api
  const script = acceptanceTaskScript()
  assert.match(script, /-LogonType Interactive/)
  // The script arrives over HTTP, so the task must read it from the upload directory.
  assert.match(script, /-File C:\\ls101-lab\\transfers\\run-acceptance\.ps1/)
  assert.match(script, /Remove-Item -LiteralPath 'C:\\ls101-lab\\results\\status\.txt'/)
  assert.match(script, /Start-ScheduledTask -TaskName 'ls101-acceptance'/)
})

// --- Lab acceptance (docs/lab-vm-acceptance-design.md milestone M1) ---------------------------

// --- Lab acceptance (docs/lab-vm-acceptance-design.md milestone M1) ---------------------------

const guestDirectory = path.resolve(__dirname, '../../infra/windows-vm/guest')
const labEntry = path.resolve(__dirname, '../../infra/windows-vm/lab.mjs')
const readGuest = (name) => readFile(path.join(guestDirectory, name), 'utf8')

test('lab acceptance is a CLI action and the defaults still target the smoke suite', async () => {
  const { parseAction, guestStateScript } = await api
  assert.equal(parseAction(['lab-acceptance']), 'lab-acceptance')
  assert.equal(parseAction(['lab-diagnose']), 'lab-diagnose')
  assert.equal(parseAction(['lab-execute']), 'lab-execute')
  // Parameterising the shared helpers must not move the existing suite's paths.
  const smoke = guestStateScript()
  assert.match(smoke, /acceptance\.log/)
  assert.match(smoke, /'ls101-acceptance'/)
})

test('the phase run is Node and PowerShell only collects structured data', async () => {
  const orchestrator = await readGuest('lab-acceptance.mjs')
  const probes = await readGuest('lab-probes.ps1')
  // The orchestration and every comparison live in Node, so `yarn vm:test` covers them in the container
  // instead of a seven-minute VM rebuild being the only way to find a defect.
  assert.match(orchestrator, /from '\.\/lab-harness\.mjs'/)
  assert.match(orchestrator, /run\.step\('elevation', async/)
  assert.match(orchestrator, /assertThat\(/)
  // Probes answer questions; they never decide. One marked JSON line per invocation, no assertions.
  assert.match(probes, /LS101PROBE\|/)
  assert.doesNotMatch(probes, /Assert|ASSERTION FAILED/)
  // The PowerShell phase script is gone.
  await assert.rejects(readGuest('run-lab-acceptance.ps1'), { code: 'ENOENT' })
})

test('the diagnostic checks each language with its own tool', async () => {
  const { labDiagnoseScript } = await api
  const script = labDiagnoseScript({ NodeVersion: '24.20.0' })
  // Asking the PowerShell parser about a Node module proved nothing; node --check is a real check.
  assert.match(script, /node --check/)
  assert.match(script, /probeParseErrors=/)
  assert.match(script, /ParseFile\('C:\\ls101-lab\\transfers\\lab-probes\.ps1'/)
  assert.match(script, /lab-harness\.mjs/)
  assert.match(script, /lab-probes\.ps1/)
  assert.match(script, /lab-task-output\.txt/)
  // Product state is read through the same probes the phase run uses. A duplicated inline query had
  // already drifted: it reported the service state without the process id, which is exactly the field a
  // stuck stop needs to tell "close() never finished" from "the process will not exit".
  // The probes are invoked through an explicit command line, not a parameter splat. `& $probes
  // @Arguments` answered `Unknown probe: -Probe` for every probe across two runs — the first positional
  // parameter received the literal string `-Probe` instead of the argument binding by name — and that
  // looked like a probe result rather than a harness failure. A command line built from quoted values
  // has one interpretation.
  // `Invoke-Expression` is what makes the arguments bind by name; the call operator alone passed the
  // whole string as the first parameter, which is what two runs of `Unknown probe: -Probe …` were.
  assert.match(script, /Invoke-Expression \('& ' \+ \(Quoted \$probes\) \+ ' ' \+ \$CommandLine\)/)
  // (`@(' a here-string starts with is not a splat; only the invocation form matters.)
  assert.doesNotMatch(script, /@Arguments/)
  assert.doesNotMatch(script, /Show-Probe '[^']+' @/)
  assert.match(script, /function Quoted\(\[string\]\$Value\)/)
  assert.match(script, /Show-Probe 'service' \('-Probe service -Name ' \+ \(Quoted \$serviceName\)\)/)
  assert.match(script, /Show-Probe 'wrapper logs' \('-Probe wrapper-logs -Path ' \+ \(Quoted \$logRoot\)/)
  // Values that reach the command line are quoted; the ones with spaces (a Program Files path) are why.
  for (const [, command] of script.matchAll(/Show-Probe '[^']+' \(?-?[^)]*\)/g))
    assert.ok(
      !/\$env:ProgramFiles(?!\))/.test(command) || command.includes('Quoted'),
      `a Program Files path must be quoted: ${command}`
    )
  assert.match(script, /Show-Probe 'wrapper logs'/)
  assert.match(script, /Show-Probe 'runtime process'/)
  assert.doesNotMatch(script, /Get-CimInstance Win32_Service -Filter "Name='LS101Lab'"/)
  // Service name, data root and port come from the same configuration the run used, not from literals.
  assert.match(script, /\$serviceName = if \(\$lab\) \{ \$lab\.serviceName \}/)
  assert.match(script, /lab-probes\.ps1 is not present on this VM/)
  // Read-only: no service, task or filesystem mutation.
  for (const forbidden of [
    /Start-Service/,
    /Stop-Service/,
    /Register-ScheduledTask/,
    /Start-ScheduledTask/,
    /Remove-Item/,
    /Set-Content/,
    /New-Item/
  ]) {
    assert.doesNotMatch(script, forbidden)
  }
})

test('a real invitation code is required and never accepted in a malformed shape', async () => {
  const { validateLabConfig } = await api
  assert.equal(validateLabConfig({ InvitationCode: '  LS101-ABC  ' }), 'LS101-ABC')
  for (const value of [undefined, '', '   ', 'a'.repeat(257), 'bad\r\ncode', 'bad\0code']) {
    assert.throws(() => validateLabConfig({ InvitationCode: value }), /InvitationCode/)
  }
})

test('the lab preflight fails before any VM work when the host cannot package the service', async () => {
  const { labPreflight } = await api
  const winsw = 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f'
  const base = { platform: 'win32', arch: 'x64', nodeVersion: '24.20.0', winswSha256: winsw }
  assert.doesNotThrow(() => labPreflight(base))
  assert.throws(() => labPreflight({ ...base, platform: 'linux' }), /Windows x64 host/)
  assert.throws(() => labPreflight({ ...base, arch: 'arm64' }), /Windows x64 host/)
  // scripts/lab/build-server.mjs refuses anything but exactly 24.20.0, so a near miss must fail here.
  assert.throws(() => labPreflight({ ...base, nodeVersion: '24.21.0' }), /exactly 24\.20\.0/)
  assert.throws(() => labPreflight({ ...base, winswSha256: '' }), /pinned SHA-256/)
  assert.throws(() => labPreflight({ ...base, winswSha256: 'deadbeef' }), /pinned SHA-256/)
})

test('lab guest configuration points the guest at every uploaded file and the documented port', async () => {
  const { labInstallerName, labGuestConfig, labGuestNodePath } = await api
  assert.equal(labInstallerName('teacher', '0.4.1'), 'ls101-lab-teacher-0.4.1-win-x64.exe')
  const config = labGuestConfig(
    {},
    { version: '0.4.1', nodeVersion: '24.20.0', hostTime: '2026-09-16T00:00:00.000Z' }
  )
  assert.equal(config.installer, 'C:\\ls101-lab\\transfers\\ls101-lab-teacher-0.4.1-win-x64.exe')
  assert.equal(config.driver, 'C:\\ls101-lab\\transfers\\manager-driver.mjs')
  // The protocol driver (milestone M2) travels beside the manager driver: same directory, same upload.
  assert.equal(config.protocolDriver, 'C:\\ls101-lab\\transfers\\protocol-driver.mjs')
  assert.equal(config.harness, 'C:\\ls101-lab\\transfers\\lab-harness.mjs')
  assert.equal(config.probes, 'C:\\ls101-lab\\transfers\\lab-probes.ps1')
  assert.equal(config.invitationFile, 'C:\\ls101-lab\\invitation.txt')
  assert.equal(config.node, labGuestNodePath('24.20.0'))
  assert.equal(config.releaseVersion, '0.4.1')
  assert.equal(config.port, 8443)
  // The host clock travels with the configuration so the guest can spot a broken VM clock.
  assert.equal(config.hostTime, '2026-09-16T00:00:00.000Z')
  assert.equal(config.serviceName, 'LS101Lab')
  assert.equal(config.serviceAccount, 'NT SERVICE\\LS101Lab')
  assert.match(config.programDir, /LS101LabService$/)
  // The installer hardens the data parent; the `data` child is created by the service on first start.
  assert.match(config.dataRoot, /ProgramData\\LS101Lab$/)
  assert.match(config.dataDir, /ProgramData\\LS101Lab\\data$/)
  // Every key the phase run requires must be present in what the host writes.
  const { REQUIRED_CONFIG_KEYS } = await import('../../infra/windows-vm/guest/lab-harness.mjs')
  for (const key of REQUIRED_CONFIG_KEYS)
    assert.ok(key in config, `configuration is missing ${key}`)
})

test('the protocol driver is bundled, checked and uploaded like the manager driver', async () => {
  const source = await readFile(labEntry, 'utf8')
  // The M2 protocol driver is a second bundle with the same lifecycle. Forgetting one of these steps
  // makes the guest phase fail with "Cannot find module" a full VM cycle later, so all four are pinned.
  const bundler = await readFile(path.resolve(__dirname, '../lab/build-test-driver.mjs'), 'utf8')
  assert.match(bundler, /'tests\/lab-vm\/protocol-driver\.ts', 'protocol-driver\.mjs'/)
  assert.match(source, /'protocol-driver\.mjs'/)
  assert.match(source, /protocolDriver, 'protocol-driver\.mjs'/)
  // The guest has no other way to learn the path.
  assert.match(source, /protocolDriver: guestPath/)
  // A preserved VM from an older run must be told which file is missing, not just fail later.
  const diagnostic = source.slice(source.indexOf('export function labDiagnoseScript'))
  assert.ok(
    diagnostic.indexOf('protocol-driver.mjs') < diagnostic.indexOf("Write-Output '=== results"),
    'the diagnostic has to list the protocol driver bundle'
  )
  // One failing probe must not end the diagnostic. The probes set `$ErrorActionPreference = 'Stop'` for
  // themselves and PowerShell keeps it in this scope afterwards, so without the reset the next cmdlet
  // becomes a terminating error — which is how a diagnostic collected to explain a failure exited 1
  // after printing almost nothing.
  assert.match(diagnostic, /try \{/)
  // The diagnostic re-uploads the probes: reading a preserved VM with the probe script from the failed
  // run asks the questions of the version that was already wrong, which is how two runs in a row ended
  // up with nine probes answering `Unknown probe: -Probe` instead of reporting product state.
  const diagnose = await readFile(labEntry, 'utf8')
  const diagnoseAction = diagnose.slice(diagnose.indexOf('async function labDiagnose'))
  assert.match(diagnoseAction, /'upload', path\.join\(root, 'guest', 'lab-probes\.ps1'\), LAB_GUEST_PROBES/)
  assert.match(diagnostic, /& \$probes @Arguments/)
  assert.match(diagnostic, /\$ErrorActionPreference = 'Continue'/)
  assert.match(diagnostic, /probe ' \+ \$Label \+ ' failed: '/)
  assert.ok(
    diagnostic.indexOf('& $probes @Arguments') < diagnostic.indexOf('catch {'),
    'the probe call has to be the thing that is guarded'
  )
  assert.ok(
    source.indexOf("protocolDriver, 'protocol-driver.mjs'") <
      source.indexOf("await putGuestFile(driver, 'manager-driver.mjs'"),
    'the bundle has to be checked before it is uploaded'
  )
})

test('the host peer check runs the same driver over the real link with no credential', async () => {
  const { hostPeerDriverCommands, hostPeerTarget } = await api
  const commands = hostPeerDriverCommands({
    address: '192.168.228.10',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    version: '0.4.1'
  })
  // The same bundle the guest ran, pointed at the guest: that is what makes this cross-machine evidence
  // rather than a loopback shortcut.
  assert.deepEqual(
    commands.map(([name]) => name),
    ['pin', 'login']
  )
  for (const [, args] of commands) {
    assert.ok(args.includes('https://192.168.228.10:8443/'))
    assert.ok(args.includes(`sha256:${'a'.repeat(64)}`))
    // No password file: a remote peer must be refused, and that refusal is the assertion.
    assert.equal(args.includes('--password-file'), false)
    assert.equal(args.includes('--local-proof-file'), false)
  }
  // The fingerprint comes from the guest results, not from whatever answers on the port.
  assert.deepEqual(
    hostPeerTarget({ 'initialize-service': { value: { fingerprint: 'sha256:x', port: 8443 } } }),
    { fingerprint: 'sha256:x', port: 8443, serverId: undefined }
  )
  assert.equal(hostPeerTarget({ 'initialize-service': { value: { port: 8443 } } }), null)
  assert.equal(hostPeerTarget({}), null)

  const source = await readFile(labEntry, 'utf8')
  // It must run after the firewall gate, or the port would still be closed and the check would prove
  // nothing about the product.
  assert.ok(
    source.indexOf('of hostPeerDriverCommands({') > source.indexOf('labFirewallScript()'),
    'the host peer check belongs after the firewall step'
  )
  assert.match(source, /lab-host-peer\.json/)
})

test('every protocol command the phase run invokes is registered in the driver', async () => {
  const orchestrator = await readGuest('lab-acceptance.mjs')
  const registry = await readFile(
    path.resolve(__dirname, '../../tests/lab-vm/protocol/index.ts'),
    'utf8'
  )
  // The registry mixes the two object-literal forms: `pin,` for a name that is a valid identifier and
  // `'enroll-issue': enrollIssue,` for one that is not.
  const registered = new Set([
    ...[...registry.matchAll(/^ {2}([a-z][a-z0-9-]*),$/gm)].map((match) => match[1]),
    ...[...registry.matchAll(/^ {2}'([a-z][a-z0-9-]*)':/gm)].map((match) => match[1])
  ])
  // The guest has no way to learn a command name except by invoking it, so a rename on one side would
  // otherwise surface as a failed VM run ten minutes in.
  const invoked = new Set(
    [...orchestrator.matchAll(/protocolResult\(\s*'([a-z][a-z0-9-]*)'/g)].map((match) => match[1])
  )
  assert.ok(invoked.size >= 6, `the phase run should exercise the protocol driver: ${[...invoked]}`)
  for (const name of invoked)
    assert.ok(registered.has(name), `protocol command '${name}' is not registered in the driver`)

  // Secrets travel through files: no step may put a password, a proof or a device secret on a command
  // line, where any process on the machine could read it from the process table.
  for (const match of orchestrator.matchAll(/protocolResult\([^)]*\]/gs)) {
    assert.doesNotMatch(
      match[0],
      /--(?:password|local-proof|device-secret)\s*['"`]/,
      match[0].slice(0, 120)
    )
  }
  // The milestone-M2 steps run after the milestone-M1 ones, because the protocol cases need an
  // installed, activated and initialized service.
  const order = [
    'stepSecretScan()',
    'stepProtocolPin()',
    'stepProtocolAuth()',
    'stepProtocolIpv6()',
    'stepEnrollmentBatch()',
    'stepEnrollmentNegatives()'
  ].map((name) => orchestrator.indexOf(`await ${name}`))
  for (let index = 1; index < order.length; index += 1)
    assert.ok(order[index] > order[index - 1], 'the milestone-M2 steps must run in order, after M1')
  for (const name of [
    'stepDeviceHeartbeat()',
    'stepServiceModeAdmission()',
    'stepConcurrencyLimits()'
  ])
    assert.ok(
      orchestrator.indexOf(`await ${name}`) > order[0],
      `${name} belongs to the milestone-M2 run`
    )
  // The leak scan runs twice: the early pass covers the two secrets that exist before the protocol
  // cases, and the final pass covers the archive password and the credentials M2 and M4 created. The
  // final pass therefore sits after the M4 group, which is the one exception to "M2 after M1".
  const early = orchestrator.indexOf('await stepSecretScan()')
  const late = orchestrator.indexOf('await stepFinalSecretScan()')
  assert.ok(early > 0 && late > early, 'the final leak pass must follow the early one')
  assert.ok(
    late > orchestrator.indexOf('await stepServiceUninstallAndReinstall()'),
    'the final leak pass must follow the M4 cases whose secrets it scans for'
  )
})

test('the lab task runs the Node orchestrator through the capturing launcher', async () => {
  const { labAcceptanceTaskScript, labGuestStateScript } = await api
  const script = labAcceptanceTaskScript({ NodeVersion: '24.20.0' })
  assert.match(script, /-LogonType Interactive/)
  assert.match(script, /-RunLevel Highest/)
  assert.match(script, /-File C:\\ls101-lab\\transfers\\start-lab-acceptance\.ps1/)
  assert.match(script, /-Script C:\\ls101-lab\\transfers\\lab-acceptance\.mjs/)
  assert.match(script, /-Node C:\\ls101-lab\\tools\\node-v24\.20\.0-win-x64\\node\.exe/)
  assert.match(script, /-Config C:\\ls101-lab\\transfers\\lab-config\.json/)
  assert.match(script, /-ResultsDir C:\\ls101-lab\\results/)
  assert.match(script, /-Output C:\\ls101-lab\\results\\lab-task-output\.txt/)
  assert.match(script, /Start-ScheduledTask -TaskName 'ls101-lab-acceptance'/)

  const state = labGuestStateScript()
  assert.match(state, /lab-status\.txt/)
  assert.match(state, /'ls101-lab-acceptance'/)
  assert.doesNotMatch(state, /'ls101-acceptance'/)
})

test('the launcher captures the child output so an early crash still explains itself', async () => {
  const launcher = await readGuest('start-lab-acceptance.ps1')
  // A real child process is what makes a start-up failure land in the redirected stream: the phase run
  // cannot report a problem that prevents it from starting.
  assert.match(
    launcher,
    /& \$Node \$Script --config \$Config --results-dir \$ResultsDir \*> \$Output/
  )
  assert.match(launcher, /exit \$LASTEXITCODE/)
})

test('the execute action reproduces the real run environment and is bounded', async () => {
  const { labExecuteScript } = await api
  const script = labExecuteScript({ NodeVersion: '24.20.0' }, { waitSeconds: 25 })
  assert.match(script, /-LogonType Interactive -RunLevel Highest/)
  assert.match(script, /-TaskName 'ls101-lab-execute'/)
  assert.doesNotMatch(script, /-TaskName 'ls101-lab-acceptance'/)
  assert.match(script, /-Script C:\\ls101-lab\\transfers\\lab-acceptance\.mjs/)
  assert.match(script, /-ResultsDir C:\\ls101-lab\\results/)
  // Bounded, so this never holds the WinRM call open for a whole install.
  assert.match(script, /Start-Sleep -Seconds 25/)
})

test('opening the service port is a scoped, idempotent and inbound-only firewall step', async () => {
  const { labFirewallScript } = await api
  const script = labFirewallScript()
  assert.match(script, /-Direction Inbound/)
  assert.match(script, /-Protocol TCP/)
  assert.match(script, /-LocalPort 8443/)
  assert.match(script, /-RemoteAddress LocalSubnet/)
  assert.doesNotMatch(script, /-RemoteAddress Any/)
  assert.match(labFirewallScript(9443), /-LocalPort 9443/)
})

test('the host probe reports whether the guest port really answers', async () => {
  const { probeGuestPort } = await api
  const net = require('node:net')
  const server = net.createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  try {
    assert.equal(await probeGuestPort('127.0.0.1', port, { timeoutMs: 2000 }), true)
  } finally {
    await new Promise((done) => server.close(done))
  }
  assert.equal(await probeGuestPort('127.0.0.1', port, { timeoutMs: 2000 }), false)
})

test('the lab run keeps the invitation code off every command line and out of the guest fileserver', async () => {
  const source = await readFile(labEntry, 'utf8')
  // The code travels through the encrypted WinRM channel, never the plain-HTTP file server that carries
  // bulk files, and never a logged command line or task action.
  assert.match(source, /run\('vagrant\.exe', \['upload', invitationFile, LAB_GUEST_INVITATION\]\)/)
  assert.doesNotMatch(source, /guestCommand\([^)]*[Ii]nivtation/)
  assert.doesNotMatch(source, /putGuestFile\([^)]*[Ii]nivtation/)
  assert.doesNotMatch(source, /report\.[A-Za-z]*[Ii]nvitationCode\s*=/)
  // The phase run reads it through the driver and deletes it once the service consumed it. It reads the
  // value into memory first — the scan below has to look for the code after its file is gone — but the
  // value may only be used for that comparison: never logged, never written anywhere.
  const orchestrator = await readGuest('lab-acceptance.mjs')
  const reads = [...orchestrator.matchAll(/readFileSync\(config\.invitationFile[^)]*\)/g)]
  assert.equal(reads.length, 1, 'the invitation code is read exactly once, for the leak scan')
  assert.match(orchestrator, /rmSync\(config\.invitationFile, \{ force: true \}\)/)
  for (const sink of [
    /run\.log\([^)]*invitationCodeValue/,
    /writeFileSync\([^)]*invitationCodeValue/,
    /results\.invitationCodeValue\s*=/
  ])
    assert.doesNotMatch(orchestrator, sink, 'the invitation code value must not reach a sink')
  // It is reported by length only, so a failing scan says which secret leaked without printing it.
  assert.match(orchestrator, /const secret = value \?\? \(file && existsSync\(file\)/)
  assert.match(orchestrator, /the \$\{label\} is available for the leak scan/)
  // Both passes exist: the early one before the protocol cases, the late one after M4 created its own
  // secrets. A single pass would either scan for a secret that is not there yet or miss the archive
  // password entirely.
  assert.match(orchestrator, /async function stepSecretScan\(\)/)
  assert.match(orchestrator, /async function stepFinalSecretScan\(\)/)
  assert.match(orchestrator, /backup password/)
  assert.match(orchestrator, /protocolSecretEntries\(\)/)
  // And the secret scan proves nothing leaked. It scans by value, so the assertion is the message the
  // leak produces rather than a fixed sentence.
  assert.match(orchestrator, /no \$\{label\} leaked into \$\{file\}/)
  assert.match(orchestrator, /scannedValues/)
})

test('every probe the phase run calls is defined with the parameters it passes', async () => {
  const orchestrator = await readGuest('lab-acceptance.mjs')
  const probes = await readGuest('lab-probes.ps1')
  const calls = [...orchestrator.matchAll(/probe\('([a-z-]+)'(?:\s*,\s*\[([\s\S]*?)\])?/g)]
  const defined = [...probes.matchAll(/^ {2}'([a-z-]+)' \{/gm)].map((match) => match[1])
  const declared = new Set(
    [...probes.matchAll(/^\s*\[[a-zA-Z\[\]]+\]\$([A-Za-z]+)/gm)].map((match) => match[1])
  )

  assert.ok(calls.length > 0, 'the phase run calls at least one probe')
  assert.ok(defined.length > 0, 'the probe script defines at least one probe')
  assert.ok(declared.size > 0, 'the probe script declares parameters')

  // A name that does not exist, or a flag the probe does not accept, would otherwise only be discovered
  // after a full VM rebuild: the probe exits non-zero and the run reports an unrelated step failure.
  for (const [, name, args] of calls) {
    assert.ok(defined.includes(name), `probe '${name}' is not defined in lab-probes.ps1`)
    for (const flag of (args ?? '').matchAll(/'(-[A-Za-z]+)'/g)) {
      assert.ok(
        declared.has(flag[1].slice(1)),
        `probe '${name}' is passed ${flag[1]}, which it does not declare`
      )
    }
  }
  // An unused probe is dead weight that silently stops being exercised.
  for (const name of defined) {
    assert.ok(
      calls.some(([, called]) => called === name),
      `probe '${name}' is never called`
    )
  }
})

test('a failed lab run collects the diagnostic itself, inside the window where it is still valid', async () => {
  const source = await readFile(labEntry, 'utf8')
  // A stuck stop never resolves on its own: WinSW only applies <stoptimeout> when it kills the service
  // process itself, and with <stoparguments> it waits on that process in a loop that keeps reporting
  // STOP_PENDING. Requiring a separate vm:diag run while the VM was still alive made the evidence
  // fragile; the failure path now collects it before rethrowing.
  const failurePath = source.slice(source.indexOf('if (guestError) {'))
  assert.match(failurePath, /labDiagnoseScript\(config\)/)
  assert.match(failurePath, /lab-diagnose\.txt/)
  assert.match(failurePath, /report\.diagnostic = diagnosticPath/)
  assert.ok(
    failurePath.indexOf('labDiagnoseScript(config)') <
      failurePath.indexOf('if (guestError) throw guestError'),
    'the diagnostic must be collected before the failure is rethrown'
  )
})

test('a failed restart captures the stop state before it can expire', async () => {
  const orchestrator = await readGuest('lab-acceptance.mjs')
  // A stop that never completes stays stuck: WinSW only applies <stoptimeout> when it kills the service
  // process itself, so the state has to be read while it is stuck rather than after some expiry. The
  // other two service steps already collected diagnostics; this one silently did not, which cost a
  // whole VM cycle.
  const restart = orchestrator.slice(orchestrator.indexOf('async function stepRestart'))
  assert.match(restart, /await serviceDiagnostics\(\)/)
  assert.match(restart, /await stopDiagnostics\(\)/)
  // The stop experiment must answer the three questions that separate the candidate causes.
  const stop = orchestrator.slice(
    orchestrator.indexOf('async function stopDiagnostics'),
    orchestrator.indexOf('async function stepRestart')
  )
  assert.match(stop, /'-Name', 'node\.exe', '-Match', 'server\.cjs'/)
  assert.match(stop, /'-Name', 'LS101Lab\.exe'/)
  assert.match(stop, /control channel after the stop request/)
  assert.match(stop, /manual shutdown: exit=/)
  // It runs the same command the wrapper runs on stop, so its timing is comparable.
  assert.match(stop, /'shutdown', '--data-dir', config\.dataDir/)
})

test('the restart records the process table while the service is stopping', async () => {
  const orchestrator = await readGuest('lab-acceptance.mjs')
  // The wrapper announces "Started process <pid>" without saying what it started, and its stop
  // executable exits straight away, so the only way to see the command line it ran is to sample the
  // process table beside the restart rather than polling a probe from the phase script.
  const restart = orchestrator.slice(
    orchestrator.indexOf('async function restartService'),
    orchestrator.indexOf('async function stepFirewallClosed')
  )
  assert.match(restart, /processSamplerScript/)
  // Sampling has to start before the restart, or a fast stop would be missed entirely.
  assert.ok(
    restart.indexOf('samplerArguments') <
      restart.indexOf("runProcess('powershell.exe', restartArguments"),
    'the sampler has to start before Restart-Service does'
  )
  const sampler = orchestrator.slice(
    orchestrator.indexOf('function processSamplerScript'),
    orchestrator.indexOf('async function restartService')
  )
  // Spawning a probe costs a whole PowerShell process, so the tight loop lives in the sampler instead.
  assert.match(sampler, /Start-Sleep -Milliseconds 100/)
  assert.match(sampler, /Name='node\.exe'/)
  assert.match(sampler, /ParentProcessId/)
  assert.match(sampler, /commandLine = \$commandLine/)
  // The phase script ends the sampler, so a normal restart waits no longer than it used to, and the
  // sampler still carries its own ceiling so it can never outlive the run.
  assert.match(sampler, /Test-Path -LiteralPath \$stopFile/)
  assert.match(sampler, /AddSeconds\(240\)/)
  assert.match(restart, /writeFileSync\(samplerStop/)
  assert.match(restart, /rmSync\(samplerStop, \{ force: true \}\)/)
  // The record is written out before the restart result is asserted on: a failed restart is exactly the
  // case that needs it.
  assert.ok(
    restart.indexOf('--- end process table ---') <
      restart.indexOf('assertThat(restarted.code === 0'),
    'the sampled process table must be recorded before the restart is judged'
  )
})

test('the vm:probe action reproduces a named guest script and decodes back to what runs', async () => {
  const {
    LAB_PROBE_COMMAND_LIMIT,
    labProbeNames,
    labProbeScript,
    labProbeTaskScript,
    parseAction,
    parseProbe,
    stripScriptComments
  } = await api
  // The action surface is a fixed list: this runs elevated in a VM, so an operator cannot hand it an
  // arbitrary script.
  assert.deepEqual(labProbeNames(), [
    'service-install',
    'service-verify',
    'installer-uninstall',
    'manifest-digests',
    'registration'
  ])
  assert.equal(parseAction(['lab-probe', 'service-install']), 'lab-probe')
  assert.equal(parseProbe(['lab-probe', 'service-verify']), 'service-verify')
  assert.equal(parseProbe(['lab-acceptance']), null)
  // A missing probe name is a parse error before any VM work happens, not a run that starts and then
  // discovers it has nothing to do.
  assert.throws(() => parseProbe(['lab-probe']), /needs exactly one probe name/)
  assert.throws(() => parseProbe(['lab-probe', 'rm-rf']), /needs exactly one probe name/)

  const config = { serviceName: 'LS101Lab', NodeVersion: '24.20.0' }
  const probe = labProbeScript('service-install', config)
  // It re-runs the script the NSIS hook ran, from the package's own resources, and reports the exit
  // code — the two facts the dialog swallowed.
  assert.match(probe, /Program Files\\ls101-lab-teacher\\resources\\lab-server\\install-windows\.ps1/)
  assert.match(probe, /exitCode=/)
  assert.doesNotMatch(probe, /-Verify/)
  assert.match(labProbeScript('service-verify', config), /-Verify/)
  assert.match(labProbeScript('installer-uninstall', config), /\/S/)
  // The installer has to run as a separate process through `-File`, exactly as the NSIS hook runs it.
  // Launching it in-process with `&` makes the parent deserialize the script's plain-text stderr as
  // CLIXML and die before it can print `LS101_INSTALL_ERROR [stage]: message`.
  assert.match(probe, /& \$shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '/)
  assert.match(probe, /Sysnative\\WindowsPowerShell\\v1\.0\\powershell\.exe/)
  assert.doesNotMatch(probe, /^& 'C:\\Program Files/m)
  // stderr is merged into the captured stream as text, so a trap line cannot be lost to a stream the
  // probe never reads.
  assert.match(probe, /2>&1 \| ForEach-Object \{ Write-Output \(\[string\]\$_\) \}/)
  assert.throws(() => labProbeScript('nope', config), /Unknown lab probe/)
  // `sameRuntime` is the installer's own decision variable: equal manifest digests mean a same-version
  // reinstall needs no preparation, unequal means the install is an "upgrade" and demands one. The probe
  // reports both digests and the comparison, because a silent install failure gives no clue which branch
  // was taken.
  const digests = labProbeScript('manifest-digests', config)
  assert.match(digests, /sameRuntime=/)
  assert.match(digests, /Get-FileHash -LiteralPath \$installedManifest -Algorithm SHA256/)
  assert.match(digests, /Get-FileHash -LiteralPath \$packagedManifest -Algorithm SHA256/)
  assert.match(digests, /upgrade-ready present=/)
  // The registration probe reproduces the one query `local-status.ts` uses to decide whether the
  // service exists, verbatim, and puts the plain SCM views next to it: the helper collapses every
  // failure of that query into STORAGE_UNAVAILABLE, so the only way to tell "service gone" from "query
  // broken" is to run the same command and read what it prints.
  const registration = labProbeScript('registration', config)
  assert.match(registration, /what local-status\.ts runs/)
  assert.match(registration, /Get-CimInstance Win32_Service -Filter "Name=''\$name''"/)
  assert.match(registration, /Select-Object State, StartMode \| ConvertTo-Json -Compress/)
  assert.match(registration, /cimDirect=/)
  assert.match(registration, /getService=/)
  assert.match(registration, /sc\.exe query \$name/)
  assert.match(registration, /runtimeManifest=/)
  assert.match(registration, /recordPresent=/)

  // The probe travels as UTF-16LE base64 written to a file and decoded on the guest: a command line
  // cannot carry it (Windows caps one at 8191 characters and `winrm --command` reports the overrun as a
  // bare ENAMETOOLONG), so the generated script only ever handles the payload as data. It is decoded
  // here, which is the only way to check that without a VM.
  const task = labProbeTaskScript('service-install', config, { timeoutSeconds: 42 })
  const chunks = [...task.matchAll(/^ {2}'([A-Za-z0-9+/=]+)'/gm)].map((match) => match[1])
  assert.ok(chunks.length > 0, 'the task writes the probe as base64 chunks')
  const decoded = Buffer.from(chunks.join(''), 'base64').toString('utf16le')
  assert.equal(decoded, stripScriptComments(probe), 'the probe that runs is exactly the one built here')
  // Every probe has to fit the command line the harness will actually send.
  for (const name of labProbeNames())
    assert.ok(
      labProbeTaskScript(name, config).length < LAB_PROBE_COMMAND_LIMIT,
      `probe ${name} must serialise inside the ${LAB_PROBE_COMMAND_LIMIT}-character command line`
    )
  assert.match(task, /lab-probe-output\.txt/)
  assert.match(task, /lab-probe\.b64/)
  assert.match(task, /run-lab-probe\.ps1/)
  assert.match(task, /-File "C:\\ls101-lab\\transfers\\run-lab-probe\.ps1"/)
  // The decoded probe is echoed back so the evidence shows what ran, and the launcher exits with the
  // probe's own status rather than the decoder's.
  assert.match(task, /Get-Content -LiteralPath 'C:\\ls101-lab\\results\\lab-probe-output\.txt'/)
  // The wait polls the task rather than sleeping: a probe that hits the failure dialog never finishes,
  // and the run has to say so instead of reporting the sleep as a result.
  assert.match(task, /Get-ScheduledTask -TaskName 'ls101-lab-probe'/)
  assert.match(task, /AddSeconds\(42\)/)
  assert.match(task, /-LogonType Interactive -RunLevel Highest/)
  // The probe output is echoed back, and the script is printed decoded so the evidence shows what ran.
  assert.match(task, /=== probe output ===/)
  assert.match(task, /Get-Content -LiteralPath 'C:\\ls101-lab\\results\\lab-probe-output\.txt'/)
})

test('milestone M4 drives the real upgrade, uninstall and retention paths', async () => {
  const orchestrator = await readGuest('lab-acceptance.mjs')
  const { labGuestConfig } = await api

  // The run has to be about the deliverable rather than about one file: the student installer travels
  // with the run, and the configuration the host writes must name it or the guest cannot assert it.
  const config = labGuestConfig(
    {},
    { version: '0.4.1', nodeVersion: '24.20.0', hostTime: '2026-09-16T00:00:00.000Z' }
  )
  assert.equal(
    config.studentInstaller,
    'C:\\ls101-lab\\transfers\\ls101-lab-student-0.4.1-win-x64.exe'
  )
  const { REQUIRED_CONFIG_KEYS } = await import('../../infra/windows-vm/guest/lab-harness.mjs')
  assert.ok(REQUIRED_CONFIG_KEYS.includes('studentInstaller'))
  assert.match(orchestrator, /stepUpgradePackages\(\)/)

  // U1–U5 as separate steps. Each one is a distinct claim, so a single combined step would make a
  // failure unreadable — and the order matters, because each case leaves the machine in the state the
  // next one measures. They all run after the M2 cases, which need the install step's own runtime.
  const steps = [
    'stepUpgradeInitialState',
    'stepReinstallSameVersion',
    'stepUpgradeWithoutPreparation',
    'stepPreparedUpgrade',
    'stepClientUninstall',
    'stepServiceUninstallAndReinstall'
  ]
  const positions = steps.map((name) => orchestrator.indexOf(`await ${name}()`))
  for (const [index, position] of positions.entries())
    assert.ok(position > 0, `${steps[index]} must be invoked from main()`)
  for (let index = 1; index < positions.length; index += 1)
    assert.ok(positions[index] > positions[index - 1], 'the M4 cases must run in order')
  assert.ok(
    positions[0] > orchestrator.indexOf('await stepConcurrencyLimits()'),
    'the M4 cases belong after the milestone-M2 run, which needs the service the install step produced'
  )

  // U1 is about *no* preparation being required. The step has to assert the record is absent before the
  // reinstall, or the case would pass for the wrong reason.
  const sameVersion = orchestrator.slice(
    orchestrator.indexOf('async function stepReinstallSameVersion'),
    orchestrator.indexOf('async function stepUpgradeWithoutPreparation')
  )
  assert.match(sameVersion, /runInstaller\(config\.installer, \['\/S'\]\)/)
  assert.match(
    sameVersion,
    /!existsSync\(upgradeReadyFile\),\s*'no upgrade preparation record exists before the same-version reinstall'/
  )
  assert.match(sameVersion, /sameRuntime === true/)
  // "Autostart is unchanged" is only meaningful against a setting that is not the default.
  assert.match(sameVersion, /autostart === autostartBefore/)
  // Two product rules shape the sequence: the installer requires a stopped service, and a running
  // service would make `--prepare-install` demand maintenance mode plus a backup. Running the installer
  // against a live service is what hung the first attempt on the NSIS MessageBox for the whole timeout.
  assert.match(sameVersion, /await stopService\('same-version reinstall'\)/)
  assert.match(sameVersion, /await startService\('same-version reinstall'\)/)
  assert.ok(
    sameVersion.indexOf("stopService('same-version reinstall')") <
      sameVersion.indexOf("runInstaller(config.installer, ['/S'])"),
    'the service has to be stopped before the installer runs'
  )

  // U2's refusal is the product's decision, so the case has to reach it by making the installer see a
  // *different* runtime while the service is running — and then prove the old service survived. Both
  // preparation failure shapes are covered: absent, and present but naming another target.
  const refused = orchestrator.slice(
    orchestrator.indexOf('async function stepUpgradeWithoutPreparation'),
    orchestrator.indexOf('async function stepPreparedUpgrade')
  )
  assert.match(refused, /sameRuntime === false/)
  // The precondition has to make the installer's own comparison false. It compares the record's release
  // manifest with the package's, so the copy is given a different manifest *before* it is named after
  // that manifest's digest — writing the original bytes back (as the first attempt did) leaves the
  // digests equal and the case can never be set up.
  assert.match(refused, /renameSync\(staging, olderDirectory\)/)
  assert.match(refused, /releaseVersion: '0\.4\.0'/)
  assert.ok(
    refused.indexOf("releaseVersion: '0.4.0'") < refused.indexOf('renameSync(staging, olderDirectory)'),
    'the manifest must change before the release is named after its digest'
  )
  assert.match(refused, /'the installer will read the alternate release from the installation record'/)
  // `reinstallTargets` has to read the record, not the package: comparing the package's manifest with
  // the service's own runtime manifest is always equal on a machine installed from that package.
  assert.match(orchestrator, /const record = JSON.parse\(readFileSync\(recordPath, 'utf8'\)\)[\s\S]{0,200}installedManifestPath/)
  assert.match(
    refused,
    /missingPreparation\.result\.code !== 0 && !missingPreparation\.result\.timedOut/
  )
  assert.match(
    refused,
    /rejection\.result\.code !== 0 && !rejection\.result\.timedOut/
  )
  // "Nothing changed" is not enough on its own: an installer that silently skipped its service step
  // would satisfy it. The replacement marker the install script writes five stages after the guard is
  // what makes the refusal attributable.
  assert.match(refused, /installation\.json\.previous/)
  assert.match(refused, /'the refused install reached the service installation stage before it refused'/)
  assert.match(refused, /await stopService\('refused version change'\)/)
  assert.match(refused, /'the refused install left the service registered and stopped'/)
  assert.match(refused, /await startService\('after the refused version change'\)/)
  // The machine is put back whichever way the step ended, so the next case cannot measure residue.
  assert.match(refused, /finally \{[\s\S]*rmSync\(upgradeReadyFile, \{ force: true \}\)/)
  assert.match(refused, /writeInstallationRecord\(\{ release: previous\.release \}\)/)

  // U2's prepared half has to establish the durable precondition rather than assume it: a real backup,
  // created through the service, in maintenance mode. The upgrade itself runs the installer directly,
  // which is the checklist's own step ("run the new teacher NSIS installer without first running the new
  // unpacked directory") and the only path that exercises `teacher.nsh`'s customInstall hook.
  const prepared = orchestrator.slice(
    orchestrator.indexOf('async function stepPreparedUpgrade'),
    orchestrator.indexOf('async function stepClientUninstall')
  )
  assert.match(prepared, /protocolResult\('backup'/)
  assert.match(prepared, /backup\.backupStatus === 'ready'/)
  assert.match(prepared, /backup\.readable === true/)
  assert.match(prepared, /!existsSync\(upgradeReadyFile\)/)
  assert.match(prepared, /'the service runs so the installer can ask it to prepare the upgrade'/)
  assert.match(prepared, /runInstaller\(config\.installer, \['\/S'\]\)/)
  assert.match(prepared, /'the upgrade kept the service identity'/)
  assert.match(prepared, /'the upgrade kept the published exam byte for byte'/)
  assert.match(prepared, /'the submission record survived the upgrade'/)
  // The manager's own `upgrade` entry point stops the service; the installer path is the one where the
  // service stops on the installer's own request, so the two must not be confused here.
  assert.doesNotMatch(orchestrator, /'--operation',\s*'upgrade'/)

  // U3 uses the client's own uninstaller and asserts the three things that must survive it.
  const clientUninstall = orchestrator.slice(
    orchestrator.indexOf('async function stepClientUninstall'),
    orchestrator.indexOf('async function stepServiceUninstallAndReinstall')
  )
  assert.match(clientUninstall, /uninstallerPath\(\)/)
  assert.match(clientUninstall, /runInstaller\(uninstaller, \['\/S'\]\)/)
  assert.match(clientUninstall, /'the client uninstall left the service registered and running'/)
  assert.match(clientUninstall, /'the business data is intact after the client uninstall'/)

  // U4/U5: refused while running, removed when stopped, and the data plus the identity survive the
  // reinstall. Autostart is turned on first so "unchanged" cannot be confused with "reset".
  const serviceUninstall = orchestrator.slice(
    orchestrator.indexOf('async function stepServiceUninstallAndReinstall'),
    orchestrator.indexOf('async function stepUpgradePackages')
  )
  assert.match(serviceUninstall, /manageOperation\('uninstall', \{ allowFailure: true, raw: true \}\)/)
  assert.match(serviceUninstall, /refused\.error === 'RESOURCE_BUSY'/)
  assert.match(serviceUninstall, /\['config', config\.serviceName, 'start=', 'auto'\]/)
  assert.match(serviceUninstall, /waitForServiceState\('Stopped'\)/)
  assert.match(serviceUninstall, /manageOperation\('uninstall'\)/)
  assert.match(serviceUninstall, /'the reinstalled service kept the original identity'/)
  assert.match(serviceUninstall, /\['config', config\.serviceName, 'start=', 'demand'\]/)

  // The uninstaller path comes from the registry entry the installer wrote, not from a guessed name.
  // electron-builder's NSIS writes `QuietUninstallString` but **not** `InstallLocation`, and the first
  // run that reached M4 failed precisely because the discovery required an install location: the entry
  // was there, printed beside the assertion, with `installLocation: null`. The fix keeps every candidate
  // and takes the command's quoted path, so the shape the installer actually writes has to keep working.
  assert.match(orchestrator, /quietUninstallString/)
  assert.match(orchestrator, /uninstallerPath/)
  assert.match(orchestrator, /function quotedPath\(/)
  assert.match(orchestrator, /candidates\.find\(\(candidate\) => existsSync\(candidate\)\)/)
  const discovery = orchestrator.slice(
    orchestrator.indexOf('async function uninstallerPath'),
    orchestrator.indexOf('// =================================================================================================\n// Milestone M4')
  )
  assert.doesNotMatch(
    discovery,
    /assertThat\(entry !== undefined/,
    'discovery must not require an entry to carry an install location'
  )

  // The backup command is a precondition of an upgrade, not a case of its own: it has to exist in the
  // registry, be called with a password file rather than a password, and be covered in the container.
  const registry = await readFile(
    path.resolve(__dirname, '../../tests/lab-vm/protocol/index.ts'),
    'utf8'
  )
  assert.match(registry, /^ {2}backup,$/m)
  const invoked = [...orchestrator.matchAll(/protocolResult\(\s*'([a-z][a-z0-9-]*)'/g)].map(
    (match) => match[1]
  )
  assert.ok(invoked.includes('backup'))
  const backupCommand = await readFile(
    path.resolve(__dirname, '../../tests/lab-vm/protocol/commands/backup.ts'),
    'utf8'
  )
  assert.match(backupCommand, /--backup-password-file/)
  await readFile(path.resolve(__dirname, '../../tests/lab-vm/protocol/backup.test.ts'), 'utf8')
})

test('the manager driver can reach both product entry points M4 depends on', async () => {
  const driver = await readFile(
    path.resolve(__dirname, '../../tests/lab-vm/manager-driver.ts'),
    'utf8'
  )
  // `install-windows.ps1` runs `manager.cjs --prepare-install` before it replaces the program
  // directory. Running that same command is the only way to observe the refusal M4's version-change
  // case is about, and it exits with a code rather than over the control channel.
  assert.match(driver, /'--prepare-install'/)
  assert.match(driver, /function prepareInstall/)
  assert.match(driver, /exitCode: child\.status/)
  assert.match(driver, /command === 'prepare-install'/)
  assert.match(driver, /prepare-install requires --runtime/)
  // The refusal code lives in the helper result, not in the exit status: `--raw` reports it so the
  // phase script can assert `RESOURCE_BUSY` instead of parsing a message.
  assert.match(driver, /args\.includes\('--raw'\)/)
  assert.match(driver, /JSON\.stringify\(helperResult\)/)
})

test('a transient status failure does not abort the upgrade cases', async () => {
  const orchestrator = await readGuest('lab-acceptance.mjs')
  // `local-status.ts` collapses every failure of its single `Get-CimInstance Win32_Service` query —
  // including a 10 s timeout — into `STORAGE_UNAVAILABLE`, and discards the child's stderr. The M4 run of
  // 2026-09-20 hit that eight seconds after the same machine reported `state: running`, with the
  // diagnostic showing the service Running and its listener up, so the case for a bounded retry is the
  // evidence rather than a hunch. A real absence survives the attempts and is reported with all of them.
  assert.match(orchestrator, /async function helperStatus\(\{ attempts = 3, intervalMs = 1500 \} = \{\}\)/)
  assert.match(orchestrator, /result\.error !== 'STORAGE_UNAVAILABLE' \|\| attempt === attempts/)
  assert.match(orchestrator, /helper status recovered on attempt/)
  assert.match(orchestrator, /'the manager helper read the service status', tried/)
})

test('the teacher installer cannot hang on a silent failure', async () => {
  const nsh = await readFile(
    path.resolve(__dirname, '../../resources/lab/windows/teacher.nsh'),
    'utf8'
  )
  // `MessageBox` blocks until a human clicks it, so a silent install has nobody to click it: the process
  // and its installer sit there forever. The M4 acceptance run hit exactly that and reported it as a
  // 900-second timeout with empty stdout and stderr, which is why the design document's risk 2 moved
  // from unverified to confirmed.
  assert.match(nsh, /\$\{If\} \$\{Silent\}/)
  assert.match(nsh, /SetErrorLevel 2/)
  assert.match(nsh, /DetailPrint "Local service installation failed \(exit \$0\)/)
  // The dialog has to stay inside the `Else` branch: an interactive operator still gets the explanation.
  const silentBranch = nsh.slice(nsh.indexOf('${If} ${Silent}'), nsh.indexOf('Abort'))
  assert.doesNotMatch(silentBranch, /MessageBox/, 'the silent branch must not raise a dialog')
  // The dialog survives in the `Else` branch, after the silent one, so an interactive operator still
  // gets an explanation while an unattended run does not block.
  assert.match(
    nsh.slice(nsh.indexOf('${If} ${Silent}')),
    /\$\{Else\}[\s\S]*MessageBox/,
    'the dialog belongs to the interactive branch, after the silent one'
  )
  // The failure still aborts, in both modes: a refused service installation must not leave a client
  // behind. `Abort` follows the whole branch, so it is not inside either half of it.
  // `Abort` follows the whole silent/interactive branch, so it is not inside either half of it: the
  // close it follows is the branch's own `${EndIf}`, not the outer one that ends the macro's failure
  // block (which comes later).
  assert.ok(
    nsh.indexOf('Abort') > nsh.lastIndexOf('${EndIf}', nsh.indexOf('Abort')),
    'Abort must run for a silent failure as well as an interactive one'
  )
  assert.equal(
    nsh.split('${EndIf}').length - 1,
    2,
    'the failure branch and the outer guard each close once'
  )
  // And nsExec's captured output is used rather than discarded, so the log carries the reason.
  assert.match(nsh, /Pop \$1/)
  assert.match(nsh, /DetailPrint "\$1"/)
})

test('the service definition declares start arguments as startarguments', async () => {
  const raw = await readFile(
    path.resolve(__dirname, '../../resources/lab/windows/LS101Lab.xml'),
    'utf8'
  )
  // XML forbids a double hyphen inside a comment, and the natural way to describe this very trap is to
  // write "--data-dir" in one. WinSW parses the file with XmlDocument, so a comment like that turns the
  // service definition into an unloadable file; the authoritative parse happens in the installer, and
  // this catches the mistake a whole VM cycle earlier.
  for (const [, body] of raw.matchAll(/<!--([\s\S]*?)-->/g)) {
    assert.equal(body.includes('--'), false, 'an XML comment must not contain a double hyphen')
    assert.equal(body.endsWith('-'), false, 'an XML comment must not end with a hyphen')
  }
  // Comments are stripped for the element assertions: they explain the trap by naming <arguments>.
  const xml = raw.replace(/<!--[\s\S]*?-->/g, '')
  // WinSW builds the stop command line as stoparguments + " " + arguments, and its documentation is
  // explicit: "When you use the <stoparguments>, you must use <startarguments> instead of <arguments>".
  // Getting this wrong is silent - the wrapper logs nothing about the stop process - and it cost a
  // whole VM cycle: the stop process exited with INVALID_ARGUMENTS, the runtime kept running, and the
  // SCM sat in Stop Pending forever because <stoptimeout> is only honoured when WinSW kills the
  // service itself.
  assert.match(xml, /<stoparguments>/)
  assert.match(xml, /<startarguments>/)
  // Both elements together are just as wrong: the start line would then be built as
  // startarguments + arguments and every start would fail instead.
  assert.doesNotMatch(xml, /<arguments>/)
  const startArguments = xml.match(/<startarguments>(.*)<\/startarguments>/)[1]
  const stopArguments = xml.match(/<stoparguments>(.*)<\/stoparguments>/)[1]
  // The two subcommands are mutually exclusive, so neither may be a prefix of the other.
  assert.match(startArguments, /server\.cjs" serve --data-dir/)
  assert.match(stopArguments, /server\.cjs" shutdown --data-dir/)
  assert.equal(stopArguments.includes(' serve '), false)
  // The installer refuses the same shapes on the machine that has to live with them.
  const installer = await readFile(
    path.resolve(__dirname, '../lab/install-server-windows.ps1'),
    'utf8'
  )
  assert.match(installer, /\$stage = 'verify-service-definition'/)
  assert.match(
    installer,
    /\[xml\]\(Get-Content -LiteralPath \(Join-Path \$source 'LS101Lab\.xml'\) -Raw\)/
  )
  assert.match(installer, /SelectSingleNode\('\/\/stoparguments'\)/)
  // It has to run before -Verify returns, or a verification pass would accept a broken definition.
  assert.ok(
    installer.indexOf('verify-service-definition') <
      installer.indexOf("Write-Output 'Service runtime verified.'"),
    'the service definition must be verified as part of the runtime check'
  )
})
