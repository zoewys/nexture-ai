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
import { useRun } from './useRun'
import { useAgents } from './useAgents'
import { useCliModels } from './useCliModels'
import { useWorkflows } from './useWorkflows'
import { AgentManager } from './AgentManager'
import { TemplatesView } from './TemplatesView'
import { UiReviewMockNav } from './UiReviewMockNav'
import { WorkflowWorkspace } from './WorkflowWorkspace'
import { SingleRunPanel } from './SingleRunPanel'
import { ModeRail, type WorkspaceMode } from './ModeRail'
import { useUiReviewFixture } from './uiReviewFixture'
import { prepareWorkflowNotificationSound } from './workflowNotificationSound'
import { useAppSettings } from './useAppSettings'
import { SettingsPanel } from './SettingsPanel'

type UiReviewWorkflowSurface = 'workflow' | 'new-run'

export function App(): JSX.Element {
  const run = useRun()
  const { agents: savedAgents, save: saveAgent, remove: removeAgent } = useAgents()
  const { models: modelCatalog, loading: modelsLoading } = useCliModels()
  const savedWorkflows = useWorkflows()
  const appSettings = useAppSettings()
  const uiReview = useUiReviewFixture()
  const agents = uiReview.enabled ? uiReview.agents : savedAgents
  const workflows = uiReview.enabled ? uiReview.workflows : savedWorkflows
  const [clis, setClis] = useState<CliCheckResult | null>(null)
  const [mode, setMode] = useState<WorkspaceMode>('workflow')
  const [configOpen, setConfigOpen] = useState(true)
  const [uiReviewWorkflowSurface, setUiReviewWorkflowSurface] =
    useState<UiReviewWorkflowSurface>('workflow')

  useEffect(() => {
    (async () => {
      const result = await window.api.checkClis()
      setClis(result)
      for (const cli of ['claude', 'codex'] as const) {
        if (!result[cli]) {
          await window.api.installCli(cli)
        }
      }
      const updated = await window.api.checkClis()
      setClis(updated)
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

  const isAgents = mode === 'agents'
  const isWorkflow = mode === 'workflow'
  const isTemplates = mode === 'templates'
  const isSettings = mode === 'settings'
  const topbarChips = uiReview.enabled
    ? uiReview.topbarChips[mode]
    : buildTopbarChips(
        mode,
        workflows.runs.filter((r) => r.status === 'running').length,
        workflows.runs.filter((r) => r.status === 'awaiting-confirm').length,
        workflows.templates.length,
        agents.length
      )

  const subtitle = (): string => {
    switch (mode) {
      case 'agents':
        return 'Agents'
      case 'templates':
        return 'Templates'
      case 'workflow':
        return uiReview.enabled && uiReviewWorkflowSurface === 'new-run'
          ? 'Workflow · New Run Drawer'
          : 'Workflow'
      case 'single':
        return 'Single Agent'
      case 'settings':
        return 'Settings'
    }
  }

  return (
    <div className={['app', uiReview.enabled ? 'app-ui-review' : ''].filter(Boolean).join(' ')}>
      <header className="app-header">
        <div className="app-brand">
          <h1>Agent Studio</h1>
          <span className="app-subtitle">{subtitle()}</span>
        </div>
        <div className="topbar-chips" aria-label="Workspace summary">
          {topbarChips.map((chip) => (
            <span className="topbar-chip" key={chip}>{chip}</span>
          ))}
        </div>
      </header>

      <div
        className={[
          'app-body',
          isAgents || isTemplates || isSettings ? 'app-body-agents' : '',
          isWorkflow ? 'app-body-workflow' : '',
          !isAgents && !isTemplates && !isWorkflow && !isSettings && !configOpen ? 'app-body-config-collapsed' : ''
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
              showMemoryReferences={appSettings.settings.showMemoryReferences}
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
            runState={run.state}
            configOpen={configOpen}
            onConfigOpenChange={setConfigOpen}
            onStart={run.start}
            onContinueSession={run.continueSession}
            onPush={run.push}
            onAbort={run.abort}
            onReset={run.reset}
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
  agentCount: number
): string[] {
  switch (mode) {
    case 'workflow':
      return [`${runningCount} running`, `${waitingCount} waiting`, 'sound per run']
    case 'templates':
      return [`${templateCount} templates`, 'node canvas later', 'linear V1']
    case 'agents':
      return [`${agentCount} agents`, '2 CLIs', 'templates linked']
    case 'single':
      return ['single run', 'follow-up', 'transcript']
    case 'settings':
      return []
  }
}
