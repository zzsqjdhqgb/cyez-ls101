/*
 * Bundles the guest-side lab driver into a single file so the disposable VM needs neither the source
 * tree nor node_modules: the control-channel protocol is inlined from packages/lab-server instead of
 * being reimplemented, which is the whole point of importing it there.
 */
import { build } from 'vite'
import { resolve } from 'node:path'

await build({
  configFile: false,
  ssr: { noExternal: true },
  build: {
    ssr: resolve('tests/lab-vm/manager-driver.ts'),
    outDir: resolve('out/lab-vm'),
    target: 'node24',
    rollupOptions: {
      external: [/^node:/],
      output: { format: 'es', entryFileNames: 'manager-driver.mjs', inlineDynamicImports: true }
    }
  }
})
