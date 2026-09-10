const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises')
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

test('failed build does not publish box credentials', async () => {
  const { buildBox, exists } = await api
  const { root, config } = await fixture()
  await assert.rejects(
    buildBox(
      root,
      config,
      (_command, args) => {
        if (args[0] === 'build') throw new Error('Packer failed')
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
