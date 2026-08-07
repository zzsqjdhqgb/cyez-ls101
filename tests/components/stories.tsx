import { useState, type JSX } from 'react'
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom'
import {
  Bell,
  Check,
  CircleAlert,
  FileQuestion,
  Home,
  Layers3,
  PanelLeftClose,
  Settings2,
  Trash2
} from 'lucide-react'
import type { AppRouteRegistration } from '../../packages/renderer/src/app/route-registry'
import { AppShell } from '../../packages/renderer/src/components/shell/AppShell'
import {
  AIModelSelect,
  type AIModelOption
} from '../../packages/renderer/src/components/ai/AIModelSelect'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../packages/renderer/src/components/settings/SettingsContent'
import { Button } from '../../packages/renderer/src/components/ui/Button'
import { ConfirmModal } from '../../packages/renderer/src/components/ui/ConfirmModal'
import { EmptyState } from '../../packages/renderer/src/components/ui/EmptyState'
import { IconButton } from '../../packages/renderer/src/components/ui/IconButton'
import { Page, PageHeader } from '../../packages/renderer/src/components/ui/Page'
import { ResizableSplit } from '../../packages/renderer/src/components/ui/ResizableSplit'

export function ButtonStory(): JSX.Element {
  const [status, setStatus] = useState('尚未保存')

  return (
    <div>
      <Button icon={Check} onClick={() => setStatus('已保存')}>
        保存
      </Button>
      <p role="status">{status}</p>
    </div>
  )
}

export function IconButtonStory(): JSX.Element {
  return <IconButton icon={Trash2} label="删除 Provider" />
}

export function ConfirmModalStory(): JSX.Element {
  const [open, setOpen] = useState(true)

  return (
    <>
      <Button onClick={() => setOpen(true)}>打开确认框</Button>
      <ConfirmModal
        danger
        message="删除后将无法恢复。"
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
        open={open}
        title="删除 Provider？"
        confirmLabel="删除"
      />
    </>
  )
}

export function ResizableSplitStory(): JSX.Element {
  return (
    <div style={{ width: 800, height: 280 }}>
      <ResizableSplit initialSize={300} minFirst={180} minSecond={240}>
        <div>字段编辑器</div>
        <div>AI 生成面板</div>
      </ResizableSplit>
    </div>
  )
}

const modelOptions: readonly AIModelOption[] = [
  {
    modelId: 'gpt-4o-mini',
    modelName: '轻量模型',
    providerId: 'openai',
    providerName: 'OpenAI'
  },
  {
    modelId: 'claude-3-5-sonnet',
    modelName: 'Sonnet',
    providerId: 'anthropic',
    providerName: 'Anthropic'
  }
]

export function AIModelSelectStory(): JSX.Element {
  const [value, setValue] = useState<{ providerId: string; modelId: string } | null>(null)
  const [refreshes, setRefreshes] = useState(0)

  return (
    <div style={{ width: 420 }}>
      <AIModelSelect
        label="生成模型"
        onChange={setValue}
        onRefresh={() => setRefreshes((current) => current + 1)}
        options={modelOptions}
        value={value}
      />
      <output aria-label="当前模型">
        {value ? `${value.providerId}/${value.modelId}` : '未选择'}
      </output>
      <output aria-label="刷新次数">{refreshes}</output>
    </div>
  )
}

function ShellHomePage(): JSX.Element {
  return (
    <Page>
      <PageHeader title="首页" />
      <EmptyState icon={Layers3} title="暂无首页内容" />
      <Link to="/focus">打开专注页面</Link>
      <Link to="/immersive">打开沉浸页面</Link>
    </Page>
  )
}

function ShellFocusPage(): JSX.Element {
  return (
    <Page>
      <PageHeader title="专注页面" />
      <EmptyState icon={PanelLeftClose} title="侧边栏已隐藏" />
      <Link to="/immersive">打开沉浸页面</Link>
    </Page>
  )
}

function ShellImmersivePage(): JSX.Element {
  return (
    <Page>
      <PageHeader title="沉浸页面" />
      <EmptyState icon={FileQuestion} title="标题栏和侧边栏已隐藏" />
      <Link to="/">返回首页</Link>
    </Page>
  )
}

const shellRoutes: readonly AppRouteRegistration[] = [
  {
    component: ShellHomePage,
    id: 'home',
    layout: 'standard',
    navigation: { icon: Home, label: '首页', order: 0 },
    path: '/'
  },
  {
    component: ShellFocusPage,
    id: 'focus',
    layout: 'focus',
    navigation: { icon: Bell, label: '专注', order: 10 },
    path: '/focus'
  },
  {
    component: ShellImmersivePage,
    id: 'immersive',
    layout: 'immersive',
    navigation: { icon: Settings2, label: '沉浸', order: 20 },
    path: '/immersive'
  }
]

export function ShellStory(): JSX.Element {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell routes={shellRoutes} />}>
          <Route element={<ShellHomePage />} path="/" />
          <Route element={<ShellFocusPage />} path="/focus" />
          <Route element={<ShellImmersivePage />} path="/immersive" />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

export function SettingsContentStory(): JSX.Element {
  return (
    <SettingsContent>
      <SettingsSection description="页面显示方式。" title="主题">
        <SettingsRow description="选择颜色主题。" label="界面主题">
          <select aria-label="界面主题" defaultValue="system">
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="交互">
        <SettingsRow label="减少动态效果">
          <label>
            <input aria-label="减少动态效果" role="switch" type="checkbox" />
          </label>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  )
}

export function PageCompositionStory(): JSX.Element {
  return (
    <Page>
      <PageHeader actions={<Button icon={CircleAlert}>检查状态</Button>} title="页面标题" />
      <EmptyState icon={FileQuestion} title="暂无内容" />
    </Page>
  )
}

export function ToastStory(): JSX.Element {
  return (
    <div>
      <Button icon={Bell}>发送通知</Button>
    </div>
  )
}
