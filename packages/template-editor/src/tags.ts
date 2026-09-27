const MAX_TEMPLATE_TAGS = 12
const MAX_TEMPLATE_TAG_LENGTH = 24

/** Normalize and validate user-facing template tags. */
export function normalizeTemplateTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  if (!Array.isArray(tags)) throw new TypeError('试卷模板标签必须是字符串数组')

  const normalized = tags.map((tag) => {
    if (typeof tag !== 'string') throw new TypeError('试卷模板标签必须是字符串')
    const value = tag.trim().normalize('NFC')
    if (value.length === 0) return ''
    if (/\p{Cc}/u.test(value)) throw new TypeError('试卷模板标签不得包含控制字符')
    if (Array.from(value).length > MAX_TEMPLATE_TAG_LENGTH) {
      throw new RangeError(`试卷模板标签长度不得超过 ${MAX_TEMPLATE_TAG_LENGTH} 个字符`)
    }
    return value
  })

  const unique = [...new Set(normalized.filter(Boolean))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  if (unique.length > MAX_TEMPLATE_TAGS) {
    throw new RangeError(`试卷模板标签数量不得超过 ${MAX_TEMPLATE_TAGS} 个`)
  }
  return unique
}
