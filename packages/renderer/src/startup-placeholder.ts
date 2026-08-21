export const MINIMUM_STARTUP_PLACEHOLDER_DURATION_MS = 2_000

export function applyStartupPlaceholderIcon(root: HTMLElement, iconUrl: string): void {
  const icon = root.querySelector<HTMLImageElement>('[data-startup-icon]')
  if (icon) icon.src = iconUrl
}

export function waitForMinimumStartupPlaceholderDuration(): Promise<void> {
  // TODO: Remove this test-only minimum duration when the final startup animation replaces the placeholder.
  return new Promise((resolve) => {
    window.setTimeout(resolve, MINIMUM_STARTUP_PLACEHOLDER_DURATION_MS)
  })
}
