// 启动动画时长与动画结束后的额外停留时间分别控制。
export const STARTUP_LOGO_ANIMATION_DURATION_MS = 1_500
export const STARTUP_COMPLETION_DELAY_MS = 1_000

interface StartupLogoMotionOptions {
  logoMarkup: string
  motionCss: string
}

/** 仅在占位图标存在时设置地址，兼容不同启动占位结构。 */
export function applyStartupPlaceholderIcon(root: HTMLElement, iconUrl: string): void {
  const icon = root.querySelector<HTMLImageElement>('[data-startup-icon]')
  if (icon) icon.src = iconUrl
}

/** 解析内置 SVG 并注入动画样式以替换静态启动标志；占位结构中没有标志容器时直接返回。 */
export function applyStartupLogoMotion(
  root: HTMLElement,
  { logoMarkup, motionCss }: StartupLogoMotionOptions
): void {
  const logo = root.querySelector<HTMLElement>('[data-startup-logo]')
  if (!logo) return

  const parsed = new DOMParser().parseFromString(logoMarkup, 'image/svg+xml')
  const svg = parsed.documentElement
  if (svg.localName !== 'svg') throw new Error('Startup logo SVG is invalid')

  const style = document.createElement('style')
  style.dataset.startupLogoMotion = ''
  style.textContent = motionCss
  document.head.appendChild(style)
  logo.replaceChildren(document.importNode(svg, true))
}

/** 等待标志动画结束；缺少标志或未收到事件时通过定时器兜底。 */
export function waitForStartupLogoAnimation(root: HTMLElement): Promise<void> {
  const renderedLogo = root.querySelector<SVGElement>('#logo-lockup')
  if (!renderedLogo) return wait(STARTUP_LOGO_ANIMATION_DURATION_MS)
  const animatedLogo = renderedLogo

  return new Promise((resolve) => {
    const fallback = window.setTimeout(finish, STARTUP_LOGO_ANIMATION_DURATION_MS + 100)
    animatedLogo.addEventListener('animationend', handleAnimationEnd)

    function handleAnimationEnd(event: AnimationEvent): void {
      // 子元素的动画事件会冒泡，只认标志容器自身的结束事件。
      if (event.target === animatedLogo) finish()
    }

    // 正常结束与超时共用清理逻辑，防止监听器和定时器继续存留。
    function finish(): void {
      window.clearTimeout(fallback)
      animatedLogo.removeEventListener('animationend', handleAnimationEnd)
      resolve()
    }
  })
}

/** 动画结束后保留短暂静止展示，再允许切换应用界面。 */
export function waitForStartupCompletionDelay(): Promise<void> {
  return wait(STARTUP_COMPLETION_DELAY_MS)
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
