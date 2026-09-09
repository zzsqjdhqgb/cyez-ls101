import { build } from 'vite'
import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const expectedNode = '24.20.0'
if (process.versions.node !== expectedNode)
  throw new Error(`Required build runtime: Node ${expectedNode}`)
if (!['linux', 'win32'].includes(process.platform)) throw new Error('Unsupported service platform')
const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'out/lab-server')
await access(resolve(root, 'node_modules'), constants.W_OK)
await mkdir(output, { recursive: true })
await access(output, constants.W_OK)
const metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
await build({
  configFile: false,
  root,
  define: { __LAB_VERSION__: JSON.stringify(metadata.version) },
  ssr: { noExternal: true, external: ['7zip-bin'] },
  build: {
    ssr: resolve(root, 'packages/lab-server/src/cli.ts'),
    outDir: output,
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    rollupOptions: {
      external: ['7zip-bin', /^node:/],
      output: { format: 'cjs', entryFileNames: 'server.cjs', inlineDynamicImports: true }
    }
  }
})
await build({
  configFile: false,
  root,
  define: { __LAB_VERSION__: JSON.stringify(metadata.version) },
  ssr: { noExternal: true, external: ['7zip-bin'] },
  build: {
    ssr: resolve(root, 'packages/lab-server/src/manager-cli.ts'),
    outDir: output,
    emptyOutDir: false,
    target: 'node24',
    minify: false,
    rollupOptions: {
      external: ['7zip-bin', /^node:/],
      output: { format: 'cjs', entryFileNames: 'manager.cjs', inlineDynamicImports: true }
    }
  }
})
const engineRoot = dirname(require.resolve('7zip-bin/package.json'))
const engine = require('7zip-bin').path7za
await access(engine, constants.X_OK)
if (process.platform !== 'win32' && engine.endsWith('.exe'))
  throw new Error('Required native archive tool is Windows-only')
const runtimeName = process.platform === 'win32' ? 'node.exe' : 'node'
let wrapper
if (process.platform === 'win32') {
  if (process.arch !== 'x64') throw new Error('Windows service currently requires x64')
  const response = await fetch(
    'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe'
  )
  if (!response.ok) throw new Error('Unable to fetch pinned service wrapper')
  wrapper = Buffer.from(await response.arrayBuffer())
  if (
    createHash('sha256').update(wrapper).digest('hex') !==
    'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f'
  )
    throw new Error('Service wrapper digest mismatch')
  await writeFile(resolve(output, 'LS101Lab.exe'), wrapper)
}
const engineRelative = `${process.platform === 'win32' ? 'win' : 'linux'}/${process.arch}/${process.platform === 'win32' ? '7za.exe' : '7za'}`
const files = [
  [process.execPath, `runtime/${runtimeName}`],
  [resolve(engineRoot, 'index.js'), 'node_modules/7zip-bin/index.js'],
  [resolve(engineRoot, 'package.json'), 'node_modules/7zip-bin/package.json'],
  [engine, `node_modules/7zip-bin/${engineRelative}`],
  ...(process.platform === 'linux'
    ? [
        [resolve(root, 'resources/lab/linux/ls101-lab.service'), 'ls101-lab.service'],
        [resolve(root, 'scripts/lab/install-server-linux.mjs'), 'install-linux.mjs']
      ]
    : [
        [resolve(root, 'resources/lab/windows/LS101Lab.xml'), 'LS101Lab.xml'],
        [resolve(root, 'resources/lab/windows/WinSW-LICENSE.txt'), 'WinSW-LICENSE.txt'],
        [resolve(root, 'scripts/lab/install-server-windows.ps1'), 'install-windows.ps1']
      ])
]
for (const [source, relative] of files) {
  const target = resolve(output, relative)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}
await chmod(resolve(output, `runtime/${runtimeName}`), 0o755)
await chmod(resolve(output, `node_modules/7zip-bin/${engineRelative}`), 0o755)
const manifest = {
  format: 'ls101-service-runtime',
  releaseVersion: metadata.version,
  nodeVersion: expectedNode,
  sqliteVersion: process.versions.sqlite,
  platform: process.platform,
  arch: process.arch,
  files: []
}
for (const relative of [
  'server.cjs',
  'manager.cjs',
  ...(wrapper ? ['LS101Lab.exe'] : []),
  ...files.map(([, relative]) => relative)
]) {
  const bytes = await readFile(resolve(output, relative))
  manifest.files.push({
    path: relative,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
}
await writeFile(resolve(output, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
