'use client'

import { useRef, useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ImportProgress } from '@/components/import-progress'

type Provider = 'chatgpt' | 'claude'

type ImportModalProps = {
  open: boolean
  onClose: () => void
  onDone?: () => void
  onRefreshProjects?: () => void | Promise<void>
  onRefreshChats?: () => void | Promise<void>
}

const PROVIDER_LINKS: Record<Provider, string> = {
  chatgpt: 'https://chatgpt.com/#settings/DataControls',
  claude: 'https://claude.ai/settings/data-privacy-controls',
}

export function ImportModal({ open, onClose, onDone, onRefreshProjects, onRefreshChats }: ImportModalProps) {
  const [provider, setProvider] = useState<Provider>('chatgpt')
  const [mode, setMode] = useState<'export' | 'shared'>('export')
  const [includeSystemMessages, setIncludeSystemMessages] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setUrl('')
    setError(null)
    setJobId(null)
    setLoading(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    setError(null)
    setLoading(true)
    try {
      if (mode === 'export') {
        if (!file) {
          setError('Please select an export file')
          setLoading(false)
          return
        }
        const form = new FormData()
        form.set('file', file)
        form.set('includeSystemMessages', includeSystemMessages ? 'true' : 'false')
        const res = await fetch(`/api/import/${provider}/export`, { method: 'POST', body: form })
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error ?? 'Import failed')
        }
        setJobId(json.jobId)
        setLoading(false)
        return
      }

      if (!url.trim()) {
        setError('Please paste a shared link URL')
        setLoading(false)
        return
      }
      const res = await fetch(`/api/import/${provider}/shared-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), includeSystemMessages }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error ?? 'Import failed')
      }
      setJobId(json.jobId)
      setLoading(false)
    } catch (err) {
      setLoading(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onClose={close} contentClassName="max-w-lg">
      <div className="space-y-4">
        <div className="text-lg font-semibold">Import chats</div>
        <div className="space-y-2">
          <Label htmlFor="provider">Provider</Label>
          <select
            id="provider"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
          >
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
          </select>
        </div>

        <div className="flex gap-2">
          <Button
            variant={mode === 'export' ? 'default' : 'outline'}
            onClick={() => setMode('export')}
          >
            Full export
          </Button>
          <Button
            variant={mode === 'shared' ? 'default' : 'outline'}
            onClick={() => setMode('shared')}
          >
            Single chat
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          Export instructions: <a className="underline" href={PROVIDER_LINKS[provider]} target="_blank" rel="noreferrer">{PROVIDER_LINKS[provider]}</a>
        </div>

        {mode === 'export' ? (
          <div key="export-mode" className="space-y-2">
            <Label htmlFor="export-file">Upload export ZIP</Label>
            <input
              ref={fileInputRef}
              id="export-file"
              type="file"
              accept=".zip,application/zip"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <div key="shared-mode" className="space-y-2">
            <Label htmlFor="shared-url">Shared link URL</Label>
            <input
              key={`url-input-${mode}`}
              id="shared-url"
              type="url"
              placeholder="https://..."
              value={url}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)}
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeSystemMessages}
            onChange={(event) => setIncludeSystemMessages(event.target.checked)}
          />
          Include system messages as visible messages
        </label>

        {error && <div className="text-sm text-destructive">{error}</div>}

        {jobId ? (
          <ImportProgress
            jobId={jobId}
            onClose={close}
            onDone={async () => {
              try {
                await onRefreshProjects?.()
                await onRefreshChats?.()
                onDone?.()
              } catch (err) {
                console.error('Failed to refresh after import:', err)
              }
            }}
          />
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={submit} disabled={loading}>
              {loading ? 'Starting...' : 'Start import'}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
