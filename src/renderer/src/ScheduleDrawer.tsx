import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDefinition,
  CronPreview,
  WorkflowSchedule,
  WorkflowScheduleTargetType,
  WorkflowTemplate
} from '@shared/types'
import { CalendarClock } from 'lucide-react'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'
import {
  buildScheduleCron,
  normalizeWeekdays,
  scheduleCronStateFromCron,
  scheduleCronStateFromPreset,
  type ScheduleCronState,
  type ScheduleIntervalMode,
  type SchedulePreset
} from './scheduleCronBuilder'
import { Select } from './Select'
import type { ScheduleDraft } from './useSchedules'

interface ScheduleDrawerProps {
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  schedule: WorkflowSchedule | null
  onSave: (input: ScheduleDraft) => Promise<WorkflowSchedule>
  onClose: () => void
}

const intervalOptions: Array<{ value: ScheduleIntervalMode; label: string }> = [
  { value: 'minutes', label: 'Every X minutes' },
  { value: 'hours', label: 'Every X hours' },
  { value: 'days', label: 'Every day' },
  { value: 'weeks', label: 'Every week' },
  { value: 'months', label: 'Every month' },
  { value: 'custom', label: 'Custom cron' }
]

const presetOptions: Array<{ preset: SchedulePreset; title: string; detail: string }> = [
  { preset: 'workday', title: '工作日早上', detail: '周一到周五 09:00' },
  { preset: 'daily', title: '每天固定时间', detail: '每天 09:00' },
  { preset: 'hourly', title: '每 2 小时', detail: '整点开始运行' },
  { preset: 'weekly', title: '每周例行', detail: '每周一 09:00' }
]

const minuteEveryOptions = [5, 10, 15, 30]
const minuteStartOptions = [0, 5, 10, 15]
const hourEveryOptions = [1, 2, 4, 6]
const hourMinuteOptions = [0, 15, 30, 45]
const monthDayOptions = Array.from({ length: 31 }, (_, index) => index + 1)
const timeHourOptions = Array.from({ length: 24 }, (_, hour) => formatTwoDigits(hour))
const timeMinuteOptions = Array.from({ length: 60 }, (_, minute) => formatTwoDigits(minute))
const weekdayOptions = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' }
]

