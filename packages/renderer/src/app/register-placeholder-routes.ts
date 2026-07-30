import { PanelsTopLeft, Settings2 } from 'lucide-react'
import { SettingsPlaceholderPage } from '../pages/SettingsPlaceholderPage'
import { WorkspacePlaceholderPage } from '../pages/WorkspacePlaceholderPage'
import { registerAppRoute } from './route-registry'

const unregisterWorkspace = registerAppRoute({
  id: 'workspace-placeholder',
  path: '/',
  component: WorkspacePlaceholderPage,
  navigation: {
    label: '工作区',
    icon: PanelsTopLeft,
    placement: 'main',
    order: 0
  }
})

const unregisterSettings = registerAppRoute({
  id: 'settings-placeholder',
  path: '/settings',
  component: SettingsPlaceholderPage,
  navigation: {
    label: '设置',
    icon: Settings2,
    placement: 'footer',
    order: 0
  }
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterWorkspace()
    unregisterSettings()
  })
}
