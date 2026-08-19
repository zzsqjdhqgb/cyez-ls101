import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { access } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()

interface IntegrationAppLaunchOptions {
  contentSize?: {
    width: number
    height: number
  }
  deviceScaleFactor?: number
  randomSeed?: number
}

export async function launchIntegrationApp(
  userDataDir: string,
  options: IntegrationAppLaunchOptions = {}
): Promise<ElectronApplication> {
  const executablePath = integrationExecutablePath()
  await access(executablePath).catch(() => {
    throw new Error(
      `Packaged integration test executable not found: ${executablePath}. Run yarn build:test first.`
    )
  })

  const environment = { ...process.env, LS101_INTEGRATION_TEST: '1' }
  delete environment['ELECTRON_RENDERER_URL']

  const args = ['--no-sandbox', '--password-store=basic', `--user-data-dir=${userDataDir}`]
  if (options.deviceScaleFactor !== undefined) {
    args.push(`--force-device-scale-factor=${options.deviceScaleFactor}`)
  }
  if (options.randomSeed !== undefined) {
    args.push(`--js-flags=--random-seed=${options.randomSeed}`)
  }

  const electronApp = await electron.launch({
    executablePath,
    args,
    cwd: path.dirname(executablePath),
    env: environment
  })

  if (options.contentSize) {
    await electronApp.firstWindow()
    await electronApp.evaluate(({ BrowserWindow }, contentSize) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Integration application did not create a browser window')
      window.setContentSize(contentSize.width, contentSize.height)
    }, options.contentSize)
  }

  return electronApp
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
