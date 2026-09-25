import { startupLogoMarkup, startupMotionCss } from './logo'
import { applyStartupLogoMotion, waitForStartupLogoAnimation } from './startup-placeholder'
import { markRendererStartupMilestone } from './startup-timing'

export interface RendererApplicationModule {
  startApplication(root: HTMLElement, startupLogoAnimation: Promise<void>): void
}

export interface BootstrapRendererOptions {
  loadApplication(): Promise<RendererApplicationModule>
  root?: HTMLElement
  onLoadError?(reason: unknown): void
}

export function bootstrapRenderer({
  loadApplication,
  root: mount,
  onLoadError
}: BootstrapRendererOptions): void {
  markRendererStartupMilestone('document-script-started')
  const root = mount ?? document.getElementById('root')

  if (!root) {
    throw new Error('Renderer root element was not found')
  }

  applyStartupLogoMotion(root, {
    logoMarkup: startupLogoMarkup,
    motionCss: startupMotionCss
  })
  markRendererStartupMilestone('startup-logo-ready')

  const startupLogoAnimation = waitForStartupLogoAnimation(root)

  // Two frames guarantee one startup-placeholder paint before application CSS and JS are requested.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      markRendererStartupMilestone('application-bundle-requested')
      void loadApplication().then(
        (application) => {
          markRendererStartupMilestone('application-bundle-loaded')
          application.startApplication(root, startupLogoAnimation)
        },
        (reason: unknown) => {
          onLoadError?.(reason)
          renderBootstrapError(root, reason)
        }
      )
    })
  })
}

export function renderBootstrapError(root: HTMLElement, reason: unknown): void {
  const main = document.createElement('main')
  main.className = 'startupError'
  main.setAttribute('role', 'alert')

  const heading = document.createElement('h1')
  heading.textContent = '应用初始化失败'
  const message = document.createElement('p')
  message.textContent = reason instanceof Error ? reason.message : '未知初始化错误'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = '重新加载'
  retry.addEventListener('click', () => window.location.reload())

  main.append(heading, message, retry)
  root.replaceChildren(main)
}
