/**
 * TemplatesView.tsx — 工作流模板编辑页（DAG 画布版）
 *
 * 左侧：模板列表（名称 + 步骤点阵）
 * 右侧：DAG 画布编辑器（替代原线性步骤列表）
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isParallelGroup, type AgentDefinition, type CliCheckResult, type ModelCatalog, type WorkflowTemplate, type WorkflowStepNode } from '@shared/types'
import type { WorkflowDraft } from './useWorkflows'
import type { AgentDraft } from './useAgents'
import { ChevronsLeft, ChevronsRight, Download, Copy, Plus, Save, Trash2 } from 'lucide-react'
import { useCredentials } from './useCredentials'

const WorkflowCanvas = lazy(() => import('./canvas/WorkflowCanvas'))

interface TemplatesViewProps {
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  clis: CliCheckResult | null
  modelCatalog: ModelCatalog | null
  onSaveAgent: (draft: AgentDraft) => Promise<AgentDefinition | null>
  onSave: (draft: WorkflowDraft) => Promise<WorkflowTemplate>
  onDelete: (id: string) => Promise<void>
}

function getTemplateVisualStepCount(template: WorkflowTemplate): number {
  const flattenedCount = template.steps.reduce((count, step) => {
    if (isParallelGroup(step)) return count + step.parallel.length
    return count + 1
  }, 0)
  const hasBranch = template.steps.some((step) => isParallelGroup(step))
  return flattenedCount + (hasBranch ? 1 : 0)
}

export function TemplatesView({
  agents,
  templates,
  clis,
  modelCatalog,
  onSaveAgent,
  onSave,
  onDelete
}: TemplatesViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCredentialIds, setEditCredentialIds] = useState<string[]>([])
  const pendingStepsRef = useRef<WorkflowStepNode[] | null>(null)
  const [contextMenu, setContextMenu] = useState<{ templateId: string; x: number; y: number } | null>(null)
  const credentialState = useCredentials()

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId]
  )

  const sortedTemplates = useMemo(
    () =>
      [...templates]
        .map((t, i) => ({ t, i }))
        .sort((a, b) => (b.t.createdAt ?? 0) - (a.t.createdAt ?? 0) || a.i - b.i)
        .map((entry) => entry.t),
    [templates]
  )

  // Auto-select first template
  useEffect(() => {
    if (!selectedId && templates.length > 0) {
      setSelectedId(sortedTemplates[0].id)
      setEditName(sortedTemplates[0].name)
      setEditDescription(sortedTemplates[0].description ?? '')
      setEditCredentialIds(sortedTemplates[0].credentialIds ?? [])
    }
    if (selectedId && !templates.some((t) => t.id === selectedId)) {
      setSelectedId(sortedTemplates[0]?.id ?? null)
      setEditName(sortedTemplates[0]?.name ?? '')
      setEditDescription(sortedTemplates[0]?.description ?? '')
      setEditCredentialIds(sortedTemplates[0]?.credentialIds ?? [])
    }
  }, [selectedId, templates, sortedTemplates])

  useEffect(() => {
    pendingStepsRef.current = selectedTemplate?.steps ?? null
    setEditCredentialIds(selectedTemplate?.credentialIds ?? [])
  }, [selectedTemplate])

  const handleSelect = useCallback(
    (id: string) => {
      if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
      setSelectedId(id)
      setIsDirty(false)
      const t = templates.find((t) => t.id === id)
      if (t) {
        setEditName(t.name)
        setEditDescription(t.description ?? '')
        setEditCredentialIds(t.credentialIds ?? [])
      }
    },
    [isDirty, templates]
  )

  const markDirty = useCallback(() => setIsDirty(true), [])

  const handleNew = useCallback(async () => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    setSaving(true)
    try {
      const saved = await onSave({ name: 'New Workflow', description: '', steps: [], credentialIds: [] })
      setSelectedId(saved.id)
      setEditName(saved.name)
      setEditDescription(saved.description ?? '')
      setIsDirty(false)
    } finally {
      setSaving(false)
    }
  }, [isDirty, onSave])

  const handleDelete = useCallback(async () => {
    if (!selectedTemplate) return
    if (!window.confirm(`Delete template "${selectedTemplate.name}"? This cannot be undone.`)) return
    await onDelete(selectedTemplate.id)
  }, [selectedTemplate, onDelete])

  const handleDuplicate = useCallback(async () => {
    if (!selectedTemplate) return
    setSaving(true)
    try {
      const saved = await onSave({
        name: `${selectedTemplate.name} Copy`,
        description: selectedTemplate.description,
        steps: selectedTemplate.steps,
        credentialIds: selectedTemplate.credentialIds ?? []
      })
      setSelectedId(saved.id)
      setEditName(saved.name)
      setEditDescription(saved.description ?? '')
      setIsDirty(false)
    } finally {
      setSaving(false)
    }
  }, [selectedTemplate, onSave])

  const handleCanvasSave = useCallback(async (steps: WorkflowStepNode[]) => {
    if (!selectedTemplate || saving) return
    setSaving(true)
    try {
      const saved = await onSave({
        id: selectedTemplate.id,
        name: editName.trim() || selectedTemplate.name,
        description: editDescription.trim() || undefined,
        steps,
        credentialIds: editCredentialIds,
        budgetUsd: selectedTemplate.budgetUsd
      })
      setSelectedId(saved.id)
      setEditName(saved.name)
      setEditDescription(saved.description ?? '')
      setIsDirty(false)
    } finally {
      setSaving(false)
    }
  }, [selectedTemplate, onSave, saving, editName, editDescription, editCredentialIds])

  const handleCanvasSaveFromButton = useCallback(() => {
    if (!selectedTemplate) return
    void handleCanvasSave(pendingStepsRef.current ?? selectedTemplate.steps)
  }, [handleCanvasSave, selectedTemplate])

  const handleExportSelected = useCallback(() => {
    if (!selectedTemplate) return
    void window.api.exportTemplate(selectedTemplate.id)
  }, [selectedTemplate])

  return (
    <section className="templates-view">
      {/* Sidebar */}
      <aside
        className={`templates-sidebar${sidebarCollapsed ? ' templates-sidebar-collapsed' : ''}`}
        style={sidebarCollapsed ? { width: 40, minWidth: 40, padding: 0 } : undefined}
      >
        {sidebarCollapsed ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              style={{ background: 'none', border: 'none', color: '#9aa3b5', cursor: 'pointer', padding: 4, display: 'flex' }}
              title="Expand sidebar"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="templates-sidebar-head">
              <h2>模板</h2>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '5px 10px', fontSize: 11 }}
                  onClick={() => void handleNew()}
                >
                  <Plus size={14} /> 新建
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  style={{ background: 'none', border: 'none', color: '#9aa3b5', cursor: 'pointer', padding: 4, display: 'flex' }}
                  title="Collapse sidebar"
                >
                  <ChevronsLeft size={14} />
                </button>
              </div>
            </div>

            <div className="templates-sidebar-list">
              {sortedTemplates.map((template) => {
                const stepCount = getTemplateVisualStepCount(template)
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={[
                      'templates-sidebar-item',
                      selectedId === template.id ? 'selected' : ''
                    ].filter(Boolean).join(' ')}
                    onClick={() => handleSelect(template.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({ templateId: template.id, x: e.clientX, y: e.clientY })
                    }}
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
          </>
        )}
      </aside>

      {/* Editor — DAG Canvas */}
      <main className="templates-editor" style={{ overflow: 'hidden', position: 'relative' }}>
        {!selectedTemplate ? (
          <div className="workflow-run-detail workflow-run-detail-empty">
            <strong>No template selected</strong>
            <span>Create a new template or select one from the list.</span>
          </div>
        ) : (
          <>
            {/* Editor header */}
            <div className="templates-editor-head">
              <div className="templates-editor-title-row">
                <span className={`dirty-dot ${isDirty ? 'visible' : ''}`} title={isDirty ? 'Unsaved changes' : ''} />
                <input
                  className="templates-name-input"
                  value={editName}
                  placeholder="Template Name"
                  onChange={(e) => {
                    setEditName(e.target.value)
                    markDirty()
                  }}
                />
                <span className="tag-green templates-step-count">{getTemplateVisualStepCount(selectedTemplate)} steps</span>
              </div>
              <div className="templates-editor-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleDuplicate()}
                  disabled={saving}
                >
                  <Copy size={14} /> 复制
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleExportSelected}
                  disabled={saving}
                >
                  <Download size={14} /> 导出
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleDelete()}
                >
                  <Trash2 size={14} /> 删除
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!isDirty || saving}
                  onClick={handleCanvasSaveFromButton}
                >
                  <Save size={14} /> {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>

            {/* Canvas */}
            <div className="workflow-canvas" style={{ flex: 1, minHeight: 0 }}>
              <Suspense fallback={<div style={{ padding: 20, color: '#9aa3b5' }}>Loading canvas…</div>}>
                <WorkflowCanvas
                  agents={agents}
                  template={selectedTemplate}
                  templates={templates}
                  clis={clis}
                  modelCatalog={modelCatalog}
                  onSaveAgent={onSaveAgent}
                  onMarkDirty={markDirty}
                  templateDescription={editDescription}
                  credentials={credentialState.credentials}
                  credentialsLoading={credentialState.loading}
                  templateCredentialIds={editCredentialIds}
                  onTemplateDescriptionChange={(description) => {
                    setEditDescription(description)
                    markDirty()
                  }}
                  onTemplateCredentialIdsChange={(credentialIds) => {
                    setEditCredentialIds(credentialIds)
                    markDirty()
                  }}
                  onSaveCredential={credentialState.save}
                  onStepsChange={(steps) => {
                    pendingStepsRef.current = steps
                  }}
                  onSave={(steps) => {
                    pendingStepsRef.current = steps
                    void handleCanvasSave(steps)
                  }}
                />
              </Suspense>
            </div>
          </>
        )}
      </main>

      {/* ── Context Menu ── */}
      {contextMenu && (() => {
        const template = templates.find(t => t.id === contextMenu.templateId)
        if (!template) { setContextMenu(null); return null }
        return (
          <>
            <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
            <div className="context-menu-dropdown" style={{ left: contextMenu.x, top: contextMenu.y }}>
              <button type="button" className="context-menu-item" onClick={() => {
                void window.api.exportTemplate(contextMenu.templateId)
                setContextMenu(null)
              }}>
                <Download size={14} /> 导出此模板
              </button>
              <div className="context-menu-divider" />
              <button type="button" className="context-menu-item" onClick={() => {
                void handleDuplicate()
                setContextMenu(null)
              }}>
                <Copy size={14} /> 复制模板
              </button>
              <button type="button" className="context-menu-item context-menu-danger" onClick={() => {
                void handleDelete()
                setContextMenu(null)
              }}>
                <Trash2 size={14} /> 删除模板
              </button>
            </div>
          </>
        )
      })()}
    </section>
  )
}
