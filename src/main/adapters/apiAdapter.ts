import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { platform, release } from 'node:os'
import { spawnSync } from 'node:child_process'
import { generateText, jsonSchema, Output as output, streamText, stepCountIs, type ModelMessage, type SystemModelMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { AdapterCapabilities, AgentEvent, ApiCallLogStatus, ApiConversationMessage, ApiProviderConfig, RunAttachment } from '@shared/types'
import type { ApiCallLogStore } from '../ApiCallLogStore'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'
import { buildToolSet } from './api-tools'
import type { PermissionGuard } from './api-tools/PermissionGuard'

const DEFAULT_MAX_OUTPUT_TOKENS = 8192
const GLM_MAX_OUTPUT_TOKENS = 131_072
const CONTEXT_WINDOW_OUTPUT_RESERVE_TOKENS = 8192
const MIN_CONTEXT_SAFE_OUTPUT_TOKENS = 1024
const STRUCTURED_RECOVERY_MAX_OUTPUT_TOKENS = 8192
const TOKEN_ESTIMATE_NON_CJK_CHARS_PER_TOKEN = 2
const DEFAULT_TEMPERATURE = 0.2
const DEFAULT_TOP_P = 1
const MAX_OUTPUT_TOKENS_ERROR_MESSAGE =
  'API 输出达到最大输出 Tokens 上限，模型回答已被截断。请调高 API Provider 的最大输出 Tokens，或把任务拆小后重试。'

class MaxOutputTokensError extends Error {
  constructor(readonly usage: { inputTokens: number; outputTokens: number }) {
    super(MAX_OUTPUT_TOKENS_ERROR_MESSAGE)
    this.name = 'MaxOutputTokensError'
  }
}

const BASE_CORE_PROMPT = [
  'You are an autonomous agent equipped with tools for reading files, editing files, running shell commands, searching content, fetching URLs, and tracking multi-step work.',
  '',
  'General operating rules:',
  '- Actively use tools when they are needed to inspect facts, modify files, or verify work. Do not merely describe work that requires tool execution.',
  '- Before editing an existing file, read the relevant portion first so you understand the current state.',
  '- Use ls for one directory level, glob for file-name discovery, grep for content search, file_read for local files, file_edit/file_write for direct edits, and bash for tests/builds or commands that cannot be done through safer file tools.',
  '- For multi-step tasks, keep a concise todo_write list and update it as work progresses.',
  '- Treat relative paths as relative to the working directory shown in the environment context.',
  '- Do not run destructive commands or expose secrets unless the user explicitly asks and the action is necessary.',
  '- Keep final responses concise, factual, and include relevant file paths when reporting code changes.'
].join('\n')

export class ApiAdapter implements CliAdapter {
  readonly vendor = 'api' as const
  readonly capabilities: AdapterCapabilities = {
    bidirectionalStdin: false,
    nativeResume: false,
    structuredOutputSchema: false,
    partialTokenStream: true
  }

  constructor(
    private readonly config: ApiProviderConfig,
    private readonly guard: PermissionGuard,
    private readonly logStore?: ApiCallLogStore
  ) {}

  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>()
    void this.run(input, queue)
    return queue
  }

  private async run(input: RunTurnInput, queue: AsyncQueue<AgentEvent>): Promise<void> {
    const sessionId = randomUUID()
    const startedAt = Date.now()
    let modelId = ''
    let callOptions: Record<string, unknown> | null = null
    let status: ApiCallLogStatus = 'success'
    let error: unknown
    let usage = { inputTokens: 0, outputTokens: 0 }
    let structuredOutput: 'native' | 'fallback' | 'none' = 'none'

    queue.push({ kind: 'session-started', sessionId, vendor: 'api' })

    try {
      modelId = input.model ?? this.config.defaultModel ?? this.config.models[0] ?? ''
      if (!modelId) throw new Error(`No model configured for API provider: ${this.config.name}`)

      const messages = buildMessages(input, this.config, modelId)
      const system = buildSystemPrompt(this.config, input, modelId)
      const tools = buildToolSet(input.cwd, input.abortSignal, this.guard, (path, op) => {
        queue.push({ kind: 'file-changed', path, op })
      })
      const baseOptions = {
        model: resolveModel(this.config, modelId) as any,
        messages,
        system,
        temperature: input.apiTemperature ?? DEFAULT_TEMPERATURE,
        topP: input.apiTopP ?? DEFAULT_TOP_P,
        maxOutputTokens: resolveMaxOutputTokens(this.config, modelId, { messages, system, tools }),
        tools,
        stopWhen: stepCountIs(input.apiMaxSteps ?? 10),
        abortSignal: input.abortSignal,
      }
      const useNativeStructuredOutput = Boolean(input.outputSchema && supportsNativeStructuredOutput(this.config, modelId))
      structuredOutput = input.outputSchema
        ? useNativeStructuredOutput ? 'native' : 'fallback'
        : 'none'
      const options = input.outputSchema
        ? useNativeStructuredOutput
          ? { ...baseOptions, output: output.object({ schema: jsonSchema(input.outputSchema), name: 'workflow_handoff' }) }
          : { ...baseOptions, system: withStructuredOutputFallbackHint(baseOptions.system, input.outputSchema) }
        : baseOptions
      callOptions = options
      try {
        usage = await executeModelTurn(options as Parameters<typeof streamText>[0], sessionId, queue)
      } catch (err) {
        if (input.outputSchema && err instanceof MaxOutputTokensError) {
          usage = addUsage(usage, err.usage)
          structuredOutput = 'fallback'
          queue.push({
            kind: 'system',
            text: 'API output hit the max token limit; retrying with a concise structured handoff.'
          })
          const recoveryOptions = buildStructuredRecoveryOptions(baseOptions, input.outputSchema, messages)
          callOptions = recoveryOptions
          const recoveryUsage = await executeModelTurn(recoveryOptions as Parameters<typeof streamText>[0], sessionId, queue)
          usage = addUsage(usage, recoveryUsage)
          return
        }
        if (!input.outputSchema || !useNativeStructuredOutput || !isStructuredOutputUnsupportedError(err)) throw err
        structuredOutput = 'fallback'
        const fallbackOptions = {
          ...baseOptions,
          system: withStructuredOutputFallbackHint(baseOptions.system, input.outputSchema)
        }
        callOptions = fallbackOptions
        usage = await executeModelTurn(fallbackOptions as Parameters<typeof streamText>[0], sessionId, queue)
      }
    } catch (err) {
      status = input.abortSignal.aborted ? 'aborted' : 'error'
      error = err
      queue.push({
        kind: 'error',
        recoverable: false,
        message: errorMessage(err),
        raw: err
      })
    } finally {
      if (modelId && callOptions) {
        const entry = this.logApiCall(input, callOptions, modelId, startedAt, status, usage, structuredOutput, error)
        if (entry) {
          queue.push({
            kind: 'system',
            text: compactApiLogEvent(entry.providerName ?? this.config.name, modelId, entry.durationMs ?? 0, entry.usage)
          })
        }
      }
      queue.close()
    }
  }

  private logApiCall(
    input: RunTurnInput,
    callOptions: Record<string, unknown>,
    modelId: string,
    startedAt: number,
    status: ApiCallLogStatus,
    usage: { inputTokens: number; outputTokens: number },
    structuredOutput: 'native' | 'fallback' | 'none',
    error?: unknown
  ) {
    if (!this.logStore) return null
    return this.logStore.record({
      source: input.apiLogSource ?? 'single',
      providerId: this.config.id,
      providerName: this.config.name,
      format: this.config.format,
      baseUrl: this.config.baseUrl,
      model: modelId,
      cwd: input.cwd,
      messagesSummary: summarizeMessages((callOptions.messages as Array<{ role?: unknown; content?: unknown }>) ?? []),
      systemSummary: summarizeSystem(callOptions.system),
      toolNames: Object.keys((callOptions.tools as Record<string, unknown>) ?? {}),
      apiMaxSteps: input.apiMaxSteps ?? 10,
      temperature: callOptions.temperature as number,
      topP: callOptions.topP as number,
      durationMs: Date.now() - startedAt,
      status,
      usage,
      error: error ? errorMessage(error) : undefined,
      structuredOutput
    })
  }
}

