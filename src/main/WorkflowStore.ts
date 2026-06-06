import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkflowRun, WorkflowTemplate } from '@shared/types'

type SaveTemplateInput = Omit<WorkflowTemplate, 'id'> & { id?: string }

export class WorkflowStore {
  private readonly templatesPath: string
  private readonly runsPath: string

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.templatesPath = join(dir, 'workflows.json')
    this.runsPath = join(dir, 'workflow-runs.json')
  }

  listTemplates(): WorkflowTemplate[] {
    return readArray<WorkflowTemplate>(this.templatesPath)
  }

  saveTemplate(input: SaveTemplateInput): WorkflowTemplate {
    const list = this.listTemplates()
    const template: WorkflowTemplate = {
      id: input.id ?? randomUUID(),
      name: input.name,
      description: input.description,
      steps: input.steps
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
    return readArray<WorkflowRun>(this.runsPath)
  }

  saveRun(run: WorkflowRun): void {
    const list = this.listRuns()
    const idx = list.findIndex((item) => item.id === run.id)
    if (idx >= 0) list[idx] = run
    else list.unshift(run)
    writeArray(this.runsPath, list)
  }

  deleteRun(id: string): void {
    writeArray(
      this.runsPath,
      this.listRuns().filter((run) => run.id !== id)
    )
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
