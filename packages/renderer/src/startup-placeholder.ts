export const STARTUP_LOGO_ANIMATION_DURATION_MS = 1_500
export const STARTUP_COMPLETION_DELAY_MS = 1_000

interface StartupLogoMotionOptions {
  logoMarkup: string
  motionCss: string
}

export function applyStartupPlaceholderIcon(root: HTMLElement, iconUrl: string): void {
  const icon = root.querySelector<HTMLImageElement>('[data-startup-icon]')
  if (icon) icon.src = iconUrl
}

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

export function waitForStartupLogoAnimation(root: HTMLElement): Promise<void> {
  const animatedLogo = root.querySelector<SVGElement>('#logo-lockup')
  if (!animatedLogo) return wait(STARTUP_LOGO_ANIMATION_DURATION_MS)

  return new Promise((resolve) => {
    const fallback = window.setTimeout(finish, STARTUP_LOGO_ANIMATION_DURATION_MS + 100)
    animatedLogo.addEventListener('animationend', handleAnimationEnd)

    function handleAnimationEnd(event: AnimationEvent): void {
      if (event.target === animatedLogo) finish()
    }

    function finish(): void {
      window.clearTimeout(fallback)
      animatedLogo.removeEventListener('animationend', handleAnimationEnd)
      resolve()
    }
  })
}

export function waitForStartupCompletionDelay(): Promise<void> {
  return wait(STARTUP_COMPLETION_DELAY_MS)
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
