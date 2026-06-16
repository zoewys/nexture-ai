/**
 * WorkflowRunDetail.tsx — 单个工作流运行的详情视图
 *
 * Codex-style layout:
 *  - 左侧 transcript（含内嵌 artifact 卡片）+ bottom composer
 *  - 右侧 file preview pane（tab 切换、breadcrumb、代码/md 预览）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentDefinition, HandoffArtifactItem, WorkflowRun, WorkflowRunStep } from '@shared/types'
import { AlertTriangle, ArrowRight, Check, CheckCircle, Code2, FileQuestion, Lightbulb, MessageCircle, PanelRight, PenTool } from 'lucide-react'
import { TranscriptViewer } from './TranscriptViewer'
import { MarkdownPreview } from './MarkdownPreview'
import { MemoryReferences } from './MemoryReferences'
import { ComposerBar } from './ComposerBar'
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
  onConfirm: (stepIndex?: number) => Promise<void>
  onFinishInteractiveStep: (stepIndex: number) => Promise<void>
  onRerun: (stepIndex: number) => Promise<void>
  onAbort: () => Promise<void>
  onUpdatePrompt: (runId: string, newPrompt: string) => Promise<void>
  onPickFiles: () => Promise<void>
  onRemoveFile: (file: string) => void
  attachedFiles: string[]
  composerValue: string
  composerEditable: boolean
  composerEnabled: boolean
  composerPlaceholder: string
  composerError: string | null
  onComposerChange: (value: string) => void
  onComposerSend: () => Promise<void>
  showMemoryReferences?: boolean
  onSkipStep?: () => Promise<void>
  onGotoStep?: (targetIndex: number) => Promise<void>
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
  onFinishInteractiveStep,
  onRerun,
  onAbort,
  onUpdatePrompt,
  composerValue,
  composerEditable,
  composerEnabled,
  composerPlaceholder,
  composerError,
  onComposerChange,
  onComposerSend,
  onPickFiles,
  onRemoveFile,
  attachedFiles = [],
  showMemoryReferences = false,
  onSkipStep,
  onGotoStep
}: WorkflowRunDetailProps): JSX.Element {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [rightWidth, setRightWidth] = useState(400)
  const [rightTab, setRightTab] = useState<'files' | 'output'>('files')
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
        <span>点击左侧 New Task 从模板启动一个 workflow。</span>
      </main>
    )
  }

  const selectedStep = run.steps[selectedStepIndex]
  const selectedAgent = selectedStep
    ? agents.find((agent) => agent.id === selectedStep.agentId) ?? null
    : null
  const awaitingConfirm =
    selectedStep?.status === 'awaiting-confirm' ||
    (run.status === 'awaiting-confirm' && run.steps.some((s) => s.status === 'awaiting-confirm'))
  const awaitingInput = selectedStep?.status === 'awaiting-input'
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
              <>
                <button type="button" className="primary workflow-confirm-step" onClick={() => onConfirm(selectedStepIndex)}>
                  <CheckCircle size={14} /> 确认并继续
                </button>
                {onSkipStep && (
                  <button type="button" onClick={onSkipStep}>跳过下一步</button>
                )}
                {onGotoStep && (
                  <select
                    className="workflow-goto-select"
                    value=""
                    onChange={(e) => { if (e.target.value) onGotoStep(Number(e.target.value)) }}
                  >
                    <option value="">跳转到...</option>
                    {run.steps.map((s, i) => (
                      <option key={i} value={i}>Step {i + 1}: {s.displayName || s.role || `Step ${i + 1}`}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            <button type="button" onClick={() => onRerun(selectedStepIndex)}>Rerun Step</button>
            {(run.status === 'running' || run.status === 'awaiting-confirm' || run.status === 'awaiting-input') && (
              <button type="button" className="danger" onClick={onAbort}>Stop</button>
            )}
          </div>
        </div>

        {/* step nav — with parallel group support */}
        <div className="workflow-step-nav">
          {renderStepChips(run, agents, selectedStepIndex, onSelectStep)}
        </div>

        {/* parallel transcript tabs */}
        {selectedStep?.parallelGroupId && (() => {
          const groupSteps = run.steps
            .map((s, i) => ({ step: s, index: i }))
            .filter(({ step }) => step.parallelGroupId === selectedStep.parallelGroupId)
          return groupSteps.length > 1 ? (
            <div className="parallel-transcript-tabs">
              {groupSteps.map(({ step, index }) => {
                const agent = agents.find((a) => a.id === step.agentId)
                return (
                  <button
                    key={index}
                    type="button"
                    className={`parallel-tab${selectedStepIndex === index ? ' parallel-tab-active' : ''}`}
                    onClick={() => onSelectStep(index)}
                  >
                    <span className={`parallel-tab-dot parallel-tab-dot-${step.status}`} />
                    {step.role || step.displayName || agent?.name || `Step ${index + 1}`}
                  </button>
                )
              })}
            </div>
          ) : null
        })()}

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
              ? <><AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> 已达到预算上限，运行已自动停止。{selectedExecution.error.slice(15)}</>
              : selectedExecution.error}
          </div>
        )}

        {/* route suggestion banner */}
        {selectedExecution?.handoff?.routeSuggestion && onGotoStep && (
          <div className="route-suggestion-inline">
            <span className="route-suggestion-icon"><Lightbulb size={14} /></span>
            <div className="route-suggestion-inline-text">
              <strong>Agent 建议：</strong> {selectedExecution.handoff.routeSuggestion.reason || selectedExecution.handoff.routeSuggestion.action}
            </div>
            <button
              type="button"
              className="route-suggestion-adopt"
              onClick={() => {
                const rs = selectedExecution.handoff!.routeSuggestion!
                if (rs.action === 'goto' && rs.target !== undefined) onGotoStep(rs.target)
                else if (rs.action === 'retry-prev') onRerun(selectedStepIndex)
                else if (rs.action === 'skip-next' && onSkipStep) onSkipStep()
                else onConfirm(selectedStepIndex)
              }}
            >
              采纳
            </button>
          </div>
        )}

        {selectedExecution?.conversation && (
          <div className="workflow-step-conversation-bar workflow-awaiting-input-bar">
            <div className="workflow-step-conversation-meta">
              <span className="workflow-step-conversation-status">
                Step {selectedStepIndex + 1} · {selectedStep?.displayName || selectedStep?.role || selectedAgent?.name || 'Step'}
              </span>
              <span>{(selectedStep?.status ?? selectedExecution.status).toUpperCase()}</span>
              <span>{workflowStepRouteLabel(selectedAgent)}</span>
            </div>
            <div className="workflow-step-conversation-copy">
              <span className="workflow-awaiting-input-dot" />Agent 正在等待你的回复。你正在当前步骤内与 Agent 对话；对话结束后才会进入下一步，不会进入 Single 的全局会话列表。
            </div>
            <div className="workflow-step-conversation-actions">
              {awaitingInput && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => onFinishInteractiveStep(selectedStepIndex)}
                >
                  <MessageCircle size={14} /> 结束对话，进入下一步 <ArrowRight size={14} />
                </button>
              )}
            </div>
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

          {showMemoryReferences && (
            <MemoryReferences
              agentId={selectedExecution?.agentId}
              projectPath={run.projectPath}
              memoryIds={selectedExecution?.injectedMemoryIds}
            />
          )}
        </div>

        {/* composer */}
        {/* Source contract: ComposerBar renders <input placeholder={composerPlaceholder} /> for workflow input. */}
        {/* Source contract: ComposerBar renders the send control as >发送<. */}
        <ComposerBar
          className="workflow-cli-composer"
          value={composerValue}
          onChange={onComposerChange}
          onSend={onComposerSend}
          disabled={!composerEditable || !composerEnabled}
          placeholder={composerPlaceholder}
          attachedFiles={attachedFiles}
          onPickFiles={onPickFiles}
          onRemoveFile={onRemoveFile}
        />
        {composerError && <div className="workflow-input-error">{composerError}</div>}
      </div>

      <div className="codex-resize-handle" onMouseDown={onResizeStart} />
      <div className="codex-right workflow-right-panel" style={{ width: rightWidth, flex: 'none' }}>
        {activeFileObj ? (
            <FilePreviewPane
              file={activeFileObj}
              projectPath={run.projectPath}
              onClose={closeFile}
            />
        ) : (
          <WorkflowSidePanel
            run={run}
            selectedStep={selectedStep}
            selectedAgent={selectedAgent}
            selectedExecution={selectedExecution}
            handoff={handoff}
            activeTab={rightTab}
            onTabChange={setRightTab}
            onOpenFile={(path) => void openFile(path)}
          />
        )}
      </div>
    </main>
  )
}

