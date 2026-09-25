import startupLogoMarkup from './startup-assets/logo.svg?raw'
import startupLogoMotionCss from './startup-assets/motion.css?inline'
import { applyStartupLogoMotion, waitForStartupLogoAnimation } from './startup-placeholder'
import { markRendererStartupMilestone } from './startup-timing'
import { toUserMessage } from './components/ui/userMessage'

markRendererStartupMilestone('document-script-started')

const root = document.getElementById('root')

if (!root) {
  throw new Error('找不到应用挂载节点，界面无法启动。')
}

applyStartupLogoMotion(root, {
  logoMarkup: startupLogoMarkup,
  motionCss: startupLogoMotionCss
})
markRendererStartupMilestone('startup-logo-ready')

const startupLogoAnimation = waitForStartupLogoAnimation(root)

// Two frames guarantee one startup-placeholder paint before application CSS and JS are requested.
window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    markRendererStartupMilestone('application-bundle-requested')
    void import('./startup-application')
      .then(({ startApplication }) => {
        markRendererStartupMilestone('application-bundle-loaded')
        startApplication(root, startupLogoAnimation)
      })
      .catch((error: unknown) => renderBootstrapError(root, error))
  })
})

function renderBootstrapError(container: HTMLElement, reason: unknown): void {
  const main = document.createElement('main')
  main.className = 'startupError'
  main.setAttribute('role', 'alert')

  const heading = document.createElement('h1')
  heading.textContent = '应用初始化失败'
  const message = document.createElement('p')
  message.textContent = toUserMessage(reason, '未知初始化错误')
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = '重新加载'
  retry.addEventListener('click', () => window.location.reload())

  main.append(heading, message, retry)
  container.replaceChildren(main)
}
