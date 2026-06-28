import { useMemo, useState } from 'react'
import { isParallelGroup } from '@shared/types'
import type {
  AgentDefinition,
  AgentEvent,
  WorkflowRun,
  WorkflowSchedule,
  WorkflowRunGitSafety,
  WorkflowStartInput,
  WorkflowTemplate
} from '@shared/types'
import { sortWorkflowRunsByStartedAt } from './workflowRunView'
import type { NewWorkflowRunDefaults } from './NewWorkflowRunDrawer'
import type { WorkflowDraft, UseWorkflowsResult } from './useWorkflows'
import type { ScheduleDraft, UseSchedulesResult } from './useSchedules'

const UI_REVIEW_QUERY = 'uiReview=v4'
const REVIEW_PROJECT_PATH = '/Users/siyuan/work/app-a'
export const canvasPreviewLabels = ['需求', '设计', '开发', '测试']

type UiReviewMode = 'workflow' | 'schedules' | 'templates' | 'agents' | 'single' | 'settings'

export interface UiReviewFixture {
  enabled: boolean
  agents: AgentDefinition[]
  workflows: UseWorkflowsResult
  schedules: UseSchedulesResult
  topbarChips: Record<UiReviewMode, string[]>
  newRunDefaults: NewWorkflowRunDefaults
}

const devFlowStepAgents: AgentDefinition[] = [
  agent('agent-pm-analyst', '需求澄清', 'PM Analyst', 'claude'),
  agent('agent-ux-architect', '信息架构', 'UX Architect', 'claude'),
  agent('agent-ui-designer', 'UI Mockup', 'UI Designer', 'claude'),
  agent('agent-senior-engineer', '技术方案', 'Senior Engineer', 'codex'),
  agent('agent-developer', '开发实现', 'Developer', 'codex'),
  agent('agent-qa-verifier', '浏览器验证', 'QA Verifier', 'codex'),
  agent('agent-frontend-qa', '移动端适配', 'Frontend QA', 'codex'),
  agent('agent-test-agent', '回归测试', 'Test Agent', 'codex'),
  agent('agent-release', '提交整理', 'Release Agent', 'codex'),
  agent('agent-doc', '文档更新', 'Doc Agent', 'claude')
]

const devFlowStepDisplayNames = [
  '需求澄清',
  '信息架构',
  'UI Mockup',
  '技术方案',
  '开发实现',
  '浏览器验证',
  '移动端适配',
  '回归测试',
  '修复反馈',
  '最终验收',
  '提交整理',
  '文档更新',
  '总结沉淀',
  '收尾检查'
]

const agents: AgentDefinition[] = devFlowStepAgents

const templates: WorkflowTemplate[] = [
  {
    id: 'template-dev-flow',
    name: 'auth-refactor-pipeline',
    description: '认证模块重构流水线',
    steps: [
      {
        parallel: [
          { agentId: 'agent-pm-analyst', role: 'Analyze' },
          { agentId: 'agent-test-agent', role: 'Generate Tests' }
        ],
        join: true
      },
      { agentId: 'agent-developer', role: 'Refactor' },
      { agentId: 'agent-qa-verifier', role: 'Review' },
      ...devFlowStepAgents
        .filter((item) => ![
          'agent-pm-analyst',
          'agent-test-agent',
          'agent-developer',
          'agent-qa-verifier'
        ].includes(item.id))
        .map((item) => ({ agentId: item.id }))
    ]
  },
  {
    id: 'template-fix-bug-flow',
    name: 'dependency-update',
    description: '依赖更新与测试',
    steps: [
      'agent-qa-verifier',
      'agent-senior-engineer',
      'agent-test-agent'
    ].map((agentId) => ({ agentId }))
  },
  {
    id: 'template-feature-branch-workflow',
    name: 'feature-branch-workflow',
    description: '新功能分支工作流',
    steps: [
      'agent-pm-analyst',
      'agent-ui-designer',
      'agent-developer',
      'agent-qa-verifier'
    ].map((agentId) => ({ agentId }))
  },
  {
    id: 'template-docs-sync',
    name: 'docs-sync',
    description: '文档同步',
    steps: ['agent-doc', 'agent-release'].map((agentId) => ({ agentId }))
  }
]

