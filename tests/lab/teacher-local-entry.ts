import { resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { startTeacherDesktop } from '../../apps/lab-teacher/main/desktop'
import { requestLocalControl } from '../../packages/lab-server/src/control'

const root = process.env.LS101_TEST_SERVICE_ROOT
if (!root) throw new Error('Missing test fixture service')

startTeacherDesktop({
  releaseVersion: '0.4.1',
  preload: resolve('out/lab-teacher/preload/index.js'),
  renderer: resolve('out/lab-teacher/renderer/index.html'),
  localService: {
    async invoke(operation, input) {
      if (process.env.LS101_TEST_SERVICE_MANAGEMENT === '1') {
        const filename = resolve(root, 'management.json')
        const fixture = JSON.parse(await readFile(filename, 'utf8'))
        if (operation === 'status') return fixture.status
        if (operation === 'install') throw new Error(fixture.installError)
        if (operation === 'uninstall') {
          if (fixture.rejectUninstall) throw new Error('RESOURCE_BUSY')
          fixture.status = { ...fixture.status, state: 'not-installed', autostart: false }
          fixture.uninstalled = true
          await writeFile(filename, JSON.stringify(fixture))
          return fixture.status
        }
        throw new Error('Unsupported service management fixture operation')
      }
      if (operation === 'status')
        return {
          ...(await requestLocalControl<Record<string, unknown>>(root, 'status')),
          autostart: false,
          error: null
        }
      if (operation === 'connection') return requestLocalControl(root, 'connection', input)
      throw new Error('Fixture excludes OS service mutations')
    }
  }
})
