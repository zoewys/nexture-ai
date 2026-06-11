/**
 * dataPortability.ts — 数据导入/导出核心逻辑
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ExportOptions, ImportOptions, ImportPreview } from '@shared/types'

function appDataDir(): string {
  return app.getPath('userData')
}

// ── Export ──────────────────────────────────────────────────────────────────

export interface ExportResult {
  ok: boolean
  path?: string
  error?: string
}

export async function createExportZip(
  destPath: string,
  options: ExportOptions
): Promise<ExportResult> {
  try {
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip()
    const dataDir = appDataDir()

    zip.addLocalFile(join(dataDir, 'agents.json'))
    zip.addLocalFile(join(dataDir, 'workflows.json'))

    const runsDir = join(dataDir, 'workflow-runs')
    if (existsSync(runsDir)) zip.addLocalFolder(runsDir, 'workflow-runs')

    if (options.schedules) {
      const p = join(dataDir, 'schedules.json')
      if (existsSync(p)) zip.addLocalFile(p)
    }
    if (options.settings) {
      const p = join(dataDir, 'settings.json')
      if (existsSync(p)) zip.addLocalFile(p)
    }
    if (options.memories) {
      const p = join(dataDir, 'memories')
      if (existsSync(p)) zip.addLocalFolder(p, 'memories')
    }

    zip.writeZip(destPath)
    return { ok: true, path: destPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function createTemplateExportZip(
  destPath: string,
  templateId: string
): Promise<ExportResult> {
  try {
    const AdmZip = (await import('adm-zip')).default
    const dataDir = appDataDir()
    const workflows = JSON.parse(readFileSync(join(dataDir, 'workflows.json'), 'utf8'))
    const template = workflows.find((t: any) => t.id === templateId)
    if (!template) return { ok: false, error: `Template not found: ${templateId}` }

    const agentIds = new Set<string>()
    for (const step of template.steps || []) {
      if (step.agentId) agentIds.add(step.agentId)
      if (step.parallel) for (const s of step.parallel) { if (s.agentId) agentIds.add(s.agentId) }
    }

    const allAgents = JSON.parse(readFileSync(join(dataDir, 'agents.json'), 'utf8'))
    const agents = allAgents.filter((a: any) => agentIds.has(a.id))

    const zip = new AdmZip()
    zip.addFile('workflows.json', Buffer.from(JSON.stringify([template], null, 2)))
    zip.addFile('agents.json', Buffer.from(JSON.stringify(agents, null, 2)))
    zip.writeZip(destPath)
    return { ok: true, path: destPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Import ──────────────────────────────────────────────────────────────────

export async function previewImportZip(
  filePath: string
): Promise<ImportPreview> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(filePath)
  const entries = zip.getEntries()
  const dataDir = appDataDir()

  const hasFile = (name: string) => entries.some((e: any) => e.entryName === name)

  const preview: ImportPreview = {
    agents: { total: 0, new: 0, existing: 0 },
    workflows: { total: 0, new: 0, existing: 0 },
    workflowRuns: { total: 0, new: 0, existing: 0 }
  }

  if (hasFile('agents.json')) {
    const agents = JSON.parse(zip.readAsText('agents.json')!)
    preview.agents.total = agents.length
    for (const a of agents) {
      if (loadExistingIds(join(dataDir, 'agents.json')).has(a.id)) preview.agents.existing++
      else preview.agents.new++
    }
  }

  if (hasFile('workflows.json')) {
    const wfs = JSON.parse(zip.readAsText('workflows.json')!)
    preview.workflows.total = wfs.length
    for (const w of wfs) {
      if (loadExistingIds(join(dataDir, 'workflows.json')).has(w.id)) preview.workflows.existing++
      else preview.workflows.new++
    }
  }

  const runEntries = entries.filter((e: any) => e.entryName.startsWith('workflow-runs/') && e.entryName.endsWith('.json'))
  preview.workflowRuns.total = runEntries.length
  const runsDir = join(dataDir, 'workflow-runs')
  if (existsSync(runsDir)) {
    let e = 0, n = 0
    for (const re of runEntries) {
      const name = (re as any).entryName.split('/').pop() || ''
      if (existsSync(join(runsDir, name))) e++
      else n++
    }
    preview.workflowRuns.new = n
    preview.workflowRuns.existing = e
  } else {
    preview.workflowRuns.new = runEntries.length
  }

  if (hasFile('schedules.json')) {
    const scheds = JSON.parse(zip.readAsText('schedules.json')!)
    let n = 0, e = 0
    for (const s of scheds) {
      if (loadExistingIds(join(dataDir, 'schedules.json')).has(s.id)) e++
      else n++
    }
    preview.schedules = { total: scheds.length, new: n, existing: e }
  }

  preview.settings = hasFile('settings.json')

  const memEntries = entries.filter((e: any) => e.entryName.startsWith('memories/agents/') && e.entryName.endsWith('global.json'))
  if (memEntries.length > 0) {
    preview.memories = { total: memEntries.length, new: memEntries.length, existing: 0 }
  }

  return preview
}

export async function executeImport(
  filePath: string,
  options: ImportOptions
): Promise<ExportResult> {
  try {
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip(filePath)
    const dataDir = appDataDir()
    const entries = zip.getEntries()
    const hasFile = (name: string) => entries.some((e: any) => e.entryName === name)

    if (options.agents && hasFile('agents.json')) {
      mergeJsonArray(join(dataDir, 'agents.json'), JSON.parse(zip.readAsText('agents.json')!))
    }
    if (options.workflows && hasFile('workflows.json')) {
      mergeJsonArray(join(dataDir, 'workflows.json'), JSON.parse(zip.readAsText('workflows.json')!))
    }
    if (options.workflowRuns) {
      await mkdir(join(dataDir, 'workflow-runs'), { recursive: true })
      for (const entry of entries) {
        const en: any = entry
        if (en.entryName.startsWith('workflow-runs/') && en.entryName.endsWith('.json')) {
          const name = en.entryName.split('/').pop()!
          const dest = join(dataDir, 'workflow-runs', name)
          if (!existsSync(dest)) await writeFile(dest, en.getData())
        }
      }
    }
    if (options.schedules && hasFile('schedules.json')) {
      mergeJsonArray(join(dataDir, 'schedules.json'), JSON.parse(zip.readAsText('schedules.json')!))
    }
    if (options.settings && hasFile('settings.json')) {
      const sdest = join(dataDir, 'settings.json')
      if (!existsSync(sdest)) await writeFile(sdest, zip.readAsText('settings.json')!)
    }
    if (options.memories) {
      for (const entry of entries) {
        const en: any = entry
        if (en.entryName.startsWith('memories/') && !en.isDirectory) {
          const dest = join(dataDir, en.entryName)
          if (!existsSync(dest)) {
            await mkdir(join(dest, '..'), { recursive: true })
            await writeFile(dest, en.getData())
          }
        }
      }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadExistingIds(path: string): Set<string> {
  try {
    if (!existsSync(path)) return new Set()
    const data = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(data)) return new Set()
    return new Set(data.map((item: any) => item.id))
  } catch { return new Set() }
}

function mergeJsonArray(path: string, incoming: any[]): void {
  const existing = loadExistingIds(path)
  let current: any[] = []
  if (existsSync(path)) {
    try { current = JSON.parse(readFileSync(path, 'utf8')) } catch { current = [] }
  }
  for (const item of incoming) {
    if (!existing.has(item.id)) current.push(item)
  }
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(current, null, 2))
}
