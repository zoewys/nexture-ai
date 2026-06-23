/**
 * Shared types — the contract spoken by both the Electron main process
 * (CLI orchestration) and the renderer (React UI).
 *
 * Keep this file dependency-free so it can be imported from either side.
 */

// ── Vendors ────────────────────────────────────────────────────────────────

export type AgentVendor = 'claude' | 'codex' | 'api'

export const ALL_VENDORS: AgentVendor[] = ['claude', 'codex', 'api']

export type ApiProviderFormat = 'anthropic' | 'openai-compatible'

export interface ApiProviderConfig {
  id: string
  name: string
  format: ApiProviderFormat
  apiKey: string
  baseUrl?: string
  models: string[]
  modelContextWindows?: Record<string, number>
  defaultModel?: string
  maxOutputTokens?: number
}

// ── CLI model catalogs ──────────────────────────────────────────────────────

export interface ModelOption {
  /** Exact string passed to the CLI --model flag. */
  id: string
  /** Human-readable label from the CLI when available. */
  label: string
  /** Codex-only reasoning levels supported by this model, when exposed by the CLI. */
  codexReasoningEfforts?: CodexReasoningEffort[]
  codexDefaultReasoningEffort?: CodexReasoningEffort
  /** Codex-only speed/service tiers exposed by the CLI. */
  codexServiceTiers?: CodexServiceTierOption[]
}

export type ModelCatalogSource = 'cli' | 'cli-help' | 'unavailable'

export interface VendorModelCatalog {
  models: ModelOption[]
  source: ModelCatalogSource
  message?: string
}

export type ModelCatalog = Record<AgentVendor, VendorModelCatalog>

// ── Codex model controls ────────────────────────────────────────────────────

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

export const CODEX_REASONING_EFFORTS: CodexReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh'
]

export interface CodexServiceTierOption {
  /** Exact string passed to Codex config `service_tier`. */
  id: string
  label: string
  description?: string
}

// ── Normalized event stream ──────────────────────────────────────────────────
// Every CLI's stdout is parsed down to this common stream so the orchestration
// layer never branches on vendor. See IMPLEMENTATION_PLAN.md §1.1.

export type AgentEvent =
  | { kind: 'session-started'; sessionId: string; vendor: AgentVendor }
  | { kind: 'message-delta'; text: string }
  | { kind: 'message'; role: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool-call'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; ok: boolean; output: unknown }
  | { kind: 'file-changed'; path: string; op: 'create' | 'modify' | 'delete' }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number }
  | { kind: 'turn-done'; sessionId: string; reason: 'complete' | 'error' | 'aborted' }
  | { kind: 'error'; recoverable: boolean; message: string; raw?: unknown }
  // Lifecycle events emitted by the app layer (not the CLI) for UI/debug.
  | { kind: 'stderr'; text: string }
  | { kind: 'system'; text: string }

export type AgentEventKind = AgentEvent['kind']

// ── Adapter capabilities ─────────────────────────────────────────────────────

export interface AdapterCapabilities {
  /** Process stays resident; user input can be appended mid-turn (claude only). */
  bidirectionalStdin: boolean
  /** Adapter can resume a previous native CLI/API session id. */
  nativeResume: boolean
  /** Final output can be constrained to a JSON schema (claude/codex). */
  structuredOutputSchema: boolean
  /** Emits incremental token deltas (claude). */
  partialTokenStream: boolean
}

// ── Run configuration ────────────────────────────────────────────────────────

/** A JSON Schema object; kept loose to avoid pulling in a schema lib here. */
export type JSONSchema = Record<string, unknown>

export type ApiLogSource = 'single' | 'workflow' | 'provider-test' | 'model-fetch' | 'reflection'

export type ApiCallLogStatus = 'started' | 'success' | 'error' | 'aborted'

