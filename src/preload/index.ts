import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type RunConfig,
  type RunStartResult,
  type RunEventEnvelope,
  type SingleSession,
  type SingleSessionCreateInput,
  type SingleSessionDetail,
  type SingleSessionEventEnvelope,
  type SingleSessionSendInput,
  type SkillSummary,
  type CliCheckResult,
  type CliVersionResult,
  type AgentDefinition,
  type ModelCatalog,
  type CronPreview,
  type WorkflowEventEnvelope,
  type WorkflowRun,
  type WorkflowRunGitSafety,
  type WorkflowSchedule,
  type WorkflowStartInput,
  type WorkflowStartResult,
  type WorkflowTemplate,
  type AgentMemoryMeta,
  type MemoryEntry,
  type ReflectionEngineConfig,
  type AppSettings,
  type ApiProviderConfig,
  type ApiCallLogEntry,
  type FeishuConnectionStatus,
  type ExportOptions,
  type ImportPreview,
  type ImportOptions,
  type PastedImageInput,
  type AppUpdateState
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

  listSingleSessions: (): Promise<SingleSession[]> =>
    ipcRenderer.invoke(IPC.singleSessionsList),

  createSingleSession: (input: SingleSessionCreateInput): Promise<SingleSession> =>
    ipcRenderer.invoke(IPC.singleSessionCreate, input),

  getSingleSession: (id: string): Promise<SingleSessionDetail> =>
    ipcRenderer.invoke(IPC.singleSessionGet, id),

  sendSingleSessionMessage: (input: SingleSessionSendInput): Promise<SingleSessionDetail> =>
    ipcRenderer.invoke(IPC.singleSessionSend, input),

  abortSingleSession: (id: string): Promise<SingleSessionDetail> =>
    ipcRenderer.invoke(IPC.singleSessionAbort, id),

  deleteSingleSession: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.singleSessionDelete, id),

  listSkills: (): Promise<SkillSummary[]> =>
    ipcRenderer.invoke(IPC.skillsList),

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

  listProviders: (): Promise<ApiProviderConfig[]> =>
    ipcRenderer.invoke(IPC.providersList),

  saveProvider: (input: Omit<ApiProviderConfig, 'id'> & { id?: string }): Promise<ApiProviderConfig> =>
    ipcRenderer.invoke(IPC.providersSave, input),

  deleteProvider: (id: string): Promise<void> => ipcRenderer.invoke(IPC.providersDelete, id),

  testProvider: (id: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.providersTest, id),

  getDecryptedProvider: (id: string): Promise<ApiProviderConfig> =>
    ipcRenderer.invoke(IPC.providersGetDecrypted, id),

  fetchProviderModels: (provider: ApiProviderConfig, providerId?: string): Promise<{ models: string[]; error?: string }> =>
    ipcRenderer.invoke(IPC.providersFetchModels, provider, providerId),

  respondPermission: (requestId: string, allowed: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.permissionRespond, requestId, allowed),

  listApiLogs: (limit?: number): Promise<ApiCallLogEntry[]> =>
    ipcRenderer.invoke(IPC.apiLogsList, limit),

  getApiLog: (id: string): Promise<ApiCallLogEntry | null> =>
    ipcRenderer.invoke(IPC.apiLogsGet, id),

  clearApiLogs: (): Promise<void> =>
    ipcRenderer.invoke(IPC.apiLogsClear),

  openApiLogDir: (): Promise<string> =>
    ipcRenderer.invoke(IPC.apiLogsOpenDir),

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

  confirmWorkflowStep: (runId: string, stepIndex?: number) =>
    ipcRenderer.invoke(IPC.workflowConfirmStep, runId, stepIndex),

  finishInteractiveStep: (runId: string, stepIndex: number) =>
    ipcRenderer.invoke(IPC.workflowFinishInteractive, runId, stepIndex),

  rerunWorkflowStep: (runId: string, stepIndex: number) =>
    ipcRenderer.invoke(IPC.workflowRerunStep, runId, stepIndex),

  abortWorkflow: (runId: string) => ipcRenderer.invoke(IPC.workflowAbort, runId),

  readFile: (absPath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.fileRead, absPath),

  pickFiles: (): Promise<string[] | null> =>
    ipcRenderer.invoke(IPC.pickFiles),

  savePastedImage: (input: PastedImageInput): Promise<string> =>
    ipcRenderer.invoke(IPC.savePastedImage, input),

  pushWorkflowInput: (runId: string, stepIndex: number, text: string) =>
    ipcRenderer.invoke(IPC.workflowPush, runId, stepIndex, text),

  updateWorkflowPrompt: (runId: string, newPrompt: string): Promise<WorkflowRun> =>
    ipcRenderer.invoke(IPC.workflowUpdatePrompt, runId, newPrompt),

  listSchedules: (): Promise<WorkflowSchedule[]> =>
    ipcRenderer.invoke(IPC.schedulesList),

  saveSchedule: (
    input: Omit<WorkflowSchedule, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
  ): Promise<WorkflowSchedule> =>
    ipcRenderer.invoke(IPC.schedulesSave, input),

  deleteSchedule: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.schedulesDelete, id),

  toggleSchedule: (id: string, enabled: boolean): Promise<WorkflowSchedule> =>
    ipcRenderer.invoke(IPC.schedulesToggle, id, enabled),

  cronValidate: (expression: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.cronValidate, expression),

  cronDescribe: (expression: string): Promise<CronPreview> =>
    ipcRenderer.invoke(IPC.cronDescribe, expression),

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

  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC.appVersionGet),

  checkForUpdates: (): Promise<AppUpdateState> =>
    ipcRenderer.invoke(IPC.appUpdateCheck),

  installUpdate: (): Promise<AppUpdateState> =>
    ipcRenderer.invoke(IPC.appUpdateInstall),

  skipWorkflowStep: (runId: string) =>
    ipcRenderer.invoke(IPC.workflowSkipStep, runId),

  gotoWorkflowStep: (runId: string, targetIndex: number) =>
    ipcRenderer.invoke(IPC.workflowGotoStep, runId, targetIndex),

  routeRecommend: (role: string) =>
    ipcRenderer.invoke(IPC.routeRecommend, role),

  pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickDir),

  /** Subscribe to run events. Returns an unsubscribe function. */
  onRunEvent: (cb: (envelope: RunEventEnvelope) => void): (() => void) => {
    const listener = (_e: unknown, envelope: RunEventEnvelope): void => cb(envelope)
    ipcRenderer.on(IPC.runEvent, listener)
    return () => ipcRenderer.removeListener(IPC.runEvent, listener)
  },

  onSingleSessionEvent: (cb: (envelope: SingleSessionEventEnvelope) => void): (() => void) => {
    const listener = (_e: unknown, envelope: SingleSessionEventEnvelope): void => cb(envelope)
    ipcRenderer.on(IPC.singleSessionEvent, listener)
    return () => ipcRenderer.removeListener(IPC.singleSessionEvent, listener)
  },

  onWorkflowEvent: (cb: (envelope: WorkflowEventEnvelope) => void): (() => void) => {
    const listener = (_e: unknown, envelope: WorkflowEventEnvelope): void => cb(envelope)
    ipcRenderer.on(IPC.workflowEvent, listener)
    return () => ipcRenderer.removeListener(IPC.workflowEvent, listener)
  },

  onAppUpdateEvent: (cb: (state: AppUpdateState) => void): (() => void) => {
    const listener = (_e: unknown, state: AppUpdateState): void => cb(state)
    ipcRenderer.on(IPC.appUpdateEvent, listener)
    return () => ipcRenderer.removeListener(IPC.appUpdateEvent, listener)
  },

  exportData: (options: ExportOptions): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.dataExport, options),

  exportTemplate: (templateId: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.dataExportTemplate, templateId),

  previewImport: (filePath: string): Promise<ImportPreview> =>
    ipcRenderer.invoke(IPC.dataImportPreview, filePath),

  importData: (filePath: string, options: ImportOptions): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.dataImport, filePath, options),

  feishuTest: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.feishuTest),

  feishuStatus: (): Promise<FeishuConnectionStatus> =>
    ipcRenderer.invoke(IPC.feishuStatus),

  onFeishuStatusChanged: (cb: (status: FeishuConnectionStatus) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: FeishuConnectionStatus) => cb(status)
    ipcRenderer.on(IPC.feishuStatusChanged, handler)
    return () => ipcRenderer.removeListener(IPC.feishuStatusChanged, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AgentStudioApi = typeof api
