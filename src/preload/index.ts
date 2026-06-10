import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type RunConfig,
  type RunStartResult,
  type RunEventEnvelope,
  type CliCheckResult,
  type CliVersionResult,
  type AgentDefinition,
  type ModelCatalog,
  type WorkflowEventEnvelope,
  type WorkflowRun,
  type WorkflowRunGitSafety,
  type WorkflowStartInput,
  type WorkflowStartResult,
  type WorkflowTemplate,
  type AgentMemoryMeta,
  type MemoryEntry,
  type ReflectionEngineConfig,
  type AppSettings
} from '@shared/types'

/**
 * The only surface the renderer can touch. No Node, no ipcRenderer directly —
 * just these typed methods. Mirrors the IPC channel contract in shared/types.
 */
const api = {
  startRun: (config: RunConfig): Promise<RunStartResult> =>
    ipcRenderer.invoke(IPC.runStart, config),

  pushInput: (runId: string, text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.runPush, runId, text),

  abortRun: (runId: string): Promise<void> => ipcRenderer.invoke(IPC.runAbort, runId),

  checkClis: (): Promise<CliCheckResult> => ipcRenderer.invoke(IPC.checkClis),

  getCliVersions: (): Promise<CliVersionResult> => ipcRenderer.invoke(IPC.cliVersions),

  installCli: (cli: 'claude' | 'codex'): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.cliInstall, cli),

  onCliInstallProgress: (cb: (cli: 'claude' | 'codex', message: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, cli: 'claude' | 'codex', message: string) => cb(cli, message)
    ipcRenderer.on(IPC.cliInstallProgress, handler)
    return () => ipcRenderer.removeListener(IPC.cliInstallProgress, handler)
  },

  listModels: (): Promise<ModelCatalog> => ipcRenderer.invoke(IPC.listModels),

  listAgents: (): Promise<AgentDefinition[]> => ipcRenderer.invoke(IPC.agentsList),

  saveAgent: (input: Omit<AgentDefinition, 'id'> & { id?: string }): Promise<AgentDefinition> =>
    ipcRenderer.invoke(IPC.agentsSave, input),

  deleteAgent: (id: string): Promise<void> => ipcRenderer.invoke(IPC.agentsDelete, id),

  listWorkflows: (): Promise<WorkflowTemplate[]> => ipcRenderer.invoke(IPC.workflowsList),

  saveWorkflow: (input: Omit<WorkflowTemplate, 'id'> & { id?: string }): Promise<WorkflowTemplate> =>
    ipcRenderer.invoke(IPC.workflowsSave, input),

  deleteWorkflow: (id: string): Promise<void> => ipcRenderer.invoke(IPC.workflowsDelete, id),

  startWorkflow: (input: WorkflowStartInput): Promise<WorkflowStartResult> =>
    ipcRenderer.invoke(IPC.workflowStart, input),

  listWorkflowRuns: (): Promise<WorkflowRun[]> => ipcRenderer.invoke(IPC.workflowRunsList),

  deleteWorkflowRun: (runId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.workflowDeleteRun, runId),

  inspectWorkflowGitSafety: (projectPath: string): Promise<WorkflowRunGitSafety> =>
    ipcRenderer.invoke(IPC.workflowGitSafety, projectPath),

  confirmWorkflowStep: (runId: string) => ipcRenderer.invoke(IPC.workflowConfirmStep, runId),

  rerunWorkflowStep: (runId: string, stepIndex: number) =>
    ipcRenderer.invoke(IPC.workflowRerunStep, runId, stepIndex),

  abortWorkflow: (runId: string) => ipcRenderer.invoke(IPC.workflowAbort, runId),

  readFile: (absPath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.fileRead, absPath),

  pickFiles: (): Promise<string[] | null> =>
    ipcRenderer.invoke(IPC.pickFiles),

  pushWorkflowInput: (runId: string, stepIndex: number, text: string) =>
    ipcRenderer.invoke(IPC.workflowPush, runId, stepIndex, text),

  updateWorkflowPrompt: (runId: string, newPrompt: string): Promise<WorkflowRun> =>
    ipcRenderer.invoke(IPC.workflowUpdatePrompt, runId, newPrompt),

  memoryList: (agentId: string, projectPath?: string): Promise<MemoryEntry[]> =>
    ipcRenderer.invoke(IPC.memoryList, agentId, projectPath),

  memoryDelete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.memoryDelete, id),

  memoryMeta: (agentId: string): Promise<AgentMemoryMeta> =>
    ipcRenderer.invoke(IPC.memoryMeta, agentId),

  reflectionConfigGet: (): Promise<ReflectionEngineConfig> =>
    ipcRenderer.invoke(IPC.reflectionConfigGet),

  reflectionConfigSave: (config: ReflectionEngineConfig): Promise<void> =>
    ipcRenderer.invoke(IPC.reflectionConfigSave, config),

  appSettingsGet: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.appSettingsGet),

  appSettingsSave: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke(IPC.appSettingsSave, settings),

  pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickDir),

  /** Subscribe to run events. Returns an unsubscribe function. */
  onRunEvent: (cb: (envelope: RunEventEnvelope) => void): (() => void) => {
    const listener = (_e: unknown, envelope: RunEventEnvelope): void => cb(envelope)
    ipcRenderer.on(IPC.runEvent, listener)
    return () => ipcRenderer.removeListener(IPC.runEvent, listener)
  },

  onWorkflowEvent: (cb: (envelope: WorkflowEventEnvelope) => void): (() => void) => {
    const listener = (_e: unknown, envelope: WorkflowEventEnvelope): void => cb(envelope)
    ipcRenderer.on(IPC.workflowEvent, listener)
    return () => ipcRenderer.removeListener(IPC.workflowEvent, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AgentStudioApi = typeof api