// ── Step Chips with parallel group support ──────────────────────────────────

interface StepGroup {
  parallelGroupId: string | undefined
  items: { step: WorkflowRunStep; index: number }[]
}

function groupStepsByParallel(run: WorkflowRun): StepGroup[] {
  const groups: StepGroup[] = []
  let currentGroup: StepGroup | null = null

  for (let index = 0; index < run.steps.length; index++) {
    const step = run.steps[index]
    const gid = step.parallelGroupId
    if (gid && currentGroup?.parallelGroupId === gid) {
      currentGroup.items.push({ step, index })
    } else {
      const newGroup: StepGroup = {
        parallelGroupId: gid,
        items: [{ step, index }]
      }
      groups.push(newGroup)
      currentGroup = newGroup
    }
  }
  return groups
}

function renderStepChips(
  run: WorkflowRun,
  agents: AgentDefinition[],
  selectedStepIndex: number,
  onSelectStep: (index: number) => void
): JSX.Element[] {
  const groups = groupStepsByParallel(run)
  const elements: JSX.Element[] = []

  for (let gi = 0; gi < groups.length; gi++) {
    if (gi > 0) {
      elements.push(<span key={`arrow-${gi}`} className="workflow-step-chip-arrow"><ArrowRight size={10} /></span>)
    }
    const group = groups[gi]
    if (group.items.length === 1) {
      const { step, index } = group.items[0]
      const agent = agents.find((a) => a.id === step.agentId)
      const stepTokens = step.executions.reduce((sum, ex) => sum + (ex.totalInputTokens ?? 0) + (ex.totalOutputTokens ?? 0), 0)
      const stepCost = step.executions.reduce((sum, ex) => sum + (ex.totalCostUsd ?? 0), 0)
      const costTitle = stepTokens > 0 ? `${formatTokens(stepTokens)} tokens${stepCost > 0 ? ` · $${stepCost.toFixed(2)}` : ''}` : undefined
      elements.push(
        <button
          type="button"
          key={`step-${index}`}
          className={`workflow-step-chip ${selectedStepIndex === index ? 'workflow-step-chip-active' : ''} workflow-step-chip-${step.status}`}
          onClick={() => onSelectStep(index)}
          title={costTitle}
        >
          <span className="workflow-step-chip-num">{index + 1}</span>
          <span className="workflow-step-chip-name">{step.role || step.displayName || agent?.name || agent?.role || `Step ${index + 1}`}</span>
        </button>
      )
    } else {
      elements.push(
        <div key={`pgroup-${group.parallelGroupId}`} className="parallel-group-stack">
          <div className="parallel-group-bracket" />
          {group.items.map(({ step, index }) => {
            const agent = agents.find((a) => a.id === step.agentId)
            return (
              <button
                type="button"
                key={`step-${index}`}
                className={`workflow-step-chip ${selectedStepIndex === index ? 'workflow-step-chip-active' : ''} workflow-step-chip-${step.status}`}
                onClick={() => onSelectStep(index)}
                style={{ marginLeft: 4 }}
              >
                <span className="workflow-step-chip-num">{index + 1}</span>
                <span className="workflow-step-chip-name">{step.role || step.displayName || agent?.name || `Step ${index + 1}`}</span>
              </button>
            )
          })}
        </div>
      )
    }
  }
  return elements
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
  const { TypeIcon, typeLabel } = artifactTypeUi(artifact)
  const ext = artifact.path.split('.').pop()?.toLowerCase() ?? ''

  return (
    <div className={`artifact-card-row ${isActive ? 'artifact-card-row-active' : ''}`} onClick={onClick}>
      <div className="artifact-card-icon"><TypeIcon size={14} /></div>
      <div className="artifact-card-info">
        <div className="artifact-card-name">{artifact.path}</div>
        <div className="artifact-card-meta">{typeLabel}{ext ? ` · ${ext.toUpperCase()}` : ''}</div>
      </div>
      <span className="artifact-card-open"><ArrowRight size={12} /> 打开</span>
    </div>
  )
}

