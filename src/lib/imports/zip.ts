import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import JSZip from 'jszip'

export async function extractZipToTemp(buffer: ArrayBuffer, prefix: string) {
  const zip = await JSZip.loadAsync(buffer)
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  let conversationsJson: string | null = null
  let selectedEntryName: string | null = null
  let selectedEntryParent: string | null = null
  let projectsJson: any[] | null = null
  let projectsEntryName: string | null = null
  const entryNames: string[] = []

  const entries = Object.values(zip.files) as any[]
  for (const entry of entries) {
    if (entry.dir) continue
    const content = await entry.async('nodebuffer')
    const targetPath = path.join(tmpRoot, entry.name)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, content)
    const base = entry.name.includes('/') ? entry.name.split('/').pop() : entry.name
    entryNames.push(entry.name)
    // Match only the exact basename 'conversations.json' to avoid
    // accidentally matching 'shared_conversations.json'. ZIP entries use
    // forward slashes regardless of platform, so splitting on '/' is okay.
    if (base === 'conversations.json') {
      conversationsJson = content.toString('utf8')
      selectedEntryName = entry.name
      if (entry.name.includes('/')) {
        const parts = entry.name.split('/')
        parts.pop()
        selectedEntryParent = parts.pop() ?? null
      }
    }
    if (base === 'projects.json') {
      try {
        projectsJson = JSON.parse(content.toString('utf8'))
        projectsEntryName = entry.name
      } catch {
        // ignore parse errors
      }
    }
  }

  // Fallback: if no conversations.json explicitly found, try any .json file
  // and detect whether it looks like a ChatGPT or Claude export by checking
  // for known top-level keys.
  if (!conversationsJson) {
    for (const name of entryNames) {
      if (!name.toLowerCase().endsWith('.json')) continue
      try {
        const content = await fs.readFile(path.join(tmpRoot, name), 'utf8')
        const parsed = JSON.parse(content)
        // ChatGPT export: array of objects with 'mapping' key or object with mapping
        if (Array.isArray(parsed) && parsed.length && (parsed[0].mapping || parsed[0].conversation_id || parsed[0].id)) {
          conversationsJson = content
          selectedEntryName = name
          break
        }
        if (!Array.isArray(parsed) && (parsed.mapping || parsed.conversation_id || parsed.id)) {
          conversationsJson = JSON.stringify([parsed])
          selectedEntryName = name
          break
        }
        // Claude export: array with 'chat_messages'
        if (Array.isArray(parsed) && parsed.length && parsed[0].chat_messages) {
          conversationsJson = content
          selectedEntryName = name
          break
        }
      } catch {
        // ignore parse errors and continue
      }
    }
  }

  // Also attempt to read projects.json if present alongside conversations
  if (!projectsJson) {
    const projEntry = entryNames.find((n) => n.toLowerCase().endsWith('projects.json'))
    if (projEntry) {
      try {
        const content = await fs.readFile(path.join(tmpRoot, projEntry), 'utf8')
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          projectsJson = parsed
          projectsEntryName = projEntry
        }
      } catch {
        // ignore
      }
    }
  }

  return { tmpRoot, conversationsJson, entries: entryNames, selectedEntryName, selectedEntryParent, projectsJson, projectsEntryName }
}
