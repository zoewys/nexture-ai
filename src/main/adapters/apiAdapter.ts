import { randomUUID } from 'node:crypto'
import { generateText, streamText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { AdapterCapabilities, AgentEvent, ApiProviderConfig } from '@shared/types'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'
import { buildToolSet } from './api-tools'
import type { PermissionGuard } from './api-tools/PermissionGuard'

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
    private readonly guard: PermissionGuard
  ) {}

  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>()
    void this.run(input, queue)
    return queue
  }

  private async run(input: RunTurnInput, queue: AsyncQueue<AgentEvent>): Promise<void> {
    const sessionId = randomUUID()
    queue.push({ kind: 'session-started', sessionId, vendor: 'api' })

    try {
      const modelId = input.model ?? this.config.defaultModel ?? this.config.models[0]
      if (!modelId) throw new Error(`No model configured for API provider: ${this.config.name}`)

      const options = {
        model: resolveModel(this.config, modelId) as any,
        prompt: input.prompt,
        system: input.appendSystemPrompt,
        temperature: 1,
        topP: 0.95,
        tools: buildToolSet(input.cwd, input.abortSignal, this.guard, (path, op) => {
          queue.push({ kind: 'file-changed', path, op })
        }),
        stopWhen: stepCountIs(input.apiMaxSteps ?? 10),
        abortSignal: input.abortSignal
      }

      let sawModelEvent = false
      let sawTurnDone = false
      let sawNoOutputError = false
      try {
        const result = await streamText(options)
        for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
          const mapped = mapStreamPart(part, sessionId, queue)
          sawModelEvent ||= mapped.meaningful
          sawTurnDone ||= mapped.turnDone
          sawNoOutputError ||= mapped.noOutput
        }

        if (sawNoOutputError && !sawTurnDone) {
          if (sawModelEvent) {
            queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
          } else {
            await runGenerateFallback(options, sessionId, queue)
          }
        } else if (!sawTurnDone) {
          if (sawModelEvent) {
            queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
          } else {
            await runGenerateFallback(options, sessionId, queue)
          }
        }
      } catch (err) {
        if (!isNoOutputGeneratedError(err)) throw err
        if (sawModelEvent) {
          queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
        } else {
          await runGenerateFallback(options, sessionId, queue)
        }
      }
    } catch (err) {
      queue.push({
        kind: 'error',
        recoverable: false,
        message: errorMessage(err),
        raw: err
      })
    } finally {
      queue.close()
    }
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
  // 必须用 .chat() 走 /v1/chat/completions，不能用默认的 Responses API (/v1/responses)
  // 因为 DeepSeek / Moonshot / SiliconFlow 等第三方只支持 Chat Completions
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

interface MappedStreamPart {
  meaningful: boolean
  turnDone: boolean
  noOutput: boolean
}

function mapStreamPart(part: Record<string, unknown>, sessionId: string, queue: AsyncQueue<AgentEvent>): MappedStreamPart {
  switch (part.type) {
    case 'text-delta': {
      const text = stringValue(part.textDelta ?? part.text)
      if (text) queue.push({ kind: 'message-delta', text })
      return { meaningful: text.length > 0, turnDone: false, noOutput: false }
    }
    case 'tool-call':
      queue.push({
        kind: 'tool-call',
        id: stringValue(part.toolCallId),
        name: stringValue(part.toolName),
        input: part.args ?? part.input
      })
      return { meaningful: true, turnDone: false, noOutput: false }
    case 'tool-result':
      queue.push({
        kind: 'tool-result',
        id: stringValue(part.toolCallId),
        ok: !part.error,
        output: part.result ?? part.output ?? part.error
      })
      return { meaningful: true, turnDone: false, noOutput: false }
    case 'step-finish': {
      const usage = isRecord(part.usage) ? part.usage : part
      const inputTokens = numberValue(usage.inputTokens ?? usage.promptTokens)
      const outputTokens = numberValue(usage.outputTokens ?? usage.completionTokens)
      if (inputTokens > 0 || outputTokens > 0) queue.push({ kind: 'usage', inputTokens, outputTokens })
      return { meaningful: inputTokens > 0 || outputTokens > 0, turnDone: false, noOutput: false }
    }
    case 'finish': {
      queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
      return { meaningful: true, turnDone: true, noOutput: false }
    }
    case 'error': {
      const error = part.error ?? part
      if (isNoOutputGeneratedError(error)) return { meaningful: false, turnDone: false, noOutput: true }
      queue.push({
        kind: 'error',
        recoverable: false,
        message: errorMessage(error),
        raw: error
      })
      return { meaningful: false, turnDone: false, noOutput: false }
    }
    default:
      return { meaningful: false, turnDone: false, noOutput: false }
  }
}

async function runGenerateFallback(
  options: Parameters<typeof generateText>[0],
  sessionId: string,
  queue: AsyncQueue<AgentEvent>
): Promise<void> {
  const result = await generateText(options)
  const text = result.text.trim()
  if (!text) {
    queue.push({
      kind: 'error',
      recoverable: false,
      message: 'API provider returned an empty response.',
      raw: result
    })
    return
  }

  queue.push({ kind: 'message', role: 'assistant', text })
  const inputTokens = numberValue(result.totalUsage?.inputTokens)
  const outputTokens = numberValue(result.totalUsage?.outputTokens)
  if (inputTokens > 0 || outputTokens > 0) queue.push({ kind: 'usage', inputTokens, outputTokens })
  queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
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
