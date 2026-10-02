/** Convert the old text prompt at read boundaries; explicit new-format data takes precedence. */
export function normalizeLegacyPrompts(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (Object.hasOwn(record, 'prompts') || typeof record.promptTemplate !== 'string') return value
  const { promptTemplate, ...rest } = record
  return { ...rest, prompts: [{ name: 'Default', content: promptTemplate }] }
}
