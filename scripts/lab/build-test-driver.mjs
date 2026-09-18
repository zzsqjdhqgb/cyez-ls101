/*
 * Bundles the guest-side lab drivers into single files so the disposable VM needs neither the source
 * tree nor node_modules.
 *
 * `manager-driver` inlines the control-channel protocol from packages/lab-server instead of
 * reimplementing it; `protocol-driver` inlines the product client stack (PinnedTransport, LabClient,
 * the generated contract validators) from packages/lab-desktop-host, packages/lab-client and
 * packages/lab-contracts. That is the whole point of importing them here rather than copying them.
 *
 * The TLS double the protocol driver uses for the wrong-pin case carries its own test certificate, so
 * no certificate generation library is pulled into the bundle.
 *
 * The output directory is emptied once, by hand: Vite empties it per build, so with the default the
 * last entry would be the only bundle left behind and the VM run would fail on the missing file.
 */
import { build } from 'vite'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const outDir = resolve('out/lab-vm')
// `ipv6` imports LabService for one static base-URL check, and LabService imports the backup store,
// which imports `7zip-bin`. That module resolves its packaged binary from `__dirname` at load time and
// cannot survive being inlined into an ES bundle, so it is aliased to a stub that fails loudly if a
// backup path is ever reached from the driver. See tests/lab-vm/protocol/seven-zip-stub.ts.
const sevenZipStub = resolve('tests/lab-vm/protocol/seven-zip-stub.ts')
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const entries = [
  ['tests/lab-vm/manager-driver.ts', 'manager-driver.mjs'],
  ['tests/lab-vm/protocol-driver.ts', 'protocol-driver.mjs'],
  ['tests/lab-vm/echo-helper.ts', 'echo-helper.mjs']
]

for (const [entry, fileName] of entries) {
  await build({
    configFile: false,
    ssr: { noExternal: true },
    resolve: { alias: { '7zip-bin': sevenZipStub } },
    build: {
      ssr: resolve(entry),
      outDir,
      emptyOutDir: false,
      target: 'node24',
      rollupOptions: {
        external: [/^node:/],
        output: { format: 'es', entryFileNames: fileName, inlineDynamicImports: true }
      }
    }
  })
}