export function resolveModel(config: ApiProviderConfig, modelId: string): unknown {
  const baseURL = normalizeProviderBaseUrl(config)
  if (config.format === 'anthropic') {
    const options = shouldUseAnthropicBearerAuth(config)
      ? { authToken: config.apiKey, baseURL }
      : { apiKey: config.apiKey, baseURL }
    return createAnthropic(options)(modelId)
  }
  // Must use .chat() for /v1/chat/completions; many third-party providers do not support /v1/responses.
  const options = { apiKey: config.apiKey, baseURL }
  return createOpenAI(options).chat(modelId)
}

export function normalizeProviderBaseUrl(config: Pick<ApiProviderConfig, 'format' | 'baseUrl'>): string {
  const baseURL = (config.baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!baseURL) throw new Error('未配置 Base URL')
  if (config.format !== 'anthropic') return baseURL

  const baseWithoutEndpoint = baseURL.replace(/\/(?:messages|models)$/i, '')
  return /\/v1$/i.test(baseWithoutEndpoint) ? baseWithoutEndpoint : `${baseWithoutEndpoint}/v1`
}

export function shouldUseAnthropicBearerAuth(
  config: Pick<ApiProviderConfig, 'format' | 'baseUrl' | 'name'>
): boolean {
  if (config.format !== 'anthropic') return false
  const marker = `${config.name} ${config.baseUrl ?? ''}`.toLowerCase()
  return marker.includes('bigmodel.cn') || marker.includes('zhipu') || /\bglm\b/.test(marker)
}

