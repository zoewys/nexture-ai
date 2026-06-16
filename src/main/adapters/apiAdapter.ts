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
const DEFAULT_TEMPERATURE = 0.2
const DEFAULT_TOP_P = 1

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
    let structuredOutput: 'native' | 'fallback' | 'none' = input.outputSchema ? 'native' : 'none'

    queue.push({ kind: 'session-started', sessionId, vendor: 'api' })

    try {
      modelId = input.model ?? this.config.defaultModel ?? this.config.models[0] ?? ''
      if (!modelId) throw new Error(`No model configured for API provider: ${this.config.name}`)

      const messages = buildMessages(input, modelId)
      const system = buildSystemPrompt(this.config, input)
      const tools = buildToolSet(input.cwd, input.abortSignal, this.guard, (path, op) => {
        queue.push({ kind: 'file-changed', path, op })
      })
      const baseOptions = {
        model: resolveModel(this.config, modelId) as any,
        messages,
        system,
        temperature: input.apiTemperature ?? DEFAULT_TEMPERATURE,
        topP: input.apiTopP ?? DEFAULT_TOP_P,
        maxOutputTokens: this.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        tools,
        stopWhen: stepCountIs(input.apiMaxSteps ?? 10),
        abortSignal: input.abortSignal,
      }
      const options = input.outputSchema
        ? { ...baseOptions, output: output.object({ schema: jsonSchema(input.outputSchema), name: 'workflow_handoff' }) }
        : baseOptions
      callOptions = options
      try {
        usage = await executeModelTurn(options as Parameters<typeof streamText>[0], sessionId, queue)
      } catch (err) {
        if (!input.outputSchema || !isStructuredOutputUnsupportedError(err)) throw err
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

interface StreamState {
  text: string
  meaningful: boolean
  turnDone: boolean
  noOutput: boolean
  usage: { inputTokens: number; outputTokens: number }
}

function mapStreamPart(part: Record<string, unknown>, sessionId: string, queue: AsyncQueue<AgentEvent>, state: StreamState): void {
  if (state.turnDone) return

  switch (part.type) {
    case 'text-delta': {
      const text = stringValue(part.textDelta ?? part.text)
      if (text) {
        state.text += text
        state.meaningful = true
        queue.push({ kind: 'message-delta', text })
      }
      return
    }
    case 'reasoning-delta': {
      const text = stringValue(part.text)
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
      const usage = isRecord(part.usage) ? part.usage : part
      emitUsage(usage, queue, state)
      return
    }
    case 'finish': {
      if (isRecord(part.totalUsage)) emitUsage(part.totalUsage, queue, state)
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
      mapStreamPart(part, sessionId, queue, state)
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
    if (!isNoOutputGeneratedError(err)) throw err
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
  const usage = {
    inputTokens: numberValue(result.totalUsage?.inputTokens),
    outputTokens: numberValue(result.totalUsage?.outputTokens)
  }
  if (usage.inputTokens > 0 || usage.outputTokens > 0) queue.push({ kind: 'usage', ...usage })
  queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
  return usage
}

function buildMessages(input: RunTurnInput, modelId: string): ModelMessage[] {
  if (input.messages?.length) return input.messages as ModelMessage[]
  return [buildUserMessage(input.prompt, input.attachments ?? [], modelId)]
}

function buildUserMessage(text: string, attachments: RunAttachment[], modelId: string): ModelMessage {
  if (attachments.length === 0) return { role: 'user', content: text }
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }]
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
  return { role: 'user', content: content as any }
}

function buildSystemPrompt(config: ApiProviderConfig, input: RunTurnInput): string | SystemModelMessage[] {
  const projectRules = readProjectRules(input.cwd)
  const stable = [
    BASE_CORE_PROMPT,
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

function withStructuredOutputFallbackHint(
  system: string | SystemModelMessage[],
  schema: NonNullable<RunTurnInput['outputSchema']>
): string | SystemModelMessage[] {
  const hint = [
    '# Structured Output Fallback',
    'The provider did not accept native structured output for this request.',
    'Return ONLY a JSON object that conforms to this JSON Schema. Do not wrap it in markdown fences and do not add prose before or after the JSON.',
    '',
    safeSchemaText(schema)
  ].join('\n')

  if (typeof system === 'string') return `${system}\n\n${hint}`
  return [...system, { role: 'system', content: hint }]
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
  return `API call: ${providerName}/${modelId} · ${durationMs}ms${tokens}`
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function inferAttachmentKind(path: string): 'image' | 'file' {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ? 'image' : 'file'
}

function isLikelyVisionModel(modelId: string): boolean {
  return /(gpt-4o|vision|omni|vl|claude-3|gemini|glm-4v|qwen.*vl|mimo-v2-omni)/i.test(modelId)
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

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function isNoOutputGeneratedError(value: unknown): boolean {
  if (!(value instanceof Error)) return false
  return (
    value.name === 'AI_NoOutputGeneratedError' ||
    value.constructor.name === 'NoOutputGeneratedError' ||
    value.message.includes('No output generated')
  )
}

function isStructuredOutputUnsupportedError(value: unknown): boolean {
  const message = errorMessage(value).toLowerCase()
  return (
    message.includes('json_schema') ||
    message.includes('response_format') ||
    message.includes('structured output') ||
    message.includes('unsupported output') ||
    message.includes('object generation')
  )
}
