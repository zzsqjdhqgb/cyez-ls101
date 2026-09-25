export const startupPlaceholderCss = `
html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
}

body {
  min-width: 680px;
  overflow: hidden;
  background: #fff;
}

.startupPlaceholder {
  display: grid;
  width: 100%;
  height: 100%;
  place-content: center;
  justify-items: center;
  gap: 28px;
  user-select: none;
}

.startupLogo {
  display: block;
  width: 556px;
  height: 160px;
}

.startupLogo img {
  display: block;
  width: 112px;
  height: 112px;
  margin: 12px auto 13px;
  border-radius: 24px;
}

.startupLogo svg {
  display: block;
  width: 556px;
  height: 160px;
  overflow: visible;
}

.startupProgressSlot {
  display: grid;
  width: 180px;
  height: 4px;
  place-items: center;
}

.startupProgress {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 2px;
  background: #dfe3e8;
  opacity: 0;
  will-change: opacity;
  animation: startup-progress-reveal 100ms ease-out 2500ms both;
}

.startupProgress::after {
  position: absolute;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: #1769d2;
  content: '';
  animation: startup-progress 1s ease-in-out infinite;
}

@keyframes startup-progress {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(340%);
  }
}

@keyframes startup-progress-reveal {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
`

export function startupPlaceholderHtml(label: string): string {
  const escaped = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  return `<main class="startupPlaceholder" aria-label="${escaped} 正在启动">
        <div class="startupLogo" data-startup-logo></div>
        <div class="startupProgressSlot">
          <div
            class="startupProgress"
            role="progressbar"
            aria-label="正在加载"
            aria-valuetext="正在加载"
            data-startup-progress
          ></div>
        </div>
      </main>`
}
