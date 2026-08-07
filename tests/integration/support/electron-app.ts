import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { access } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()

export async function launchIntegrationApp(userDataDir: string): Promise<ElectronApplication> {
  const executablePath = integrationExecutablePath()
  await access(executablePath).catch(() => {
    throw new Error(
      `Packaged integration test executable not found: ${executablePath}. Run yarn build:test first.`
    )
  })

  const environment = { ...process.env, LS101_INTEGRATION_TEST: '1' }
  delete environment['ELECTRON_RENDERER_URL']

  return electron.launch({
    executablePath,
    args: ['--no-sandbox', '--password-store=basic', `--user-data-dir=${userDataDir}`],
    cwd: path.dirname(executablePath),
    env: environment
  })
}

export function integrationExecutablePath(platform = process.platform): string {
  const override = process.env['LS101_INTEGRATION_EXECUTABLE']
  if (override) return path.resolve(override)
  if (platform === 'win32') {
    return path.join(projectRoot, 'dist', 'win-unpacked', 'CYEZ-LS101.exe')
  }
  if (platform === 'linux') {
    return path.join(projectRoot, 'dist', 'linux-unpacked', 'cyez-ls101')
  }
  throw new Error(`Packaged integration tests do not support platform: ${platform}`)
}
