import { supabaseServerAdmin } from '@/lib/supabase/server'
import { requireUserIdServer } from '@/lib/supabase/user'
import type { Json } from '@/lib/supabase/types'
import type { NormalizedConversation, NormalizedMessage } from '@/lib/imports/common'
import { buildMessageMetadata } from '@/lib/imports/common'

export async function findExistingConversationId(params: {
  claudeUuid?: string | null
  chatgptId?: string | null
  importHash?: string | null
}): Promise<string | null> {
  const userId = await requireUserIdServer()
  const supabase = (await supabaseServerAdmin()) as any

  const check = async (field: string, value?: string | null) => {
    if (!value) return null
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .eq(`metadata->>${field}`, value)
      .limit(1)
    if (error) return null
    return data?.[0]?.id ?? null
  }

  const byClaude = await check('claude_uuid', params.claudeUuid)
  if (byClaude) return byClaude
  const byChatgpt = await check('chatgpt_id', params.chatgptId)
  if (byChatgpt) return byChatgpt
  const byHash = await check('import_hash', params.importHash)
  if (byHash) return byHash
  return null
}

export async function insertConversationWithMessages(params: {
  conversation: NormalizedConversation
  messages: NormalizedMessage[]
  importHash?: string | null
  userIdOverride?: string | null
  projectIdOverride?: string | null
}): Promise<string> {
  const userId = params.userIdOverride ?? (await requireUserIdServer())
  const supabase = (await supabaseServerAdmin()) as any
  const metadata = {
    ...(typeof params.conversation.metadata === 'object' ? params.conversation.metadata : {}),
    import_hash: params.importHash ?? null,
  }

  // Allow an explicit project id override (provided by the job runner).
  // If not provided, fall back to looking up `imported_project_name` or `project_name`
  let projectId: string | null = params.projectIdOverride ?? null
  if (!projectId) {
    try {
      const importedProjectName = (params.conversation.metadata as any)?.imported_project_name ?? (params.conversation.metadata as any)?.project_name ?? null
      if (importedProjectName && typeof importedProjectName === 'string' && importedProjectName.trim()) {
        // Try to find an existing project with this name
        const { data: existing } = await supabase
          .from('projects')
          .select('id')
          .eq('user_id', userId)
          .eq('name', importedProjectName)
          .limit(1)

        if (existing && existing.length) {
          projectId = existing[0].id
        } else {
          // Create a new project and mark it as imported
          const { data: created, error: createErr } = await supabase
            .from('projects')
            .insert([
              {
                user_id: userId,
                name: importedProjectName,
                metadata: { imported: true, import_source: (params.conversation.metadata as any)?.source ?? null },
              },
            ])
            .select()
            .single()

          if (createErr) {
            // Fall back to null projectId if creation fails
            console.warn('Failed to create imported project:', createErr.message)
          } else if (created) {
            projectId = created.id
          }
        }
      }
    } catch (err) {
      console.warn('Error resolving imported project:', err)
    }
  }

  const { data: convo, error: convoError } = await supabase
    .from('conversations')
    .insert([
      {
        user_id: userId,
        title: params.conversation.title ?? null,
        project_id: projectId,
        metadata: metadata as Json,
        created_at: params.conversation.createdAt ?? null,
      },
    ])
    .select()
    .single()

  if (convoError || !convo) {
    throw new Error(`Failed to insert conversation: ${convoError?.message ?? 'unknown error'}`)
  }

  const chunkSize = 100
  for (let i = 0; i < params.messages.length; i += chunkSize) {
    const chunk = params.messages.slice(i, i + chunkSize)
    const payload = chunk.map((msg) => ({
      user_id: userId,
      conversation_id: convo.id,
      role: msg.role,
      content: msg.content,
      metadata: buildMessageMetadata(msg.attachments, msg.metadata ?? null),
      created_at: msg.createdAt ?? null,
    }))

    const { error: msgError } = await supabase.from('messages').insert(payload)
    if (msgError) {
      throw new Error(`Failed to insert messages: ${msgError.message}`)
    }
  }

  return convo.id as string
}
