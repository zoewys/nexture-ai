import { useEffect, useMemo, useState } from 'react'
import type { AgentDefinition, WorkflowTemplate } from '@shared/types'
import type { WorkflowDraft } from './useWorkflows'
import { GitBranch, Plus, Save, Trash2, Play, FolderOpen, X } from './Icons'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'

export interface WorkflowPanelProps {
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  onSave: (draft: WorkflowDraft) => Promise<WorkflowTemplate>
  onDelete: (id: string) => Promise<void>
  onStart?: (templateId: string, projectPath: string, initialPrompt: string) => Promise<unknown>
  hideRunControls?: boolean
}

export function WorkflowPanel({
  agents,
  templates,
  onSave,
  onDelete,
  onStart,
  hideRunControls = false
}: WorkflowPanelProps): JSX.Element {
  const [templateId, setTemplateId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [stepAgentIds, setStepAgentIds] = useState<string[]>([])
  const [projectPath, setProjectPath] = useState(readLastProjectPath)
  const [initialPrompt, setInitialPrompt] = useState('')

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templates, templateId]
  )

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id)
  }, [templateId, templates])

  useEffect(() => {
    if (!selectedTemplate) return
    setName(selectedTemplate.name)
    setDescription(selectedTemplate.description ?? '')
    setStepAgentIds(selectedTemplate.steps.map((step) => step.agentId))
  }, [selectedTemplate])

  const canSave = name.trim() !== '' && stepAgentIds.length > 0
  const canStart =
    !hideRunControls &&
    !!selectedTemplate &&
    projectPath.trim() !== '' &&
    initialPrompt.trim() !== ''

  useEffect(() => {
    if (hideRunControls) return
    rememberProjectPath(projectPath)
  }, [hideRunControls, projectPath])

  const addStep = (): void => {
    const firstAgent = agents[0]
    if (firstAgent) setStepAgentIds((prev) => [...prev, firstAgent.id])
  }

  const saveTemplate = async (): Promise<void> => {
    if (!canSave) return
    const saved = await onSave({
      id: selectedTemplate?.id,
      name: name.trim(),
      description: description.trim() || undefined,
      steps: stepAgentIds.map((agentId) => ({ agentId }))
    })
    setTemplateId(saved.id)
  }

  const startRun = async (): Promise<void> => {
    if (!selectedTemplate || !onStart || !canStart) return
    rememberProjectPath(projectPath)
    await onStart(selectedTemplate.id, projectPath.trim(), initialPrompt.trim())
  }

  const pickDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) setProjectPath(dir)
  }

  return (
    <section className="workflow-panel">
      <div className="section-title"><GitBranch size={14} /> Workflow</div>

      <label className="field">
        <span>Template</span>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">New Workflow</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Name</span>
        <input value={name} placeholder='e.g. "Design → Develop → Test"' onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="field">
        <span>Description</span>
        <input value={description} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
      </label>

      <div className="workflow-steps-editor">
        <div className="field-row field-row-between">
          <span className="mini-label">Steps</span>
          <button type="button" onClick={addStep} disabled={agents.length === 0}>
            <Plus size={14} /> Step
          </button>
        </div>
        {stepAgentIds.length === 0 && <div className="field-hint">Add at least one agent step.</div>}
        {stepAgentIds.map((agentId, index) => (
          <div className="workflow-step-edit" key={`${index}-${agentId}`}>
            <span>{index + 1}</span>
            <select
              value={agentId}
              onChange={(e) =>
                setStepAgentIds((prev) =>
                  prev.map((value, i) => (i === index ? e.target.value : value))
                )
              }
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name || 'Unnamed'} · {agent.vendor}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-only"
              aria-label="Remove step"
              onClick={() => setStepAgentIds((prev) => prev.filter((_, i) => i !== index))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="actions">
        <button type="button" className="primary" disabled={!canSave} onClick={saveTemplate}>
          <Save size={14} /> Save Workflow
        </button>
        {selectedTemplate && (
          <button type="button" onClick={() => onDelete(selectedTemplate.id)}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>

      {!hideRunControls && (
        <>
          <label className="field">
            <span>Project Directory</span>
            <div className="field-row">
              <input value={projectPath} placeholder="/path/to/project" onChange={(e) => setProjectPath(e.target.value)} />
              <button type="button" onClick={pickDir}>
                <FolderOpen size={14} /> Browse
              </button>
            </div>
          </label>

          <label className="field">
            <span>Initial Prompt</span>
            <textarea
              className="workflow-prompt"
              value={initialPrompt}
              placeholder="Describe the task for this workflow..."
              onChange={(e) => setInitialPrompt(e.target.value)}
            />
          </label>

          <div className="actions">
            <button type="button" className="primary" disabled={!canStart} onClick={startRun}>
              <Play size={14} /> Start Workflow
            </button>
          </div>
        </>
      )}
    </section>
  )
}
