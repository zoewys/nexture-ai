import { useEffect, useMemo, useState } from 'react'
import type { AgentDefinition, WorkflowTemplate } from '@shared/types'
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
  onSave
}: TemplatesViewProps): JSX.Element {
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? '')
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null,
    [selectedTemplateId, templates]
  )
  const previewAgents = selectedTemplate?.steps.slice(0, 4).map((step) => agentName(step.agentId, agents)) ?? []

  useEffect(() => {
    if (!templates.length) {
      setSelectedTemplateId('')
      return
    }
    if (!selectedTemplateId || !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0].id)
    }
  }, [selectedTemplateId, templates])

  const saveTemplate = async (): Promise<void> => {
    if (!selectedTemplate) return
    await onSave({
      id: selectedTemplate.id,
      name: selectedTemplate.name,
      description: selectedTemplate.description,
      steps: selectedTemplate.steps
    })
  }

  const duplicateTemplate = async (): Promise<void> => {
    if (!selectedTemplate) return
    const saved = await onSave({
      name: `${selectedTemplate.name} Copy`,
      description: selectedTemplate.description,
      steps: selectedTemplate.steps
    })
    setSelectedTemplateId(saved.id)
  }

  return (
    <section className="templates-view">
      <aside className="templates-view-list">
        <div className="templates-view-header">
          <div className="field-row field-row-between">
            <div className="templates-title">Templates</div>
            <button type="button" className="primary">New</button>
          </div>
          <p>模板定义流程；Runs 是模板启动后的实例。</p>
        </div>

        <div className="templates-list">
          {templates.map((template) => (
            <button
              type="button"
              key={template.id}
              className={[
                'templates-template-card',
                selectedTemplate?.id === template.id ? 'templates-template-card-active' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => setSelectedTemplateId(template.id)}
            >
              <div className="templates-card-row">
                <div className="name">{template.name}</div>
                <div className="status running">{template.steps.length} steps</div>
              </div>
              <div className="meta">{template.description ?? '线性流程 · 可未来升级节点画布'}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="templates-view-main readonly">
        <section className="templates-run-head">
          <div className="templates-main-row">
            <div>
              <h1>{selectedTemplate ? `${selectedTemplate.name} Template` : 'Dev Flow Template'}</h1>
              <div className="templates-path">当前用有序步骤编辑；后续可切换为节点拖拽画布</div>
            </div>
            <div className="templates-main-actions">
              <button type="button" disabled={!selectedTemplate} onClick={() => void duplicateTemplate()}>
                Duplicate
              </button>
              <button
                type="button"
                className="primary"
                disabled={!selectedTemplate}
                onClick={() => void saveTemplate()}
              >
                Save
              </button>
            </div>
          </div>
        </section>

        <section className="templates-workspace">
          <div className="artifact">
            <div className="templates-main-row">
              <h2>Future Node Canvas Preview</h2>
              <span className="topbar-chip">layout-safe</span>
            </div>
            <div className="canvas-preview">
              <div className="edge ab"></div>
              <div className="edge bc"></div>
              <div className="edge cd"></div>
              <div className="node a">{previewAgents[0] ?? '需求'}</div>
              <div className="node b">{previewAgents[1] ?? '设计'}</div>
              <div className="node c">{previewAgents[2] ?? '开发'}</div>
              <div className="node d">{previewAgents[3] ?? '测试'}</div>
            </div>
            <div className="templates-sub">
              节点拖拽主要影响 Template 编辑器和 run 的 Graph View；Runs 列表、详情、历史不需要整体重做。
            </div>
          </div>
        </section>
      </main>
    </section>
  )
}

function agentName(agentId: string, agents: AgentDefinition[]): string {
  const agent = agents.find((item) => item.id === agentId)
  return agent?.role || agent?.name || 'Step'
}
