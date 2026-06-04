/**
 * Shared types — the contract spoken by both the Electron main process
 * (CLI orchestration) and the renderer (React UI).
 *
 * Keep this file dependency-free so it can be imported from either side.
 */

// ── Vendors ────────────────────────────────────────────────────────────────

export type AgentVendor = 'claude' | 'codex'

export const ALL_VENDORS: AgentVendor[] = ['claude', 'codex']

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
  /** Final output can be constrained to a JSON schema (claude/codex). */
  structuredOutputSchema: boolean
  /** Emits incremental token deltas (claude). */
  partialTokenStream: boolean
}

// ── Run configuration ────────────────────────────────────────────────────────

/** A JSON Schema object; kept loose to avoid pulling in a schema lib here. */
export type JSONSchema = Record<string, unknown>

export interface ResumeHandle {
  sessionId: string
  vendor: AgentVendor
  /** Path to the app-owned transcript, used to rebuild a prompt if resume
   *  fails. Filled in by the main process (TranscriptStore); the renderer
   *  neither knows nor needs the on-disk path. */
  transcriptPath?: string
}

/** Everything the UI must collect to launch one turn of one agent. */
export interface RunConfig {
  vendor: AgentVendor
  prompt: string
  cwd: string
  model?: string
  /** Codex-only: passed as `-c model_reasoning_effort="<value>"`. */
  codexReasoningEffort?: CodexReasoningEffort
  /** Codex-only: passed as `-c service_tier="<value>"`. */
  codexServiceTier?: string
  addDirs?: string[]
  appendSystemPrompt?: string
  outputSchema?: JSONSchema
  resumeFrom?: ResumeHandle
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
  /** System prompt injected via --append-system-prompt at run time. */
  systemPrompt: string
  /** CLI permission mode for this agent. Defaults to bypassPermissions. */
  permissionMode?: PermissionMode
}

// ── Workflow orchestration ─────────────────────────────────────────────────

export interface WorkflowTemplateStep {
  agentId: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description?: string
  steps: WorkflowTemplateStep[]
}

export type StepStatus =
  | 'pending'
  | 'running'
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
}

export interface WorkflowStepExecution {
  id: string
  stepIndex: number
  agentId: string
  status: StepStatus
  sessionId?: string
  runId?: string
  startedAt?: number
  finishedAt?: number
  handoff?: HandoffArtifact
  events: AgentEvent[]
  error?: string
}

export interface WorkflowRunStep {
  agentId: string
  status: StepStatus
  executions: WorkflowStepExecution[]
}

export interface WorkflowRun {
  id: string
  templateId: string
  templateName: string
  projectPath: string
  initialPrompt: string
  status: 'running' | 'awaiting-confirm' | 'completed' | 'error' | 'aborted'
  currentStepIndex: number
  steps: WorkflowRunStep[]
  startedAt: number
  finishedAt?: number
}

export interface WorkflowStartInput {
  templateId: string
  projectPath: string
  initialPrompt: string
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
  /** renderer → main: detect which CLIs are installed. */
  checkClis: 'cli:check',
  /** renderer → main: ask installed CLIs for their current model choices. */
  listModels: 'cli:models',
  /** renderer → main: open a native folder picker, returns chosen path or null. */
  pickDir: 'dialog:pickDir',
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
  /** renderer → main: confirm the current awaiting handoff and advance. */
  workflowConfirmStep: 'workflow:confirm-step',
  /** renderer → main: rerun one step and stale downstream steps. */
  workflowRerunStep: 'workflow:rerun-step',
  /** renderer → main: abort a running workflow. */
  workflowAbort: 'workflow:abort',
  /** renderer → main: send input to the active workflow step. */
  workflowPush: 'workflow:push',
  /** main → renderer: workflow run updates and nested agent events. */
  workflowEvent: 'workflow:event'
} as const

export interface RunStartResult {
  runId: string
}

/** Wire envelope for an event delivered to the renderer. */
export interface RunEventEnvelope {
  runId: string
  event: AgentEvent
}

export interface CliCheckResult {
  claude: boolean
  codex: boolean
}
