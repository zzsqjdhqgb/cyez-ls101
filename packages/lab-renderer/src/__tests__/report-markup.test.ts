import { describe, expect, it } from 'vitest'
import { renderSafeReportMarkup } from '../report-markup'

const resources = {
  picture: { resourceKey: 'picture', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }
}

function render(markdown: string): string {
  return renderSafeReportMarkup(markdown, resources, (resource) => `blob:${resource.resourceKey}`)
}

describe('renderSafeReportMarkup', () => {
  it('renders report markdown and resolves resource references', () => {
    const markup = render('# 标题\n\n![图](resource:picture)')
    expect(markup).toContain('<h1>标题</h1>')
    expect(markup).toContain('src="blob:picture"')
  })

  it('drops references to unknown resources', () => {
    const markup = render('![缺失](resource:missing)')
    expect(markup).not.toContain('resource:')
    expect(markup).not.toContain('blob:')
  })

  it('escapes raw HTML instead of injecting it', () => {
    const markup = render('<img src=x onerror="alert(1)">\n\n**加粗**')
    expect(markup).toContain('&lt;img src=x')
    expect(markup).not.toContain('<img src=x')
    expect(markup).toContain('<strong>加粗</strong>')
  })

  it('only allows known link and image protocols', () => {
    const markup = render(
      '[安全](https://example.com)\n\n[危险](javascript:alert(1))\n\n![内联](data:image/png;base64,AAA)'
    )
    expect(markup).toContain('href="https://example.com"')
    expect(markup).not.toContain('javascript:')
    expect(markup).toContain('src="data:image/png;base64,AAA"')
  })
})
