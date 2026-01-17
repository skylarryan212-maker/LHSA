type AnyRecord = Record<string, unknown>

export function extractNextDataJson(html: string): AnyRecord | null {
  // Try __NEXT_DATA__ script tag (Next.js SSR)
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (nextDataMatch) {
    try {
      return JSON.parse(nextDataMatch[1]) as AnyRecord
    } catch {
      // Continue to try other methods
    }
  }
  return null
}

function extractEmbeddedJson(html: string, patterns: RegExp[]): AnyRecord | null {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]) as AnyRecord
      } catch {
        // Continue to next pattern
      }
    }
  }
  return null
}

function findObjectWithKeys(obj: unknown, keys: string[], maxDepth = 20): AnyRecord | null {
  if (maxDepth <= 0) return null
  if (!obj || typeof obj !== 'object') return null
  const record = obj as AnyRecord
  if (keys.every((k) => k in record)) return record
  if (Array.isArray(record)) {
    for (const item of record) {
      const found = findObjectWithKeys(item, keys, maxDepth - 1)
      if (found) return found
    }
    return null
  }
  for (const value of Object.values(record)) {
    const found = findObjectWithKeys(value, keys, maxDepth - 1)
    if (found) return found
  }
  return null
}

export function extractClaudeConversationFromHtml(html: string): AnyRecord | null {
  // Try __NEXT_DATA__ first
  const nextData = extractNextDataJson(html)
  if (nextData) {
    const found = findObjectWithKeys(nextData, ['chat_messages', 'uuid'])
    if (found) return found
  }

  // Try other embedded JSON patterns
  const patterns = [
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi,
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});/i,
    /window\.INITIAL_DATA\s*=\s*({[\s\S]*?});/i,
  ]

  const embedded = extractEmbeddedJson(html, patterns)
  if (embedded) {
    const found = findObjectWithKeys(embedded, ['chat_messages', 'uuid'])
    if (found) return found
  }

  return null
}

export function extractChatGPTConversationFromHtml(html: string): AnyRecord | null {
  // Try __NEXT_DATA__ first
  const nextData = extractNextDataJson(html)
  if (nextData) {
    const found = findObjectWithKeys(nextData, ['mapping', 'title'])
    if (found) return found
  }

  // Try other embedded JSON patterns for ChatGPT
  const patterns = [
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi,
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});/i,
    /window\.INITIAL_DATA\s*=\s*({[\s\S]*?});/i,
    /"serverResponse":\s*({[\s\S]*?"mapping"[\s\S]*?})/i,
  ]

  const embedded = extractEmbeddedJson(html, patterns)
  if (embedded) {
    const found = findObjectWithKeys(embedded, ['mapping', 'title'])
    if (found) return found
  }

  return null
}
