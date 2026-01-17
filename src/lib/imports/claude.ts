import type { NormalizedConversation, NormalizedMessage, ParserOptions } from '@/lib/imports/common'
import { clampText, normalizeRole, normalizeTimestamp } from '@/lib/imports/common'

type ClaudeConversation = {
  uuid: string
  name?: string | null
  title?: string | null
  summary?: string | null
  created_at?: string | null
  chat_messages?: ClaudeMessage[]
}

type ClaudeMessage = {
  uuid: string
  sender?: string | null
  text?: string | null
  content?: Array<{ type?: string; text?: string | null }>
  created_at?: string | null
  updated_at?: string | null
  attachments?: Array<{ name?: string; mime_type?: string; url?: string }>
  files?: Array<{ name?: string; mime_type?: string; url?: string }>
}

export function parseClaudeConversations(rawJson: string, options: ParserOptions): NormalizedConversation[] {
  const cleaned = rawJson.replace(/^\uFEFF/, '').trim()
  const data = JSON.parse(cleaned) as ClaudeConversation[]
  const out: NormalizedConversation[] = []

  for (const convo of data) {
    const messages: NormalizedMessage[] = []
    const systemMessages: NormalizedMessage[] = []

    for (const msg of convo.chat_messages ?? []) {
      const role = normalizeRole(msg.sender ?? 'system')
      const content = clampText(
        msg.text ?? msg.content?.map((c) => c.text ?? '').filter(Boolean).join(' ') ?? ''
      )
      const normalized: NormalizedMessage = {
        role,
        content,
        createdAt: normalizeTimestamp(msg.created_at ?? null),
        metadata: {
          source_message_id: msg.uuid,
          raw: msg,
        },
        attachments: [...(msg.attachments ?? []), ...(msg.files ?? [])]
          .map((file) => {
            if (!file.name) return null
            return {
              sourceId: file.name,
              name: file.name,
              mime: file.mime_type,
            }
          })
          .filter(Boolean) as NormalizedMessage['attachments'],
      }

      if (role === 'system' && !options.includeSystemMessages) {
        systemMessages.push(normalized)
        continue
      }

      messages.push(normalized)
    }

    const title = (convo.title ?? convo.name ?? convo.summary ?? null) || 'Imported Claude Chat'

    // Try to detect an imported project name from common export fields so
    // imported conversations can be grouped under projects.
    const importedProjectName =
      (convo as any).imported_project_name ??
      (convo as any).project_name ??
      (convo as any).project ??
      (convo as any).workspace ??
      (convo as any).folder ??
      (convo as any).collection ??
      null

    // Also surface account/project related identifiers if present in the
    // exported conversation. Some Claude exports place conversations inside
    // account/workspace folders rather than embedding a project field.
    const accountUuid = (convo as any).account?.uuid ?? (convo as any).account_uuid ?? null

    out.push({
      title,
      createdAt: normalizeTimestamp(convo.created_at ?? null),
      metadata: {
        source: options.source,
        claude_uuid: convo.uuid,
        original_summary: convo.summary ?? null,
        imported_project_name: importedProjectName ?? null,
        account_uuid: accountUuid ?? null,
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
