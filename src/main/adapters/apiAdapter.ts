import { randomUUID } from 'node:crypto'
import { streamText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { AgentEvent, ApiProviderConfig } from '@shared/types'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'
import { buildToolSet } from './api-tools'
import type { PermissionGuard } from './api-tools/PermissionGuard'

export class ApiAdapter implements CliAdapter {
  readonly vendor = 'api' as const
  readonly capabilities = {
    bidirectionalStdin: false,
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

      const result = await streamText({
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
      })

      for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
        mapStreamPart(part, sessionId, queue)
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
  const baseURL = (config.baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!baseURL) throw new Error('未配置 Base URL')
  const options = { apiKey: config.apiKey, baseURL }
  if (config.format === 'anthropic') return createAnthropic(options)(modelId)
  // 必须用 .chat() 走 /v1/chat/completions，不能用默认的 Responses API (/v1/responses)
  // 因为 DeepSeek / Moonshot / SiliconFlow 等第三方只支持 Chat Completions
  return createOpenAI(options).chat(modelId)
}

function mapStreamPart(part: Record<string, unknown>, sessionId: string, queue: AsyncQueue<AgentEvent>): void {
  switch (part.type) {
    case 'text-delta':
      queue.push({ kind: 'message-delta', text: stringValue(part.textDelta ?? part.text) })
      return
    case 'tool-call':
      queue.push({
        kind: 'tool-call',
        id: stringValue(part.toolCallId),
        name: stringValue(part.toolName),
        input: part.args ?? part.input
      })
      return
    case 'tool-result':
      queue.push({
        kind: 'tool-result',
        id: stringValue(part.toolCallId),
        ok: !part.error,
        output: part.result ?? part.output ?? part.error
      })
      return
    case 'step-finish': {
      const usage = isRecord(part.usage) ? part.usage : part
      const inputTokens = numberValue(usage.inputTokens ?? usage.promptTokens)
      const outputTokens = numberValue(usage.outputTokens ?? usage.completionTokens)
      if (inputTokens > 0 || outputTokens > 0) queue.push({ kind: 'usage', inputTokens, outputTokens })
      return
    }
    case 'finish':
      queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
      return
    case 'error':
      queue.push({
        kind: 'error',
        recoverable: false,
        message: errorMessage(part.error ?? part),
        raw: part.error ?? part
      })
      return
    default:
      return
  }
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