export interface ApiCallLogEntry {
  id: string
  timestamp: string
  source: ApiLogSource
  providerId?: string
  providerName?: string
  format?: ApiProviderFormat
  baseUrl?: string
  model?: string
  cwd?: string
  messagesSummary?: string
  systemSummary?: string
  toolNames?: string[]
  apiMaxSteps?: number
  temperature?: number
  topP?: number
  durationMs?: number
  status: ApiCallLogStatus
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  error?: string
  structuredOutput?: 'native' | 'fallback' | 'none'
  costUsd?: number
}

export interface RunAttachment {
  path: string
  kind?: 'image' | 'file'
  mediaType?: string
  name?: string
}

export interface PastedImageInput {
  data: ArrayBuffer
  mediaType: string
  name?: string
}

export interface ApiConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<Record<string, unknown>>
}

export interface ResumeHandle {
  sessionId: string
  vendor: AgentVendor
  /** Path to the app-owned transcript, used to rebuild a prompt if resume
   *  fails. Filled in by the main process (TranscriptStore); the renderer
   *  neither knows nor needs the on-disk path. */
  transcriptPath?: string
}

// ── Skills ─────────────────────────────────────────────────────────────────

export interface SkillSummary {
  id: string
  name: string
  description: string
  sourceLabel: string
  path: string
}

export interface SkillDefinition extends SkillSummary {
  content: string
}

// ── Product-level sessions ─────────────────────────────────────────────────

export type SessionScope = 'single' | 'workflow-step'

export type SessionStatus = 'active' | 'archived' | 'deleted'

export type SessionContinuationStrategy =
  | 'new'
  | 'live-push'
  | 'native-resume'
  | 'logic-replay'

export interface SessionRoute {
  vendor: AgentVendor
  model?: string
  agentId?: string
  apiProviderId?: string
  apiTemperature?: number
  apiTopP?: number
  codexReasoningEffort?: CodexReasoningEffort
  codexServiceTier?: string
  permissionMode?: PermissionMode
}

export interface SessionSegment {
  id: string
  scope: SessionScope
  route: SessionRoute
  /** Working directory used when this segment was launched. */
  cwd?: string
  runId?: string
  /** Native session id emitted by Claude/Codex/API for this segment. */
  nativeSessionId?: string
  /** App-level skills selected for one or more turns in this segment. */
  skillIds?: string[]
  continuationStrategy: SessionContinuationStrategy
  startedAt: number
  finishedAt?: number
}

export interface ConversationState {
  scope: SessionScope
  activeSegmentId?: string
  segments: SessionSegment[]
  events: AgentEvent[]
}

export interface SingleSession {
  id: string
  scope: 'single'
  title: string
  preview?: string
  status: SessionStatus
  cwd: string
  route?: SessionRoute
  conversation: ConversationState
  injectedMemoryIds?: string[]
  createdAt: number
  updatedAt: number
}

export interface SingleSessionDetail extends SingleSession {
  activeSegment?: SessionSegment
  running: boolean
}

export interface SingleSessionCreateInput {
  cwd: string
  route?: SessionRoute
  title?: string
}

export interface SingleSessionSendInput {
  sessionId: string
  text: string
  cwd: string
  route: SessionRoute
  appendSystemPrompt?: string
  addDirs?: string[]
  apiMaxSteps?: number
  apiTemperature?: number
  apiTopP?: number
  attachments?: RunAttachment[]
  skillIds?: string[]
}

export type SingleSessionEvent =
  | { kind: 'session-updated'; session: SingleSessionDetail }
  | {
      kind: 'agent-event'
      sessionId: string
      segmentId: string
      runId: string
      event: AgentEvent
    }

export interface SingleSessionEventEnvelope {
  sessionId: string
  event: SingleSessionEvent
}