function supportsNativeStructuredOutput(config: ApiProviderConfig, modelId: string): boolean {
  return !isKnownJsonSchemaUnsupportedProvider(config, modelId)
}

interface MaxOutputTokenRequestParts {
  messages: unknown
  system: unknown
  tools: unknown
}

function resolveMaxOutputTokens(
  config: ApiProviderConfig,
  modelId: string,
  request?: MaxOutputTokenRequestParts
): number {
  const configured = typeof config.maxOutputTokens === 'number' && Number.isFinite(config.maxOutputTokens)
    ? Math.floor(config.maxOutputTokens)
    : DEFAULT_MAX_OUTPUT_TOKENS
  const positive = configured >= 1 ? configured : DEFAULT_MAX_OUTPUT_TOKENS
  const limits = [
    maxOutputTokensLimit(config, modelId),
    contextSafeMaxOutputTokens(config, modelId, request)
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1)
  const limit = limits.length ? Math.min(...limits) : null
  return limit ? Math.min(positive, limit) : positive
}

function maxOutputTokensLimit(config: ApiProviderConfig, modelId: string): number | null {
  const marker = `${config.name} ${config.baseUrl ?? ''} ${modelId}`.toLowerCase()
  if (
    marker.includes('bigmodel.cn') ||
    marker.includes('zhipu') ||
    /\bglm[-_.\w]*/.test(marker)
  ) {
    return GLM_MAX_OUTPUT_TOKENS
  }
  return null
}

function contextSafeMaxOutputTokens(
  config: ApiProviderConfig,
  modelId: string,
  request?: MaxOutputTokenRequestParts
): number | null {
  const contextWindow = modelContextWindow(config, modelId)
  if (!contextWindow) return null

  const estimatedInputTokens = request ? estimateRequestInputTokens(request) : 0
  const available = contextWindow - estimatedInputTokens - CONTEXT_WINDOW_OUTPUT_RESERVE_TOKENS
  if (available >= MIN_CONTEXT_SAFE_OUTPUT_TOKENS) return Math.floor(available)
  if (contextWindow > estimatedInputTokens) return Math.max(1, Math.floor(contextWindow - estimatedInputTokens))
  return 1
}

function modelContextWindow(config: ApiProviderConfig, modelId: string): number | null {
  const direct = config.modelContextWindows?.[modelId]
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 1) return Math.floor(direct)

  const lowerModelId = modelId.toLowerCase()
  const matched = Object.entries(config.modelContextWindows ?? {})
    .find(([id]) => id.toLowerCase() === lowerModelId)?.[1]
  if (typeof matched === 'number' && Number.isFinite(matched) && matched >= 1) return Math.floor(matched)

  const marker = `${config.name} ${config.baseUrl ?? ''} ${modelId}`.toLowerCase()
  const moonshotWindow = moonshotModelContextWindow(marker)
  if (moonshotWindow) return moonshotWindow
  return null
}

function moonshotModelContextWindow(marker: string): number | null {
  const moonshotMatch = marker.match(/\bmoonshot-v1-(\d+)k\b/)
  if (moonshotMatch) return Number(moonshotMatch[1]) * 1024
  if (/\bkimi-k2(?:\.6|-thinking(?:-\d+)?)\b/.test(marker)) return 262_144
  if (/\bkimi-k2\b/.test(marker)) return 131_072
  if (/\bkimi\b/.test(marker)) return 262_144
  return null
}

