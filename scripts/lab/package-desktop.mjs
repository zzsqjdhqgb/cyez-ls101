import { build, Platform, Arch } from 'electron-builder'
import { build as buildDesktop } from 'electron-vite'
import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const [role, mode, ...extra] = process.argv.slice(2)
if (!['student', 'teacher'].includes(role) || (mode && mode !== '--dir') || extra.length)
  throw new Error('Use student|teacher [--dir]')
if (!['linux', 'win32'].includes(process.platform)) throw new Error('Unsupported lab platform')
const root = resolve(import.meta.dirname, '../..')
await access(resolve(root, 'node_modules'), constants.W_OK)
await mkdir(resolve(root, 'out'), { recursive: true })
await access(resolve(root, 'out'), constants.W_OK)
await mkdir(resolve(root, 'dist'), { recursive: true })
await access(resolve(root, 'dist'), constants.W_OK)
await buildDesktop({ configFile: resolve(root, `electron.vite.lab-${role}.config.ts`) })
if (role === 'teacher')
  execFileSync(process.execPath, [resolve(root, 'scripts/lab/build-server.mjs')], {
    cwd: root,
    stdio: 'inherit'
  })
const metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const app = resolve(root, `out/lab-${role}`)
await writeFile(
  resolve(app, 'package.json'),
  `${JSON.stringify({ name: `ls101-lab-${role}`, version: metadata.version, main: 'main/index.js', description: `LS101 Lab ${role}`, homepage: 'https://github.com/zzsqjdhqgb/cyez-ls101', author: 'LS101', private: true }, null, 2)}\n`
)
const platform = process.platform === 'win32' ? Platform.WINDOWS : Platform.LINUX
if (process.platform === 'linux') {
  const templates = resolve(
    dirname(require.resolve('app-builder-lib/package.json')),
    'templates/linux'
  )
  const install = await readFile(resolve(templates, 'after-install.tpl'), 'utf8')
  const remove = await readFile(resolve(templates, 'after-remove.tpl'), 'utf8')
  const installExtra =
    role === 'student'
      ? '\ninstall -D -m 644 "/opt/${sanitizedProductName}/resources/student-autostart.desktop" /etc/xdg/autostart/ls101-lab-student.desktop\n'
      : '\n"/opt/${sanitizedProductName}/resources/lab-server/runtime/node" "/opt/${sanitizedProductName}/resources/lab-server/install-linux.mjs" --install || exit 1\n'
  await writeFile(resolve(app, 'after-install.sh'), install + installExtra)
  await writeFile(
    resolve(app, 'after-remove.sh'),
    remove + (role === 'student' ? '\nrm -f /etc/xdg/autostart/ls101-lab-student.desktop\n' : '\n')
  )
}
await build({
  projectDir: app,
  targets: platform.createTarget(
    mode === '--dir' ? ['dir'] : process.platform === 'win32' ? ['nsis'] : ['deb'],
    Arch[process.arch]
  ),
  config: {
    extends: null,
    appId: `com.ls101.lab.${role}`,
    productName: `LS101 Lab ${role === 'student' ? 'Student' : 'Teacher'}`,
    executableName: `ls101-lab-${role}`,
    electronVersion: require('electron/package.json').version,
    directories: {
      app,
      output: resolve(root, `dist/lab-${role}`),
      buildResources: resolve(root, 'build')
    },
    files: ['main/**', 'preload/**', 'renderer/**', 'package.json', '!**/node_modules/**'],
    extraResources:
      role === 'teacher'
        ? [
            { from: resolve(root, 'out/lab-server'), to: 'lab-server' },
            // electron-builder excludes a resource root's node_modules directory.
            {
              from: resolve(root, 'out/lab-server/node_modules/7zip-bin'),
              to: 'lab-server/node_modules/7zip-bin'
            }
          ]
        : process.platform === 'linux'
          ? [
              {
                from: resolve(root, 'resources/lab/linux/student.desktop'),
                to: 'student-autostart.desktop'
              }
            ]
          : [],
    asar: true,
    npmRebuild: false,
    electronFuses: {
      runAsNode: false,
      enableNodeCliInspectArguments: false,
      enableNodeOptionsEnvironmentVariable: false,
      onlyLoadAppFromAsar: true
    },
    artifactName: `ls101-lab-${role}-\${version}-\${os}-\${arch}.\${ext}`,
    linux: {
      category: 'Education',
      icon: resolve(root, 'build/icon.png'),
      maintainer: 'LS101 <support@ls101.invalid>'
    },
    win: { requestedExecutionLevel: 'asInvoker' },
    deb: {
      afterInstall: resolve(app, 'after-install.sh'),
      afterRemove: resolve(app, 'after-remove.sh')
    },
    nsis: {
      oneClick: false,
      perMachine: true,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
      include: resolve(root, `resources/lab/windows/${role}.nsh`)
    },
    fileAssociations:
      role === 'student' ? [{ ext: 'lsjoin', name: 'LS101 enrollment', role: 'Viewer' }] : [],
    publish: null,
    afterPack: async ({ appOutDir }) => {
      const entries = require('@electron/asar').listPackage(
        resolve(appOutDir, 'resources/app.asar')
      )
      const unexpected = entries.filter(
        (path) => !/^\/(main|preload|renderer)(\/|$)/.test(path) && path !== '/package.json'
      )
      if (unexpected.length)
        throw new Error(`Unexpected packaged dependencies: ${unexpected.join(', ')}`)
      let runtimeManifest
      if (role === 'teacher') {
        const sourceManifest = await readFile(resolve(root, 'out/lab-server/runtime-manifest.json'))
        const serviceRoot = resolve(appOutDir, 'resources/lab-server')
        if (!(await readFile(resolve(serviceRoot, 'runtime-manifest.json'))).equals(sourceManifest))
          throw new Error('Packaged service manifest differs from the build')
        runtimeManifest = JSON.parse(sourceManifest.toString('utf8'))
        for (const file of runtimeManifest.files) {
          const bytes = await readFile(resolve(serviceRoot, file.path))
          if (
            bytes.length !== file.bytes ||
            createHash('sha256').update(bytes).digest('hex') !== file.sha256
          )
            throw new Error(`Packaged service integrity mismatch: ${file.path}`)
        }
      }
      await writeFile(
        resolve(appOutDir, 'resources/package-audit.json'),
        `${JSON.stringify({ role, entries, runtimeManifest }, null, 2)}\n`
      )
    }
  }
})
