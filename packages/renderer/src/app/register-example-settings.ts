import { Palette } from 'lucide-react'
import { AppearanceSettingsExample } from '../features/settings/AppearanceSettingsExample'
import { registerSettingsPage } from './settings-registry'

const unregisterSettingsPages = [
  registerSettingsPage({
    id: 'appearance-example',
    title: '外观（示例）',
    description: '临时演示页面，设置不会保存',
    icon: Palette,
    group: {
      id: 'general',
      label: '通用',
      order: 0
    },
    order: 0,
    component: AppearanceSettingsExample
  })
]

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterSettingsPages.forEach((unregister) => unregister())
  })
}
