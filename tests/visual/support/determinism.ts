import type { Page } from '@playwright/test'

/** 与产品文档测试一致的固定时间。 */
export const VISUAL_FIXED_TIME = new Date('2026-01-15T08:00:00.000Z')

/**
 * 把 `crypto.randomUUID` 替换为确定性递增序列，避免界面上出现的对象 ID
 * 在每次运行时变化，导致视觉基线漂移。实现与 `tests/product-docs/support/product-test.ts`
 * 中的同名函数一致。
 */
export function installDeterministicRandomUuid(
  cryptoObject: { randomUUID(): string } = globalThis.crypto
): void {
  let sequence = 0
  Object.defineProperty(cryptoObject, 'randomUUID', {
    configurable: true,
    value: () => {
      sequence += 1
      return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`
    }
  })
}

/**
 * 把 `Math.random` 替换为确定性 xorshift32 序列。
 * 启动参数 `--js-flags=--random-seed=1` 只约束 V8 的初始种子，不能保证所有隔离环境
 * （例如 renderer 与 worker）一致；这里显式接管，保证随机摘句等文案稳定。
 */
export function installDeterministicMathRandom(): void {
  let state = 0x2f6e2b1
  Math.random = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 1_000_000) / 1_000_000
  }
}

/**
 * 在界面加载前固定会影响渲染的非确定性来源：
 * - 固定时钟（日期、时间戳文案）；
 * - 确定性 UUID（新建对象的 ID、节点 ID 等身份）；
 * - 确定性 `Math.random`（随机摘句、随机顺序）。
 */
export async function installDeterminism(page: Page): Promise<void> {
  await page.clock.setFixedTime(VISUAL_FIXED_TIME)
  await page.addInitScript(installDeterministicRandomUuid)
  await page.evaluate(installDeterministicRandomUuid)
  await page.addInitScript(installDeterministicMathRandom)
  await page.evaluate(installDeterministicMathRandom)
}