/** Everything the UI must collect to launch one turn of one agent. */
export interface RunConfig {
  vendor: AgentVendor
  prompt: string
  cwd: string
  /** Optional saved agent id. Enables app-owned memory injection for single runs. */
  agentId?: string
  model?: string
  /** Codex-only: passed as `-c model_reasoning_effort="<value>"`. */
  codexReasoningEffort?: CodexReasoningEffort
  /** Codex-only: passed as `-c service_tier="<value>"`. */
  codexServiceTier?: string
  /** API-only: saved provider config id. */
  apiProviderId?: string
  /** API-only: maximum tool-calling steps for the AI SDK loop. */
  apiMaxSteps?: number
  /** API-only: temperature override. Defaults to provider-safe 0.2. */
  apiTemperature?: number
  /** API-only: top-p override. Defaults to 1. */
  apiTopP?: number
  /** API-only: structured replay messages used across logical session segments. */
  messages?: ApiConversationMessage[]
  /** API-only: local files attached to the user message. */
  attachments?: RunAttachment[]
  /** API-only: identifies the source shown in local API call logs. */
  apiLogSource?: ApiLogSource
  /** True for workflow/scheduled/background runs without an interactive permission UI. */
  headless?: boolean
  addDirs?: string[]
  appendSystemPrompt?: string
  outputSchema?: JSONSchema
  resumeFrom?: ResumeHandle
  /** Keep resident stdin open after a turn-done event for interactive workflow steps. */
  keepStdinOpenAfterTurnDone?: boolean
  /** Optional absolute path to the CLI binary; falls back to PATH lookup. */
  cliPath?: string
  /** CLI permission mode. Defaults to bypassPermissions when unset. */
  permissionMode?: PermissionMode
}

// ── Agent definitions ───────────────────────────────────────────────────────

/** Permission mode passed to the CLI. Mirrors claude's --permission-mode. */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan']

export interface AgentDefinition {
  id: string
  /** Display name, e.g. "Senior Product Manager". */
  name: string
  /** Free-form role label, e.g. "product" / "design" / "dev" / "test". */
  role: string
  vendor: AgentVendor
  model?: string
  codexReasoningEffort?: CodexReasoningEffort
  codexServiceTier?: string
  apiProviderId?: string
  apiTemperature?: number
  apiTopP?: number
  /** System prompt injected via --append-system-prompt at run time. */
  systemPrompt: string
  /** CLI permission mode for this agent. Defaults to bypassPermissions. */
  permissionMode?: PermissionMode
}

// ── Workflow orchestration ─────────────────────────────────────────────────

// ── Step rules (conditional jumps) ──────────────────────────────────────────

export interface StepRule {
  on: 'error' | 'handoff-failed' | 'done'
  action: 'retry' | 'skip' | 'goto'
  target?: number
  maxRetries?: number
}

export interface RouteSuggestion {
  action: 'continue' | 'retry-prev' | 'skip-next' | 'goto'
  target?: number
  reason?: string
}

export type FailureStrategyType = 'stop' | 'retry-then-notify' | 'retry-then-goto'

export interface FailureStrategy {
  type: FailureStrategyType
  /** Maximum automatic retries before notifying or jumping. Defaults to 3. */
  maxRetries?: number
  /** Target step index used by retry-then-goto after retries are exhausted. */
  gotoTarget?: number
}

// ── Workflow template ────────────────────────────────────────────────────────

export interface WorkflowTemplateStep {
  agentId: string
  role?: string
  rules?: StepRule[]
  /** Allows user/agent conversation inside this step. Defaults to false. */
  interactive?: boolean
  /** When true, this step advances to the next node automatically after a valid handoff. */
  autoConfirm?: boolean
  /** Fallback behavior after StepRule handling. Defaults to stop. */
  failureStrategy?: FailureStrategy
}

export interface WorkflowParallelGroup {
  parallel: WorkflowTemplateStep[]
  join: boolean
}

export type WorkflowStepNode = WorkflowTemplateStep | WorkflowParallelGroup

export function isParallelGroup(node: WorkflowStepNode): node is WorkflowParallelGroup {
  return 'parallel' in node && Array.isArray((node as WorkflowParallelGroup).parallel)
}

