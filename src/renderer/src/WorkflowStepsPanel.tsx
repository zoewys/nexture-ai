import { useMemo, useState } from 'react'
import type { AgentDefinition, WorkflowRun } from '@shared/types'

interface WorkflowStepsPanelProps {
  run: WorkflowRun | null
  agents: AgentDefinition[]
  selectedStepIndex: number
  onSelectStep: (index: number) => void
}

export function WorkflowStepsPanel({
  run,
  agents,
  selectedStepIndex,
  onSelectStep
}: WorkflowStepsPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    if (!run) return []
    const clean = query.trim().toLowerCase()
    return run.steps
      .map((step, index) => ({
        step,
        index,
        agent: agents.find((item) => item.id === step.agentId)
      }))
      .filter(({ agent, index }) =>
        !clean ||
        String(index + 1).includes(clean) ||
        (agent?.name ?? '').toLowerCase().includes(clean) ||
        (agent?.role ?? '').toLowerCase().includes(clean)
      )
  }, [agents, query, run])

  return (
    <aside className="workflow-steps-panel">
      <div className="workflow-steps-header">
        <div className="workflow-steps-title">
          <span>Steps</span>
          <strong>{run ? `${run.steps.length} total` : '0 total'}</strong>
        </div>
        <input
          value={query}
          placeholder="搜索步骤 / agent"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="workflow-steps-list" data-scroll-axis="overflow-y">
        {filtered.map(({ step, index, agent }) => (
          <button
            type="button"
            key={`${run?.id}-${index}`}
            className={[
              'workflow-step-nav-card',
              selectedStepIndex === index ? 'workflow-step-nav-card-active' : '',
              step.status === 'awaiting-confirm' ? 'workflow-step-nav-card-waiting' : ''
            ].filter(Boolean).join(' ')}
            onClick={() => onSelectStep(index)}
          >
            <div className="workflow-step-card-row">
              <span>{index + 1}. {agent?.name ?? 'Missing agent'}</span>
              <span className={`workflow-step-status-dot workflow-step-status-dot-${step.status}`} />
            </div>
            <div className="workflow-step-card-row">
              <small>{agent?.role ?? 'unknown'}</small>
              <strong className={`workflow-step-status workflow-step-status-${step.status}`}>
                {stepStatusLabel(step.status)}
              </strong>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}

function stepStatusLabel(status: WorkflowRun['steps'][number]['status']): string {
  switch (status) {
    case 'pending': return '待运行'
    case 'running': return '运行中'
    case 'awaiting-confirm': return '等待确认'
    case 'done': return '完成'
    case 'stale': return '已过期'
    case 'error': return '错误'
  }
}
