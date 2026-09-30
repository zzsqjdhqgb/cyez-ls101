import { randomUUID } from 'node:crypto'
import type { Schema } from '@ls101/lab-contracts'
import type { Session } from './context'

// Driver state is test instrumentation, not the student's portable connection configuration.
export async function registerStudent(
  session: Session,
  enrollmentFile: string,
  computerName: string,
  version: string,
  runtimeId = randomUUID(),
  platform: 'linux' | 'win32' = process.platform === 'win32' ? 'win32' : 'linux'
): Promise<Schema<'StudentSession'> & { connectionSecret: string; runtimeId: string }> {
  const connection = await session.client.request<Schema<'ServerConnection'>>(
    'postEnrollmentConnections',
    {
      body: { enrollmentFile, computerName, releaseVersion: version }
    }
  )
  const registered = await session.client.request<Schema<'StudentSession'>>('postStudentSessions', {
    body: { ...connection, computerName, platform, runtimeId }
  })
  return { ...registered, ...connection, runtimeId }
}
