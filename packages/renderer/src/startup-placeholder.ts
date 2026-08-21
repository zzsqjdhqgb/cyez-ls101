export const STARTUP_LOGO_ANIMATION_DURATION_MS = 1_500

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
  style.media = '(prefers-reduced-motion: no-preference)'
  style.textContent = motionCss
  document.head.appendChild(style)
  logo.replaceChildren(document.importNode(svg, true))
}

export function waitForStartupLogoAnimation(root: HTMLElement): Promise<void> {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()

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

export function showStartupProgress(root: HTMLElement): void {
  const progress = root.querySelector<HTMLElement>('[data-startup-progress]')
  if (progress) progress.hidden = false
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
