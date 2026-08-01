import { Palette } from 'lucide-react'
import { AppearanceSettingsPage } from '../features/settings/AppearanceSettingsPage'
import { registerSettingsPage } from './settings-registry'

const unregisterSettingsPages = [
  registerSettingsPage({
    id: 'appearance',
    title: '外观',
    description: '调整应用主题和动态效果',
    icon: Palette,
    group: {
      id: 'general',
      label: '通用',
      order: 0
    },
    order: 0,
    component: AppearanceSettingsPage
  })
]

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterSettingsPages.forEach((unregister) => unregister())
  })
}
