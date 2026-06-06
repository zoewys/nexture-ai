import type { WorkflowRun } from '@shared/types'
import { formatHandoffDisplay } from './handoffDisplay'
import { ClipboardCheck } from './Icons'

interface HandoffPanelProps {
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']>
}

export function HandoffPanel({ handoff }: HandoffPanelProps): JSX.Element {
  const display = formatHandoffDisplay(handoff)

  return (
    <div className="handoff-panel">
      <div className="handoff-panel-header">
        <div className="section-title"><ClipboardCheck size={14} /> 结构化交接物</div>
        <span className="handoff-panel-status">Parsed</span>
      </div>

      <section className="handoff-section">
        <h3>{display.summary.label}</h3>
        <p>{display.summary.text}</p>
      </section>

      <section className="handoff-section">
        <h3>{display.artifacts.label}</h3>
        {display.artifacts.rows.length > 0 ? (
          <div className="handoff-artifact-table" role="table">
            <div className="handoff-artifact-head" role="row">
              {display.artifacts.headers.map((header) => (
                <span role="columnheader" key={header}>{header}</span>
              ))}
            </div>
            {display.artifacts.rows.map((artifact, index) => (
              <div className="handoff-artifact-row" role="row" key={`${artifact.path}-${index}`}>
                <span className="handoff-artifact-type" role="cell">{artifact.type}</span>
                <code role="cell">{artifact.path}</code>
                <span role="cell">{artifact.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="handoff-empty">{display.artifacts.emptyText}</p>
        )}
      </section>

      {display.guidance && (
        <section className="handoff-section">
          <h3>{display.guidance.label}</h3>
          <p>{display.guidance.text}</p>
        </section>
      )}
    </div>
  )
}
