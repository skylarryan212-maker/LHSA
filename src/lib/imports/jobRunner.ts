import { computeImportHash } from '@/lib/imports/common'
import type { NormalizedConversation, NormalizedMessage } from '@/lib/imports/common'
import { buildAttachmentIndex, uploadAttachmentFile } from '@/lib/imports/attachments'
import { findExistingConversationId, insertConversationWithMessages } from '@/lib/imports/db'
import { logImportEvent } from '@/lib/logging'
import { supabaseServerAdmin } from '@/lib/supabase/server'
import { requireUserIdServer } from '@/lib/supabase/user'

export type ImportJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type ImportJobRecord = {
  id: string
  user_id: string
  source: string
  status: ImportJobStatus
  total: number
  imported: number
  skipped: number
  errors: number
  created_at: string | null
  updated_at: string | null
  started_at: string | null
  completed_at: string | null
  metadata?: Record<string, unknown> | null
  progress?: Record<string, unknown> | null
}

export async function createImportJob(params: { source: string; total: number; metadata?: Record<string, unknown> }) {
  const userId = await requireUserIdServer()
  const supabase = (await supabaseServerAdmin()) as any
  const { data, error } = await supabase
    .from('import_jobs')
    .insert([
      {
        user_id: userId,
        source: params.source,
        status: 'queued',
        total: params.total,
        imported: 0,
        skipped: 0,
        errors: 0,
        metadata: params.metadata ?? {},
      },
    ])
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Failed to create import job: ${error?.message ?? 'unknown error'}`)
  }
  return data as ImportJobRecord
}

export async function updateImportJob(jobId: string, patch: Partial<ImportJobRecord>) {
  const supabase = (await supabaseServerAdmin()) as any
  const { error } = await supabase
    .from('import_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) {
    throw new Error(`Failed to update import job: ${error.message}`)
  }
}

async function getJobStatus(jobId: string): Promise<ImportJobRecord | null> {
  const supabase = (await supabaseServerAdmin()) as any
  const { data } = await supabase.from('import_jobs').select('*').eq('id', jobId).limit(1)
  return data?.[0] ?? null
}

export async function runImportJob(params: {
  jobId: string
  conversations: NormalizedConversation[]
  attachmentRoot?: string | null
  batchSize?: number
  force?: boolean
  projects?: any[] | null
  selectedEntryParent?: string | null
}) {
  try {
    const userId = await requireUserIdServer()
    const supabase = (await supabaseServerAdmin()) as any
    const batchSize = params.batchSize ?? 20
    const attachmentIndex = params.attachmentRoot
      ? await buildAttachmentIndex(params.attachmentRoot)
      : new Map()

    await updateImportJob(params.jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
    })
    await logImportEvent({ jobId: params.jobId, level: 'info', event: 'job.start', data: { total: params.conversations.length } })

    let imported = 0
    let skipped = 0
    let errors = 0

    // Build a mapping from imported projects (if provided in the archive)
    // to Supabase project IDs by creating or finding projects for each entry.
    let jobProjectId: string | null = null
    const projectNameToId = new Map<string, string>()
    const projectUuidToId = new Map<string, string>()
    const accountUuidToId = new Map<string, string>()
    const createdProjectIds: string[] = []
    const mappedProjectIds: string[] = []
    try {
      if (Array.isArray(params.projects) && params.projects.length) {
        for (const p of params.projects) {
          try {
            const projectName = p.name ?? p.title ?? null
            const projectUuid = p.uuid ?? p.id ?? null
            const projectAccountUuid = (p as any).account?.uuid ?? (p as any).account_uuid ?? null
            if (!projectName) continue

            // Try to find existing project by user and name
            const { data: existing } = await supabase
              .from('projects')
              .select('id')
              .eq('user_id', userId)
              .eq('name', projectName)
              .limit(1)

            if (existing && existing.length) {
              projectNameToId.set(projectName, existing[0].id)
              if (projectUuid) projectUuidToId.set(projectUuid, existing[0].id)
              if (projectAccountUuid) accountUuidToId.set(projectAccountUuid, existing[0].id)
              mappedProjectIds.push(existing[0].id)
              // Log that we mapped to an existing project
              await logImportEvent({ jobId: params.jobId, level: 'info', event: 'project.mapped', data: { name: projectName, uuid: projectUuid ?? null, projectId: existing[0].id } })
              continue
            }

            // Create project
            const firstSource = params.conversations.length > 0 ? (params.conversations[0].metadata as any)?.source ?? null : null
            const { data: created, error: createErr } = await supabase
              .from('projects')
              .insert([
                {
                  user_id: userId,
                  name: projectName,
                  metadata: { imported: true, import_job_id: params.jobId, import_project_uuid: projectUuid ?? null, source: firstSource },
                },
              ])
              .select()
              .single()

            if (!createErr && created) {
              projectNameToId.set(projectName, created.id)
              if (projectUuid) projectUuidToId.set(projectUuid, created.id)
              if (projectAccountUuid) accountUuidToId.set(projectAccountUuid, created.id)
              createdProjectIds.push(created.id)
              // Log a created project for diagnostics
              await logImportEvent({ jobId: params.jobId, level: 'info', event: 'project.created', data: { name: projectName, uuid: projectUuid ?? null, projectId: created.id } })
            }
          } catch (inner) {
            await logImportEvent({ jobId: params.jobId, level: 'warn', event: 'project.create.failed', message: String(inner) })
          }
        }
      }

      // If there are no explicit project mappings from the archive, create
      // a single fallback project for this job so imported chats aren't orphaned.
      const anyProvidedProjectName = params.conversations.some((c) => {
        const m = c.metadata as any
        return Boolean(m?.imported_project_name ?? m?.project_name)
      })
        if (!anyProvidedProjectName && (!projectNameToId.size) && params.conversations.length > 0) {
        const firstSource = (params.conversations[0].metadata as any)?.source ?? null
        const projectName = `Imported ${firstSource ?? 'Chats'} ${new Date().toISOString().slice(0, 10)}`
        const { data: createdProj, error: projErr } = await supabase
          .from('projects')
          .insert([
            {
              user_id: userId,
              name: projectName,
              metadata: { imported: true, import_job_id: params.jobId, source: firstSource ?? null },
            },
          ])
          .select()
          .single()

        if (!projErr && createdProj) {
          jobProjectId = createdProj.id
          createdProjectIds.push(createdProj.id)
          await logImportEvent({ jobId: params.jobId, level: 'info', event: 'project.created', data: { name: projectName, projectId: createdProj.id } })
        }
      }
    } catch (err) {
      await logImportEvent({ jobId: params.jobId, level: 'warn', event: 'project.create.failed', message: String(err) })
    }

    // If the extractor selected a conversations.json inside a folder whose
    // name matches a project UUID from `projects.json`, prefer that mapping
    // for the job-level project.
    try {
      const selectedParent = params.selectedEntryParent ?? null
      if (selectedParent && projectUuidToId.has(selectedParent)) {
        jobProjectId = projectUuidToId.get(selectedParent) ?? jobProjectId
      }
    } catch {
      // ignore
    }

    // Persist discovered/mapped/created project ids on the job metadata so
    // the client can inspect which projects were created or mapped by this
    // import. This also helps debugging when projects don't appear in the UI.
    try {
      const existingJob = await getJobStatus(params.jobId)
      if (existingJob) {
        const meta = (existingJob.metadata ?? {}) as Record<string, unknown>
        const existingCreated = (meta.createdProjectIds ?? []) as string[]
        const existingMapped = (meta.mappedProjectIds ?? []) as string[]
        meta.createdProjectIds = Array.from(new Set([...existingCreated, ...createdProjectIds]))
        meta.mappedProjectIds = Array.from(new Set([...existingMapped, ...mappedProjectIds]))
        await updateImportJob(params.jobId, { metadata: meta })
      }
    } catch (err) {
      // don't fail the import if we can't persist metadata
      await logImportEvent({ jobId: params.jobId, level: 'warn', event: 'job.metadata.update.failed', message: String(err) })
    }

    for (let i = 0; i < params.conversations.length; i += batchSize) {
      const status = await getJobStatus(params.jobId)
      if (status?.status === 'cancelled') {
        await logImportEvent({ jobId: params.jobId, level: 'warn', event: 'job.cancelled' })
        return
      }

      const batch = params.conversations.slice(i, i + batchSize)
      for (const conversation of batch) {
        try {
          const importHash = computeImportHash(conversation.messages)
          const chatgptId = (conversation.metadata as any)?.chatgpt_id ?? null
          const claudeUuid = (conversation.metadata as any)?.claude_uuid ?? null
          // Log parsed conversation metadata for diagnostics
          await logImportEvent({
            jobId: params.jobId,
            level: 'info',
            event: 'conversation.parsed',
            data: {
              title: conversation.title,
              messageCount: conversation.messages.length,
              chatgptId,
              claudeUuid,
              importHash,
            },
          })

          let existingId: string | null = null
          if (!params.force) {
            existingId = await findExistingConversationId({
              claudeUuid,
              chatgptId,
              importHash,
            })

            if (existingId) {
              skipped += 1
              await logImportEvent({
                jobId: params.jobId,
                level: 'info',
                event: 'conversation.skipped',
                data: { existingId, title: conversation.title, importHash, chatgptId, claudeUuid },
              })
              continue
            }
          } else {
            // When forcing, log that dedupe was bypassed
            await logImportEvent({ jobId: params.jobId, level: 'info', event: 'conversation.force_import', data: { title: conversation.title, importHash, chatgptId, claudeUuid } })
          }

          const resolvedMessages: NormalizedMessage[] = []
          for (const msg of conversation.messages) {
            if (msg.attachments && msg.attachments.length) {
              const uploaded = [] as NormalizedMessage['attachments']
              for (const ref of msg.attachments) {
                const file = attachmentIndex.get(ref.sourceId)
                if (!file) continue
                const uploadedFile = await uploadAttachmentFile(file)
                uploaded?.push({
                  sourceId: ref.sourceId,
                  name: uploadedFile.name,
                  mime: uploadedFile.mime ?? undefined,
                  sizeBytes: uploadedFile.sizeBytes,
                  url: uploadedFile.url ?? undefined,
                })
              }
              resolvedMessages.push({ ...msg, attachments: uploaded })
            } else {
              resolvedMessages.push(msg)
            }
          }

          // Determine per-conversation project override: prefer explicit
          // imported_project_name or project_name from the conversation metadata,
          // then match against provided projects, then fall back to jobProjectId.
          let convProjectId: string | null = null
          try {
            const convMeta = conversation.metadata as any
            const convName = convMeta?.imported_project_name ?? convMeta?.project_name ?? null
            const convUuid = convMeta?.project_uuid ?? convMeta?.import_project_uuid ?? null
            const convAccountUuid = convMeta?.account_uuid ?? null
            if (convName && projectNameToId.has(convName)) {
              convProjectId = projectNameToId.get(convName) ?? null
            } else if (convUuid && projectUuidToId.has(convUuid)) {
              convProjectId = projectUuidToId.get(convUuid) ?? null
            } else if (convAccountUuid && accountUuidToId.has(convAccountUuid)) {
              convProjectId = accountUuidToId.get(convAccountUuid) ?? null
            }
          } catch {
            // ignore
          }

          const effectiveProjectId = convProjectId ?? jobProjectId

          await insertConversationWithMessages({
            conversation,
            messages: resolvedMessages,
            importHash,
            userIdOverride: userId,
            projectIdOverride: effectiveProjectId,
          })

          imported += 1
          await logImportEvent({
            jobId: params.jobId,
            level: 'info',
            event: 'conversation.imported',
            data: { title: conversation.title, importHash, chatgptId, claudeUuid },
          })
        } catch (error) {
          errors += 1
          await logImportEvent({
            jobId: params.jobId,
            level: 'error',
            event: 'conversation.error',
            message: error instanceof Error ? error.message : String(error),
            data: { title: conversation.title },
          })
        }
      }

      await updateImportJob(params.jobId, {
        imported,
        skipped,
        errors,
        progress: {
          batchIndex: Math.floor(i / batchSize),
          batchSize,
          processed: Math.min(i + batchSize, params.conversations.length),
          total: params.conversations.length,
        },
      })
    }

    await updateImportJob(params.jobId, {
      status: 'completed',
      imported,
      skipped,
      errors,
      completed_at: new Date().toISOString(),
    })
    await logImportEvent({ jobId: params.jobId, level: 'info', event: 'job.complete', data: { imported, skipped, errors } })
  } catch (error) {
    await updateImportJob(params.jobId, { status: 'failed', completed_at: new Date().toISOString() })
    await logImportEvent({
      jobId: params.jobId,
      level: 'error',
      event: 'job.failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function cancelImportJob(jobId: string) {
  await updateImportJob(jobId, { status: 'cancelled' })
}
