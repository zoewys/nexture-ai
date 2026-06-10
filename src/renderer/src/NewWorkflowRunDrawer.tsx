/**
 * NewWorkflowRunDrawer.tsx — 新建工作流运行抽屉
 *
 * 从右侧滑出的抽屉面板，用于启动一次新的 workflow run：
 *  - 选择 workflow 模板
 *  - 填写项目路径（带 Browse 按钮）
 *  - 输入初始 prompt
 *  - Git 安全检测提示（同 worktree 冲突警告）
 *  - 启动按钮
 */

import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDefinition,
  WorkflowRunGitSafety,
  WorkflowStartInput,
  WorkflowTemplate
} from '@shared/types'
import { FolderOpen } from 'lucide-react'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'
import { Select } from './Select'


export interface NewWorkflowRunDefaults {
  initialRunName?: string
  initialProjectPath?: string
  initialPrompt?: string
}

interface NewWorkflowRunDrawerProps {
  agents: AgentDefinition[]
  templates: WorkflowTemplate[]
  onStart: (input: WorkflowStartInput) => Promise<unknown>
  onInspectGitSafety: (projectPath: string) => Promise<WorkflowRunGitSafety>
  runningRunCount: number
  newRunDefaults?: NewWorkflowRunDefaults
  uiReviewEnabled?: boolean
  onClose: () => void
}