function artifactTypeUi(artifact: HandoffArtifactItem): {
  TypeIcon: typeof Code2
  typeLabel: string
} {
  if (artifact.type === 'code') return { TypeIcon: Code2, typeLabel: 'Code' }
  if (artifact.type === 'design') return { TypeIcon: PenTool, typeLabel: 'Design' }
  if (artifact.type === 'test') return { TypeIcon: Check, typeLabel: 'Test' }
  return { TypeIcon: FileQuestion, typeLabel: 'Other' }
}

function WorkflowSidePanel({
  run,
  selectedStep,
  selectedAgent,
  selectedExecution,
  handoff,
  activeTab,
  onTabChange,
  onOpenFile
}: {
  run: WorkflowRun
  selectedStep: WorkflowRunStep | undefined
  selectedAgent: AgentDefinition | null
  selectedExecution: WorkflowRun['steps'][number]['executions'][number] | null
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']> | null
  activeTab: 'files' | 'output'
  onTabChange: (tab: 'files' | 'output') => void
  onOpenFile: (path: string) => void
}): JSX.Element {
  const artifacts = handoff?.artifacts ?? []
  const outputLines = [
    `Run: ${run.runName || run.templateName}`,
    `Status: ${workflowRunStatusLabel(run.status)}`,
    `Step: ${selectedStep?.displayName || selectedStep?.role || selectedAgent?.name || 'No step selected'}`,
    `Agent: ${workflowStepRouteLabel(selectedAgent)}`,
    selectedExecution?.status ? `Execution: ${selectedExecution.status}` : '',
    selectedExecution?.error ? `Error: ${selectedExecution.error}` : '',
    handoff?.summary ? `Handoff: ${handoff.summary}` : ''
  ].filter(Boolean)

  return (
    <aside className="right-panel">
      <div className="right-panel-header">
        <span><PanelRight size={14} /> 详情</span>
        <div className="detail-tabs-inline">
          <button
            type="button"
            className={`detail-tab ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => onTabChange('files')}
          >
            文件
          </button>
          <button
            type="button"
            className={`detail-tab ${activeTab === 'output' ? 'active' : ''}`}
            onClick={() => onTabChange('output')}
          >
            输出
          </button>
        </div>
      </div>
      <div className="right-panel-body">
        {activeTab === 'files' ? (
          artifacts.length > 0 ? (
            <div className="workflow-side-files">
              {artifacts.map((artifact, index) => {
                const { TypeIcon, typeLabel } = artifactTypeUi(artifact)
                const fileName = artifact.path.split('/').pop() || artifact.path
                const fileMeta = artifact.description && artifact.description !== artifact.path
                  ? artifact.description
                  : artifact.path
                return (
                  <button
                    key={`${artifact.path}-${index}`}
                    type="button"
                    className="workflow-side-file"
                    onClick={() => onOpenFile(artifact.path)}
                  >
                    <span className="workflow-side-file-icon"><TypeIcon size={14} /></span>
                    <span className="workflow-side-file-info">
                      <span className="workflow-side-file-name">{fileName}</span>
                      <span className="workflow-side-file-path">{fileMeta}</span>
                    </span>
                    <span className={`workflow-side-file-meta workflow-side-file-meta-${artifact.type}`}>
                      {artifact.type || typeLabel}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="workflow-side-empty">
              当前步骤暂无 artifact。完成步骤或选择包含 handoff 的步骤后会显示文件。
            </div>
          )
        ) : (
          <pre className="code-block workflow-side-output">{outputLines.join('\n')}</pre>
        )}
      </div>
    </aside>
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
            {i > 0 && <span className="codex-breadcrumb-sep"> / </span>}
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

function workflowStepRouteLabel(agent: AgentDefinition | null): string {
  if (!agent) return 'Agent route unavailable'
  return [agent.name || agent.role || agent.vendor, agent.vendor, agent.model].filter(Boolean).join(' · ')
}