const topbarChips: UiReviewFixture['topbarChips'] = {
  workflow: ['3 running', '1 input', '2 waiting', 'sound per run'],
  schedules: ['5 schedules', '4 enabled', '1 paused'],
  templates: ['4 模板', 'node canvas', 'branch flow'],
  agents: ['9 agents', '2 CLIs', 'templates linked'],
  single: ['single run', 'follow-up', 'transcript'],
  settings: ['memory references', 'local storage']
}

const newRunDefaults: NewWorkflowRunDefaults = {
  initialRunName: 'Todo App · Dev Flow',
  initialProjectPath: REVIEW_PROJECT_PATH,
  initialPrompt: '开发一个 Web Todo List，支持新增、编辑、删除、完成状态切换和筛选。'
}

export function useUiReviewFixture(): UiReviewFixture {
  const enabled = isUiReviewEnabled()
  const [runs, setRuns] = useState<WorkflowRun[]>(() => sortWorkflowRunsByStartedAt(createRuns()))
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>(() => createSchedules())
  const [selectedRunId, setSelectedRunId] = useState<string | null>('run-todo-dev-flow')

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId]
  )

  const workflows = useMemo<UseWorkflowsResult>(() => {
    const applyRun = (updated: WorkflowRun): void => {
      setRuns((current) =>
        sortWorkflowRunsByStartedAt([updated, ...current.filter((run) => run.id !== updated.id)])
      )
      setSelectedRunId(updated.id)
    }

    return {
      templates,
      runs,
      selectedRun,
      selectedRunId,
      currentRun: selectedRun,
      selectRun: setSelectedRunId,
      reload: async () => {},
      reloadRuns: async () => {},
      save: async (draft: WorkflowDraft) => {
        return {
          id: draft.id ?? `template-review-${Date.now()}`,
          name: draft.name,
          description: draft.description,
          steps: draft.steps
        }
      },
      remove: async () => {},
      start: async (input: WorkflowStartInput) => {
        const template = templates.find((item) => item.id === input.templateId) ?? templates[0]
        const run = createRun({
          id: `run-review-${Date.now()}`,
          template,
          runName: input.runName || template.name,
          projectPath: input.projectPath,
          status: 'running',
          currentStepIndex: 0,
          startedAt: Date.now(),
          stepStatuses: ['running'],
          tailEvents: [{ kind: 'system', text: 'workflow run started from UI review fixture' }]
        })
        applyRun(run)
        return run
      },
      confirmStep: async () => {},
      finishInteractiveStep: async () => {},
      rerunStep: async () => {},
      abort: async () => {},
      pushInput: async () => {},
      skipStep: async () => {},
      updatePrompt: async () => {},
      deleteRun: async (runId: string) => {
        setRuns((current) => current.filter((run) => run.id !== runId))
        setSelectedRunId((current) => (current === runId ? runs[0]?.id ?? null : current))
      },
      inspectGitSafety: async (projectPath: string): Promise<WorkflowRunGitSafety> => ({
        projectPath,
        gitRoot: '/Users/siyuan/work',
        commonGitDir: '/Users/siyuan/work/.git',
        branch: 'feature/todo-ui',
        isGitRepo: true,
        isLinkedWorktree: true,
        sameWorkingTreeRunIds: [],
        relatedWorktreeRunIds: ['run-bookmark-test'],
        conflictingRunIds: ['run-bookmark-test'],
        level: 'warning',
        message:
          '已检测到同 Git root 下有 1 个 workflow 正在运行。当前目录是 worktree：允许继续；如果不是 worktree，需要点击“仍然启动”。'
      }),
      clearRun: () => setSelectedRunId(null)
    }
  }, [runs, selectedRun, selectedRunId])

  const scheduleState = useMemo<UseSchedulesResult>(() => {
    const sort = (items: WorkflowSchedule[]): WorkflowSchedule[] =>
      [...items].sort((a, b) => b.createdAt - a.createdAt)

    return {
      schedules,
      loading: false,
      save: async (input: ScheduleDraft) => {
        const saved: WorkflowSchedule = {
          ...input,
          id: input.id ?? `schedule-review-${Date.now()}`,
          createdAt: input.createdAt ?? Date.now()
        }
        setSchedules((current) => sort([saved, ...current.filter((item) => item.id !== saved.id)]))
        return saved
      },
      remove: async (id: string) => {
        setSchedules((current) => current.filter((item) => item.id !== id))
      },
      toggle: async (id: string, enabled: boolean) => {
        const currentSchedule = schedules.find((item) => item.id === id)
        if (!currentSchedule) throw new Error('Schedule not found')
        const saved = { ...currentSchedule, enabled }
        setSchedules((current) =>
          sort(current.map((item) => (item.id === id ? saved : item)))
        )
        return saved
      },
      refresh: async () => {}
    }
  }, [schedules])

  return {
    enabled,
    agents,
    workflows,
    schedules: scheduleState,
    topbarChips,
    newRunDefaults
  }
}

function isUiReviewEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.search.includes(UI_REVIEW_QUERY)
}

function agent(
  id: string,
  name: string,
  role: string,
  vendor: AgentDefinition['vendor']
): AgentDefinition {
  return {
    id,
    name,
    role,
    vendor,
    model: vendor === 'codex' ? 'gpt-5-codex-high' : 'claude-sonnet-4.5',
    systemPrompt:
      'Read upstream handoff, execute the assigned workflow step, verify the result, and output structured handoff JSON.',
    permissionMode: 'bypassPermissions'
  }
}

function createRuns(): WorkflowRun[] {
  return [
    createRun({
      id: 'run-todo-dev-flow',
      template: templates[0],
      runName: 'Todo App · Dev Flow',
      projectPath: REVIEW_PROJECT_PATH,
      status: 'awaiting-confirm',
      currentStepIndex: 4,
      startedAt: fixedTime(14, 21),
      displayPath: '/Users/siyuan/work/app-a · worktree: feature/todo-ui · started 14:21',
      listMeta: '14:21 · /work/app-a · worktree feature/todo-ui',
      tailLines: ['assistant: CRUD done', 'handoff ready · waiting for confirm'],
      stepStatuses: ['done', 'done', 'done', 'done', 'awaiting-confirm'],
      tailEvents: todoEvents(),
      gitSafetyMessage:
        '⚠ 与另一个 run 使用相同 Git root。当前目录是 git worktree，允许继续；如果不是 worktree，启动时会要求二次确认。',
      handoff: {
        summary: '已完成 Todo List CRUD 页面，等待浏览器验证。',
        artifacts: [
          { path: 'src/App.tsx', description: 'Todo List 页面与交互状态', type: 'code' },
          { path: 'src/styles.css', description: '列表、筛选和编辑态样式', type: 'code' },
          { path: 'docs/todo-flow.md', description: '需求与验收说明', type: 'requirement' },
          { path: 'tests/todo-ui.test.ts', description: '基础交互测试计划', type: 'test' }
        ],
        nextStepGuidance: 'run browser verification and edge case tests'
      }
    }),
    createRun({
      id: 'run-bookmark-test',
      template: templates[0],
      runName: 'Bookmark Manager · Test',
      projectPath: '/Users/siyuan/work/bookmarks',
      scheduledBy: 'schedule-bookmark-regression',
      status: 'running',
      currentStepIndex: 1,
      startedAt: fixedTime(14, 12),
      listMeta: '14:12 · /work/bookmarks · branch test-cases',
      tailLines: ['tool: npm test', 'browser: screenshot captured'],
      stepStatuses: ['done', 'running'],
      tailEvents: [
        { kind: 'tool-call', id: 'bookmark-tool', name: 'npm test', input: {} },
        { kind: 'system', text: 'browser: screenshot captured' }
      ]
    }),
    createRun({
      id: 'run-agent-studio-icons',
      template: templates[1],
      runName: 'Agent Studio · Fix Icons',
      projectPath: '/Users/siyuan/work/agent-studio',
      status: 'awaiting-input',
      currentStepIndex: 1,
      startedAt: fixedTime(13, 58),
      listMeta: '13:58 · /work/agent-studio · same repo warning',
      tailLines: ['assistant: 需要确认图标密度', 'agent awaiting reply'],
      stepStatuses: ['done', 'awaiting-input'],
      tailEvents: [
        { kind: 'message', role: 'assistant', text: '图标 rail 已初步整理。请确认是否保留当前 24px 密度，还是压缩到 20px？' },
        { kind: 'turn-done', sessionId: 'run-agent-studio-icons-session-2', reason: 'complete' }
      ]
    }),
    createRun({
      id: 'run-landing-research',
      template: templates[0],
      runName: 'Landing Page · Research',
      projectPath: '/Users/siyuan/work/landing',
      scheduledBy: 'schedule-nightly-qa',
      status: 'completed',
      currentStepIndex: 13,
      startedAt: fixedTime(13, 7),
      finishedAt: fixedTime(13, 44),
      listMeta: '13:20 · /work/sites/landing · completed 18m',
      tailLines: ['summary: landing page completed', 'tests passed · ready for review'],
      stepStatuses: Array.from({ length: 14 }, () => 'done'),
      tailEvents: [
        { kind: 'message', role: 'assistant', text: 'research summary delivered' },
        { kind: 'system', text: 'final handoff archived' }
      ]
    }),
    createRun({
      id: 'run-icon-qa-visual',
      template: templates[1],
      runName: 'Icon QA · Visual',
      projectPath: '/Users/siyuan/work/agent-studio',
      scheduledBy: 'schedule-icon-qa',
      status: 'error',
      currentStepIndex: 3,
      startedAt: fixedTime(12, 48),
      finishedAt: fixedTime(12, 55),
      listMeta: '12:48 · /work/agent-studio · failed at step 4',
      tailLines: ['error: screenshot mismatch', 'next: inspect collapsed rail icons'],
      stepStatuses: ['done', 'done', 'error'],
      tailEvents: [
        { kind: 'error', recoverable: true, message: 'screenshot mismatch' },
        { kind: 'system', text: 'next: inspect collapsed rail icons' }
      ]
    })
  ]
}

