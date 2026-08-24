const MAX_TEMPLATE_TAGS = 12
const MAX_TEMPLATE_TAG_LENGTH = 24

/** Normalize and validate user-facing template tags. */
export function normalizeTemplateTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  if (!Array.isArray(tags)) throw new TypeError('Template tags must be an array of strings')

  const normalized = tags.map((tag) => {
    if (typeof tag !== 'string') throw new TypeError('Template tags must be strings')
    const value = tag.trim().normalize('NFC')
    if (value.length === 0) return ''
    if (/\p{Cc}/u.test(value))
      throw new TypeError('Template tags must not contain control characters')
    if (Array.from(value).length > MAX_TEMPLATE_TAG_LENGTH) {
      throw new RangeError(`Template tags must be at most ${MAX_TEMPLATE_TAG_LENGTH} characters`)
    }
    return value
  })

  const unique = [...new Set(normalized.filter(Boolean))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  if (unique.length > MAX_TEMPLATE_TAGS) {
    throw new RangeError(`Template tags must contain at most ${MAX_TEMPLATE_TAGS} items`)
  }
  return unique
}
