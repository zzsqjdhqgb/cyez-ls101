import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LabService } from '../../../packages/lab-server/src/service'
import { createLabHttpServer, closeLabHttpServer } from '../../../packages/lab-server/src/http'
import { PinnedTransport } from '../../../packages/lab-desktop-host/src/transport'
import { LabClient } from '../../../packages/lab-client/src/index'
import { INVITATION_CODE_HASH } from '../../../packages/license/src/index'
import { encodeExamPackage } from '../../../packages/exam-package/src/index'
import type { ExamPackage } from '@ls101/core-types'
import { LAB_VERSION } from './release-version'

interface DesktopApp {
  app: ElectronApplication
  page: Page
}
interface BusinessFixture {
  root: string
  service: LabService
  transport: PinnedTransport
  target: Awaited<ReturnType<PinnedTransport['open']>>
  teacher: LabClient
  launch(role: 'student' | 'teacher', extra?: string[]): Promise<DesktopApp>
  launchTeacher(): Promise<DesktopApp>
  examFile(seconds?: number): Promise<string>
  online(): Promise<void>
  offline(): Promise<void>
  close(): Promise<void>
}

export async function businessFixture(): Promise<BusinessFixture> {
  const root = await mkdtemp(join(tmpdir(), 'ls101-business-'))
  const service = await LabService.initialize(
    { root: join(root, 'server'), releaseVersion: LAB_VERSION, isLicenseActive: () => true },
    { name: 'Business Lab', baseUrl: 'https://127.0.0.1:8443/', password: 'test-password' }
  )
  const server = createLabHttpServer(service)
  const apps = new Set<ElectronApplication>()
  let port = 0
  const online = async (): Promise<void> => {
    await new Promise<void>((done) => server.listen(port, '127.0.0.1', done))
    port = (server.address() as { port: number }).port
  }
  const close = async (): Promise<void> => {
    await Promise.all([...apps].map((app) => app.close()))
    await closeLabHttpServer(server)
    await service.backups.wait()
    await service.db.close()
    await rm(root, { recursive: true, force: true })
  }
  try {
    await online()
    const baseUrl = `https://127.0.0.1:${port}/`
    service.db.transaction(() => service.saveData({ ...service.data(), baseUrl }))
    const transport = new PinnedTransport(join(root, 'downloads'), LAB_VERSION)
    const target = await transport.open(
      { baseUrl, fingerprint: service.identity.fingerprint },
      'teacher'
    )
    await transport.authenticate(target.connectionId, 'test-password')
    const teacher = new LabClient(target.connectionId, transport)
    const launch = async (
      role: 'student' | 'teacher',
      extra: string[] = []
    ): Promise<DesktopApp> => {
      const data = join(root, `${role}-lab-${role}`)
      await mkdir(data, { recursive: true })
      await writeFile(
        join(data, 'license.json'),
        JSON.stringify({
          schemaVersion: 1,
          invitationCodeHash: INVITATION_CODE_HASH,
          activatedAt: new Date().toISOString()
        })
      )
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RENDERER_URL'
        )
      )
      const app = await electron.launch({
        args: [
          resolve(`out/lab-${role}/main/index.js`),
          '--no-sandbox',
          '--password-store=basic',
          `--user-data-dir=${join(root, role)}`,
          ...extra
        ],
        env
      })
      apps.add(app)
      app.on('close', () => apps.delete(app))
      return { app, page: await app.firstWindow() }
    }
    const launchTeacher = async (): Promise<DesktopApp> => {
      const result = await launch('teacher')
      const { page } = result
      await page.getByRole('button', { name: '添加服务' }).click()
      await page.getByLabel('服务地址', { exact: true }).fill(baseUrl)
      await page.getByLabel('公钥指纹', { exact: true }).fill(service.identity.fingerprint)
      await page.getByLabel('已通过管理员核对公钥指纹').check()
      await page.getByLabel('管理密码', { exact: true }).fill('test-password')
      await page.getByRole('button', { name: '连接', exact: true }).click()
      await expect(page.getByRole('heading', { name: '试卷', exact: true })).toBeVisible()
      return result
    }
    const examFile = async (seconds = 0): Promise<string> => {
      const packageId = randomUUID()
      const exam: ExamPackage = {
        format: 'ls101-exam',
        formatVersion: 1,
        packageId,
        examData: {
          title: '独立业务练习',
          resources: {},
          player: {
            pages: [{ id: 'one', content: [], timeline: [{ type: 'countdown', seconds }] }],
            recordingIndices: []
          }
        },
        answerCapturePlan: { strings: [], audios: [] },
        submissionTemplate: {
          format: 'ls101-submission',
          formatVersion: 1,
          meta: { examPackageId: packageId, examTitle: '独立业务练习' },
          schemaUses: [],
          resources: {}
        }
      }
      const file = join(root, `${packageId}.lsexam`)
      await writeFile(file, await encodeExamPackage(exam, {}))
      return file
    }
    return {
      root,
      service,
      transport,
      target,
      teacher,
      launch,
      launchTeacher,
      examFile,
      online,
      offline: () => closeLabHttpServer(server),
      close
    }
  } catch (error) {
    await close()
    throw error
  }
}
