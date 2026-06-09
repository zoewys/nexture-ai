/**
 * WorkflowRunDetail.tsx — 单个工作流运行的详情视图
 *
 * Codex-style layout:
 *  - 左侧 transcript（含内嵌 artifact 卡片）+ bottom composer
 *  - 右侧 file preview pane（tab 切换、breadcrumb、代码/md 预览）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentDefinition, HandoffArtifactItem, WorkflowRun } from '@shared/types'
import { CheckCircle } from './Icons'
import { TranscriptViewer } from './TranscriptViewer'
import { MarkdownPreview } from './MarkdownPreview'
import { workflowRunStatusLabel } from './workflowLabels'

type WorkflowRunUiMeta = WorkflowRun & {
  displayPath?: string
  gitSafetyMessage?: string
}

export interface WorkflowRunDetailProps {
  agents: AgentDefinition[]
  run: WorkflowRun | null
  selectedStepIndex: number
  onSelectStep: (stepIndex: number) => void
  selectedExecution: WorkflowRun['steps'][number]['executions'][number] | null
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']> | null
  uiReviewEnabled?: boolean
  onConfirm: () => Promise<void>
  onRerun: (stepIndex: number) => Promise<void>
  onAbort: () => Promise<void>
  onUpdatePrompt: (runId: string, newPrompt: string) => Promise<void>
  composerValue: string
  composerEditable: boolean
  composerEnabled: boolean
  composerPlaceholder: string
  composerError: string | null
  onComposerChange: (value: string) => void
  onComposerSend: () => Promise<void>
}

interface OpenFile {
  path: string
  content: string | null
  loading: boolean
  error: string | null
}

export function WorkflowRunDetail({
  agents,
  run,
  selectedStepIndex,
  onSelectStep,
  selectedExecution,
  handoff,
  onConfirm,
  onRerun,
  onAbort,
  onUpdatePrompt,
  composerValue,
  composerEditable,
  composerEnabled,
  composerPlaceholder,
  composerError,
  onComposerChange,
  onComposerSend
}: WorkflowRunDetailProps): JSX.Element {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [rightWidth, setRightWidth] = useState(400)
  const resizing = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current || !bodyRef.current) return
      const rect = bodyRef.current.getBoundingClientRect()
      const w = rect.right - e.clientX
      setRightWidth(Math.max(280, Math.min(rect.width * 0.7, w)))
    }
    const onUp = () => {
      if (!resizing.current) return
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const openFile = useCallback(async (artifactPath: string) => {
    if (!run) return
    // If already open, just activate
    const existing = openFiles.find(f => f.path === artifactPath)
    if (existing) { setActiveFile(artifactPath); return }

    const newFile: OpenFile = { path: artifactPath, content: null, loading: true, error: null }
    setOpenFiles(prev => [...prev, newFile])
    setActiveFile(artifactPath)

    try {
      const absPath = `${run.projectPath}/${artifactPath}`
      const content = await window.api.readFile(absPath)
      setOpenFiles(prev => prev.map(f => f.path === artifactPath ? { ...f, content, loading: false } : f))
    } catch (err) {
      setOpenFiles(prev => prev.map(f => f.path === artifactPath ? { ...f, error: err instanceof Error ? err.message : String(err), loading: false } : f))
    }
  }, [run, openFiles])

  const closeFile = useCallback((filePath: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.path !== filePath)
      if (activeFile === filePath) setActiveFile(next[0]?.path ?? null)
      return next
    })
  }, [activeFile])

  const activeFileObj = openFiles.find(f => f.path === activeFile) ?? null

  if (!run) {
    return (
      <main className="workflow-run-detail workflow-run-detail-empty">
        <strong>暂无工作流运行</strong>
        <span>点击左侧 New Run 从模板启动一个 workflow。</span>
      </main>
    )
  }

  const selectedStep = run.steps[selectedStepIndex]
  const selectedAgent = selectedStep
    ? agents.find((agent) => agent.id === selectedStep.agentId) ?? null
    : null
  const awaitingConfirm =
    run.status === 'awaiting-confirm' &&
    run.steps[run.currentStepIndex]?.status === 'awaiting-confirm'
  const { displayPath, gitSafetyMessage } = run as WorkflowRunUiMeta

  return (
    <main className="workflow-run-detail codex-layout" ref={bodyRef}>
      {/* ── left column: transcript + composer ── */}
      <div className="codex-left">
        {/* header */}
        <div className="workflow-run-detail-header">
          <div className="workflow-detail-title">
            <h2>{run.runName || run.templateName}</h2>
            <span className={`workflow-run-status workflow-run-status-${run.status}`}>
              {workflowRunStatusLabel(run.status)}
            </span>
            {(() => {
              const currentTokens = selectedExecution?.status === 'running'
                ? (selectedExecution.totalInputTokens ?? 0) + (selectedExecution.totalOutputTokens ?? 0)
                : 0
              const currentCost = selectedExecution?.status === 'running'
                ? (selectedExecution.totalCostUsd ?? 0)
                : 0
              const totalTokens = run.totalInputTokens + run.totalOutputTokens + currentTokens
              const totalCost = run.totalCostUsd + currentCost
              if (totalTokens <= 0 && totalCost <= 0) return null
              return (
                <span className="workflow-run-cost">
                  {formatTokens(totalTokens)} tokens
                  {totalCost > 0 ? ` · $${totalCost.toFixed(2)}` : ''}
                  {run.budgetUsd !== undefined ? ` / $${run.budgetUsd.toFixed(2)}` : ''}
                </span>
              )
            })()}
          </div>
          <div className="workflow-run-detail-actions">
            {awaitingConfirm && (
              <button type="button" className="primary workflow-confirm-step" onClick={onConfirm}>
                <CheckCircle size={14} /> 确认并继续
              </button>
            )}
            <button type="button" onClick={() => onRerun(selectedStepIndex)}>Rerun Step</button>
            {(run.status === 'running' || run.status === 'awaiting-confirm') && (
              <button type="button" className="danger" onClick={onAbort}>Stop</button>
            )}
          </div>
        </div>

        {/* step nav */}
        <div className="workflow-step-nav">
          {run.steps.map((step, index) => {
            const agent = agents.find((candidate) => candidate.id === step.agentId)
            const stepTokens = step.executions.reduce((sum, ex) => sum + (ex.totalInputTokens ?? 0) + (ex.totalOutputTokens ?? 0), 0)
            const stepCost = step.executions.reduce((sum, ex) => sum + (ex.totalCostUsd ?? 0), 0)
            const costTitle = stepTokens > 0 ? `${formatTokens(stepTokens)} tokens${stepCost > 0 ? ` · $${stepCost.toFixed(2)}` : ''}` : undefined
            return (
              <button
                type="button"
                key={`${run.id}-step-${index}`}
                className={`workflow-step-chip ${selectedStepIndex === index ? 'workflow-step-chip-active' : ''} workflow-step-chip-${step.status}`}
                onClick={() => onSelectStep(index)}
                title={costTitle}
              >
                <span className="workflow-step-chip-num">{index + 1}</span>
                <span className="workflow-step-chip-name">{step.role || step.displayName || agent?.name || agent?.role || `Step ${index + 1}`}</span>
              </button>
            )
          })}
        </div>

        {/* prompt display */}
        <div className="workflow-prompt-section">
          {editingPrompt ? (
            <div className="workflow-prompt-edit">
              <textarea value={promptDraft} onChange={(e) => setPromptDraft(e.target.value)} rows={3} autoFocus />
              <div className="workflow-prompt-edit-actions">
                <button type="button" className="primary" onClick={() => {
                  void onUpdatePrompt(run.id, promptDraft.trim()).then(() => setEditingPrompt(false))
                }}>保存</button>
                <button type="button" onClick={() => setEditingPrompt(false)}>取消</button>
              </div>
            </div>
          ) : (
            <div className="workflow-prompt-display" onClick={() => { setPromptDraft(run.initialPrompt); setEditingPrompt(true) }}>
              <span className="workflow-prompt-label">任务描述</span>
              <span className="workflow-prompt-text">{run.initialPrompt}</span>
              <span className="workflow-prompt-edit-hint">点击编辑</span>
            </div>
          )}
        </div>

        {gitSafetyMessage && <div className="workflow-run-warning">{gitSafetyMessage}</div>}
        {selectedExecution?.error && (
          <div className={`workflow-detail-error${selectedExecution.error.startsWith('Budget exceeded') ? ' workflow-budget-exceeded' : ''}`}>
            {selectedExecution.error.startsWith('Budget exceeded')
              ? <>⚠️ 已达到预算上限，运行已自动停止。{selectedExecution.error.slice(15)}</>
              : selectedExecution.error}
          </div>
        )}

        {/* transcript */}
        <div className="codex-transcript-area">
          <TranscriptViewer events={selectedExecution?.events ?? []} />

          {/* inline artifact cards */}
          {handoff && handoff.artifacts.length > 0 && (
            <div className="artifact-cards">
              <div className="artifact-cards-header">
                Created <span className="artifact-cards-count">{handoff.artifacts.length}</span> files
              </div>
              {handoff.artifacts.map((artifact, i) => (
                <ArtifactCard
                  key={`${artifact.path}-${i}`}
                  artifact={artifact}
                  isActive={activeFile === artifact.path}
                  onClick={() => void openFile(artifact.path)}
                />
              ))}
            </div>
          )}
        </div>

        {/* composer */}
        <div className="workflow-cli-composer">
          <div className="workflow-cli-prompt">›</div>
          <input
            value={composerValue}
            disabled={!composerEditable}
            placeholder={composerPlaceholder}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onComposerSend() } }}
          />
          <button
            onClick={() => void onComposerSend()}
            disabled={!composerEnabled || composerValue.trim() === ''}
            type="button"
          >发送</button>
        </div>
        {composerError && <div className="workflow-input-error">{composerError}</div>}
      </div>

      {/* ── right column: preview pane (only when a file is open) ── */}
      {openFiles.length > 0 && activeFileObj && (
        <>
          <div className="codex-resize-handle" onMouseDown={onResizeStart} />
          <div className="codex-right" style={{ width: rightWidth, flex: 'none' }}>
            <FilePreviewPane
              file={activeFileObj}
              projectPath={run.projectPath}
              onClose={closeFile}
            />
          </div>
        </>
      )}
    </main>
  )
}

