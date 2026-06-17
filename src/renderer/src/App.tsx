/**
 * App.tsx — 应用根组件 / 顶层路由壳
 *
 * 职责：
 *  1. 初始化全局 hooks（agents、workflows、CLI 模型目录、单次运行状态）
 *  2. 检测并自动安装缺失的 CLI 工具（claude / codex）
 *  3. 根据当前 workspace mode 路由到对应面板：
 *     - workflow  → WorkflowWorkspace（多步骤工作流运行管理）
 *     - templates → TemplatesView（工作流模板 CRUD）
 *     - agents   → AgentManager（Agent 定义 CRUD）
 *     - single   → SingleRunPanel（单次 Agent 运行 + 实时对话）
 *  4. 渲染全局 UI 外壳（header、topbar chips、ModeRail 导航栏）
 */

import { useEffect, useState } from 'react'
import type { CliCheckResult } from '@shared/types'
import { useAgents } from './useAgents'
import { useCliModels } from './useCliModels'
import { useWorkflows } from './useWorkflows'
import { useSingleSessions } from './useSingleSessions'
import { AgentManager } from './AgentManager'
import { TemplatesView } from './TemplatesView'
import { UiReviewMockNav } from './UiReviewMockNav'
import { WorkflowWorkspace } from './WorkflowWorkspace'
import { ScheduleWorkspace } from './ScheduleWorkspace'
import { SingleRunPanel } from './SingleRunPanel'
import { ModeRail, type WorkspaceMode } from './ModeRail'
import { useUiReviewFixture } from './uiReviewFixture'
import { prepareWorkflowNotificationSound } from './workflowNotificationSound'
import { useAppSettings } from './useAppSettings'
import { SettingsPanel } from './SettingsPanel'
import { CliSetupDialog } from './CliSetupDialog'
import { Moon, Sun } from 'lucide-react'

type UiReviewWorkflowSurface = 'workflow' | 'new-run'

