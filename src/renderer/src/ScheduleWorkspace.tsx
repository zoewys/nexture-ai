import { useEffect, useState } from 'react'
import type { AgentDefinition, WorkflowRun, WorkflowSchedule, WorkflowTemplate } from '@shared/types'
import { ChevronLeft } from 'lucide-react'
import { ScheduleDetail } from './ScheduleDetail'
import { ScheduleDrawer } from './ScheduleDrawer'
import { ScheduleList } from './ScheduleList'
import { useSchedules, type UseSchedulesResult } from './useSchedules'

interface ScheduleWorkspaceProps {
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  runs: WorkflowRun[]
  onOpenRun: (runId: string) => void
  scheduleState?: UseSchedulesResult
}

export function ScheduleWorkspace({
  agents,
  templates,
  runs,
  onOpenRun,
  scheduleState
}: ScheduleWorkspaceProps): JSX.Element {
  const liveSchedules = useSchedules()
  const schedules = scheduleState ?? liveSchedules
  const [scheduleView, setScheduleView] = useState<'schedules' | 'schedule-detail'>('schedules')
  const [scheduleDrawerOpen, setScheduleDrawerOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<WorkflowSchedule | null>(null)
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null)
  const selectedSchedule =
    schedules.schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null

  useEffect(() => {
    if (scheduleView !== 'schedule-detail') return
    if (selectedSchedule) return
    setScheduleView('schedules')
  }, [scheduleView, selectedSchedule])

  const selectSchedule = (scheduleId: string): void => {
    setSelectedScheduleId(scheduleId)
    setScheduleView('schedule-detail')
  }

  const onBack = (): void => setScheduleView('schedules')

  const openNewScheduleDrawer = (): void => {
    setEditingSchedule(null)
    setScheduleDrawerOpen(true)
  }

  const openEditScheduleDrawer = (schedule: WorkflowSchedule): void => {
    setEditingSchedule(schedule)
    setScheduleDrawerOpen(true)
  }

  const saveSchedule = async (input: Parameters<typeof schedules.save>[0]): Promise<WorkflowSchedule> => {
    const saved = await schedules.save(input)
    setSelectedScheduleId(saved.id)
    setScheduleView('schedule-detail')
    return saved
  }

  const deleteSchedule = async (id: string): Promise<void> => {
    await schedules.remove(id)
    setSelectedScheduleId((current) => (current === id ? null : current))
    setScheduleView('schedules')
  }

  return (
    <section className="schedule-workspace">
      {scheduleView === 'schedules' ? (
        <ScheduleList
          schedules={schedules.schedules}
          agents={agents}
          templates={templates}
          runs={runs}
          selectedScheduleId={selectedScheduleId}
          loading={schedules.loading}
          onSelectSchedule={selectSchedule}
          onNewSchedule={openNewScheduleDrawer}
          onToggle={schedules.toggle}
        />
      ) : (
        <section className="schedule-detail-page">
          <div className="detail-header">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
              <ChevronLeft size={16} />
              返回
            </button>
          </div>
          <ScheduleDetail
            schedule={selectedSchedule}
            agents={agents}
            templates={templates}
            runs={runs}
            onEdit={openEditScheduleDrawer}
            onDelete={deleteSchedule}
            onOpenRun={onOpenRun}
          />
        </section>
      )}
      {scheduleDrawerOpen && (
        <ScheduleDrawer
          agents={agents}
          templates={templates}
          schedule={editingSchedule}
          onSave={saveSchedule}
          onClose={() => setScheduleDrawerOpen(false)}
        />
      )}
    </section>
  )
}
