/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer } from 'electron'
import type { TemplateListItem } from '../../renderer/src/types'

export function createTemplateBridge(): {
  template: {
    list: () => Promise<TemplateListItem[]>
    import: () => Promise<{ success: boolean; error?: string }>
    export: (templateId: string) => Promise<void>
    delete: (templateId: string) => Promise<{ success: boolean }>
  }
} {
  return {
    template: {
      list: (devMode?: boolean): Promise<TemplateListItem[]> =>
        ipcRenderer.invoke('template:list', devMode),
      import: (): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('template:import'),
      export: (templateId: string): Promise<void> =>
        ipcRenderer.invoke('template:export', templateId),
      delete: (templateId: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('template:delete', templateId)
    }
  }
}