export interface WorkflowTemplate {
  id: string
  name: string
  description?: string
  steps: WorkflowStepNode[]
  /** Optional per-run budget cap in USD applied to runs started from this template. */
  budgetUsd?: number
  /** Epoch ms of creation; newest sorts first in the template list. */
  createdAt?: number
}

export interface WorkflowSchedule {
  id: string
  templateId: string
  name: string
  cron: string
  enabled: boolean
  projectPath: string
  initialPrompt: string
  createdAt: number
  lastTriggeredAt?: number
  lastRunId?: string
  lastRunStatus?: 'completed' | 'error' | 'running'
}

export interface CronPreview {
  valid: boolean
  description: string
  nextFireAt?: number
  error?: string
}

export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting-input'
  | 'awaiting-confirm'
  | 'done'
  | 'stale'
  | 'error'

export interface HandoffArtifactItem {
  path: string
  description: string
  type?: 'requirement' | 'design' | 'code' | 'test' | 'other'
}

export interface HandoffArtifact {
  summary: string
  artifacts: HandoffArtifactItem[]
  nextStepGuidance?: string
  routeSuggestion?: RouteSuggestion
}

export interface WorkflowStepExecution {
  id: string
  stepIndex: number
  agentId: string
  vendor?: AgentVendor
  model?: string
  apiProviderId?: string
  status: StepStatus
  sessionId?: string
  runId?: string
  startedAt?: number
  finishedAt?: number
  handoff?: HandoffArtifact
  conversation?: ConversationState
  injectedMemoryIds?: string[]
  events: AgentEvent[]
  error?: string
  /** Accumulated token usage for this step (includes reruns). */
  totalInputTokens: number
  totalOutputTokens: number
  /** Accumulated cost in USD for this step (includes reruns). */
  totalCostUsd: number
}

export interface WorkflowRunStep {
  agentId: string
  displayName?: string
  role?: string
  vendor?: AgentVendor
  model?: string
  apiProviderId?: string
  status: StepStatus
  executions: WorkflowStepExecution[]
  parallelGroupId?: string
  parallelGroupJoin?: boolean
  worktreePath?: string
}

export type WorkflowRunStatus =
  | 'running'
  | 'awaiting-input'
  | 'awaiting-confirm'
  | 'completed'
  | 'error'
  | 'aborted'
  | 'interrupted'

export interface WorkflowRun {
  id: string
  templateId: string
  templateName: string
  /** User-facing instance name. Defaults to templateName when omitted. */
  runName?: string
  /** Original repository path the run was launched against. Always the source git root. */
  projectPath: string
  /** Run-level worktree path when the run executes in an isolated copy; undefined when running in place. */
  worktreePath?: string
  /** Branch the run is executing on (worktree branch, or the project's current branch). */
  branch?: string
  initialPrompt: string
  status: WorkflowRunStatus
  currentStepIndex: number
  steps: WorkflowRunStep[]
  startedAt: number
  finishedAt?: number
  /** Aggregated token usage across all steps. */
  totalInputTokens: number
  totalOutputTokens: number
  /** Aggregated cost in USD across all steps. */
  totalCostUsd: number
  /** Optional budget cap for this run. When totalCostUsd reaches this, the run stops. */
  budgetUsd?: number
  /** Scheduled runs auto-advance through handoffs without manual confirmation. */
  autoConfirm?: boolean
  /** Schedule id that launched this run, when started by the scheduler. */
  scheduledBy?: string
}

export interface WorkflowStartInput {
  templateId: string
  runName?: string
  projectPath: string
  initialPrompt: string
  /** When true and the path is a git repo, execute the run inside a freshly-created worktree. */
  useWorktree?: boolean
  /** True only after the user accepts a same-working-tree warning. */
  allowUnsafeSameGitRoot?: boolean
  /** Scheduled runs pass true so every valid handoff advances automatically. */
  autoConfirm?: boolean
  /** Schedule id that launched this run. */
  scheduledBy?: string
}

export interface WorkflowStartResult {
  run: WorkflowRun
}