export function ScheduleDrawer({
  agents,
  templates,
  schedule,
  onSave,
  onClose
}: ScheduleDrawerProps): JSX.Element {
  const [targetType, setTargetType] = useState<WorkflowScheduleTargetType>(schedule?.targetType ?? 'workflow')
  const [templateId, setTemplateId] = useState(
    schedule?.targetType !== 'agent' ? schedule?.templateId ?? templates[0]?.id ?? '' : templates[0]?.id ?? ''
  )
  const [agentId, setAgentId] = useState(
    schedule?.targetType === 'agent' ? schedule.agentId ?? agents[0]?.id ?? '' : agents[0]?.id ?? ''
  )
  const [name, setName] = useState(schedule?.name ?? '')
  const [projectPath, setProjectPath] = useState(schedule?.projectPath ?? readLastProjectPath())
  const [scheduleState, setScheduleState] = useState<ScheduleCronState>(() =>
    scheduleCronStateFromCron(schedule?.cron)
  )
  const [initialPrompt, setInitialPrompt] = useState(schedule?.initialPrompt ?? '')
  const [cronValid, setCronValid] = useState(false)
  const [cronPreview, setCronPreview] = useState<CronPreview | null>(null)
  const [saving, setSaving] = useState(false)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates]
  )
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? null,
    [agentId, agents]
  )

  const cronResult = useMemo(() => buildScheduleCron(scheduleState), [scheduleState])
  const cron = cronResult.cron

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id)
  }, [templateId, templates])

  useEffect(() => {
    if (!agentId && agents[0]) setAgentId(agents[0].id)
  }, [agentId, agents])

  useEffect(() => {
    let cancelled = false
    const expression = cron.trim()
    if (!expression) {
      setCronValid(false)
      setCronPreview(null)
      return
    }

    Promise.all([
      window.api.cronValidate(expression),
      window.api.cronDescribe(expression)
    ])
      .then(([valid, preview]) => {
        if (cancelled) return
        setCronValid(valid)
        setCronPreview(preview)
      })
      .catch(() => {
        if (cancelled) return
        setCronValid(false)
        setCronPreview(null)
      })

    return () => {
      cancelled = true
    }
  }, [cron])

  const updateScheduleState = (patch: Partial<ScheduleCronState>): void => {
    setScheduleState((current) => ({ ...current, ...patch }))
  }

  const setMode = (mode: ScheduleIntervalMode): void => {
    setScheduleState((current) => ({
      ...current,
      mode,
      weekdays: mode === 'weeks' ? normalizeWeekdays(current.weekdays) : current.weekdays
    }))
  }

  const applyPreset = (preset: SchedulePreset): void => {
    setScheduleState(scheduleCronStateFromPreset(preset))
  }

  const toggleWeekday = (day: number): void => {
    setScheduleState((current) => {
      const weekdays = current.weekdays.includes(day)
        ? current.weekdays.filter((item) => item !== day)
        : [...current.weekdays, day]
      return { ...current, weekdays: normalizeWeekdays(weekdays) }
    })
  }

  const canSave =
    (targetType === 'workflow' ? !!selectedTemplate : !!selectedAgent) &&
    name.trim() !== '' &&
    projectPath.trim() !== '' &&
    initialPrompt.trim() !== '' &&
    cronValid &&
    !saving

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    try {
      rememberProjectPath(projectPath.trim())
      await onSave({
        id: schedule?.id,
        targetType,
        templateId: targetType === 'workflow' ? selectedTemplate?.id : undefined,
        agentId: targetType === 'agent' ? selectedAgent?.id : undefined,
        name: name.trim(),
        cron,
        enabled: schedule?.enabled ?? true,
        projectPath: projectPath.trim(),
        initialPrompt: initialPrompt.trim(),
        createdAt: schedule?.createdAt,
        lastTriggeredAt: schedule?.lastTriggeredAt,
        lastRunId: schedule?.lastRunId,
        lastRunStatus: schedule?.lastRunStatus
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="workflow-new-run-drawer workflow-schedule-drawer" aria-label="Schedule Run">
      <div className="workflow-new-run-header">
        <div>
          <strong>{schedule ? 'Edit Schedule' : 'New Schedule'}</strong>
          <span>Bind a workflow or agent to a schedule rule</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>

      <div className="workflow-new-run-body">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <label className="field">
          <span>Run Target</span>
          <Select
            value={targetType}
            onChange={(value) => setTargetType(value as WorkflowScheduleTargetType)}
          >
            <Select.Item value="workflow">Workflow</Select.Item>
            <Select.Item value="agent">Agent</Select.Item>
          </Select>
        </label>

        {targetType === 'workflow' ? (
          <label className="field">
            <span>Template</span>
            <Select value={templateId} onChange={setTemplateId}>
              {templates.map((template) => (
                <Select.Item key={template.id} value={template.id}>
                  {template.name} · {template.steps.length} steps
                </Select.Item>
              ))}
            </Select>
          </label>
        ) : (
          <label className="field">
            <span>Agent</span>
            <Select value={agentId} onChange={setAgentId}>
              {agents.map((agent) => (
                <Select.Item key={agent.id} value={agent.id}>
                  {agent.name} · {agent.role}
                </Select.Item>
              ))}
            </Select>
          </label>
        )}

        <label className="field">
          <span>Project Directory</span>
          <div className="field-row">
            <input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
          </div>
        </label>

        <section className="schedule-picker-box" aria-label="Schedule interval picker">
          <div className="schedule-picker-head">
            <div>
              <strong>Trigger Interval</strong>
              <span>Choose a simple repeat rule. Cron is generated automatically.</span>
            </div>
            <Select
              value={scheduleState.mode}
              onChange={(value) => setMode(value as ScheduleIntervalMode)}
            >
              {intervalOptions.map((option) => (
                <Select.Item key={option.value} value={option.value}>{option.label}</Select.Item>
              ))}
            </Select>
          </div>

          <div className="schedule-preset-grid" aria-label="Common schedule presets">
            {presetOptions.map((item) => (
              <button
                key={item.preset}
                type="button"
                className="schedule-preset"
                onClick={() => applyPreset(item.preset)}
              >
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>

          <div className="schedule-picker-fields">
            {scheduleState.mode === 'minutes' && (
              <div className="schedule-picker-grid">
                <label className="field">
                  <span>Repeat every</span>
                  <Select
                    value={String(scheduleState.minuteEvery)}
                    onChange={(value) => updateScheduleState({ minuteEvery: Number(value) })}
                  >
                    {minuteEveryOptions.map((minute) => (
                      <Select.Item key={minute} value={String(minute)}>{minute} minutes</Select.Item>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span>Start at minute</span>
                  <Select
                    value={String(scheduleState.minuteStart)}
                    onChange={(value) => updateScheduleState({ minuteStart: Number(value) })}
                  >
                    {minuteStartOptions.map((minute) => (
                      <Select.Item key={minute} value={String(minute)}>{String(minute).padStart(2, '0')}</Select.Item>
                    ))}
                  </Select>
                </label>
              </div>
            )}

            {scheduleState.mode === 'hours' && (
              <div className="schedule-picker-grid">
                <label className="field">
                  <span>Repeat every</span>
                  <Select
                    value={String(scheduleState.hourEvery)}
                    onChange={(value) => updateScheduleState({ hourEvery: Number(value) })}
                  >
                    {hourEveryOptions.map((hour) => (
                      <Select.Item key={hour} value={String(hour)}>{hour} hour{hour > 1 ? 's' : ''}</Select.Item>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span>At minute</span>
                  <Select
                    value={String(scheduleState.hourMinute)}
                    onChange={(value) => updateScheduleState({ hourMinute: Number(value) })}
                  >
                    {hourMinuteOptions.map((minute) => (
                      <Select.Item key={minute} value={String(minute)}>{String(minute).padStart(2, '0')}</Select.Item>
                    ))}
                  </Select>
                </label>
              </div>
            )}

            {scheduleState.mode === 'days' && (
              <div className="schedule-picker-grid">
                <label className="field">
                  <span>Run at</span>
                  <ScheduleTimeSelect
                    value={scheduleState.dailyTime}
                    onChange={(dailyTime) => updateScheduleState({ dailyTime })}
                  />
                </label>
                <label className="field">
                  <span>Day rule</span>
                  <Select value="every-day" onChange={() => undefined} disabled>
                    <Select.Item value="every-day">Every day</Select.Item>
                  </Select>
                </label>
              </div>
            )}

            {scheduleState.mode === 'weeks' && (
              <>
                <div className="schedule-weekday-chips" aria-label="Weekdays">
                  {weekdayOptions.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      className={`schedule-weekday-chip ${scheduleState.weekdays.includes(day.value) ? 'active' : ''}`}
                      onClick={() => toggleWeekday(day.value)}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span>Run at</span>
                  <ScheduleTimeSelect
                    value={scheduleState.weeklyTime}
                    onChange={(weeklyTime) => updateScheduleState({ weeklyTime })}
                  />
                </label>
              </>
            )}

            {scheduleState.mode === 'months' && (
              <div className="schedule-picker-grid">
                <label className="field">
                  <span>Day of month</span>
                  <Select
                    value={String(scheduleState.monthDay)}
                    onChange={(value) => updateScheduleState({ monthDay: Number(value) })}
                  >
                    {monthDayOptions.map((day) => (
                      <Select.Item key={day} value={String(day)}>{day}</Select.Item>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span>Run at</span>
                  <ScheduleTimeSelect
                    value={scheduleState.monthlyTime}
                    onChange={(monthlyTime) => updateScheduleState({ monthlyTime })}
                  />
                </label>
              </div>
            )}

            {scheduleState.mode === 'custom' && (
              <label className="field">
                <span>Custom cron</span>
                <input
                  className="schedule-cron-input"
                  value={scheduleState.customCron}
                  onChange={(event) => updateScheduleState({ customCron: event.target.value })}
                  placeholder="0 9 * * 1-5"
                />
              </label>
            )}
          </div>

          <div className="schedule-cron-output">
            <code>{cron || '-'}</code>
            <span>自动生成</span>
          </div>
        </section>

        <div className={`schedule-cron-preview ${cronPreview?.valid ? 'valid' : 'invalid'}`}>
          <CalendarClock size={14} />
          {cronPreview?.valid ? (
            <span>
              {cronResult.summary} · next {formatDateTime(cronPreview.nextFireAt)}
            </span>
          ) : (
            <span>格式错误，请输入 5 字段 cron 表达式</span>
          )}
        </div>

        <label className="field">
          <span>Initial Prompt</span>
          <textarea value={initialPrompt} onChange={(event) => setInitialPrompt(event.target.value)} />
        </label>
      </div>

      <div className="workflow-new-run-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save Schedule'}
        </button>
      </div>
    </aside>
  )
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

interface ScheduleTimeSelectProps {
  value: string
  onChange: (value: string) => void
}

function ScheduleTimeSelect({ value, onChange }: ScheduleTimeSelectProps): JSX.Element {
  const { hour, minute } = splitScheduleTime(value)

  return (
    <div className="schedule-time-select" aria-label="Run time">
      <Select
        value={hour}
        onChange={(nextHour) => onChange(`${nextHour}:${minute}`)}
        ariaLabel="Select hour"
        contentClassName="schedule-time-select-content"
      >
        {timeHourOptions.map((option) => (
          <Select.Item key={option} value={option}>{option}</Select.Item>
        ))}
      </Select>
      <span className="schedule-time-separator">:</span>
      <Select
        value={minute}
        onChange={(nextMinute) => onChange(`${hour}:${nextMinute}`)}
        ariaLabel="Select minute"
        contentClassName="schedule-time-select-content"
      >
        {timeMinuteOptions.map((option) => (
          <Select.Item key={option} value={option}>{option}</Select.Item>
        ))}
      </Select>
    </div>
  )
}

function splitScheduleTime(value: string): { hour: string; minute: string } {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value)
  if (!match) return { hour: '09', minute: '00' }
  return {
    hour: formatTwoDigits(clampTimePart(Number(match[1]), 0, 23)),
    minute: formatTwoDigits(clampTimePart(Number(match[2]), 0, 59))
  }
}

function clampTimePart(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function formatTwoDigits(value: number): string {
  return String(value).padStart(2, '0')
}
