import { createHash } from 'crypto'
import type { Json } from '@/lib/supabase/types'

export type ImportSource = 'claude' | 'chatgpt'

export type AttachmentRef = {
  sourceId: string
  name?: string
  mime?: string
  sizeBytes?: number
  path?: string
  url?: string
}

export type NormalizedMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt?: string | null
  metadata?: Json | null
  attachments?: AttachmentRef[]
}

export type NormalizedConversation = {
  title: string | null
  createdAt?: string | null
  metadata: Json
  messages: NormalizedMessage[]
}

export type ParserOptions = {
  includeSystemMessages?: boolean
  source: ImportSource
}

export function normalizeRole(role?: string | null): NormalizedMessage['role'] {
  const value = (role ?? '').toLowerCase()
  if (value === 'human' || value === 'user') return 'user'
  if (value === 'assistant' || value === 'ai') return 'assistant'
  if (value === 'tool') return 'tool'
  return 'system'
}

export function normalizeTimestamp(value?: string | number | null): string | null {
  if (!value) return null
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export function computeImportHash(messages: NormalizedMessage[]): string {
  const joined = messages
    .map((m) => `${m.role}|${m.createdAt ?? ''}|${m.content}`)
    .join('\n')
  return createHash('sha256').update(joined).digest('hex')
}

export function clampText(value: string, maxLength = 20000): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength)
}

export function extractTextFromParts(parts?: unknown[]): string {
  if (!parts || !Array.isArray(parts)) return ''
  return parts
    .map((part) => (typeof part === 'string' ? part : ''))
    .filter(Boolean)
    .join(' ')
}

export function extractFileIds(value: unknown): string[] {
  const ids = new Set<string>()
  const walk = (input: unknown) => {
    if (!input) return
    if (typeof input === 'string') {
      const matches = input.match(/file_[0-9a-f]+/gi) ?? []
      for (const match of matches) ids.add(match)
      return
    }
    if (Array.isArray(input)) {
      input.forEach(walk)
      return
    }
    if (typeof input === 'object') {
      Object.values(input as Record<string, unknown>).forEach(walk)
    }
  }
  walk(value)
  return Array.from(ids)
}

export function buildMessageMetadata(attachments?: AttachmentRef[], extra?: Json | null): Json {
  const metadata: Record<string, unknown> = {}
  if (attachments && attachments.length) {
    metadata.files = attachments.map((file) => ({
      name: file.name ?? file.sourceId,
      mimeType: file.mime ?? null,
      url: file.url ?? null,
      sizeBytes: file.sizeBytes ?? null,
      sourceId: file.sourceId,
    }))
  }
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    Object.assign(metadata, extra as Record<string, unknown>)
  }
  // Ensure the returned value matches the `Json` type by round-tripping
  // through JSON serialization. This strips non-serializable values and
  // gives TypeScript a `Json`-compatible object.
  return JSON.parse(JSON.stringify(metadata)) as Json
}
