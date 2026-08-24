export interface PocketTtsTokenizer {
  encode(text: string): Uint32Array
}

export interface PocketTtsTextOptions {
  maxTokensPerChunk: number
  padShortInputs: boolean
  removeSemicolons: boolean
}

export function splitText(
  text: string,
  tokenizer: PocketTtsTokenizer,
  options: PocketTtsTextOptions
): string[] {
  const normalized = preprocessText(text, options)
  const rawSentences = normalized.split(/(?<=[.!?。！？])/).filter((item) => item.trim())
  const refined: Array<{ text: string; tokens: number }> = []

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim()
    const tokens = tokenizer.encode(trimmed).length
    if (tokens <= options.maxTokensPerChunk) {
      refined.push({ text: trimmed, tokens })
      continue
    }
    const pieces = trimmed.split(/(?<=[，,;；:：])/).filter((item) => item.trim())
    if (pieces.length > 1) {
      for (const piece of pieces) {
        const value = piece.trim()
        refined.push(...splitOversized(value, tokenizer, options.maxTokensPerChunk))
      }
      continue
    }
    let current = ''
    let currentTokens = 0
    for (const word of trimmed.split(/(?<=\s)/)) {
      const wordTokens = tokenizer.encode(word).length
      if (wordTokens > options.maxTokensPerChunk) {
        if (current.trim()) refined.push({ text: current.trim(), tokens: currentTokens })
        refined.push(...splitOversized(word.trim(), tokenizer, options.maxTokensPerChunk))
        current = ''
        currentTokens = 0
        continue
      }
      if (current && currentTokens + wordTokens > options.maxTokensPerChunk) {
        refined.push({ text: current.trim(), tokens: currentTokens })
        current = word
        currentTokens = wordTokens
      } else {
        current += word
        currentTokens += wordTokens
      }
    }
    if (current.trim()) refined.push({ text: current.trim(), tokens: currentTokens })
  }

  const chunks: string[] = []
  let current = ''
  let currentTokens = 0
  for (const item of refined) {
    if (!current) {
      current = item.text
      currentTokens = item.tokens
    } else if (currentTokens + item.tokens <= options.maxTokensPerChunk) {
      current += needsWordSeparator(current, item.text) ? ` ${item.text}` : item.text
      currentTokens += item.tokens
    } else {
      chunks.push(current)
      current = item.text
      currentTokens = item.tokens
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function splitOversized(
  text: string,
  tokenizer: PocketTtsTokenizer,
  maxTokensPerChunk: number
): Array<{ text: string; tokens: number }> {
  const chunks: Array<{ text: string; tokens: number }> = []
  let current = ''
  let currentTokens = 0
  for (const character of Array.from(text)) {
    const candidate = current + character
    const tokens = tokenizer.encode(candidate).length
    if (current && tokens > maxTokensPerChunk) {
      chunks.push({ text: current, tokens: currentTokens })
      current = character
      currentTokens = tokenizer.encode(character).length
    } else {
      current = candidate
      currentTokens = tokens
    }
  }
  if (current) chunks.push({ text: current, tokens: currentTokens })
  return chunks
}

function needsWordSeparator(left: string, right: string): boolean {
  return (
    !/\s$/.test(left) &&
    !/^\s/.test(right) &&
    /[\p{L}\p{N}]$/u.test(left) &&
    /^[\p{L}\p{N}]/u.test(right)
  )
}

function preprocessText(text: string, options: PocketTtsTextOptions): string {
  let normalized = text.trim()
  if (!normalized) throw new Error('Text prompt cannot be empty')
  normalized = normalized.replace(/\n|\r/g, ' ').replace(/  +/g, ' ')
  if (options.removeSemicolons) normalized = normalized.replace(/;/g, ',')
  if (!/^[A-Z\u{00C0}-\u{024F}\u{0400}-\u{04FF}]/u.test(normalized[0])) {
    normalized = normalized[0].toLocaleUpperCase() + normalized.slice(1)
  }
  if (/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF]$/.test(normalized)) normalized += '.'
  if (options.padShortInputs && normalized.split(/\s+/).length < 5)
    normalized = `        ${normalized}`
  return normalized
}
