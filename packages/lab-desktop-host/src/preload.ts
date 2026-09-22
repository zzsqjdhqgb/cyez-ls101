import { contextBridge, ipcRenderer } from 'electron'
import { createWindowControlsBridge } from '@ls101/desktop-ui/main'
import type { LabHost } from './shared'

const capabilities = new Set([
  'license.status',
  'license.activate',
  'startup.status',
  'startup.commands',
  'window.close',
  'window.maintenance',
  'foreground.set',
  'binding.summary',
  'binding.connect',
  'binding.runtime',
  'binding.observe',
  'connections.list',
  'operations.list',
  'connections.save',
  'connections.open',
  'connections.authenticate',
  'connections.close',
  'transport.request',
  'transport.cancel',
  'transfer.import',
  'transfer.export',
  'transfer.exportJson',
  'cache.prepare',
  'cache.release',
  'practice.persist',
  'records.list',
  'records.begin',
  'records.chunk',
  'records.finish',
  'records.cas',
  'records.uploadHandle',
  'records.export',
  'tasks.listJournals',
  'tasks.saveJournal',
  'tasks.cleanupResult',
  'tests.storage',
  'tests.prepare',
  'tests.release',
  'tests.begin',
  'tests.chunk',
  'tests.finish',
  'tests.list',
  'tests.cas',
  'tests.uploadHandle',
  'cleanup.preview',
  'cleanup.snapshot',
  'cleanup.item',
  'localService.status',
  'localService.install',
  'localService.uninstall',
  'localService.upgrade',
  'localService.configure',
  'localService.updateSettings',
  'localService.changePassword',
  'localService.selectBackup',
  'localService.recover-restore',
  'localService.initialize',
  'localService.start',
  'localService.stop',
  'localService.force-stop',
  'localService.export-data',
  'localService.purge',
  'localService.autostart',
  'localService.logs',
  'localService.connection',
  'localService.restore'
])
const host: LabHost = {
  invoke(capability, input) {
    if (!capabilities.has(capability))
      return Promise.reject(new Error('Unsupported host capability'))
    return ipcRenderer.invoke('lab:invoke', capability, input)
  },
  onEvent(listener) {
    const receive = (
      _event: Electron.IpcRendererEvent,
      value: { type: string; value: unknown }
    ): void => listener(value)
    ipcRenderer.on('lab:event', receive)
    return () => ipcRenderer.removeListener('lab:event', receive)
  }
}
contextBridge.exposeInMainWorld('lab', host)
contextBridge.exposeInMainWorld('windowControls', createWindowControlsBridge(ipcRenderer))
