import path from 'node:path'
import { promises as fs } from 'node:fs'
import { supabaseServerAdmin } from '@/lib/supabase/server'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

export type AttachmentFile = {
  id: string
  name: string
  path: string
  sizeBytes: number
  mime?: string
}

export async function buildAttachmentIndex(exportRoot: string): Promise<Map<string, AttachmentFile>> {
  const index = new Map<string, AttachmentFile>()

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) continue
      const idMatch = entry.name.match(/file_[0-9a-f]+/i)
      if (!idMatch) continue
      const id = idMatch[0]
      const stat = await fs.stat(full)
      if (!index.has(id)) {
        index.set(id, {
          id,
          name: entry.name,
          path: full,
          sizeBytes: stat.size,
          mime: mimeFromExtension(ext),
        })
      }
    }
  }

  await walk(exportRoot)
  return index
}

export function mimeFromExtension(ext: string): string | undefined {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return undefined
  }
}

export async function uploadAttachmentFile(file: AttachmentFile, bucket = 'attachments') {
  const supabase = (await supabaseServerAdmin()) as any
  try {
    const { data: buckets } = await supabase.storage.listBuckets()
    const existing = (buckets ?? []).find((b: { name: string }) => b.name === bucket)
    if (!existing) {
      await supabase.storage.createBucket(bucket, { public: true, fileSizeLimit: 50 * 1024 * 1024 })
    }
  } catch {
    // ignore bucket ensure failures, upload may still succeed if bucket exists
  }
  const folder = new Date().toISOString().slice(0, 10)
  const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`
  const bytes = await fs.readFile(file.path)
  const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.mime ?? undefined,
  })
  if (error) {
    throw new Error(`Attachment upload failed: ${error.message}`)
  }
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(key)
  return {
    name: file.name,
    path: key,
    url: pub?.publicUrl ?? null,
    mime: file.mime ?? null,
    sizeBytes: file.sizeBytes,
  }
}
