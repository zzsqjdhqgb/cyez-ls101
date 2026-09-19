import { useSyncExternalStore } from 'react'
import { TeacherSession, type TeacherView } from './session'

export const teacherSession = new TeacherSession(window.lab)

export function useTeacherSession(): { session: TeacherSession; view: TeacherView } {
  const view = useSyncExternalStore(teacherSession.subscribe, teacherSession.getSnapshot)

  return { session: teacherSession, view }
}