function estimateRequestInputTokens(request: MaxOutputTokenRequestParts): number {
  return roughTokenCount([
    safeTokenEstimateText(request.system),
    safeTokenEstimateText(request.messages),
    safeTokenEstimateText(request.tools)
  ].join('\n'))
}

function safeTokenEstimateText(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === 'function') return `[Function ${current.name || 'anonymous'}]`
      if (typeof current === 'bigint') return current.toString()
      if (current && typeof current === 'object') {
        if (seen.has(current)) return '[Circular]'
        seen.add(current)
      }
      return current
    }) ?? ''
  } catch {
    return String(value)
  }
}

function roughTokenCount(text: string): number {
  if (!text) return 0
  const cjkChars = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  return Math.ceil(cjkChars + (text.length - cjkChars) / TOKEN_ESTIMATE_NON_CJK_CHARS_PER_TOKEN)
}

function isKnownJsonSchemaUnsupportedProvider(config: ApiProviderConfig, modelId: string): boolean {
  const marker = `${config.name} ${config.baseUrl ?? ''} ${modelId}`.toLowerCase()
  return (
    marker.includes('deepseek') ||
    marker.includes('bigmodel.cn') ||
    marker.includes('zhipu') ||
    marker.includes('z.ai') ||
    /\bglm[-_.\w]*/.test(marker)
  )
}

interface StreamState {
  text: string
  meaningful: boolean
  turnDone: boolean
  noOutput: boolean
  finishReason?: string
  usage: { inputTokens: number; outputTokens: number }
}

function mapStreamPart(part: Record<string, unknown>, sessionId: string, queue: AsyncQueue<AgentEvent>, state: StreamState): void {
  if (state.turnDone) return

  switch (part.type) {
    case 'text-delta': {
      const text = stringValue(part.textDelta ?? part.delta ?? part.text)
      if (text) {
        state.text += text
        state.meaningful = true
        queue.push({ kind: 'message-delta', text })
      }
      return
    }
    case 'reasoning-delta': {
      const text = stringValue(part.text ?? part.delta)
      if (text) {
        state.meaningful = true
        queue.push({ kind: 'thinking', text })
      }
      return
    }
    case 'tool-call':
      state.meaningful = true
      queue.push({
        kind: 'tool-call',
        id: stringValue(part.toolCallId),
        name: stringValue(part.toolName),
        input: part.args ?? part.input
      })
      return
    case 'tool-result':
      state.meaningful = true
      queue.push({
        kind: 'tool-result',
        id: stringValue(part.toolCallId),
        ok: !part.error,
        output: part.result ?? part.output ?? part.error
      })
      return
    case 'tool-error':
      state.meaningful = true
      queue.push({
        kind: 'tool-result',
        id: stringValue(part.toolCallId),
        ok: false,
        output: errorMessage(part.error ?? part)
      })
      return
    case 'tool-output-denied':
      state.meaningful = true
      queue.push({
        kind: 'tool-result',
        id: stringValue(part.toolCallId),
        ok: false,
        output: 'Tool output was denied.'
      })
      return
    case 'finish-step':
    case 'step-finish': {
      const finishReason = stringValue(part.finishReason)
      if (finishReason) state.finishReason = finishReason
      const usage = isRecord(part.usage) ? part.usage : part
      emitUsage(usage, queue, state)
      return
    }
    case 'finish': {
      const finishReason = stringValue(part.finishReason)
      if (finishReason) state.finishReason = finishReason
      if (isRecord(part.totalUsage)) emitUsage(part.totalUsage, queue, state)
      if (isLengthFinishReason(state.finishReason)) return
      finishComplete(sessionId, queue, state)
      return
    }
    case 'abort':
      flushAssistantMessage(queue, state)
      state.turnDone = true
      queue.push({ kind: 'turn-done', sessionId, reason: 'aborted' })
      return
    case 'error': {
      const error = part.error ?? part
      if (isNoOutputGeneratedError(error)) {
        state.noOutput = true
        return
      }
      queue.push({
        kind: 'error',
        recoverable: false,
        message: errorMessage(error),
        raw: error
      })
      return
    }
    default:
      return
  }
}

