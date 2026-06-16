import type {
  AdapterCapabilities,
  AgentEvent,
  AgentVendor,
  ApiConversationMessage,
  ApiLogSource,
  CodexReasoningEffort,
  JSONSchema,
  PermissionMode,
  RunAttachment,
  ResumeHandle
} from '@shared/types'

/** Input to a single turn. Mirrors RunConfig but with a required AbortSignal. */
export interface RunTurnInput {
  prompt: string
  cwd: string
  model?: string
  codexReasoningEffort?: CodexReasoningEffort
  codexServiceTier?: string
  apiMaxSteps?: number
  apiTemperature?: number
  apiTopP?: number
  messages?: ApiConversationMessage[]
  attachments?: RunAttachment[]
  apiLogSource?: ApiLogSource
  addDirs?: string[]
  appendSystemPrompt?: string
  outputSchema?: JSONSchema
  resumeFrom?: ResumeHandle
  keepStdinOpenAfterTurnDone?: boolean
  cliPath?: string
  permissionMode?: PermissionMode
  headless?: boolean
  abortSignal: AbortSignal
}

/**
 * The one abstraction every CLI hides behind. The orchestration layer only
 * ever speaks this interface — never the raw command line or stdout format.
 *
 * Core model is a "turn": feed input → run → yield normalized events → done.
 * claude's bidirectional stdin is a superset (it can run many turns in one
 * resident process) exposed via `capabilities.bidirectionalStdin` + pushInput.
 */
export interface CliAdapter {
  readonly vendor: AgentVendor
  readonly capabilities: AdapterCapabilities

  /** Run one turn, yielding normalized events until turn-done/error. */
  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent>

  /** Append user text to a live resident process. Only adapters with
   *  capabilities.bidirectionalStdin implement this; others omit it. */
  pushInput?(text: string): Promise<void>
  /** Close resident stdin after orchestration decides the conversation is over. */
  closeInput?(): void
}