// ── Artifact Card ───────────────────────────────────────────────────────────

function ArtifactCard({
  artifact,
  isActive,
  onClick
}: {
  artifact: HandoffArtifactItem
  isActive: boolean
  onClick: () => void
}): JSX.Element {
  const typeIcon = artifact.type === 'code' ? '{ }' : artifact.type === 'design' ? '◉' : artifact.type === 'test' ? '✓' : '?'
  const typeLabel = artifact.type === 'code' ? 'Code' : artifact.type === 'design' ? 'Design' : artifact.type === 'test' ? 'Test' : 'Other'
  const ext = artifact.path.split('.').pop()?.toLowerCase() ?? ''

  return (
    <div className={`artifact-card-row ${isActive ? 'artifact-card-row-active' : ''}`} onClick={onClick}>
      <div className="artifact-card-icon">{typeIcon}</div>
      <div className="artifact-card-info">
        <div className="artifact-card-name">{artifact.path}</div>
        <div className="artifact-card-meta">{typeLabel}{ext ? ` · ${ext.toUpperCase()}` : ''}</div>
      </div>
      <span className="artifact-card-open">Open ▾</span>
    </div>
  )
}

// ── File Preview Pane ───────────────────────────────────────────────────────

function FilePreviewPane({
  file,
  projectPath,
  onClose
}: {
  file: OpenFile
  projectPath: string
  onClose: (path: string) => void
}): JSX.Element {
  const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
  const isMarkdown = ext === 'md' || ext === 'mdx'
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)
  const breadcrumbParts = file.path.split('/')

  return (
    <div className="codex-preview-pane">
      <div className="codex-preview-breadcrumb">
        {breadcrumbParts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="codex-breadcrumb-sep"> › </span>}
            <span className={i === breadcrumbParts.length - 1 ? 'codex-breadcrumb-last' : ''}>{part}</span>
          </span>
        ))}
      </div>

      <div className="codex-preview-toolbar">
        <span className="codex-preview-filename">{file.path}</span>
        <button type="button" className="codex-preview-open-btn" onClick={() => onClose(file.path)}>关闭</button>
      </div>

      <div className="codex-preview-body">
        {file.loading ? (
          <span className="codex-preview-status">加载中…</span>
        ) : file.error ? (
          <span className="codex-preview-status codex-preview-error">{file.error}</span>
        ) : isImage ? (
          <img src={`file://${projectPath}/${file.path}`} alt={file.path} className="codex-preview-image" />
        ) : isMarkdown ? (
          <MarkdownPreview source={file.content ?? ''} className="codex-preview-markdown" />
        ) : (
          <pre className="codex-preview-code"><code>{file.content}</code></pre>
        )}
      </div>
    </div>
  )
}

// ── Utilities ───────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