async function executeModelTurn(
  options: Parameters<typeof streamText>[0],
  sessionId: string,
  queue: AsyncQueue<AgentEvent>
): Promise<{ inputTokens: number; outputTokens: number }> {
  const state: StreamState = {
    text: '',
    meaningful: false,
    turnDone: false,
    noOutput: false,
    usage: { inputTokens: 0, outputTokens: 0 }
  }

  try {
    const result = await streamText(options)
    for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
      if (part.type === 'error' && isStructuredOutputUnsupportedError(part.error ?? part)) {
        throw part.error ?? part
      }
      if (part.type === 'error' && isTransientStreamTerminationError(part.error ?? part)) {
        throw part.error ?? part
      }
      mapStreamPart(part, sessionId, queue, state)
    }

    if (isLengthFinishReason(state.finishReason)) {
      flushAssistantMessage(queue, state)
      throw new MaxOutputTokensError(state.usage)
    }

    if (state.noOutput && !state.turnDone) {
      if (state.meaningful) finishComplete(sessionId, queue, state)
      else return runGenerateFallback(options as Parameters<typeof generateText>[0], sessionId, queue)
    } else if (!state.turnDone) {
      if (state.meaningful) finishComplete(sessionId, queue, state)
      else return runGenerateFallback(options as Parameters<typeof generateText>[0], sessionId, queue)
    }
    return state.usage
  } catch (err) {
    if (!isNoOutputGeneratedError(err) && !isTransientStreamTerminationError(err)) throw err
    if (isAbortSignalAborted(options)) throw err
    if (isTransientStreamTerminationError(err) && state.meaningful) throw err
    if (state.meaningful) {
      finishComplete(sessionId, queue, state)
      return state.usage
    }
    return runGenerateFallback(options as Parameters<typeof generateText>[0], sessionId, queue)
  }
}

async function runGenerateFallback(
  options: Parameters<typeof generateText>[0],
  sessionId: string,
  queue: AsyncQueue<AgentEvent>
): Promise<{ inputTokens: number; outputTokens: number }> {
  const result = await generateText(options)
  const text = result.text.trim()
  const usage = {
    inputTokens: numberValue(result.totalUsage?.inputTokens),
    outputTokens: numberValue(result.totalUsage?.outputTokens)
  }
  const emitFallbackUsage = (): void => {
    if (usage.inputTokens > 0 || usage.outputTokens > 0) queue.push({ kind: 'usage', ...usage })
  }

  if (isLengthFinishReason(result.finishReason)) {
    if (text) queue.push({ kind: 'message', role: 'assistant', text })
    emitFallbackUsage()
    throw new MaxOutputTokensError(usage)
  }

  if (!text) {
    queue.push({
      kind: 'error',
      recoverable: false,
      message: 'API provider returned an empty response.',
      raw: result
    })
    return { inputTokens: 0, outputTokens: 0 }
  }

  queue.push({ kind: 'message', role: 'assistant', text })
  emitFallbackUsage()
  queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
  return usage
}

function buildMessages(input: RunTurnInput, config: ApiProviderConfig, modelId: string): ModelMessage[] {
  const attachments = input.attachments ?? []
  if (input.messages?.length) {
    return mergeAttachmentsIntoMessages(
      withReplayRuntimeBoundary(input.messages, config, modelId),
      attachments,
      modelId
    ) as ModelMessage[]
  }
  return [buildUserMessage(input.prompt, attachments, modelId)]
}

function buildUserMessage(text: string, attachments: RunAttachment[], modelId: string): ModelMessage {
  return { role: 'user', content: buildUserContent(text, attachments, modelId) as any }
}

function buildUserContent(text: string, attachments: RunAttachment[], modelId: string): string | Array<Record<string, unknown>> {
  if (attachments.length === 0) return text
  return appendAttachmentsToContent([{ type: 'text', text }], attachments, modelId)
}

function mergeAttachmentsIntoMessages(
  messages: ApiConversationMessage[],
  attachments: RunAttachment[],
  modelId: string
): ApiConversationMessage[] {
  if (attachments.length === 0) return messages
  const next = messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : message.content
  }))

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index]
    if (message.role !== 'user') continue
    message.content = typeof message.content === 'string'
      ? buildUserContent(message.content, attachments, modelId)
      : appendAttachmentsToContent(message.content, attachments, modelId)
    return next
  }

  next.push({ role: 'user', content: buildUserContent('', attachments, modelId) })
  return next
}

