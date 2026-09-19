import type { Plugin } from 'vite'
import {
  startupPlaceholderCss,
  startupPlaceholderHtml
} from '../../packages/desktop-ui/src/startup/placeholder'

export interface StartupPlaceholderPluginOptions {
  /** Product name announced by the placeholder, for example 曹二听说101. */
  label: string
}

/**
 * Injects the shared startup placeholder into an application's index.html.
 *
 * The markup must be present before the module bundle runs so the first paint already shows the
 * logo animation. configs import this file relatively (like scripts/lab/bundle-audit) because the
 * Electron/Vite config loader bundles relative TypeScript imports but externalizes bare package
 * specifiers, which Node cannot execute from source.
 */
export function startupPlaceholderPlugin({ label }: StartupPlaceholderPluginOptions): Plugin {
  const emptyRoot = /<div id="root">\s*<\/div>/

  return {
    name: 'ls101:startup-placeholder',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!emptyRoot.test(html)) {
          throw new Error(
            'startupPlaceholderPlugin requires an empty <div id="root"></div> in index.html'
          )
        }

        return {
          html: html.replace(emptyRoot, `<div id="root">${startupPlaceholderHtml(label)}</div>`),
          tags: [{ tag: 'style', children: startupPlaceholderCss, injectTo: 'head' }]
        }
      }
    }
  }
}
