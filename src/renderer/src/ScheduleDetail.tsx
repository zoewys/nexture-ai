import { useEffect, useMemo, useState } from 'react'
import type { CronPreview, WorkflowRun, WorkflowSchedule, WorkflowTemplate } from '@shared/types'
import { Edit3, Trash2 } from 'lucide-react'
import { workflowRunDisplayName } from './workflowRunView'
import { formatWorkflowRunActualDuration } from './workflowRunDuration'
import { workflowRunStatusLabel } from './workflowLabels'

interface ScheduleDetailProps {
  schedule: WorkflowSchedule | null
  templates: WorkflowTemplate[]
  runs: WorkflowRun[]
  onEdit: (schedule: WorkflowSchedule) => void
  onDelete: (id: string) => Promise<void>
  onOpenRun: (runId: string) => void
}

export function ScheduleDetail({
  schedule,
  templates,
  runs,
  onEdit,
  onDelete,
  onOpenRun
}: ScheduleDetailProps): JSX.Element {
  const [preview, setPreview] = useState<CronPreview | null>(null)
  const template = schedule
    ? templates.find((item) => item.id === schedule.templateId) ?? null
    : null
  const history = useMemo(
    () => schedule
      ? runs.filter((run) => run.scheduledBy === schedule.id).sort((a, b) => b.startedAt - a.startedAt)
      : [],
    [runs, schedule]
  )

  useEffect(() => {
    if (!schedule) {
      setPreview(null)
      return
    }
    let cancelled = false
    window.api.cronDescribe(schedule.cron)
      .then((next) => {
        if (!cancelled) setPreview(next)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [schedule])

  if (!schedule) {
    return (
      <main className="schedule-detail schedule-detail-empty">
        <strong>No schedule selected</strong>
        <span>Create a schedule from the left panel.</span>
      </main>
    )
  }

  const deleteSchedule = async (): Promise<void> => {
    if (!window.confirm(`Delete schedule "${schedule.name}"?`)) return
    await onDelete(schedule.id)
  }

  return (
    <main className="schedule-detail">
      <div className="workflow-run-detail-header">
        <div>
          <h2>{schedule.name}</h2>
          <p>{preview?.valid ? preview.description : schedule.cron}</p>
        </div>
        <div className="workflow-run-detail-actions">
          <button type="button" onClick={() => onEdit(schedule)} title="Edit schedule">
            <Edit3 size={14} /> Edit
          </button>
          <button type="button" className="danger" onClick={() => void deleteSchedule()} title="Delete schedule">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      <div className="schedule-detail-body">
        <section className="schedule-detail-section">
          <div className="schedule-detail-grid">
            <span>Template</span>
            <strong>{template?.name ?? 'Missing template'}</strong>
            <span>Project</span>
            <code>{schedule.projectPath}</code>
            <span>Cron</span>
            <code>{schedule.cron}</code>
            <span>Status</span>
            <strong>{schedule.enabled ? 'Enabled' : 'Disabled'}</strong>
            <span>Last trigger</span>
            <strong>{formatLastTrigger(schedule)}</strong>
            <span>Next trigger</span>
            <strong>{preview?.valid ? formatDateTime(preview.nextFireAt) : 'Invalid cron'}</strong>
          </div>
        </section>

        <section className="schedule-detail-section">
          <div className="schedule-section-title">Recent Runs</div>
          <div className="schedule-history">
            {history.length === 0 && <div className="schedule-empty">No runs yet</div>}
            {history.map((run) => (
              <button
                type="button"
                key={run.id}
                className="schedule-history-row"
                onClick={() => onOpenRun(run.id)}
              >
                <span>{formatDateTime(run.startedAt)}</span>
                <strong>{workflowRunStatusLabel(run.status)}</strong>
                <span>{run.steps.length} steps</span>
                <span>{formatWorkflowRunActualDuration(run)}</span>
                <span>{formatCost(run.totalCostUsd)}</span>
                <small>{workflowRunDisplayName(run)}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function formatLastTrigger(schedule: WorkflowSchedule): string {
  if (!schedule.lastTriggeredAt) return 'Never'
  const status = schedule.lastRunStatus ? ` · ${schedule.lastRunStatus}` : ''
  return `${formatDateTime(schedule.lastTriggeredAt)}${status}`
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatCost(cost: number): string {
  return cost > 0 ? `$${cost.toFixed(2)}` : '$0.00'
}
