import { resolve } from 'node:path'
import { startLabDesktop } from '../../packages/lab-desktop-host/src/desktop'
import { requestLocalControl } from '../../packages/lab-server/src/control'

const root = process.env.LS101_TEST_SERVICE_ROOT
if (!root) throw new Error('Missing test fixture service')
startLabDesktop({
  role: 'teacher',
  releaseVersion: '0.4.1',
  preload: resolve('out/lab-teacher/preload/index.js'),
  renderer: resolve('out/lab-teacher/renderer/index.html'),
  localService: {
    async invoke(operation, input) {
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