function withReplayRuntimeBoundary(
  messages: ApiConversationMessage[],
  config: ApiProviderConfig,
  modelId: string
): ApiConversationMessage[] {
  const next = messages.map((message) => cloneApiMessage(message))
  const boundary: ApiConversationMessage = {
    role: 'user',
    content: [
      '# Current Runtime Boundary',
      'The transcript above is historical context from earlier session segments.',
      `Current provider: ${config.name}`,
      `Current model id: ${modelId}`,
      'Answer runtime, provider, and model identity questions using only the current provider/model above.',
      'Ignore or correct older assistant self-identification in the historical transcript when it conflicts with this boundary.'
    ].join('\n')
  }

  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role !== 'user') continue
    next.splice(index, 0, boundary)
    return next
  }

  next.push(boundary)
  return next
}

function cloneApiMessage(message: ApiConversationMessage): ApiConversationMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : message.content
  }
}

function appendAttachmentsToContent(
  initialContent: Array<Record<string, unknown>>,
  attachments: RunAttachment[],
  modelId: string
): Array<Record<string, unknown>> {
  const content = initialContent.map((part) => ({ ...part }))
  const attachmentNotes: string[] = []
  const vision = isLikelyVisionModel(modelId)

  for (const attachment of attachments) {
    const kind = attachment.kind ?? inferAttachmentKind(attachment.path)
    if (kind === 'image' && vision) {
      try {
        content.push({
          type: 'image',
          image: readFileSync(attachment.path),
          mediaType: attachment.mediaType ?? mediaTypeForPath(attachment.path)
        })
      } catch (err) {
        attachmentNotes.push(`Image attachment unavailable (${attachment.path}): ${errorMessage(err)}`)
      }
    } else {
      attachmentNotes.push(`${kind === 'image' ? 'Image' : 'File'} attachment path: ${attachment.path}`)
    }
  }

  if (attachmentNotes.length > 0) {
    content.push({ type: 'text', text: `\n\nAttachments:\n${attachmentNotes.map((item) => `- ${item}`).join('\n')}` })
  }
  return content
}

function buildSystemPrompt(
  config: ApiProviderConfig,
  input: RunTurnInput,
  modelId: string
): string | SystemModelMessage[] {
  const projectRules = readProjectRules(input.cwd)
  const stable = [
    BASE_CORE_PROMPT,
    buildRuntimeIdentityPrompt(config, modelId, Boolean(input.messages?.length)),
    projectRules ? `# Project Instructions\n${projectRules}` : '',
    input.appendSystemPrompt ? `# Additional Agent Instructions\n${input.appendSystemPrompt}` : ''
  ].filter(Boolean).join('\n\n')

  const volatile = [
    '# Environment Context',
    `Working directory: ${input.cwd}`,
    `Operating system: ${platform()} ${release()}`,
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    gitStatus(input.cwd),
    topLevelDirectory(input.cwd),
    input.addDirs?.length ? `Additional directories:\n${input.addDirs.map((dir) => `- ${dir}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n')

  if (config.format !== 'anthropic') return `${stable}\n\n${volatile}`
  return [
    {
      role: 'system',
      content: stable,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
    },
    { role: 'system', content: volatile }
  ]
}

function buildRuntimeIdentityPrompt(
  config: ApiProviderConfig,
  modelId: string,
  hasReplayMessages: boolean
): string {
  return [
    '# Runtime Identity',
    'This turn is running inside NextureAI API mode.',
    `Configured provider: ${config.name}`,
    `Configured model id: ${modelId}`,
    'If the user asks which model, provider, or runtime you are, answer from the configured provider/model above.',
    'Do not claim to be Claude, Codex, GPT, Kimi, Gemini, Playwright MCP, or any other product/runtime unless that exactly matches the configured provider/model above.',
    'Do not guess hidden runtime details that were not provided in this prompt.',
    hasReplayMessages
      ? 'Earlier transcript messages may come from a different session segment or model. Treat them as conversation history only, not as authoritative metadata about your current runtime identity.'
      : '',
    'When branding is ambiguous, describe yourself as NextureAI API mode using the configured provider/model id.'
  ].filter(Boolean).join('\n')
}

function withStructuredOutputFallbackHint(
  system: string | SystemModelMessage[],
  schema: NonNullable<RunTurnInput['outputSchema']>
): string | SystemModelMessage[] {
  const hint = [
    '# Structured Output Fallback',
    'This provider is using prompt-enforced structured output for this request.',
    'This output requirement has higher priority than any earlier instruction that asks for a table, prose summary, markdown, or another final format.',
    'If another instruction asks for a final table or report, encode that result inside the JSON fields. The final assistant message itself must still be only the JSON object.',
    'Return ONLY a JSON object that conforms to this JSON Schema. Do not wrap it in markdown fences and do not add prose before or after the JSON.',
    '',
    safeSchemaText(schema)
  ].join('\n')

  if (typeof system === 'string') return `${system}\n\n${hint}`
  return [...system, { role: 'system', content: hint }]
}

function withMaxOutputRecoveryHint(system: string | SystemModelMessage[]): string | SystemModelMessage[] {
  const hint = [
    '# Max Output Recovery',
    'The previous response hit the max output token limit before the workflow handoff could finish.',
    'Do not continue the long prose or report.',
    'Return only the final concise structured handoff JSON for the work already completed.',
    'Keep the summary brief and include only the key artifact paths.'
  ].join('\n')

  if (typeof system === 'string') return `${system}\n\n${hint}`
  return [...system, { role: 'system', content: hint }]
}

function buildStructuredRecoveryOptions(
  baseOptions: Record<string, unknown>,
  schema: NonNullable<RunTurnInput['outputSchema']>,
  messages: ModelMessage[]
): Record<string, unknown> {
  const { tools: _tools, stopWhen: _stopWhen, output: _output, ...withoutTools } = baseOptions
  const baseMaxOutputTokens = typeof baseOptions.maxOutputTokens === 'number' && Number.isFinite(baseOptions.maxOutputTokens)
    ? Math.floor(baseOptions.maxOutputTokens)
    : STRUCTURED_RECOVERY_MAX_OUTPUT_TOKENS
  return {
    ...withoutTools,
    messages: buildStructuredRecoveryMessages(messages),
    system: withStructuredOutputFallbackHint(withMaxOutputRecoveryHint(baseOptions.system as string | SystemModelMessage[]), schema),
    maxOutputTokens: Math.max(1, Math.min(baseMaxOutputTokens, STRUCTURED_RECOVERY_MAX_OUTPUT_TOKENS))
  }
}

function buildStructuredRecoveryMessages(messages: ModelMessage[]): ModelMessage[] {
  return [
    ...messages,
    {
      role: 'user',
      content: [
        'The previous response was truncated by the max output token limit.',
        'Do not continue the truncated response.',
        'Return only a concise JSON object that satisfies the required workflow handoff schema.'
      ].join('\n')
    } as ModelMessage
  ]
}

function addUsage(
  a: { inputTokens: number; outputTokens: number },
  b: { inputTokens: number; outputTokens: number }
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens
  }
}

