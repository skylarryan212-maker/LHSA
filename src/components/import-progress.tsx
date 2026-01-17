'use client'

import { useEffect, useState, memo } from 'react'
import { Button } from '@/components/ui/button'

interface ImportProgressProps {
  jobId: string
  onClose: () => void
  onDone?: () => void
}

type ImportJob = {
  id: string
  status: string
  total: number
  imported: number
  skipped: number
  errors: number
  progress?: { processed?: number; total?: number }
}

export const ImportProgress = memo(function ImportProgress({ jobId, onClose, onDone }: ImportProgressProps) {
  const [job, setJob] = useState<ImportJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)

  useEffect(() => {
    let mounted = true
    let timer: number | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/import/jobs/status/${jobId}`)
        const json = await res.json()
        if (!mounted) return
        if (!res.ok) {
          setError(json?.error ?? 'Failed to load job status')
          return
        }
        setJob(json.job)
        if (json.job?.status === 'completed' || json.job?.status === 'failed' || json.job?.status === 'cancelled') {
          // Notify parent that the job finished so the UI can refresh projects/chats
          try {
            onDone?.()
          } catch {}
          return
        }
        timer = window.setTimeout(poll, 2000)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    void poll()
    return () => {
      mounted = false
      if (timer) window.clearTimeout(timer)
    }
  }, [jobId])

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    )
  }

  const cancelJob = async () => {
    if (!job || canceling || job.status !== 'running') return
    setCanceling(true)
    try {
      await fetch(`/api/import/jobs/cancel/${jobId}`, { method: 'POST' })
    } finally {
      setCanceling(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Import status: {job?.status ?? 'loading...'}</div>
      <div className="text-sm text-muted-foreground">
        Imported {job?.imported ?? 0} / {job?.total ?? 0} | Skipped {job?.skipped ?? 0} | Errors {job?.errors ?? 0}
      </div>
      {job?.progress && (
        <div className="text-xs text-muted-foreground">
          Processed {job.progress.processed ?? 0} of {job.progress.total ?? job.total ?? 0}
        </div>
      )}
      <div className="flex gap-2">
        {job?.status === 'running' && (
          <Button variant="outline" onClick={cancelJob} disabled={canceling}>
            {canceling ? 'Cancelling...' : 'Cancel import'}
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
});

ImportProgress.displayName = 'ImportProgress';