function createSchedules(): WorkflowSchedule[] {
  const schedules: WorkflowSchedule[] = [
    {
      id: 'schedule-nightly-qa',
      templateId: 'template-dev-flow',
      name: 'Nightly QA Sweep',
      cron: '0 21 * * 1-5',
      enabled: true,
      projectPath: '/Users/siyuan/work/landing',
      initialPrompt: '每天晚上跑一轮 landing 页面研发工作流并输出浏览器验证摘要。',
      createdAt: fixedTime(8, 30),
      lastTriggeredAt: fixedTime(13, 44),
      lastRunId: 'run-landing-research',
      lastRunStatus: 'completed'
    },
    {
      id: 'schedule-bookmark-regression',
      templateId: 'template-dev-flow',
      name: 'Bookmark Regression',
      cron: '*/30 9-18 * * 1-5',
      enabled: true,
      projectPath: '/Users/siyuan/work/bookmarks',
      initialPrompt: '检查 bookmark manager 的核心交互和测试结果。',
      createdAt: fixedTime(8, 10),
      lastTriggeredAt: fixedTime(14, 12),
      lastRunId: 'run-bookmark-test',
      lastRunStatus: 'running'
    },
    {
      id: 'schedule-icon-qa',
      templateId: 'template-fix-bug-flow',
      name: 'Icon QA Visual',
      cron: '15 10 * * 2,4',
      enabled: true,
      projectPath: '/Users/siyuan/work/agent-studio',
      initialPrompt: '验证 UI 图标、状态徽标和暗色主题视觉一致性。',
      createdAt: fixedTime(7, 55),
      lastTriggeredAt: fixedTime(12, 55),
      lastRunId: 'run-icon-qa-visual',
      lastRunStatus: 'error'
    },
    {
      id: 'schedule-docs-sync',
      templateId: 'template-docs-sync',
      name: 'Docs Sync',
      cron: '0 17 * * 5',
      enabled: true,
      projectPath: '/Users/siyuan/work/docs',
      initialPrompt: '同步本周变更到文档，并整理缺口清单。',
      createdAt: fixedTime(7, 20)
    },
    {
      id: 'schedule-dependency-audit',
      templateId: 'template-fix-bug-flow',
      name: 'Dependency Audit',
      cron: '0 9 1 * *',
      enabled: false,
      projectPath: '/Users/siyuan/work/agent-studio',
      initialPrompt: '审计依赖更新风险并生成测试计划。',
      createdAt: fixedTime(7, 0)
    }
  ]
  return schedules.sort((a, b) => b.createdAt - a.createdAt)
}