function safeSchemaText(schema: NonNullable<RunTurnInput['outputSchema']>): string {
  try {
    return JSON.stringify(schema, null, 2)
  } catch {
    return String(schema)
  }
}

function readProjectRules(cwd: string): string {
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const path = join(cwd, name)
    if (!existsSync(path)) continue
    try {
      return `${name}\n${readFileSync(path, 'utf8').slice(0, 12000)}`
    } catch {
      return ''
    }
  }
  return ''
}

function topLevelDirectory(cwd: string): string {
  try {
    const entries = readdirSync(cwd)
      .filter((entry) => !['.git', 'node_modules'].includes(entry))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 80)
      .map((entry) => {
        try {
          return statSync(join(cwd, entry)).isDirectory() ? `${entry}/` : entry
        } catch {
          return entry
        }
      })
    return `Top-level directory entries:\n${entries.map((entry) => `- ${entry}`).join('\n')}`
  } catch (err) {
    return `Top-level directory entries: unavailable (${errorMessage(err)})`
  }
}

function gitStatus(cwd: string): string {
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' })
  if (branch.status !== 0) return 'Git status: not a git repository or git unavailable'
  const status = spawnSync('git', ['status', '--short'], { cwd, encoding: 'utf8' })
  const clean = (status.stdout ?? '').trim().length === 0
  return [
    'Git status:',
    `- Branch: ${(branch.stdout ?? '').trim() || '(detached)'}`,
    `- Uncommitted changes: ${clean ? 'no' : 'yes'}`
  ].join('\n')
}

function finishComplete(sessionId: string, queue: AsyncQueue<AgentEvent>, state: StreamState): void {
  flushAssistantMessage(queue, state)
  state.turnDone = true
  queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
}

function flushAssistantMessage(queue: AsyncQueue<AgentEvent>, state: StreamState): void {
  if (!state.text) return
  queue.push({ kind: 'message', role: 'assistant', text: state.text })
  state.text = ''
}

