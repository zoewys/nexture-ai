import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkflowRun, WorkflowTemplate, WorkflowStepNode } from '@shared/types'
import { isParallelGroup } from '@shared/types'

type SaveTemplateInput = Omit<WorkflowTemplate, 'id'> & { id?: string }

export class WorkflowStore {
  private readonly templatesPath: string
  private readonly runsDir: string

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.templatesPath = join(dir, 'workflows.json')
    this.runsDir = join(dir, 'workflow-runs')
    mkdirSync(this.runsDir, { recursive: true })
    this.migrateFromLegacy(dir)
  }

  listTemplates(): WorkflowTemplate[] {
    return readArray<WorkflowTemplate>(this.templatesPath).map(normalizeTemplate)
  }

  saveTemplate(input: SaveTemplateInput): WorkflowTemplate {
    const list = this.listTemplates()
    const existing = list.find((item) => item.id === input.id)
    const template: WorkflowTemplate = {
      id: input.id ?? randomUUID(),
      name: input.name,
      description: input.description,
      steps: input.steps,
      budgetUsd: input.budgetUsd,
      createdAt: existing?.createdAt ?? input.createdAt ?? Date.now()
    }
    const idx = list.findIndex((item) => item.id === template.id)
    if (idx >= 0) list[idx] = template
    else list.unshift(template)
    writeArray(this.templatesPath, list)
    return template
  }

  deleteTemplate(id: string): void {
    writeArray(
      this.templatesPath,
      this.listTemplates().filter((template) => template.id !== id)
    )
  }

  listRuns(): WorkflowRun[] {
    try {
      const files = readdirSync(this.runsDir).filter((f) => f.endsWith('.json'))
      const runs: WorkflowRun[] = []
      for (const file of files) {
        try {
          const data = readFileSync(join(this.runsDir, file), 'utf8')
          runs.push(JSON.parse(data) as WorkflowRun)
        } catch {
          // Skip corrupted files
        }
      }
      return runs
    } catch {
      return []
    }
  }

  saveRun(run: WorkflowRun): void {
    try {
      writeFileSync(join(this.runsDir, `${run.id}.json`), JSON.stringify(run))
    } catch {
      // Persistence is best-effort.
    }
  }

  deleteRun(id: string): void {
    try {
      unlinkSync(join(this.runsDir, `${id}.json`))
    } catch {
      // Already gone or never existed.
    }
  }

  private migrateFromLegacy(dir: string): void {
    const legacyPath = join(dir, 'workflow-runs.json')
    if (!existsSync(legacyPath)) return
    try {
      const runs = readArray<WorkflowRun>(legacyPath)
      for (const run of runs) {
        const dest = join(this.runsDir, `${run.id}.json`)
        if (!existsSync(dest)) {
          writeFileSync(dest, JSON.stringify(run))
        }
      }
      unlinkSync(legacyPath)
    } catch {
      // Migration is best-effort; legacy file stays.
    }
  }
}

function readArray<T>(path: string): T[] {
  try {
    if (!existsSync(path)) return []
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeArray<T>(path: string, list: T[]): void {
  try {
    writeFileSync(path, JSON.stringify(list, null, 2))
  } catch {
    // Persistence is best-effort.
  }
}

function normalizeTemplate(t: WorkflowTemplate): WorkflowTemplate {
  return {
    ...t,
    steps: t.steps.map((node: WorkflowStepNode) => {
      if (isParallelGroup(node)) return { ...node, join: node.join ?? true }
      return node
    })
  }
}