function createRun({
  id,
  template,
  runName,
  projectPath,
  scheduledBy,
  status,
  currentStepIndex,
  startedAt,
  finishedAt,
  displayPath,
  listMeta,
  tailLines,
  stepStatuses,
  tailEvents,
  gitSafetyMessage,
  handoff
}: {
  id: string
  template: WorkflowTemplate
  runName: string
  projectPath: string
  scheduledBy?: string
  status: WorkflowRun['status']
  currentStepIndex: number
  startedAt: number
  finishedAt?: number
  displayPath?: string
  listMeta?: string
  tailLines?: string[]
  stepStatuses: WorkflowRun['steps'][number]['status'][]
  tailEvents: AgentEvent[]
  gitSafetyMessage?: string
  handoff?: WorkflowRun['steps'][number]['executions'][number]['handoff']
}): WorkflowRun {
  const initialPrompt = newRunDefaults.initialPrompt ?? ''
  const stepDisplayNames = template.id === 'template-dev-flow' ? devFlowStepDisplayNames : []
  const run: WorkflowRun & {
    displayPath?: string
    gitSafetyMessage?: string
    listMeta?: string
    tailLines?: string[]
  } = {
    id,
    templateId: template.id,
    templateName: template.name,
    runName,
    projectPath,
    scheduledBy,
    initialPrompt,
    status,
    currentStepIndex,
    startedAt,
    finishedAt,
    totalInputTokens: stepStatuses.reduce((sum, _, i) => sum + (i <= currentStepIndex ? (i + 1) * 5000 : 0), 0),
    totalOutputTokens: stepStatuses.reduce((sum, _, i) => sum + (i <= currentStepIndex ? (i + 1) * 1200 : 0), 0),
    totalCostUsd: stepStatuses.reduce((sum, _, i) => sum + (i <= currentStepIndex ? (i + 1) * 0.15 : 0), 0),
    steps: template.steps.map((step, index) => {
      const stepStatus = stepStatuses[index] ?? 'pending'
      const stepAgentId = isParallelGroup(step) ? 'parallel-group' : step.agentId
      const agent = isParallelGroup(step)
        ? agents.find((item) => item.id === step.parallel[0]?.agentId)
        : agents.find((item) => item.id === step.agentId)
      return {
        agentId: stepAgentId,
        displayName: stepDisplayNames[index],
        vendor: agent?.vendor,
        model: agent?.model?.trim() || undefined,
        apiProviderId: agent?.apiProviderId,
        status: stepStatus,
        executions:
          stepStatus === 'pending'
            ? []
            : [
                {
                  id: `${id}-step-${index + 1}`,
                  stepIndex: index,
                  agentId: stepAgentId,
                  status: stepStatus,
                  sessionId: `${id}-session-${index + 1}`,
                  runId: id,
                  startedAt: startedAt + index * 60_000,
                  finishedAt: stepStatus === 'running' ? undefined : startedAt + (index + 1) * 60_000,
                  handoff: index === currentStepIndex ? handoff : undefined,
                  events: index === currentStepIndex ? tailEvents : completedStepEvents(index),
                  error: stepStatus === 'error' ? 'screenshot mismatch' : undefined,
                  totalInputTokens: index <= currentStepIndex ? (index + 1) * 5000 : 0,
                  totalOutputTokens: index <= currentStepIndex ? (index + 1) * 1200 : 0,
                  totalCostUsd: index <= currentStepIndex ? (index + 1) * 0.15 : 0
                }
              ]
      }
    })
  }
  if (displayPath) run.displayPath = displayPath
  if (gitSafetyMessage) run.gitSafetyMessage = gitSafetyMessage
  if (listMeta) run.listMeta = listMeta
  if (tailLines) run.tailLines = tailLines
  return run
}

function todoEvents(): AgentEvent[] {
  return [
    { kind: 'system', text: 'system: developer agent finished current turn' },
    {
      kind: 'message',
      role: 'assistant',
      text: '已完成 Todo List CRUD 页面，包含新增、编辑、删除、筛选与本地状态保存。'
    },
    { kind: 'tool-call', id: 'todo-tool', name: 'modified src/App.tsx, src/styles.css', input: {} },
    {
      kind: 'message',
      role: 'assistant',
      text: 'Handoff JSON parsed successfully. Waiting for user confirmation before browser verification.'
    },
    { kind: 'system', text: 'handoff: 4 artifacts · next step: run browser verification and edge case tests' }
  ]
}

function completedStepEvents(index: number): AgentEvent[] {
  return [
    { kind: 'system', text: `step ${index + 1} completed` },
    { kind: 'message', role: 'assistant', text: 'handoff ready' }
  ]
}

function fixedTime(hour: number, minute: number): number {
  return new Date(2026, 5, 6, hour, minute, 0, 0).getTime()
}
