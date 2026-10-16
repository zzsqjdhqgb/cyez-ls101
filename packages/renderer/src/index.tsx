import startupLogoMarkup from './startup-assets/logo.svg?raw'
import startupLogoMotionCss from './startup-assets/motion.css?inline'
import { applyStartupLogoMotion, waitForStartupLogoAnimation } from './startup-placeholder'
import { markRendererStartupMilestone } from './startup-timing'

// 首屏入口只加载启动动画与计时工具，完整 React 应用在占位界面绘制后再请求。
markRendererStartupMilestone('document-script-started')

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element was not found')
}

// 在静态占位容器内安装 SVG 动画，并将动画完成信号交给后续启动流程。
applyStartupLogoMotion(root, {
  logoMarkup: startupLogoMarkup,
  motionCss: startupLogoMotionCss
})
markRendererStartupMilestone('startup-logo-ready')

const startupLogoAnimation = waitForStartupLogoAnimation(root)

// 通过两次动画帧回调，让启动占位界面先获得绘制机会，再请求应用样式与脚本。
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

/** 应用模块加载失败时使用原生 DOM 展示错误，保留重新加载入口。 */
function renderBootstrapError(container: HTMLElement, reason: unknown): void {
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
  container.replaceChildren(main)
}
