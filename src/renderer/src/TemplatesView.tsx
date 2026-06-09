/**
 * TemplatesView.tsx — 工作流模板编辑页
 *
 * 对应 "Templates" 模式，提供 workflow 模板的完整 CRUD 界面：
 *  - 左侧列表：所有已保存的模板（名称 + 步骤数量点阵）
 *  - 右侧编辑器：名称、描述、Pipeline 预览、步骤拖拽排序、初始 Prompt 模板
 *  - 每个步骤绑定一个 Agent + 可选 role 标签
 *  - Prompt 模板支持变量插入（{{projectPath}} / {{branch}} / {{userInput}}）
 *  - 支持复制、删除模板，Cmd+S 保存快捷键
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentDefinition, WorkflowTemplate } from '@shared/types'
import type { WorkflowDraft } from './useWorkflows'
import { Select } from './Select'

interface TemplatesViewProps {
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  onSave: (draft: WorkflowDraft) => Promise<WorkflowTemplate>
  onDelete: (id: string) => Promise<void>
}

interface StepDraft {
  agentId: string
  role: string
}

const PROMPT_VARS = ['{{projectPath}}', '{{branch}}', '{{userInput}}']

export function TemplatesView({
  agents,
  templates,
  onSave,
  onDelete
}: TemplatesViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<StepDraft[]>([])
  const [promptTemplate, setPromptTemplate] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [highlightedStep, setHighlightedStep] = useState<number | null>(null)

  const stepRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // ── derived ──────────────────────────────────────────────────────────────

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId]
  )

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates]
  )

  // ── load template into draft ─────────────────────────────────────────────

  const loadTemplate = useCallback(
    (template: WorkflowTemplate | null) => {
      if (!template) {
        setName('')
        setDescription('')
        setSteps([])
        setPromptTemplate('')
        setIsDirty(false)
        return
      }
      setName(template.name)
      setDescription(template.description ?? '')
      setSteps(
        template.steps.map((s) => ({
          agentId: s.agentId,
          role: (s as StepDraft).role ?? ''
        }))
      )
      setPromptTemplate((template as WorkflowTemplate & { promptTemplate?: string }).promptTemplate ?? '')
      setIsDirty(false)
    },
    []
  )

  // ── auto-select first template ───────────────────────────────────────────

  useEffect(() => {
    if (!selectedId && templates.length > 0) {
      const first = sortedTemplates[0]
      setSelectedId(first.id)
      loadTemplate(first)
    }
    if (selectedId && !templates.some((t) => t.id === selectedId)) {
      const next = sortedTemplates[0] ?? null
      setSelectedId(next?.id ?? null)
      loadTemplate(next)
    }
  }, [selectedId, templates, sortedTemplates, loadTemplate])

  // ── select ───────────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (id: string) => {
      if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
      setSelectedId(id)
      const template = templates.find((t) => t.id === id) ?? null
      loadTemplate(template)
    },
    [isDirty, templates, loadTemplate]
  )

  // ── dirty tracking ───────────────────────────────────────────────────────

  const markDirty = useCallback(() => setIsDirty(true), [])

  // ── save ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const draft: WorkflowDraft & { promptTemplate?: string } = {
        id: selectedTemplate?.id,
        name: name.trim(),
        description: description.trim() || undefined,
        steps: steps.map((s) => ({ agentId: s.agentId, role: s.role } as StepDraft & { agentId: string })),
        promptTemplate: promptTemplate.trim() || undefined
      }
      const saved = await onSave(draft)
      setSelectedId(saved.id)
      setIsDirty(false)
    } finally {
      setSaving(false)
    }
  }, [name, description, steps, promptTemplate, selectedTemplate, onSave, saving])

  // ── new ──────────────────────────────────────────────────────────────────

  const handleNew = useCallback(async () => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    setSaving(true)
    try {
      const saved = await onSave({ name: 'New Workflow', steps: [] })
      setSelectedId(saved.id)
      loadTemplate(saved)
    } finally {
      setSaving(false)
    }
  }, [isDirty, onSave, loadTemplate])

  // ── duplicate ────────────────────────────────────────────────────────────

  const handleDuplicate = useCallback(async () => {
    if (!selectedTemplate) return
    setSaving(true)
    try {
      const saved = await onSave({
        name: `${selectedTemplate.name} Copy`,
        description: selectedTemplate.description,
        steps: selectedTemplate.steps
      })
      setSelectedId(saved.id)
    } finally {
      setSaving(false)
    }
  }, [selectedTemplate, onSave])

  // ── delete ───────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!selectedTemplate) return
    if (!window.confirm(`Delete template "${selectedTemplate.name}"? This cannot be undone.`)) return
    await onDelete(selectedTemplate.id)
    // useEffect will auto-select next
  }, [selectedTemplate, onDelete])

  // ── step ops ─────────────────────────────────────────────────────────────

  const handleAddStep = useCallback(() => {
    const firstAgent = agents[0]
    if (!firstAgent) return
    setSteps((prev) => [...prev, { agentId: firstAgent.id, role: '' }])
    markDirty()
  }, [agents, markDirty])

  const handleRemoveStep = useCallback(
    (index: number) => {
      setSteps((prev) => prev.filter((_, i) => i !== index))
      markDirty()
    },
    [markDirty]
  )

  const handleStepAgentChange = useCallback(
    (index: number, agentId: string) => {
      setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, agentId } : s)))
      markDirty()
    },
    [markDirty]
  )

  const handleStepRoleChange = useCallback(
    (index: number, role: string) => {
      setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, role } : s)))
      markDirty()
    },
    [markDirty]
  )

  // ── drag-and-drop ────────────────────────────────────────────────────────

  const dragIndex = useRef<number | null>(null)

  const handleDragStart = useCallback((index: number) => {
    dragIndex.current = index
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault()
      const fromIndex = dragIndex.current
      if (fromIndex === null || fromIndex === toIndex) return
      setSteps((prev) => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
      dragIndex.current = null
      markDirty()
    },
    [markDirty]
  )

  const handleDragEnd = useCallback(() => {
    dragIndex.current = null
  }, [])

  // ── pipeline click → scroll to step ──────────────────────────────────────

  const handlePipelineClick = useCallback((index: number) => {
    setHighlightedStep(index)
    const el = stepRefs.current.get(index)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setTimeout(() => setHighlightedStep(null), 900)
  }, [])

  // ── variable chip click ──────────────────────────────────────────────────

  const handleVarChipClick = useCallback((varName: string) => {
    const textarea = promptRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = promptTemplate.slice(0, start)
    const after = promptTemplate.slice(end)
    const newValue = before + varName + after
    setPromptTemplate(newValue)
    markDirty()
    // restore cursor after the inserted text
    requestAnimationFrame(() => {
      textarea.focus()
      const pos = start + varName.length
      textarea.setSelectionRange(pos, pos)
    })
  }, [promptTemplate, markDirty])

  // ── agent label helper ───────────────────────────────────────────────────

  const agentLabel = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      return agent ? `${agent.name || agent.role || 'Agent'} · ${agent.vendor}` : agentId
    },
    [agents]
  )

  const agentShortName = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      return agent?.name || agent?.role || 'Agent'
    },
    [agents]
  )

  // ── keyboard shortcut ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty) void handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDirty, handleSave])

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <section className="templates-view">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className="templates-sidebar">
        <div className="templates-sidebar-head">
          <h2>Templates</h2>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '5px 10px', fontSize: 11 }}
            onClick={() => void handleNew()}
          >
            + New
          </button>
        </div>

        <div className="templates-sidebar-list">
          {sortedTemplates.map((template) => {
            const stepCount = template.steps.length
            return (
              <button
                key={template.id}
                type="button"
                className={[
                  'templates-sidebar-item',
                  selectedId === template.id ? 'selected' : ''
                ].filter(Boolean).join(' ')}
                onClick={() => handleSelect(template.id)}
              >
                <div className="templates-sidebar-item-name">{template.name}</div>
                <div className="templates-sidebar-item-desc">
                  {template.description || 'No description'}
                </div>
                <div className="templates-sidebar-item-dots">
                  {Array.from({ length: Math.max(stepCount, 1) }).map((_, i) => (
                    <span
                      key={i}
                      className={[
                        'templates-sidebar-dot',
                        i < stepCount ? 'on' : ''
                      ].filter(Boolean).join(' ')}
                    />
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ── Editor ────────────────────────────────────────────────────── */}
      <main className="templates-editor">
        {!selectedTemplate ? (
          <div className="workflow-run-detail workflow-run-detail-empty">
            <strong>No template selected</strong>
            <span>Create a new template or select one from the list.</span>
          </div>
        ) : (
          <>
            {/* Editor header */}
            <div className="templates-editor-head">
              <span className={`dirty-dot ${isDirty ? 'visible' : ''}`} title={isDirty ? 'Unsaved changes' : ''} />
              <input
                className="templates-name-input"
                value={name}
                placeholder="Template Name"
                onChange={(e) => {
                  setName(e.target.value)
                  markDirty()
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || saving}
                onClick={() => void handleSave()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handleDuplicate()}
                disabled={saving}
              >
                Duplicate
              </button>
            </div>

            {/* Editor body */}
            <div className="templates-editor-body">
              {/* Description */}
              <div className="templates-field">
                <span className="templates-section-label">Description</span>
                <textarea
                  value={description}
                  placeholder="Brief description of this workflow…"
                  onChange={(e) => {
                    setDescription(e.target.value)
                    markDirty()
                  }}
                  rows={2}
                />
              </div>

              {/* Pipeline Preview */}
              {steps.length > 0 && (
                <div className="templates-field">
                  <span className="templates-section-label">Pipeline</span>
                  <div style={{ height: 4 }} />
                  <div className="templates-pipeline">
                    {steps.map((step, index) => (
                      <button
                        key={index}
                        type="button"
                        className={[
                          'templates-pnode',
                          highlightedStep === index ? 'active' : ''
                        ].filter(Boolean).join(' ')}
                        onClick={() => handlePipelineClick(index)}
                      >
                        <div className="templates-pnode-index">{index + 1}</div>
                        <div className="templates-pnode-agent">{agentShortName(step.agentId)}</div>
                        <div className="templates-pnode-role">{step.role || `Step ${index + 1}`}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step Editor */}
              <div className="templates-field">
                <span className="templates-section-label">Steps</span>
                <div style={{ height: 4 }} />
                <div className="templates-step-list">
                  {steps.map((step, index) => (
                    <div
                      key={`${index}-${step.agentId}`}
                      ref={(el) => {
                        if (el) stepRefs.current.set(index, el)
                        else stepRefs.current.delete(index)
                      }}
                      className={[
                        'templates-step-row',
                        highlightedStep === index ? 'highlight' : ''
                      ].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className="templates-step-grip" aria-label="Drag to reorder">
                        ⋮⋮
                      </span>
                      <span className="templates-step-num">{index + 1}</span>
                      <Select
                        value={step.agentId}
                        onChange={(v) => handleStepAgentChange(index, v)}
                      >
                        {agents.map((agent) => (
                          <Select.Item key={agent.id} value={agent.id}>
                            {agent.name || agent.role || 'Agent'} · {agent.vendor}
                          </Select.Item>
                        ))}
                      </Select>
                      <input
                        className="templates-step-role"
                        value={step.role}
                        placeholder="Role"
                        onChange={(e) => handleStepRoleChange(index, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-icon"
                        aria-label="Remove step"
                        onClick={() => handleRemoveStep(index)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="templates-add-step-btn"
                    onClick={handleAddStep}
                  >
                    + Add Step
                  </button>
                </div>
              </div>

              {/* Prompt Template */}
              <div className="templates-field templates-prompt-section">
                <span className="templates-section-label">Initial Prompt Template</span>
                <textarea
                  ref={promptRef}
                  value={promptTemplate}
                  placeholder="Write the initial prompt that starts this workflow…"
                  onChange={(e) => {
                    setPromptTemplate(e.target.value)
                    markDirty()
                  }}
                />
                <div className="templates-var-chips">
                  {PROMPT_VARS.map((varName) => (
                    <button
                      key={varName}
                      type="button"
                      className="templates-var-chip"
                      onClick={() => handleVarChipClick(varName)}
                    >
                      {varName}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Editor footer */}
            <div className="templates-editor-foot">
              <div className="spacer" />
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleDelete()}
              >
                Delete Template
              </button>
            </div>
          </>
        )}
      </main>
    </section>
  )
}
