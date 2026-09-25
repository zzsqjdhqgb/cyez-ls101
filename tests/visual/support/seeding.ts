import type { Page } from '@playwright/test'

/**
 * 通过 preload 桥写入 fileStore 文本，为视觉规格构造确定性的持久状态。
 * 与 `tests/product-docs` 的 `writeFileStoreText` 同源，避免真实用户目录。
 */
export async function seedFileStoreText(
  page: Page,
  scope: string[],
  filename: string,
  value: unknown
): Promise<void> {
  await page.evaluate(
    async ({ scope, filename, value }) => {
      await window.fileStore.invoke('file:write-text', { scope, filename }, JSON.stringify(value))
    },
    { scope, filename, value }
  )
}

/**
 * 注入一个可用的语音服务商，使生成试卷设置页（UI-TP-05）渲染默认/男声/女声三组音色下拉，
 * 而不是「没有可用的语音服务商」告警。默认态截图不会发起合成请求。
 */
export async function seedSpeechProvider(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.airouter.saveSpeechProviderConfig({
      id: 'visual-speech',
      name: '视觉语音',
      kind: 'online',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9/visual/v1',
      models: [{ id: 'visual-model', enabled: true }],
      voices: [{ id: 'visual-voice', enabled: true }],
      apiKey: 'visual'
    })
  })
}
