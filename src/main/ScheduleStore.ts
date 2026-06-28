import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkflowSchedule } from '@shared/types'
import { isValidCron } from './cronParser'

export type ScheduleSaveInput = Omit<WorkflowSchedule, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

export class ScheduleStore {
  private readonly path: string

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'schedules.json')
  }

  list(): WorkflowSchedule[] {
    try {
      if (!existsSync(this.path)) return []
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(normalizeSchedule)
        .filter((item): item is WorkflowSchedule => item !== null)
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  save(input: ScheduleSaveInput): WorkflowSchedule {
    const name = input.name.trim()
    const cron = input.cron.trim()
    const projectPath = input.projectPath.trim()
    const initialPrompt = input.initialPrompt.trim()
    const targetType = input.targetType ?? (input.agentId ? 'agent' : 'workflow')
    const templateId = input.templateId?.trim() ?? ''
    const agentId = input.agentId?.trim() ?? ''
    if (!name) throw new Error('Schedule name is required')
    if (targetType === 'workflow' && !templateId) throw new Error('Workflow template is required')
    if (targetType === 'agent' && !agentId) throw new Error('Agent is required')
    if (!projectPath) throw new Error('Project directory is required')
    if (!initialPrompt) throw new Error('Initial prompt is required')
    if (!isValidCron(cron)) throw new Error('Invalid cron expression')

    const current = this.list()
    const existing = input.id ? current.find((item) => item.id === input.id) : undefined
    const schedule: WorkflowSchedule = {
      id: input.id ?? randomUUID(),
      targetType,
      templateId: targetType === 'workflow' ? templateId : undefined,
      agentId: targetType === 'agent' ? agentId : undefined,
      name,
      cron,
      enabled: input.enabled,
      projectPath,
      initialPrompt,
      createdAt: existing?.createdAt ?? input.createdAt ?? Date.now(),
      lastTriggeredAt: input.lastTriggeredAt ?? existing?.lastTriggeredAt,
      lastRunId: input.lastRunId ?? existing?.lastRunId,
      lastRunStatus: input.lastRunStatus ?? existing?.lastRunStatus
    }

    const next = current.filter((item) => item.id !== schedule.id)
    next.unshift(schedule)
    this.writeAll(next)
    return schedule
  }

  remove(id: string): void {
    this.writeAll(this.list().filter((item) => item.id !== id))
  }

  toggle(id: string, enabled: boolean): WorkflowSchedule {
    const list = this.list()
    const index = list.findIndex((item) => item.id === id)
    if (index < 0) throw new Error(`Workflow schedule not found: ${id}`)
    const schedule = { ...list[index], enabled }
    list[index] = schedule
    this.writeAll(list)
    return schedule
  }

  updateLastTriggered(id: string, runId: string, status: WorkflowSchedule['lastRunStatus']): void {
    const list = this.list()
    const index = list.findIndex((item) => item.id === id)
    if (index < 0) return
    list[index] = {
      ...list[index],
      lastTriggeredAt: Date.now(),
      lastRunId: runId || list[index].lastRunId,
      lastRunStatus: status
    }
    this.writeAll(list)
  }

  private writeAll(list: WorkflowSchedule[]): void {
    try {
      writeFileSync(this.path, JSON.stringify(list, null, 2), 'utf8')
    } catch {
      // Persistence is best-effort.
    }
  }
}

function normalizeSchedule(value: unknown): WorkflowSchedule | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Partial<WorkflowSchedule>
  const commonValid =
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.cron === 'string' &&
    typeof item.enabled === 'boolean' &&
    typeof item.projectPath === 'string' &&
    typeof item.initialPrompt === 'string' &&
    typeof item.createdAt === 'number'
  if (!commonValid) return null

  const targetType = item.targetType === 'agent' ? 'agent' : 'workflow'
  if (targetType === 'workflow' && typeof item.templateId !== 'string') return null
  if (targetType === 'agent' && typeof item.agentId !== 'string') return null

  const id = item.id as string
  const name = item.name as string
  const cron = item.cron as string
  const enabled = item.enabled as boolean
  const projectPath = item.projectPath as string
  const initialPrompt = item.initialPrompt as string
  const createdAt = item.createdAt as number

  return {
    id,
    targetType,
    templateId: targetType === 'workflow' ? item.templateId : undefined,
    agentId: targetType === 'agent' ? item.agentId : undefined,
    name,
    cron,
    enabled,
    projectPath,
    initialPrompt,
    createdAt,
    lastTriggeredAt: item.lastTriggeredAt,
    lastRunId: item.lastRunId,
    lastRunStatus: item.lastRunStatus
  }
}
