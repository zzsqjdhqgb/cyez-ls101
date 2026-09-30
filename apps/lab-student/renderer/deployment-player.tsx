import { useCallback, useMemo, type JSX } from 'react'
import { ExamPlayer } from '@ls101/exam-player'
import type { ExamPackage } from '@ls101/core-types'
import type { StudentView } from './controller'
import { playbackExam, TEST_CANDIDATE } from './deployment-tests'
import { PracticeNotice } from './src/components/PracticeNotice'

export function DeploymentPlayer({
  player
}: {
  player: NonNullable<StudentView['testPlayer']>
}): JSX.Element {
  const parameters = player.lease.parameters
  const fetcher = useMemo<typeof fetch>(
    () => async (input, init) => {
      player.signal.throwIfAborted()
      const response = await fetch(input, { ...init, signal: player.signal })
      if (
        String(input).endsWith('/manifest.json') &&
        response.ok &&
        parameters.type === 'deployment-test'
      )
        return Response.json(
          playbackExam((await response.json()) as ExamPackage, parameters.caseIds.includes('audio'))
        )
      return response
    },
    [player, parameters]
  )
  const beforeStart = useCallback(async () => {
    player.signal.throwIfAborted()
    if (parameters.type !== 'deployment-test') throw new Error('Deployment lease required')
    return { submissionId: parameters.testSubmissionId }
  }, [player, parameters])
  return (
    <>
      <ExamPlayer
        examBaseUrl={player.baseUrl}
        fetcher={fetcher}
        allowExit={false}
        startSession={{ candidate: TEST_CANDIDATE }}
        beforeStart={beforeStart}
        onFinish={player.finish}
        onError={player.fail}
        onExit={() => player.fail(new Error('Deployment playback stopped'))}
      />
      <PracticeNotice>部署测试</PracticeNotice>
    </>
  )
}
