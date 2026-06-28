import { useEffect, useMemo, useState } from 'react'
import type { AgentDefinition, CronPreview, WorkflowRun, WorkflowSchedule, WorkflowTemplate } from '@shared/types'
import { Bot, CircleDot, Layers, Plus, Search } from 'lucide-react'

interface ScheduleListProps {
  schedules: WorkflowSchedule[]
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  runs: WorkflowRun[]
  selectedScheduleId: string | null
  loading: boolean
  onSelectSchedule: (scheduleId: string) => void
  onNewSchedule: () => void
  onToggle: (id: string, enabled: boolean) => Promise<unknown>
}

export function ScheduleList({
  schedules,
  agents,
  templates,
  runs,
  selectedScheduleId,
  loading,
  onSelectSchedule,
  onNewSchedule,
  onToggle
}: ScheduleListProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const filteredSchedules = useMemo(
    () => filterSchedules(schedules, templates, agents, query, filter),
    [agents, filter, query, schedules, templates]
  )
  const counts = useMemo(
    () => ({
      all: schedules.length,
      enabled: schedules.filter((schedule) => schedule.enabled).length,
      disabled: schedules.filter((schedule) => !schedule.enabled).length
    }),
    [schedules]
  )

  return (
    <section className="schedule-list schedule-dashboard-page">
      <div className="page-header workflow-runs-header">
        <div className="page-title-block">
          <h2 className="page-title">定时任务</h2>
          <p>自动启动 workflow run，按设定时间后台执行。</p>
        </div>
        <div className="page-actions workflow-runs-actions">
          <button type="button" className="primary" onClick={onNewSchedule}>
            <Plus size={14} /> 新建定时任务
          </button>
        </div>
      </div>

      <div className="toolbar schedule-dashboard-toolbar">
        <label className="search-field">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索定时任务、目标..."
          />
        </label>
        <div className="filter-chips" role="group" aria-label="Schedule filters">
          {[
            { key: 'all' as const, label: '全部', count: counts.all },
            { key: 'enabled' as const, label: '已启用', count: counts.enabled, className: 'success' },
            { key: 'disabled' as const, label: '已停用', count: counts.disabled, className: 'awaiting' }
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              className={[
                'filter-chip',
                option.className,
                filter === option.key ? 'active' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
              <span className="filter-chip-count">{option.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="schedule-cards cards-grid">
        {loading && schedules.length === 0 && (
          <div className="schedule-empty">Loading schedules...</div>
        )}
        {!loading && schedules.length > 0 && filteredSchedules.length === 0 && (
          <div className="schedule-empty">
            <Search size={18} />
            <span>暂无匹配的定时任务</span>
          </div>
        )}
        {filteredSchedules.map((schedule, index) => (
          <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            selected={selectedScheduleId === schedule.id}
            targetName={scheduleTargetName(schedule, templates, agents)}
            runs={runs.filter((run) => run.scheduledBy === schedule.id)}
            index={index}
            onSelectSchedule={onSelectSchedule}
            onToggle={onToggle}
          />
        ))}
        {!loading && (
          <CreateScheduleCard
            index={filteredSchedules.length}
            onNewSchedule={onNewSchedule}
          />
        )}
      </div>
    </section>
  )
}

function CreateScheduleCard({
  index,
  onNewSchedule
}: {
  index: number
  onNewSchedule: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="schedule-card dashboard-create-card schedule-create-card"
      style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
      onClick={onNewSchedule}
    >
      <div className="dashboard-create-card-icon">
        <Plus size={20} />
      </div>
      <div className="dashboard-create-card-title">新建定时任务</div>
      <div className="dashboard-create-card-desc">设置一个自动运行的 workflow 或 agent</div>
    </button>
  )
}

function ScheduleCard({
  schedule,
  selected,
  targetName,
  runs,
  index,
  onSelectSchedule,
  onToggle
}: {
  schedule: WorkflowSchedule
  selected: boolean
  targetName: string
  runs: WorkflowRun[]
  index: number
  onSelectSchedule: (scheduleId: string) => void
  onToggle: (id: string, enabled: boolean) => Promise<unknown>
}): JSX.Element {
  const successRate = scheduleSuccessRate(runs, schedule)
  const lastRunClass =
    schedule.lastRunStatus === 'completed'
      ? 'success'
      : schedule.lastRunStatus === 'error'
        ? 'error'
        : ''

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'schedule-card',
        selected ? 'schedule-card-active' : '',
        !schedule.enabled ? 'schedule-card-disabled' : ''
      ].filter(Boolean).join(' ')}
      style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
      onClick={() => onSelectSchedule(schedule.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelectSchedule(schedule.id)
      }}
    >
      <div className="schedule-card-header">
        <div className="schedule-card-name" title={schedule.name}>{schedule.name}</div>
        <button
          type="button"
          className={`schedule-toggle${schedule.enabled ? ' on' : ''}`}
          role="switch"
          aria-checked={schedule.enabled}
          aria-label={schedule.enabled ? '停用定时任务' : '启用定时任务'}
          onClick={(event) => {
            event.stopPropagation()
            void onToggle(schedule.id, !schedule.enabled)
          }}
        />
      </div>

      <code className="schedule-cron">{schedule.cron}</code>
      <ScheduleTiming cron={schedule.cron} enabled={schedule.enabled} />

      <div className="schedule-stats-row">
        <span className="schedule-stats-text">成功率 <strong>{successRate}%</strong></span>
        <span className="schedule-stats-bar">
          <span
            className="schedule-stats-bar-fill"
            style={{ width: `${successRate}%` }}
          />
        </span>
      </div>

      <div className={`schedule-last-run ${lastRunClass}`}>
        <CircleDot size={10} />
        <span>上次 {formatLastRun(schedule)}</span>
      </div>

      <div className="schedule-card-footer">
        <span className="schedule-template-name">
          {schedule.targetType === 'agent' ? <Bot size={12} /> : <Layers size={12} />}
          {schedule.targetType === 'agent' ? `Agent · ${targetName}` : targetName}
        </span>
      </div>
    </div>
  )
}

function ScheduleTiming({ cron, enabled }: { cron: string; enabled: boolean }): JSX.Element {
  const [preview, setPreview] = useState<CronPreview | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.cronDescribe(cron)
      .then((next) => {
        if (!cancelled) setPreview(next)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [cron])

  if (!enabled) {
    return (
      <div className="schedule-countdown-wrap">
        <span className="schedule-countdown-label">已停用</span>
        <span className="schedule-countdown dim">-</span>
        <span className="schedule-next-time">不会自动触发</span>
      </div>
    )
  }

  if (!preview?.valid) {
    return (
      <div className="schedule-countdown-wrap">
        <span className="schedule-countdown-label">Cron 无效</span>
        <span className="schedule-countdown dim">-</span>
        <span className="schedule-next-time">请编辑表达式</span>
      </div>
    )
  }

  return (
    <div className="schedule-countdown-wrap">
      <span className="schedule-countdown-label">下次运行</span>
      <span className="schedule-countdown">{formatCountdown(preview.nextFireAt)}</span>
      <span className="schedule-next-time">{preview.description} · {formatDateTime(preview.nextFireAt)}</span>
    </div>
  )
}

function filterSchedules(
  schedules: WorkflowSchedule[],
  templates: WorkflowTemplate[],
  agents: AgentDefinition[],
  query: string,
  filter: 'all' | 'enabled' | 'disabled'
): WorkflowSchedule[] {
  const cleanQuery = query.trim().toLowerCase()
  return schedules.filter((schedule) => {
    const targetName = scheduleTargetName(schedule, templates, agents)
    const matchesQuery =
      !cleanQuery ||
      schedule.name.toLowerCase().includes(cleanQuery) ||
      schedule.cron.toLowerCase().includes(cleanQuery) ||
      targetName.toLowerCase().includes(cleanQuery)
    if (!matchesQuery) return false
    if (filter === 'enabled') return schedule.enabled
    if (filter === 'disabled') return !schedule.enabled
    return true
  })
}

function scheduleTargetName(
  schedule: WorkflowSchedule,
  templates: WorkflowTemplate[],
  agents: AgentDefinition[]
): string {
  if (schedule.targetType === 'agent') {
    return agents.find((agent) => agent.id === schedule.agentId)?.name ?? 'Missing agent'
  }
  return templates.find((template) => template.id === schedule.templateId)?.name ?? 'Missing template'
}

function scheduleSuccessRate(runs: WorkflowRun[], schedule: WorkflowSchedule): number {
  if (runs.length === 0) {
    if (schedule.lastRunStatus === 'completed') return 100
    if (schedule.lastRunStatus === 'error') return 0
    return 0
  }
  const completed = runs.filter((run) => run.status === 'completed').length
  return Math.round((completed / runs.length) * 100)
}

function formatLastRun(schedule: WorkflowSchedule): string {
  if (!schedule.lastTriggeredAt) return '从未运行'
  const status = schedule.lastRunStatus === 'completed'
    ? '成功'
    : schedule.lastRunStatus === 'error'
      ? '失败'
      : '运行中'
  return `${formatDateTime(schedule.lastTriggeredAt)} · ${status}`
}

function formatCountdown(timestamp?: number): string {
  if (!timestamp) return '-'
  const ms = Math.max(0, timestamp - Date.now())
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (ms < minute) return `${Math.ceil(ms / 1000)}s`
  if (ms < hour) return `${Math.ceil(ms / minute)}m`
  if (ms < day) {
    const hours = Math.floor(ms / hour)
    const minutes = Math.ceil((ms % hour) / minute)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(ms / day)
  const hours = Math.ceil((ms % day) / hour)
  return `${days}d ${hours}h`
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
