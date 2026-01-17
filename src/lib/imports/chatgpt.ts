import type { NormalizedConversation, NormalizedMessage, ParserOptions } from '@/lib/imports/common'
import { clampText, extractFileIds, extractTextFromParts, normalizeRole, normalizeTimestamp } from '@/lib/imports/common'
import type { Json } from '@/lib/supabase/types'

type ChatGPTMessage = {
  id?: string
  author?: { role?: string | null; name?: string | null }
  content?: { content_type?: string; parts?: unknown[]; user_profile?: string; user_instructions?: string }
  create_time?: number | string | null
  metadata?: Record<string, unknown>
}

type ChatGPTNode = {
  id: string
  message: ChatGPTMessage | null
  parent: string | null
  children: string[]
}

type ChatGPTConversation = {
  id?: string
  conversation_id?: string
  title?: string | null
  create_time?: number | string | null
  update_time?: number | string | null
  current_node?: string | null
  mapping?: Record<string, ChatGPTNode>
}

function buildChronologicalTraversal(mapping: Record<string, ChatGPTNode>): ChatGPTNode[] {
  if (!mapping || !Object.keys(mapping).length) return []
  const roots = Object.values(mapping).filter((n) => !n.parent)
  const ordered: ChatGPTNode[] = []
  const seen = new Set<string>()

  const sortChildren = (children: string[]) => {
    return children
      .map((id) => mapping[id])
      .filter(Boolean)
      .sort((a, b) => {
        const at = typeof a.message?.create_time === 'number' ? a.message?.create_time : 0
        const bt = typeof b.message?.create_time === 'number' ? b.message?.create_time : 0
        return at - bt
      })
  }

  const walk = (node: ChatGPTNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    ordered.push(node)
    const children = sortChildren(node.children ?? [])
    for (const child of children) {
      walk(child)
    }
  }

  for (const root of roots) {
    walk(root)
  }

  return ordered
}

function extractContent(message: ChatGPTMessage): string {
  const content = message.content
  if (!content) return ''
  if (content.content_type === 'text' || content.content_type === 'code' || content.content_type === 'markdown') {
    return extractTextFromParts(content.parts)
  }
  if (content.content_type === 'user_editable_context') {
    return [content.user_profile, content.user_instructions].filter(Boolean).join('\n')
  }
  return extractTextFromParts(content.parts)
}

export function parseChatGPTConversations(rawJson: string, options: ParserOptions): NormalizedConversation[] {
  const data = JSON.parse(rawJson) as ChatGPTConversation[]
  const out: NormalizedConversation[] = []

  for (const convo of data) {
    const mapping = convo.mapping ?? {}
    const nodes = buildChronologicalTraversal(mapping)
    const messages: NormalizedMessage[] = []
    const systemMessages: NormalizedMessage[] = []

    for (const node of nodes) {
      if (!node.message) continue
      const role = normalizeRole(node.message.author?.role ?? 'system')
      const content = clampText(extractContent(node.message))
      if (!content && node.message.content?.content_type !== 'user_editable_context') {
        continue
      }

      const isHidden = Boolean(node.message.metadata?.is_visually_hidden_from_conversation)
      const normalized: NormalizedMessage = {
        role,
        content,
        createdAt: normalizeTimestamp(node.message.create_time ?? null),
        metadata: {
          source_message_id: node.message.id ?? node.id,
          // Ensure `raw` is a JSON-serializable value compatible with `Json`
          raw: JSON.parse(JSON.stringify(node.message)) as Json,
        },
        attachments: extractFileIds(node.message).map((sourceId) => ({ sourceId })),
      }

      if (isHidden || role === 'system' || node.message.content?.content_type === 'user_editable_context') {
        if (options.includeSystemMessages) {
          messages.push(normalized)
        } else {
          systemMessages.push(normalized)
        }
        continue
      }

      messages.push(normalized)
    }

    const title = convo.title ?? 'Imported ChatGPT Chat'
    out.push({
      title,
      createdAt: normalizeTimestamp(convo.create_time ?? null),
      metadata: {
        source: options.source,
        chatgpt_id: convo.id ?? convo.conversation_id ?? null,
        system_messages: systemMessages.map((m) => ({
          role: m.role,
          content: m.content,
          created_at: m.createdAt ?? null,
          metadata: m.metadata ?? {},
        })),
      },
      messages,
    })
  }

  return out
}