function emitUsage(usage: Record<string, unknown>, queue: AsyncQueue<AgentEvent>, state: StreamState): void {
  const inputTokens = numberValue(usage.inputTokens ?? usage.promptTokens)
  const outputTokens = numberValue(usage.outputTokens ?? usage.completionTokens)
  if (inputTokens > 0 || outputTokens > 0) {
    state.usage = { inputTokens, outputTokens }
    queue.push({ kind: 'usage', inputTokens, outputTokens })
  }
}

function summarizeSystem(system: unknown): string {
  if (typeof system === 'string') return truncate(system, 4000)
  if (Array.isArray(system)) return truncate(system.map((part) => isRecord(part) ? String(part.content ?? '') : '').join('\n'), 4000)
  if (isRecord(system)) return truncate(String(system.content ?? ''), 4000)
  return ''
}

function summarizeMessages(messages: Array<{ role?: unknown; content?: unknown }>): string {
  return truncate(messages.map((message) => {
    const content = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content) ? message.content.map((part) => {
          if (isRecord(part) && part.type === 'text') return String(part.text ?? '')
          if (isRecord(part) && part.type === 'image') return `[image ${String(part.mediaType ?? '')}]`
          if (isRecord(part) && part.type === 'tool-call') return `[tool-call ${String(part.toolName ?? '')}]`
          if (isRecord(part) && part.type === 'tool-result') return `[tool-result ${String(part.toolName ?? '')}]`
          return `[${isRecord(part) ? String(part.type ?? 'part') : 'part'}]`
        }).join('\n') : String(message.content ?? '')
    return `${String(message.role ?? 'message')}: ${content}`
  }).join('\n\n'), 4000)
}

function compactApiLogEvent(providerName: string, modelId: string, durationMs: number, usage?: { inputTokens: number; outputTokens: number }): string {
  const tokens = usage && (usage.inputTokens > 0 || usage.outputTokens > 0)
    ? ` · ${formatTokens(usage.inputTokens + usage.outputTokens)} tokens`
    : ''
  return `API call: ${providerName}/${modelId} · ${formatDuration(durationMs)}${tokens}`
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function formatDuration(durationMs: number): string {
  const ms = Math.max(0, Math.round(durationMs))
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${formatDurationNumber(seconds)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${formatDurationNumber(minutes)}min`
  return `${formatDurationNumber(minutes / 60)}h`
}

function formatDurationNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function inferAttachmentKind(path: string): 'image' | 'file' {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ? 'image' : 'file'
}

function isLikelyVisionModel(modelId: string): boolean {
  return /(gpt-4o|vision|omni|vl|claude-3|gemini|glm-4v|qwen.*vl|mimo-v2-omni|kimi(?:-k2(?:\.\d+)?|.*(?:vision|vl|omni))|moonshot.*(?:vision|vl|omni))/i.test(modelId)
}

function mediaTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isLengthFinishReason(value: unknown): boolean {
  return value === 'length'
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

const NESTED_ERROR_KEYS = ['cause', 'error', 'message', 'responseBody', 'body', 'data'] as const

function collectErrorText(value: unknown, seen = new Set<object>()): string[] {
  if (value == null) return []
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object') return [String(value)]
  if (seen.has(value)) return []
  seen.add(value)

  const record = value as Record<string, unknown>
  const parts: string[] = value instanceof Error && value.message ? [value.message] : []
  for (const key of NESTED_ERROR_KEYS) {
    const nested = record[key]
    if (nested !== undefined) parts.push(...collectErrorText(nested, seen))
  }
  return parts
}

function isNoOutputGeneratedError(value: unknown): boolean {
  if (!(value instanceof Error)) return false
  return (
    value.name === 'AI_NoOutputGeneratedError' ||
    value.constructor.name === 'NoOutputGeneratedError' ||
    value.message.includes('No output generated')
  )
}

function isTransientStreamTerminationError(value: unknown): boolean {
  const message = collectErrorText(value).join('\n').toLowerCase()
  return /(^|\W)terminated(\W|$)/.test(message)
}

function isAbortSignalAborted(options: { abortSignal?: unknown }): boolean {
  const signal = options.abortSignal
  return isRecord(signal) && signal.aborted === true
}

function isStructuredOutputUnsupportedError(value: unknown): boolean {
  const message = collectErrorText(value).join('\n').toLowerCase()
  return (
    message.includes('json_schema') ||
    message.includes('response_format') ||
    message.includes('structured output') ||
    message.includes('unsupported output') ||
    message.includes('object generation')
  )
}
