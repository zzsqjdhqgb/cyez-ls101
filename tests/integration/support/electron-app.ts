import {
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { createHash } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()

export const INTEGRATION_LICENSE_CODE = 'ls101-integration-license'
export const INTEGRATION_LICENSE_CODE_HASH = createHash('sha256')
  .update(INTEGRATION_LICENSE_CODE.toUpperCase(), 'utf8')
  .digest('hex')
const INTEGRATION_LICENSE_NOW = '2026-08-23T08:00:00.000Z'

interface IntegrationAppLaunchOptions {
  contentSize?: {
    width: number
    height: number
  }
  deviceScaleFactor?: number
  extraArgs?: readonly string[]
  environment?: Record<string, string>
  license?: 'activated' | 'not-activated'
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

  const environment = {
    ...process.env,
    LS101_INTEGRATION_TEST: '1',
    LS101_LICENSE_TEST_CODE_HASH: INTEGRATION_LICENSE_CODE_HASH,
    LS101_LICENSE_TEST_NOW: INTEGRATION_LICENSE_NOW,
    ...options.environment
  }
  delete environment['ELECTRON_RENDERER_URL']

  if (options.license !== 'not-activated') {
    await writeFile(
      path.join(userDataDir, 'license.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          invitationCodeHash: environment['LS101_LICENSE_TEST_CODE_HASH'],
          activatedAt: environment['LS101_LICENSE_TEST_NOW']
        },
        null,
        2
      )}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
  }

  const args = ['--no-sandbox', '--password-store=basic', `--user-data-dir=${userDataDir}`]
  if (options.deviceScaleFactor !== undefined) {
    args.push(`--force-device-scale-factor=${options.deviceScaleFactor}`)
  }
  if (options.randomSeed !== undefined) {
    args.push(`--js-flags=--random-seed=${options.randomSeed}`)
  }
  if (options.extraArgs) args.push(...options.extraArgs)

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

export async function closeStartupReleaseNotes(page: Page): Promise<void> {
  const closeButton = page.getByRole('button', { name: '关闭版本说明' })
  await expect(closeButton).toBeVisible()
  await closeButton.click()
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
