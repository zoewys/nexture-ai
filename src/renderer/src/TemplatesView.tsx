import type { AgentDefinition, WorkflowTemplate } from '@shared/types'
import { WorkflowPanel } from './WorkflowPanel'
import type { WorkflowDraft } from './useWorkflows'

interface TemplatesViewProps {
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  onSave: (draft: WorkflowDraft) => Promise<WorkflowTemplate>
  onDelete: (id: string) => Promise<void>
}

export function TemplatesView({
  agents,
  templates,
  onSave,
  onDelete
}: TemplatesViewProps): JSX.Element {
  return (
    <section className="templates-view">
      <header className="templates-view-header">
        <div className="section-title">Workflow Templates</div>
        <h2>Workflow Templates</h2>
        <p>Build and maintain reusable multi-agent step sequences.</p>
      </header>
      <WorkflowPanel
        agents={agents}
        templates={templates}
        onSave={onSave}
        onDelete={onDelete}
        hideRunControls
      />
    </section>
  )
}
