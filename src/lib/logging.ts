'use server'

import { supabaseServerAdmin } from '@/lib/supabase/server'
import { requireUserIdServer } from '@/lib/supabase/user'
import type { Json } from '@/lib/supabase/types'

export type ImportLogLevel = 'info' | 'warn' | 'error'

export type ImportLogEvent = {
  jobId?: string | null
  level: ImportLogLevel
  event: string
  message?: string
  data?: Json | null
}

function safeJson(value: Json | undefined | null, maxLength = 8000): Json | null {
  if (!value) return null
  try {
    const text = JSON.stringify(value)
    if (text.length <= maxLength) return value
    return JSON.parse(text.slice(0, maxLength)) as Json
  } catch {
    return null
  }
}

export async function logImportEvent(evt: ImportLogEvent): Promise<void> {
  const payload = {
    event: evt.event,
    message: evt.message ?? null,
    data: safeJson(evt.data),
  }

  const prefix = evt.jobId ? `[import:${evt.jobId}]` : '[import]'
  if (evt.level === 'error') {
    console.error(prefix, payload)
  } else if (evt.level === 'warn') {
    console.warn(prefix, payload)
  } else {
    console.info(prefix, payload)
  }

  if (evt.level !== 'error' || !evt.jobId) return

  try {
    const userId = await requireUserIdServer()
    const supabase = (await supabaseServerAdmin()) as any
    await supabase.from('import_job_errors').insert([
      {
        job_id: evt.jobId,
        user_id: userId,
        message: evt.message ?? evt.event,
        details: payload.data ?? {},
      },
    ])
  } catch (error) {
    console.error(prefix, { event: 'logImportEvent.persist_failed', error })
  }
}
