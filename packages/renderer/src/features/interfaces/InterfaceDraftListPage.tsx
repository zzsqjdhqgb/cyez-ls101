import type { JSX } from 'react'
import { Navigate } from 'react-router-dom'

export function InterfaceDraftListRedirect(): JSX.Element {
  return <Navigate replace to="/interfaces?view=drafts" />
}
