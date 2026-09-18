import { useEffect, useRef, type JSX } from 'react'
import { App } from './app/App'
import { markRendererStartupMilestone } from './startup-timing'

interface StartupApplicationViewProps {
  showReleaseNotes: boolean
}

export function StartupApplicationView({
  showReleaseNotes
}: StartupApplicationViewProps): JSX.Element {
  const firstFrameRecorded = useRef(false)

  useEffect(() => {
    let afterPaintFrame = 0
    const paintFrame = window.requestAnimationFrame(() => {
      afterPaintFrame = window.requestAnimationFrame(() => {
        if (firstFrameRecorded.current) return
        firstFrameRecorded.current = true
        markRendererStartupMilestone('main-interface-first-frame')
      })
    })

    return () => {
      window.cancelAnimationFrame(paintFrame)
      window.cancelAnimationFrame(afterPaintFrame)
    }
  }, [])

  return <App showReleaseNotesOnStartup={showReleaseNotes} />
}
