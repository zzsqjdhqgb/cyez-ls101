import { expect, test, type Page } from '@playwright/test'
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Schema } from '@ls101/lab-contracts'
import type { LabHost, StudentRecord } from '@ls101/lab-desktop-host'
import { machineDataRoot } from '../../packages/lab-desktop-host/src/binding'
import { businessFixture } from './support/business-fixture'

const records = (page: Page): Promise<StudentRecord[]> =>
  page.evaluate(() =>
    (window as unknown as { lab: LabHost }).lab.invoke<StudentRecord[]>('records.list')
  )

test('student saves while disconnected, survives restart and uploads the same archive once reconnected', async () => {
  test.setTimeout(90000)
  const f = await businessFixture()
  try {
    const enrollment = await f.teacher.request<Schema<'EnrollmentCreated'>>(
      'postTeacherEnrollments',
      {
        body: { expectedModeRevision: 1, validForSeconds: 600 },
        idempotencyKey: randomUUID()
      }
    )
    const joinArchive = await f.teacher.request<{ handle: string }>('getTeacherEnrollmentsIdFile', {
      path: { id: enrollment.enrollment.id }
    })
    const joinFile = join(f.root, 'lab.lsjoin')
    await copyFile(f.transport.file(joinArchive.handle), joinFile)
    const first = await f.launch('student', [
      joinFile,
      '--server-fingerprint',
      f.service.identity.fingerprint
    ])
    await expect(first.page.getByRole('heading', { name: '机房维护中' })).toBeVisible()
    const file = await f.examFile(12)
    const imported = await f.teacher.request<Schema<'ExamImport'>>('postTeacherExams', {
      archive: await f.transport.registerArchive(f.target.connectionId, file),
      idempotencyKey: randomUUID()
    })
    await f.teacher.request('patchTeacherExamsExamId', {
      path: { examId: imported.examId },
      body: { published: true, expectedRevision: imported.revision }
    })
    await f.teacher.request('deleteTeacherEnrollmentsId', {
      path: { id: enrollment.enrollment.id }
    })
    await f.teacher.request('putTeacherServiceMode', {
      body: { mode: 'normal', expectedRevision: 1 }
    })
    await first.page.getByRole('button', { name: '刷新连接' }).click()
    await first.page.getByRole('button', { name: '开始练习' }).click()
    await first.page.getByLabel('姓名', { exact: true }).fill('断网学生')
    await first.page.getByLabel('考生号').fill('2001')
    await first.page.getByRole('button', { name: '继续', exact: true }).click()
    await expect
      .poll(
        () =>
          f.service.db.get<{ total: number }>('SELECT count(*) AS total FROM practice_grants')
            ?.total
      )
      .toBe(1)
    // Stop the actual TLS listener: renderer request routing cannot intercept main-process HTTPS.
    await expect(first.page.getByText('第 1 / 1 页', { exact: true })).toBeVisible()
    await f.offline()
    await expect(first.page.getByRole('heading', { name: '考试完成' })).toBeVisible({
      timeout: 20000
    })
    await first.page.getByRole('button', { name: '完成', exact: true }).click()
    await first.page.getByRole('link', { name: '处理中', exact: true }).click()
    await expect(first.page.getByText('断网学生', { exact: true })).toBeVisible()
    const [saved] = await records(first.page)
    expect(saved).toMatchObject({ archivePresent: true, receipt: null })
    const archivePath = join(
      machineDataRoot(join(f.root, 'student-lab-student')),
      'submissions',
      saved.submissionId,
      'archive.lssubmission'
    )
    const bytes = await readFile(archivePath)
    expect(bytes.length).toBe(saved.archiveBytes)
    expect(
      f.service.db.get<{ total: number }>('SELECT count(*) AS total FROM submissions')?.total
    ).toBe(0)
    await first.app.close()
    const restarted = await f.launch('student')
    await expect(
      restarted.page.getByRole('heading', { name: '连接异常', exact: true })
    ).toBeVisible()
    await expect(restarted.page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
    await expect(restarted.page.getByRole('button', { name: '开始练习' })).toHaveCount(0)
    expect(await records(restarted.page)).toEqual([
      expect.objectContaining({
        submissionId: saved.submissionId,
        archiveSha256: saved.archiveSha256,
        archivePresent: true,
        receipt: null
      })
    ])
    expect(await readFile(archivePath)).toEqual(bytes)
    await f.online()
    await restarted.page.getByRole('button', { name: '刷新连接' }).click()
    await restarted.page.getByRole('link', { name: '处理中', exact: true }).click()
    // Wait for recovery to choose a stable outcome before locating a button that disappears
    // after automatic upload. Unknown previous attempts require receipt lookup and manual retry.
    await expect
      .poll(async () => {
        const record = (await records(restarted.page))[0]
        return (
          record.state === 'completed' ||
          (record.state === 'retry-required' && record.retryPolicy === 'manual')
        )
      })
      .toBe(true)
    if ((await records(restarted.page))[0].state !== 'completed') {
      await restarted.page.getByRole('button', { name: '重试提交' }).click()
    }
    await expect.poll(async () => (await records(restarted.page))[0].state).toBe('completed')
    await restarted.page.getByRole('link', { name: '历史', exact: true }).click()
    await expect(restarted.page.getByText('提交完成', { exact: true })).toBeVisible()
    const [completed] = await records(restarted.page)
    expect(completed.submissionId).toBe(saved.submissionId)
    expect(completed.archiveSha256).toBe(saved.archiveSha256)
    expect(completed.receipt).not.toBeNull()
    expect(await readFile(archivePath)).toEqual(bytes)
    expect(
      f.service.db.get<{ total: number }>('SELECT count(*) AS total FROM submissions')?.total
    ).toBe(1)
    await restarted.app.close()
    const confirmed = await f.launch('student')
    await expect.poll(async () => (await records(confirmed.page))[0]?.state).toBe('completed')
    expect((await records(confirmed.page))[0].attemptCount).toBe(completed.attemptCount)
    expect(
      f.service.db.get<{ total: number }>('SELECT count(*) AS total FROM submissions')?.total
    ).toBe(1)
  } finally {
    await f.close()
  }
})
