import { Cpu, Info, Palette } from 'lucide-react'
import { AIRouterSettingsPage } from '../features/airouter/AIRouterSettingsPage'
import { AboutSettingsPage } from '../features/settings/AboutSettingsPage'
import { AppearanceSettingsPage } from '../features/settings/AppearanceSettingsPage'
import { registerSettingsPage } from './settings-registry'

const unregisterSettingsPages = [
  registerSettingsPage({
    id: 'ai-router',
    title: 'AI 引擎',
    description: '配置 AI Provider 和各类可用模型',
    icon: Cpu,
    group: {
      id: 'ai',
      label: 'AI',
      order: 10
    },
    order: 0,
    component: AIRouterSettingsPage
  }),
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
  }),
  registerSettingsPage({
    id: 'about',
    title: '关于',
    description: '查看应用版本、项目团队和软件许可',
    icon: Info,
    group: {
      id: 'general',
      label: '通用',
      order: 0
    },
    order: 100,
    component: AboutSettingsPage
  })
]

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterSettingsPages.forEach((unregister) => unregister())
  })
}