export function App(): JSX.Element {
  const { agents: savedAgents, save: saveAgent, remove: removeAgent } = useAgents()
  const { models: modelCatalog, loading: modelsLoading } = useCliModels()
  const savedWorkflows = useWorkflows()
  const singleSessions = useSingleSessions()
  const appSettings = useAppSettings()
  const uiReview = useUiReviewFixture()
  const agents = uiReview.enabled ? uiReview.agents : savedAgents
  const workflows = uiReview.enabled ? uiReview.workflows : savedWorkflows
  const [clis, setClis] = useState<CliCheckResult | null>(null)
  const [showCliSetup, setShowCliSetup] = useState(false)
  const [mode, setMode] = useState<WorkspaceMode>('workflow')
  const [uiReviewWorkflowSurface, setUiReviewWorkflowSurface] =
    useState<UiReviewWorkflowSurface>('workflow')
  const [workflowOpenRunId, setWorkflowOpenRunId] = useState<string | null>(null)
  const appearanceTheme = appSettings.settings.appearanceTheme

  useEffect(() => {
    (async () => {
      const result = await window.api.checkClis()
      setClis(result)
      if (!result.claude || !result.codex) {
        setShowCliSetup(true)
      }
    })()
  }, [])

  useEffect(() => {
    const prepareSound = () => prepareWorkflowNotificationSound()
    window.addEventListener('pointerdown', prepareSound, { once: true })
    window.addEventListener('keydown', prepareSound, { once: true })
    return () => {
      window.removeEventListener('pointerdown', prepareSound)
      window.removeEventListener('keydown', prepareSound)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = appearanceTheme
  }, [appearanceTheme])

  const isAgents = mode === 'agents'
  const isWorkflow = mode === 'workflow'
  const isSchedules = mode === 'schedules'
  const isTemplates = mode === 'templates'
  const isSingle = mode === 'single'
  const isSettings = mode === 'settings'
  const topbarChips = uiReview.enabled
    ? uiReview.topbarChips[mode]
    : buildTopbarChips(
        mode,
        workflows.runs.filter((r) => r.status === 'running').length,
        workflows.runs.filter((r) => r.status === 'awaiting-confirm' || r.status === 'awaiting-input').length,
        workflows.templates.length,
        agents.length,
        singleSessions.sessions.length,
        !!singleSessions.selectedSession?.running,
        appearanceTheme
      )

  const subtitle = (): string => {
    switch (mode) {
      case 'agents':
        return '智能体管理'
      case 'templates':
        return '模板编辑'
      case 'workflow':
        return uiReview.enabled && uiReviewWorkflowSurface === 'new-run'
          ? '工作流 · 新建运行'
          : '工作流'
      case 'schedules':
        return '定时任务'
      case 'single':
        return '单次对话'
      case 'settings':
        return '系统设置'
    }
  }

  const toggleTheme = (): void => {
    const nextTheme = appearanceTheme === 'dark' ? 'light' : 'dark'
    void appSettings.save({ ...appSettings.settings, appearanceTheme: nextTheme })
  }

  return (
    <div className={['app', uiReview.enabled ? 'app-ui-review' : ''].filter(Boolean).join(' ')}>
      <div className="chinese-pattern-bg" />
      <div className="ink-wash ink-wash-1" />
      <div className="ink-wash ink-wash-2" />
      <div className="tech-grid-bg" />
      <div className="tech-glow tech-glow-1" />
      <div className="tech-glow tech-glow-2" />
      {showCliSetup && (
        <CliSetupDialog onDone={async () => {
          setShowCliSetup(false)
          const updated = await window.api.checkClis()
          setClis(updated)
        }} />
      )}
      <header className="app-header">
        <div className="app-brand">
          <h1>Nexture AI</h1>
          <span className="app-subtitle">{subtitle()}</span>
        </div>
        <div className="topbar-actions">
          <div className="topbar-chips" aria-label="Workspace summary">
            {topbarChips.map((chip) => (
              <span className="topbar-chip" key={chip}>{chip}</span>
            ))}
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            disabled={appSettings.loading}
            title={appearanceTheme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
            aria-label={appearanceTheme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
          >
            {appearanceTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            <span>{appearanceTheme === 'dark' ? '亮' : '暗'}</span>
          </button>
        </div>
      </header>

      <div
        className={[
          'app-body',
          isAgents || isTemplates || isSettings ? 'app-body-agents' : '',
          isWorkflow || isSchedules ? 'app-body-workflow' : '',
          isSingle ? 'app-body-single' : ''
        ].filter(Boolean).join(' ')}
      >
        <ModeRail mode={mode} onModeChange={setMode} />

        {isAgents ? (
          <div className="panel agent-page">
            <AgentManager
              agents={agents}
              clis={clis}
              modelCatalog={modelCatalog}
              onSave={saveAgent}
              onDelete={removeAgent}
              onClose={() => setMode('workflow')}
            />
          </div>
        ) : isTemplates ? (
          <div className="panel templates-page">
            <TemplatesView
              agents={agents}
              templates={workflows.templates}
              onSave={workflows.save}
              onDelete={workflows.remove}
            />
          </div>
        ) : isWorkflow ? (
          <main className="panel panel-runtime panel-runtime-workflow">
            <WorkflowWorkspace
              agents={agents}
              workflows={workflows}
              newRunDefaults={uiReview.enabled ? uiReview.newRunDefaults : undefined}
              uiReviewEnabled={uiReview.enabled}
              onUiReviewSurfaceChange={setUiReviewWorkflowSurface}
              openRunId={workflowOpenRunId}
              onOpenRunConsumed={() => setWorkflowOpenRunId(null)}
              showMemoryReferences={appSettings.settings.showMemoryReferences}
            />
          </main>
        ) : isSchedules ? (
          <main className="panel panel-runtime panel-runtime-workflow">
          <ScheduleWorkspace
            templates={workflows.templates}
            runs={workflows.runs}
            scheduleState={uiReview.enabled ? uiReview.schedules : undefined}
            onOpenRun={(runId) => {
              setWorkflowOpenRunId(runId)
              setMode('workflow')
            }}
            />
          </main>
        ) : isSettings ? (
          <div className="panel settings-page">
            <SettingsPanel
              settings={appSettings.settings}
              loading={appSettings.loading}
              onSave={appSettings.save}
            />
          </div>
        ) : (
          <SingleRunPanel
            agents={agents}
            clis={clis}
            modelCatalog={modelCatalog}
            modelsLoading={modelsLoading}
            sessions={singleSessions.sessions}
            selectedSession={singleSessions.selectedSession}
            selectedSessionId={singleSessions.selectedSessionId}
            onCreateSession={singleSessions.createSession}
            onSelectSession={singleSessions.selectSession}
            onSendMessage={singleSessions.sendMessage}
            onAbortSession={singleSessions.abortSession}
            onDeleteSession={singleSessions.deleteSession}
            onModeAgents={() => setMode('agents')}
            showMemoryReferences={appSettings.settings.showMemoryReferences}
          />
        )}
      </div>

      {uiReview.enabled && mode !== 'workflow' && <UiReviewMockNav active={mode} />}
    </div>
  )
}

function buildTopbarChips(
  mode: WorkspaceMode,
  runningCount: number,
  waitingCount: number,
  templateCount: number,
  agentCount: number,
  singleSessionCount: number,
  singleRunning: boolean,
  appearanceTheme: string
): string[] {
  switch (mode) {
    case 'workflow':
      return [`${runningCount} 运行中`, `${waitingCount} 待处理`, `${templateCount} 模板`, `${agentCount} 智能体`]
    case 'schedules':
      return ['定时任务', '后台执行', `${templateCount} 模板`]
    case 'templates':
      return [`${templateCount} 模板`, 'DAG 画布', `${agentCount} 智能体`]
    case 'agents':
      return [`${agentCount} 智能体`, 'Claude · Codex · API', '模板可复用']
    case 'single':
      return [`${singleSessionCount} 会话`, singleRunning ? '1 运行中' : '就绪', '连续对话']
    case 'settings':
      return [appearanceTheme === 'dark' ? '暗色主题' : '亮色主题', '本地存储']
  }
}
