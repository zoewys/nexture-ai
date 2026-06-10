/**
 * HandoffPanel.tsx — 结构化交接物展示面板
 *
 * 渲染一个 workflow step 完成后产出的 HandoffArtifact：
 *  - Summary：步骤完成摘要
 *  - Artifacts 表格：产出物列表（类型 / 路径 / 描述）
 *  - Next-step Guidance：给下游 agent 的建议
 *
 * 支持折叠收起。在 WorkflowRunDetail 中作为右侧可拖拽面板使用。
 */

import type { WorkflowRun } from '@shared/types'
import { formatHandoffDisplay } from './handoffDisplay'
import { ChevronRight, ClipboardCheck } from 'lucide-react'

interface HandoffPanelProps {
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']>
  onCollapse?: () => void
}

export function HandoffPanel({ handoff, onCollapse }: HandoffPanelProps): JSX.Element {
  const display = formatHandoffDisplay(handoff)

  return (
    <div className="handoff-panel">
      <div className="handoff-panel-header">
        <div className="section-title"><ClipboardCheck size={14} /> 结构化交接物</div>
        <div className="handoff-panel-header-actions">
          <span className="handoff-panel-status">等待确认</span>
          {onCollapse && (
            <button
              type="button"
              className="icon-only handoff-toggle"
              title="收起交接物"
              aria-label="收起交接物"
              onClick={onCollapse}
            >
              <ChevronRight size={15} />
            </button>
          )}
        </div>
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
