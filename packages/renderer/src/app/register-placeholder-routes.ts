import { Boxes, PanelsTopLeft, Settings2 } from 'lucide-react'
import { FocusPlaceholderPage } from '../pages/FocusPlaceholderPage'
import { GroupedPlaceholderPage } from '../pages/GroupedPlaceholderPage'
import { HiddenPlaceholderPage } from '../pages/HiddenPlaceholderPage'
import { ImmersivePlaceholderPage } from '../pages/ImmersivePlaceholderPage'
import { SettingsPlaceholderPage } from '../pages/SettingsPlaceholderPage'
import { WorkbenchPage } from '../pages/WorkbenchPage'
import { registerAppRoute } from './route-registry'

const unregisterRoutes = [
  // Default main navigation registration. `placement` defaults to `main`.
  registerAppRoute({
    id: 'workbench',
    path: '/',
    component: WorkbenchPage,
    layout: 'standard',
    navigation: {
      label: '工作台',
      icon: PanelsTopLeft,
      order: 0
    }
  }),

  // Grouped main navigation registration.
  registerAppRoute({
    id: 'grouped-placeholder',
    path: '/grouped-example',
    component: GroupedPlaceholderPage,
    navigation: {
      label: '分组页面',
      icon: Boxes,
      group: '示例分组',
      order: 10
    }
  }),

  // Footer navigation registration.
  registerAppRoute({
    id: 'settings-placeholder',
    path: '/settings',
    component: SettingsPlaceholderPage,
    navigation: {
      label: '设置',
      icon: Settings2,
      placement: 'footer',
      order: 0
    }
  }),

  // Hidden route registration. Omitting `navigation` keeps it out of the sidebar.
  registerAppRoute({
    id: 'hidden-placeholder',
    path: '/hidden-example',
    component: HiddenPlaceholderPage
  }),

  // Hidden focus-layout route, opened from the grouped placeholder page.
  registerAppRoute({
    id: 'focus-layout-placeholder',
    path: '/layout-example/focus',
    component: FocusPlaceholderPage,
    layout: 'focus'
  }),

  // Hidden immersive-layout route, opened from the grouped placeholder page.
  registerAppRoute({
    id: 'immersive-layout-placeholder',
    path: '/layout-example/immersive',
    component: ImmersivePlaceholderPage,
    layout: 'immersive'
  })
]

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterRoutes.forEach((unregister) => unregister())
  })
}
