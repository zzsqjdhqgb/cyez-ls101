import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ComponentTestApp } from './component-test-app'
import '../../packages/renderer/src/styles/tokens.css'
import '../../packages/renderer/src/styles/global.css'

const root = document.getElementById('root')

if (!root) throw new Error('Component test root was not found')

createRoot(root).render(
  <StrictMode>
    <ComponentTestApp />
  </StrictMode>
)