export type WorkflowEvent =
  | { kind: 'run-updated'; run: WorkflowRun }
  | { kind: 'agent-event'; runId: string; stepIndex: number; executionId: string; event: AgentEvent }

export interface WorkflowEventEnvelope {
  runId: string
  event: WorkflowEvent
}

export interface WorkflowRunGitSafety {
  projectPath: string
  gitRoot?: string
  commonGitDir?: string
  branch?: string
  isGitRepo: boolean
  isLinkedWorktree: boolean
  sameWorkingTreeRunIds: string[]
  relatedWorktreeRunIds: string[]
  /** Combined list for simple UI badges. */
  conflictingRunIds: string[]
  level: 'safe' | 'warning' | 'requires-confirmation'
  message?: string
}

// ── Agent memory ───────────────────────────────────────────────────────────

export type MemoryScope = 'global' | 'project'

export type MemoryCategory = 'method' | 'knowledge' | 'preference' | 'avoidance'

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'method',
  'knowledge',
  'preference',
  'avoidance'
]

export interface MemoryEntry {
  id: string
  agentId: string
  scope: MemoryScope
  projectHash?: string
  projectPath?: string
  category: MemoryCategory
  content: string
  evidence: string
  strength: number
  createdAt: number
  lastReinforcedAt: number
  reinforceCount: number
}

export interface MemorySignal {
  type: 'positive' | 'negative' | 'format-error' | 'completion'
  source: 'user-confirmed' | 'user-rerun' | 'handoff-failed' | 'workflow-done'
  runId: string
  workflowRunId: string
  stepIndex: number
  agentId: string
  projectPath: string
  timestamp: number
  transcript: string
  injectedMemoryIds?: string[]
  handoff?: HandoffArtifact
  error?: string
  userAction?: string
}

export interface ReflectionResult {
  category: MemoryCategory
  scope: MemoryScope
  content: string
  confidence: number
}

export interface AgentMemoryMeta {
  agentId: string
  totalRuns: number
  totalMemories: number
  lastReflectionAt?: number
}

