import type { JSX } from 'react'
import {
  AIModelSelectStory,
  ButtonStory,
  ConfirmModalStory,
  IconButtonStory,
  PageCompositionStory,
  ResizableSplitStory,
  SettingsContentStory,
  ShellStory
} from './stories'

const stories: Record<string, () => JSX.Element> = {
  'ai-model-select': AIModelSelectStory,
  button: ButtonStory,
  'confirm-modal': ConfirmModalStory,
  'icon-button': IconButtonStory,
  page: PageCompositionStory,
  'resizable-split': ResizableSplitStory,
  settings: SettingsContentStory,
  shell: ShellStory
}

export function ComponentTestApp(): JSX.Element {
  const key = new URLSearchParams(window.location.search).get('component') ?? 'button'
  const Story = stories[key] ?? ButtonStory

  return (
    <main
      data-testid="component-root"
      style={{ height: '100%', minHeight: '100%', padding: key === 'shell' ? 0 : 24 }}
    >
      <Story />
    </main>
  )
}