export function NewWorkflowRunDrawer({
  agents,
  templates,
  onStart,
  onInspectGitSafety,
  runningRunCount,
  newRunDefaults,
  uiReviewEnabled = false,
  onClose
}: NewWorkflowRunDrawerProps): JSX.Element {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [runName, setRunName] = useState(newRunDefaults?.initialRunName ?? '')
  const [projectPath, setProjectPath] = useState(
    () => newRunDefaults?.initialProjectPath ?? readLastProjectPath()
  )
  const [initialPrompt, setInitialPrompt] = useState(newRunDefaults?.initialPrompt ?? '')
  const [safety, setSafety] = useState<WorkflowRunGitSafety | null>(null)
  const [allowUnsafeSameGitRoot, setAllowUnsafeSameGitRoot] = useState(false)
  const [allowHighConcurrency, setAllowHighConcurrency] = useState(false)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates]
  )
  const previewSteps = selectedTemplate?.steps.slice(0, 5) ?? []
  const gitRoot = gitRootDisplay(projectPath, safety)
  const worktree = worktreeDisplay(projectPath, safety)

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id)
  }, [templateId, templates])

  useEffect(() => {
    if (!projectPath.trim()) {
      setSafety(null)
      return
    }
    let cancelled = false
    onInspectGitSafety(projectPath.trim())
      .then((next) => {
        if (!cancelled) setSafety(next)
      })
      .catch(() => {
        if (!cancelled) setSafety(null)
      })
    return () => {
      cancelled = true
    }
  }, [onInspectGitSafety, projectPath])

  const canStart =
    !!selectedTemplate &&
    projectPath.trim() !== '' &&
    initialPrompt.trim() !== '' &&
    (safety?.level !== 'requires-confirmation' || allowUnsafeSameGitRoot) &&
    (runningRunCount < 5 || allowHighConcurrency)

  const start = async (): Promise<void> => {
    if (!selectedTemplate || !canStart) return
    if (!uiReviewEnabled) rememberProjectPath(projectPath.trim())
    await onStart({
      templateId: selectedTemplate.id,
      runName: runName.trim() || selectedTemplate.name,
      projectPath: projectPath.trim(),
      initialPrompt: initialPrompt.trim(),
      allowUnsafeSameGitRoot
    })
    onClose()
  }

  const saveDraft = (): void => {
    if (!uiReviewEnabled) rememberProjectPath(projectPath.trim())
  }

  const pickDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) setProjectPath(dir)
  }

  return (
    <aside className="workflow-new-run-drawer" aria-label="New Workflow Task">
      <div className="workflow-new-run-header">
        <div>
          <strong>New Workflow Task</strong>
          <span>从模板启动一个新的任务实例</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>

      <div className="workflow-new-run-body">
        <label className="field">
          <span>Template</span>
          <Select value={templateId} onChange={setTemplateId}>
            {templates.map((template) => (
              <Select.Item key={template.id} value={template.id}>{formatTemplateOption(template)}</Select.Item>
            ))}
          </Select>
        </label>

        <label className="field">
          <span>Run Name</span>
          <input
            value={runName}
            placeholder={selectedTemplate?.name ?? 'Run name'}
            onChange={(event) => setRunName(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Project Directory</span>
          <div className="field-row">
            <input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
            {!uiReviewEnabled && (
              <button type="button" onClick={pickDir}><FolderOpen size={14} /> Browse</button>
            )}
          </div>
        </label>

        <div className="workflow-new-run-split">
          <label className="field">
            <span>Git Root</span>
            <input value={gitRoot} readOnly />
          </label>
          <label className="field">
            <span>Worktree</span>
            <input value={worktree} readOnly />
          </label>
        </div>

        {safety?.message && (
          <div className={`workflow-git-safety workflow-git-safety-${safety.level}`}>
            {safety.message}
          </div>
        )}

        {safety?.level === 'requires-confirmation' && (
          <label className="workflow-confirm-unsafe">
            <input
              type="checkbox"
              checked={allowUnsafeSameGitRoot}
              onChange={(event) => setAllowUnsafeSameGitRoot(event.target.checked)}
            />
            <span>仍然启动</span>
          </label>
        )}

        {runningRunCount >= 3 && (
          <div className="workflow-git-safety workflow-git-safety-warning">
            当前已有 {runningRunCount} 个 workflow 正在运行，继续启动可能增加 CPU、内存和 CLI 限流压力。
          </div>
        )}

        {runningRunCount >= 5 && (
          <label className="workflow-confirm-unsafe">
            <input
              type="checkbox"
              checked={allowHighConcurrency}
              onChange={(event) => setAllowHighConcurrency(event.target.checked)}
            />
            <span>确认超过 5 个 workflow 同时运行</span>
          </label>
        )}

        <label className="field">
          <span>Task Prompt</span>
          <textarea value={initialPrompt} onChange={(event) => setInitialPrompt(event.target.value)} />
        </label>

        <div className="workflow-template-preview">
          <div className="field-row field-row-between">
            <strong>Workflow Template</strong>
            <span>
              {uiReviewEnabled ? selectedTemplate?.name : `${selectedTemplate?.steps.length ?? 0} steps`}
            </span>
          </div>
          <div className="workflow-template-preview-pills">
            {previewSteps.map((step, index) => (
              <span className="pill-small" key={`${step.agentId}-${index}`}>
                {index + 1} {step.role || agentPreviewName(step.agentId, agents)}
              </span>
            ))}
            {(selectedTemplate?.steps.length ?? 0) > previewSteps.length && (
              <span className="pill-small">
                ... {selectedTemplate?.steps.length ?? 0} 收尾
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="workflow-new-run-actions">
        <button type="button" onClick={saveDraft}>Save Draft</button>
        <button type="button" className="primary" disabled={!canStart} onClick={start}>
          Start Run
        </button>
      </div>
    </aside>
  )
}

function formatTemplateOption(template: WorkflowTemplate): string {
  return `${template.name} · ${template.steps.length} steps`
}

function gitRootDisplay(projectPath: string, safety: WorkflowRunGitSafety | null): string {
  if (!projectPath.trim()) return ''
  if (!safety) return 'Inspecting...'
  return safety.gitRoot ?? 'No git root detected'
}

function worktreeDisplay(projectPath: string, safety: WorkflowRunGitSafety | null): string {
  if (!projectPath.trim()) return ''
  if (!safety) return 'Inspecting...'
  if (!safety.isGitRepo) return 'Not a git repository'
  if (safety.branch) return safety.branch
  return safety.isLinkedWorktree ? 'linked worktree' : 'main working tree'
}

function agentPreviewName(agentId: string, agents: AgentDefinition[]): string {
  const agent = agents.find((item) => item.id === agentId)
  return agent?.role || agent?.name || 'Step'
}