export interface ReflectionEngineConfig {
  vendor: AgentVendor
  model: string
  enabled: boolean
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionEngineConfig = {
  vendor: 'claude',
  model: 'haiku',
  enabled: true
}

// ── App Settings ─────────────────────────────────────────────────────────────

export interface FeishuConfig {
  appId: string
  appSecret: string
  chatId?: string
  userId?: string
  enabled: boolean
}

export const DEFAULT_FEISHU_CONFIG: FeishuConfig = {
  appId: '',
  appSecret: '',
  chatId: '',
  userId: '',
  enabled: false
}

export type FeishuConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type AppearanceTheme = 'light' | 'dark'

export interface AppSettings {
  appearanceTheme: AppearanceTheme
  showMemoryReferences: boolean
  minimizeToTray: boolean
  feishu: FeishuConfig
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearanceTheme: 'light',
  showMemoryReferences: false,
  minimizeToTray: true,
  feishu: DEFAULT_FEISHU_CONFIG
}

// ── IPC channel names + payloads ─────────────────────────────────────────────
// Single source of truth so main/preload/renderer never drift on strings.

export const IPC = {
  /** renderer → main: start a run. Returns a runId. */
  runStart: 'run:start',
  /** renderer → main: push interjection text into a live (claude) run. */
  runPush: 'run:push',
  /** renderer → main: abort a run (kill the child process). */
  runAbort: 'run:abort',
  /** main → renderer: a normalized AgentEvent for a given runId. */
  runEvent: 'run:event',
  /** renderer → main: list Single sessions. */
  singleSessionsList: 'single:sessions:list',
  /** renderer → main: create a Single session. */
  singleSessionCreate: 'single:sessions:create',
  /** renderer → main: get one Single session detail. */
  singleSessionGet: 'single:sessions:get',
  /** renderer → main: send a message into one Single session. */
  singleSessionSend: 'single:sessions:send',
  /** renderer → main: abort one Single session's active run. */
  singleSessionAbort: 'single:sessions:abort',
  /** renderer → main: delete one Single session. */
  singleSessionDelete: 'single:sessions:delete',
  /** main → renderer: Single session updates and nested agent events. */
  singleSessionEvent: 'single:sessions:event',
  /** renderer → main: list discovered local skills. */
  skillsList: 'skills:list',
  /** main → renderer: incremental transcript delta from file tailing. */
  transcriptDelta: 'transcript:delta',
  /** renderer → main: detect which CLIs are installed. */
  checkClis: 'cli:check',
  /** renderer → main: get installed CLI version strings. */
  cliVersions: 'cli:versions',
  /** renderer → main: ask installed CLIs for their current model choices. */
  listModels: 'cli:models',
  /** renderer → main: install a CLI tool. Returns InstallResult. */
  cliInstall: 'cli:install',
  /** main → renderer: CLI install progress updates. */
  cliInstallProgress: 'cli:install-progress',
  /** renderer → main: stop an in-progress CLI install. */
  cliInstallCancel: 'cli:install-cancel',
  /** renderer → main: open a native folder picker, returns chosen path or null. */
  pickDir: 'dialog:pickDir',
  /** renderer → main: open a native file picker, returns chosen file paths or null. */
  pickFiles: 'dialog:pickFiles',
  /** renderer → main: save a pasted clipboard image as a local attachment file. */
  savePastedImage: 'clipboard:image:save',
  /** renderer → main: export data to a zip file. */
  dataExport: 'data:export',
  /** renderer → main: export a single template to a zip file. */
  dataExportTemplate: 'data:export-template',
  /** renderer → main: preview contents of an import zip file. */
  dataImportPreview: 'data:import-preview',
  /** renderer → main: import data from a zip file. */
  dataImport: 'data:import',
  /** renderer → main: restart the app. */
  appRestart: 'app:restart',
  /** renderer → main: list all saved agent definitions. */
  agentsList: 'agents:list',
  /** renderer → main: create or update an agent definition. */
  agentsSave: 'agents:save',
  /** renderer → main: delete an agent definition by id. */
  agentsDelete: 'agents:delete',
  /** renderer → main: list saved workflow templates. */
  workflowsList: 'workflows:list',
  /** renderer → main: create or update a workflow template. */
  workflowsSave: 'workflows:save',
  /** renderer → main: delete a workflow template. */
  workflowsDelete: 'workflows:delete',
  /** renderer → main: start a workflow run. */
  workflowStart: 'workflow:start',
  /** renderer → main: list persisted workflow runs. */
  workflowRunsList: 'workflow:runs:list',
  /** renderer → main: delete one persisted workflow run. */
  workflowDeleteRun: 'workflow:runs:delete',
  /** renderer → main: inspect project directory concurrency and git safety. */
  workflowGitSafety: 'workflow:git-safety',
  /** renderer → main: confirm the current awaiting handoff and advance. */
  workflowConfirmStep: 'workflow:confirm-step',
  /** renderer → main: finish an interactive step without a handoff JSON. */
  workflowFinishInteractive: 'workflow:finish-interactive',
  /** renderer → main: rerun one step and stale downstream steps. */
  workflowRerunStep: 'workflow:rerun-step',
  /** renderer → main: abort a running workflow. */
  workflowAbort: 'workflow:abort',
  /** renderer → main: read a file from disk (absolute path). */
  fileRead: 'file:read',
  /** renderer → main: send input to the active workflow step. */
  workflowPush: 'workflow:push',
  /** renderer → main: update a workflow run's initial prompt. */
  workflowUpdatePrompt: 'workflow:update-prompt',
  /** main → renderer: workflow run updates and nested agent events. */
  workflowEvent: 'workflow:event',
  /** renderer → main: list memories for one agent. */
  memoryList: 'memory:list',
  /** renderer → main: delete one memory. */
  memoryDelete: 'memory:delete',
  /** renderer → main: get memory stats for one agent. */
  memoryMeta: 'memory:meta',
  /** renderer → main: get reflection engine config. */
  reflectionConfigGet: 'reflection:config:get',
  /** renderer → main: save reflection engine config. */
  reflectionConfigSave: 'reflection:config:save',
  /** renderer → main: get app settings. */
  appSettingsGet: 'app:settings:get',
  /** renderer → main: save app settings. */
  appSettingsSave: 'app:settings:save',
  /** renderer → main: list workflow schedules. */
  schedulesList: 'schedules:list',
  /** renderer → main: create or update a workflow schedule. */
  schedulesSave: 'schedules:save',
  /** renderer → main: delete one workflow schedule. */
  schedulesDelete: 'schedules:delete',
  /** renderer → main: enable or disable one workflow schedule. */
  schedulesToggle: 'schedules:toggle',
  /** renderer → main: validate a 5-field cron expression. */
  cronValidate: 'cron:validate',
  /** renderer → main: describe a cron expression and return next fire time. */
  cronDescribe: 'cron:describe',
  /** renderer → main: skip the next step in a workflow run. */
  workflowSkipStep: 'workflow:skip-step',
  /** renderer → main: jump to a specific step in a workflow run. */
  workflowGotoStep: 'workflow:goto-step',
  /** renderer → main: get a vendor/model recommendation for a role. */
  routeRecommend: 'route:recommend',
  /** renderer → main: list saved API providers. */
  providersList: 'providers:list',
  /** renderer → main: create or update an API provider. */
  providersSave: 'providers:save',
  /** renderer → main: delete an API provider. */
  providersDelete: 'providers:delete',
  /** renderer → main: test an API provider connection. */
  providersTest: 'providers:test',
  /** renderer → main: fetch available models from a provider's API. */
  providersFetchModels: 'providers:fetch-models',
  /** renderer → main: get a provider with decrypted apiKey. */
  providersGetDecrypted: 'providers:get-decrypted',
  /** renderer → main: list recent local API call logs. */
  apiLogsList: 'apiLogs:list',
  /** renderer → main: clear local API call logs. */
  apiLogsClear: 'apiLogs:clear',
  /** renderer → main: open the local API call log directory. */
  apiLogsOpenDir: 'apiLogs:openDir',
  /** renderer → main: get one API call log entry by id. */
  apiLogsGet: 'apiLogs:get',
  /** main → renderer: request tool permission. */
  permissionRequest: 'permission:request',
  /** renderer → main: respond to a tool permission request. */
  permissionRespond: 'permission:respond',
  /** renderer → main: send a Feishu test notification. */
  feishuTest: 'feishu:test',
  /** renderer → main: get current Feishu websocket status. */
  feishuStatus: 'feishu:status',
  /** main → renderer: Feishu websocket status changed. */
  feishuStatusChanged: 'feishu:status-changed'
} as const

export interface RunStartResult {
  runId: string
  injectedMemoryIds?: string[]
}

/** Wire envelope for an event delivered to the renderer. */
export interface RunEventEnvelope {
  runId: string
  event: AgentEvent
}

export interface CliCheckResult {
  claude: boolean
  codex: boolean
  api: boolean
}

export interface CliVersionResult {
  claude: string | null
  codex: string | null
}

// ── Data Import / Export ───────────────────────────────────────────────────

export interface ExportOptions {
  agents: true
  workflows: true
  workflowRuns: true
  schedules?: boolean
  settings?: boolean
  memories?: boolean
}

export interface ImportPreview {
  agents: { total: number; new: number; existing: number }
  workflows: { total: number; new: number; existing: number }
  workflowRuns: { total: number; new: number; existing: number }
  schedules?: { total: number; new: number; existing: number }
  settings?: boolean
  memories?: { total: number; new: number; existing: number }
}

export interface ImportOptions {
  agents: true
  workflows: true
  workflowRuns: true
  schedules?: boolean
  settings?: boolean
  memories?: boolean
}
