import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

async function importApiAdapter(mocks) {
  globalThis.__apiAdapterMocks = mocks
  const absPath = join(root, 'src/main/adapters/apiAdapter.ts')
  const outBase = join(root, '.tmp', 'api-adapter-tests')
  mkdirSync(outBase, { recursive: true })
  const outDir = mkdtempSync(join(outBase, 'ts-'))
  const outPath = join(outDir, `apiAdapter-${Date.now()}-${Math.random()}.mjs`)
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const output = transpiled.outputText
    .replace(
      /import\s+\{[^}]*\}\s+from\s+['"]ai['"];?/,
      'const { generateText, streamText, stepCountIs, output, jsonSchema } = globalThis.__apiAdapterMocks;'
    )
    .replace(
      /import\s+\{\s*createAnthropic\s*\}\s+from\s+['"]@ai-sdk\/anthropic['"];?/,
      'const { createAnthropic } = globalThis.__apiAdapterMocks;'
    )
    .replace(
      /import\s+\{\s*createOpenAI\s*\}\s+from\s+['"]@ai-sdk\/openai['"];?/,
      'const { createOpenAI } = globalThis.__apiAdapterMocks;'
    )
    .replace(
      /import\s+\{\s*buildToolSet\s*\}\s+from\s+['"]\.\/api-tools['"];?/,
      'const { buildToolSet } = globalThis.__apiAdapterMocks;'
    )
    .replace(
      /import\s+\{\s*AsyncQueue\s*\}\s+from\s+['"]\.\/AsyncQueue['"];?/,
      `class AsyncQueue {
        values = []
        resolvers = []
        closed = false
        push(value) {
          if (this.closed) return
          const resolve = this.resolvers.shift()
          if (resolve) resolve({ value, done: false })
          else this.values.push(value)
        }
        close() {
          this.closed = true
          while (this.resolvers.length) this.resolvers.shift()({ value: undefined, done: true })
        }
        async *[Symbol.asyncIterator]() {
          while (true) {
            if (this.values.length > 0) {
              yield this.values.shift()
              continue
            }
            if (this.closed) return
            const result = await new Promise((resolve) => this.resolvers.push(resolve))
            if (result.done) return
            yield result.value
          }
        }
      }`
    )
  writeFileSync(outPath, output, 'utf8')
  return import(`${pathToFileURL(outPath).href}?cache=${Date.now()}-${Math.random()}`)
}

async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}

function mocksFor(parts, calls = []) {
  return {
    streamText: async (args) => {
      calls.push(args)
      return {
        fullStream: (async function* () {
          for (const part of parts) {
            if (part instanceof Error) throw part
            yield part
          }
        })()
      }
    },
    generateText: async (args) => {
      calls.push({ ...args, fallback: true })
      return {
        text: 'fallback response',
        totalUsage: { inputTokens: 5, outputTokens: 6 }
      }
    },
    stepCountIs: (count) => ({ stepCount: count }),
    output: {
      object: (input) => ({ mode: 'object', ...input })
    },
    jsonSchema: (schema) => ({ kind: 'json-schema', schema }),
    createAnthropic: (options) => (modelId) => ({ provider: 'anthropic', options, modelId }),
    createOpenAI: (options) => ({ chat: (modelId) => ({ provider: 'openai', options, modelId }) }),
    buildToolSet: () => ({ bash: { execute: async () => ({ exitCode: 0, output: '' }) } })
  }
}

const guard = {
  request: async () => true,
  respond: () => {}
}

function systemText(system) {
  if (typeof system === 'string') return system
  if (Array.isArray(system)) return system.map((part) => part.content).join('\n')
  return system?.content ?? ''
}

function userText(message) {
  if (typeof message.content === 'string') return message.content
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
}

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-studio-api-adapter-'))
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

test('ApiAdapter emits session-started first, maps text deltas, emits a full assistant message, and uses messages', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'hello' },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'Anthropic',
    format: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: 'https://anthropic.example',
    models: ['claude-3-5'],
    defaultModel: 'claude-3-5'
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: 'Say hi',
    cwd: root,
    appendSystemPrompt: 'system text',
    abortSignal: new AbortController().signal
  }))

  assert.equal(events[0].kind, 'session-started')
  assert.equal(events[0].vendor, 'api')
  assert.deepEqual(events[1], { kind: 'message-delta', text: 'hello' })
  assert.deepEqual(events[2], { kind: 'message', role: 'assistant', text: 'hello' })
  assert.equal(events[3].kind, 'turn-done')
  assert.equal(events[3].sessionId, events[0].sessionId)
  assert.equal('prompt' in calls[0], false)
  assert.equal(calls[0].messages[0].role, 'user')
  assert.equal(userText(calls[0].messages[0]), 'Say hi')
  assert.match(systemText(calls[0].system), /You are an autonomous agent/i)
  assert.match(systemText(calls[0].system), /system text/)
  assert.deepEqual(calls[0].stopWhen, { stepCount: 10 })
})

test('ApiAdapter maps AI SDK v6 delta text so DeepSeek workflow handoffs can complete', async () => {
  const { parseHandoff } = await import('../src/main/handoffParser.ts')
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', delta: '{"summary":"ok","artifacts":[]}' },
    { type: 'finish' }
  ]))
  const adapter = new ApiAdapter({
    id: 'deepseek',
    name: 'DeepSeek',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://deepseek.example/v1',
    models: ['deepseek-chat'],
    defaultModel: 'deepseek-chat'
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: 'Return handoff',
    cwd: root,
    outputSchema: {
      type: 'object',
      required: ['summary', 'artifacts'],
      properties: {
        summary: { type: 'string' },
        artifacts: { type: 'array' }
      }
    },
    abortSignal: new AbortController().signal
  }))

  assert.deepEqual(events[1], { kind: 'message-delta', text: '{"summary":"ok","artifacts":[]}' })
  assert.deepEqual(events[2], { kind: 'message', role: 'assistant', text: '{"summary":"ok","artifacts":[]}' })
  assert.equal(events[3].kind, 'turn-done')
  assert.equal(parseHandoff(events)?.summary, 'ok')
})

test('ApiAdapter maps v6 tool call, tool result, usage, reasoning, denied output, and finish events', async () => {
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'tool-call', toolCallId: 'tool-1', toolName: 'bash', args: { command: 'echo hi' } },
    { type: 'tool-result', toolCallId: 'tool-1', result: { exitCode: 0, output: 'hi\n' } },
    { type: 'reasoning-delta', delta: 'checking tools' },
    { type: 'finish-step', usage: { inputTokens: 3, outputTokens: 4 } },
    { type: 'tool-error', toolCallId: 'tool-2', toolName: 'grep', error: new Error('grep failed') },
    { type: 'tool-output-denied', toolCallId: 'tool-3', toolName: 'file_write' },
    { type: 'finish' }
  ]))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'OpenAI',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://example.com/v1',
    models: ['gpt-4o']
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: 'Run',
    cwd: root,
    model: 'gpt-4o-mini',
    apiMaxSteps: 4,
    abortSignal: new AbortController().signal
  }))

  assert.deepEqual(events[1], { kind: 'tool-call', id: 'tool-1', name: 'bash', input: { command: 'echo hi' } })
  assert.deepEqual(events[2], { kind: 'tool-result', id: 'tool-1', ok: true, output: { exitCode: 0, output: 'hi\n' } })
  assert.deepEqual(events[3], { kind: 'thinking', text: 'checking tools' })
  assert.deepEqual(events[4], { kind: 'usage', inputTokens: 3, outputTokens: 4 })
  assert.equal(events[5].kind, 'tool-result')
  assert.equal(events[5].id, 'tool-2')
  assert.equal(events[5].ok, false)
  assert.match(String(events[5].output), /grep failed/)
  assert.deepEqual(events[6], { kind: 'tool-result', id: 'tool-3', ok: false, output: 'Tool output was denied.' })
  assert.equal(events[7].kind, 'turn-done')
})

test('ApiAdapter emits error events for stream error parts and thrown stream errors', async () => {
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'error', error: new Error('model failed') },
    new Error('stream exploded')
  ]))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'OpenAI',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://openai.example/v1',
    models: ['gpt-4o']
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: 'Run',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.equal(events[1].kind, 'error')
  assert.match(events[1].message, /model failed/)
  assert.equal(events[2].kind, 'error')
  assert.match(events[2].message, /stream exploded/)
})

test('ApiAdapter falls back to generateText when provider stream ends without output', async () => {
  const noOutput = new Error('No output generated. The model stream ended without a finish chunk.')
  noOutput.name = 'AI_NoOutputGeneratedError'
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([noOutput], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'GLM',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://glm.example/v1',
    models: ['glm-5.1'],
    defaultModel: 'glm-5.1'
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: '你好',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.equal(events[0].kind, 'session-started')
  assert.deepEqual(events[1], { kind: 'message', role: 'assistant', text: 'fallback response' })
  assert.deepEqual(events[2], { kind: 'usage', inputTokens: 5, outputTokens: 6 })
  assert.equal(events[3].kind, 'turn-done')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].fallback, true)
})

test('ApiAdapter falls back to generateText when stream transport terminates before output', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([new Error('terminated')], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'OpenCode Gateway',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://opencode.example/v1',
    models: ['kimi-k2.6'],
    defaultModel: 'kimi-k2.6'
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: '调整设计稿',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.deepEqual(events[1], { kind: 'message', role: 'assistant', text: 'fallback response' })
  assert.deepEqual(events[2], { kind: 'usage', inputTokens: 5, outputTokens: 6 })
  assert.equal(events[3].kind, 'turn-done')
  assert.equal(events.some((event) => event.kind === 'error'), false)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].fallback, true)
})

test('ApiAdapter keeps stream termination as an error after partial output', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'partial response' },
    new Error('terminated')
  ], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'OpenCode Gateway',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://opencode.example/v1',
    models: ['kimi-k2.6'],
    defaultModel: 'kimi-k2.6'
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: '调整设计稿',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.deepEqual(events[1], { kind: 'message-delta', text: 'partial response' })
  const error = events.find((event) => event.kind === 'error')
  assert.match(error?.message ?? '', /terminated/)
  assert.equal(events.some((event) => event.kind === 'turn-done' && event.reason === 'complete'), false)
  assert.equal(calls.length, 1)
})

test('ApiAdapter falls back when no-output arrives as a stream error part', async () => {
  const noOutput = new Error('No output generated. The model stream ended without a finish chunk.')
  noOutput.name = 'AI_NoOutputGeneratedError'
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'error', error: noOutput }], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'GLM',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://glm.example/v1',
    models: ['glm-5.1'],
    defaultModel: 'glm-5.1'
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: '你好',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.equal(events[0].kind, 'session-started')
  assert.deepEqual(events[1], { kind: 'message', role: 'assistant', text: 'fallback response' })
  assert.deepEqual(events[2], { kind: 'usage', inputTokens: 5, outputTokens: 6 })
  assert.equal(events[3].kind, 'turn-done')
  assert.equal(events.some((event) => event.kind === 'error'), false)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].fallback, true)
})

test('ApiAdapter completes the turn when stream produced text but missed finish chunk', async () => {
  const noOutput = new Error('No output generated. The model stream ended without a finish chunk.')
  noOutput.name = 'AI_NoOutputGeneratedError'
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'partial' },
    noOutput
  ], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'GLM',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://glm.example/v1',
    models: ['glm-5.1'],
    defaultModel: 'glm-5.1'
  }, guard)

  const events = await collect(adapter.runTurn({
    prompt: '你好',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.deepEqual(events[1], { kind: 'message-delta', text: 'partial' })
  assert.deepEqual(events[2], { kind: 'message', role: 'assistant', text: 'partial' })
  assert.equal(events[3].kind, 'turn-done')
  assert.equal(calls.length, 1)
})

test('ApiAdapter builds layered system context from base prompt, environment, project rules, addDirs, and agent prompt', async () => {
  const { dir, cleanup } = tempProject()
  try {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n\nUse lucide-react icons only.', 'utf8')
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}', 'utf8')
    const calls = []
    const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))
    const adapter = new ApiAdapter({
      id: 'p1',
      name: 'OpenAI',
      format: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://openai.example/v1',
      models: ['gpt-4o']
    }, guard)

    await collect(adapter.runTurn({
      prompt: 'Inspect project',
      cwd: dir,
      addDirs: ['/tmp/shared-context'],
      appendSystemPrompt: 'Agent-specific instruction.',
      abortSignal: new AbortController().signal
    }))

    const text = systemText(calls[0].system)
    assert.match(text, /You are an autonomous agent/i)
    assert.match(text, /This turn is running inside NextureAI API mode\./)
    assert.match(text, /Configured provider: OpenAI/)
    assert.match(text, /Configured model id: gpt-4o/)
    assert.match(text, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(text, /Operating system:/)
    assert.match(text, /Current date:/)
    assert.match(text, /package\.json/)
    assert.match(text, /src\//)
    assert.match(text, /AGENTS\.md/)
    assert.match(text, /Use lucide-react icons only/)
    assert.match(text, /\/tmp\/shared-context/)
    assert.match(text, /Agent-specific instruction\./)
  } finally {
    cleanup()
  }
})

test('ApiAdapter system prompt pins runtime identity even when replay messages are provided', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'Volcengine',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://example.com/v1',
    models: ['kimi-k2.6']
  }, guard)

  await collect(adapter.runTurn({
    prompt: 'ignored when replay messages exist',
    cwd: root,
    model: 'kimi-k2.6',
    messages: [
      { role: 'user', content: '你是什么模型' },
      { role: 'assistant', content: '我是 Claude。' },
      { role: 'user', content: '再说一次' }
    ],
    abortSignal: new AbortController().signal
  }))

  const text = systemText(calls[0].system)
  assert.match(text, /Configured provider: Volcengine/)
  assert.match(text, /Configured model id: kimi-k2\.6/)
  assert.match(text, /Do not claim to be Claude, Codex, GPT, Kimi, Gemini, Playwright MCP/)
  assert.match(text, /Earlier transcript messages may come from a different session segment or model\./)
})

test('ApiAdapter adds a current runtime boundary before replayed API user turns', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))
  const adapter = new ApiAdapter({
    id: 'company',
    name: '公司的API',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://company.example/v1',
    models: ['kimi-k2.6', 'deepseek-v4-flash'],
    defaultModel: 'kimi-k2.6'
  }, guard)

  await collect(adapter.runTurn({
    prompt: 'ignored when replay messages exist',
    cwd: root,
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'user', content: '你是什么模型' },
      { role: 'assistant', content: '我是 NextureAI API mode，当前配置的模型是 kimi-k2.6。' },
      { role: 'user', content: '你是什么模型' }
    ],
    abortSignal: new AbortController().signal
  }))

  const messages = calls[0].messages
  assert.equal(messages.at(-2).role, 'user')
  assert.match(userText(messages.at(-2)), /Current provider: 公司的API/)
  assert.match(userText(messages.at(-2)), /Current model id: deepseek-v4-flash/)
  assert.match(userText(messages.at(-2)), /older assistant self-identification/)
  assert.equal(userText(messages.at(-1)), '你是什么模型')
  assert.match(messages.at(-3).content, /kimi-k2\.6/)
})

test('ApiAdapter uses tunable generation settings, max output tokens, prompt caching, and structured output', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'Anthropic',
    format: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: 'https://anthropic.example',
    models: ['claude-3-5'],
    maxOutputTokens: 12000
  }, guard)

  await collect(adapter.runTurn({
    prompt: 'Return handoff',
    cwd: root,
    apiTemperature: 0.15,
    apiTopP: 0.8,
    outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls[0].temperature, 0.15)
  assert.equal(calls[0].topP, 0.8)
  assert.equal(calls[0].maxOutputTokens, 12000)
  assert.equal(calls[0].output.mode, 'object')
  assert.equal(calls[0].output.name, 'workflow_handoff')
  assert.deepEqual(calls[0].output.schema.kind, 'json-schema')
  assert.equal(Array.isArray(calls[0].system), true)
  assert.deepEqual(calls[0].system[0].providerOptions, {
    anthropic: { cacheControl: { type: 'ephemeral' } }
  })
})

test('ApiAdapter uses schema prompt fallback immediately for DeepSeek providers', async () => {
  const calls = []
  const logs = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: '{"summary":"ok","artifacts":[]}' },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'DeepSeek',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-pro']
  }, guard, {
    record: (entry) => {
      logs.push(entry)
      return { ...entry, id: 'log-1', timestamp: '2026-06-15T00:00:00.000Z' }
    }
  })

  const events = await collect(adapter.runTurn({
    prompt: 'Return handoff',
    cwd: root,
    outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].output, undefined)
  assert.match(systemText(calls[0].system), /Structured Output Fallback/)
  assert.match(systemText(calls[0].system), /"required": \[\s*"summary"\s*\]/)
  assert.deepEqual(events[1], { kind: 'message-delta', text: '{"summary":"ok","artifacts":[]}' })
  assert.equal(logs[0].structuredOutput, 'fallback')
})

test('ApiAdapter uses schema prompt fallback immediately for GLM-compatible providers', async () => {
  const calls = []
  const logs = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: '{"summary":"ok","artifacts":[]}' },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: '火山 codeplan',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    models: ['glm-5.2']
  }, guard, {
    record: (entry) => {
      logs.push(entry)
      return { ...entry, id: 'log-1', timestamp: '2026-06-18T00:00:00.000Z' }
    }
  })

  const events = await collect(adapter.runTurn({
    prompt: 'Return handoff',
    cwd: root,
    outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].output, undefined)
  assert.match(systemText(calls[0].system), /Structured Output Fallback/)
  assert.match(systemText(calls[0].system), /higher priority than any earlier instruction/)
  assert.match(systemText(calls[0].system), /final table or report/)
  assert.deepEqual(events[1], { kind: 'message-delta', text: '{"summary":"ok","artifacts":[]}' })
  assert.equal(logs[0].structuredOutput, 'fallback')
})

test('ApiAdapter clamps GLM max output tokens to provider range', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'ok' },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'glm',
    format: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: ['glm-5.2'],
    defaultModel: 'glm-5.2',
    maxOutputTokens: 1131072
  }, guard)

  await collect(adapter.runTurn({
    prompt: 'hello',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls[0].maxOutputTokens, 131072)
})

test('ApiAdapter reserves context space when Kimi max output matches the full context window', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'ok' },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'kimi',
    name: 'Kimi',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2.6'],
    defaultModel: 'kimi-k2.6',
    maxOutputTokens: 262144
  }, guard)

  await collect(adapter.runTurn({
    prompt: 'hello',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.ok(calls[0].maxOutputTokens <= 262144 - 8192)
  assert.ok(calls[0].maxOutputTokens >= 200000)
})

test('ApiAdapter clamps Kimi thinking max output even without stored context metadata', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'ok' },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'kimi',
    name: 'Kimi',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-thinking-251104'],
    defaultModel: 'kimi-k2-thinking-251104',
    maxOutputTokens: 2_140_665
  }, guard)

  await collect(adapter.runTurn({
    prompt: 'hello',
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.ok(calls[0].maxOutputTokens <= 262144 - 8192)
  assert.ok(calls[0].maxOutputTokens >= 200000)
})

test('ApiAdapter uses a conservative Kimi input estimate for long single-agent transcripts', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'ok' },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'kimi',
    name: 'Kimi',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2.6'],
    defaultModel: 'kimi-k2.6',
    maxOutputTokens: 262_144
  }, guard)
  const longTranscript = '中文上下文 transcript token pressure '.repeat(3200)

  await collect(adapter.runTurn({
    prompt: longTranscript,
    cwd: root,
    abortSignal: new AbortController().signal
  }))

  assert.ok(calls[0].maxOutputTokens <= 226_380)
  assert.ok(calls[0].maxOutputTokens >= 180_000)
})

test('ApiAdapter retries a concise structured handoff after max output truncation', async () => {
  const calls = []
  const logs = []
  const mocks = mocksFor([])
  let callCount = 0
  mocks.streamText = async (args) => {
    calls.push(args)
    callCount += 1
    return {
      fullStream: (async function* () {
        if (callCount === 1) {
          yield { type: 'text-delta', textDelta: 'long unfinished response' }
          yield { type: 'finish-step', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 8192 } }
          yield { type: 'finish' }
          return
        }
        yield {
          type: 'text-delta',
          textDelta: '{"summary":"ok","artifacts":[],"nextStepGuidance":null,"routeSuggestion":null}'
        }
        yield { type: 'finish', totalUsage: { inputTokens: 20, outputTokens: 40 } }
      })()
    }
  }
  const { ApiAdapter } = await importApiAdapter(mocks)
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'DeepSeek',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-pro']
  }, guard, {
    record: (entry) => {
      logs.push(entry)
      return { ...entry, id: 'log-1', timestamp: '2026-06-15T00:00:00.000Z' }
    }
  })

  const events = await collect(adapter.runTurn({
    prompt: 'Write a long script and return handoff',
    cwd: root,
    outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls.length, 2)
  assert.equal(calls[1].tools, undefined)
  assert.equal(calls[1].stopWhen, undefined)
  assert.equal(calls[1].output, undefined)
  assert.equal(calls[1].maxOutputTokens, 8192)
  assert.match(systemText(calls[1].system), /Max Output Recovery/)
  assert.match(userText(calls[1].messages.at(-1)), /Do not continue the truncated response/)
  assert.equal(events.some((event) => event.kind === 'error'), false)
  assert.equal(events.some((event) => event.kind === 'system' && /retrying with a concise structured handoff/.test(event.text)), true)
  assert.equal(events.some((event) => event.kind === 'turn-done' && event.reason === 'complete'), true)
  assert.equal(logs[0].status, 'success')
  assert.equal(logs[0].structuredOutput, 'fallback')
  assert.deepEqual(logs[0].usage, { inputTokens: 30, outputTokens: 8232 })
})

test('ApiAdapter retries with schema prompt fallback when native structured output is unsupported', async () => {
  const calls = []
  const logs = []
  const mocks = mocksFor([])
  mocks.streamText = async (args) => {
    calls.push(args)
    if (args.output) throw new Error('response_format json_schema is not supported')
    return {
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: '{"summary":"ok","artifacts":[]}' }
        yield { type: 'finish' }
      })()
    }
  }
  const { ApiAdapter } = await importApiAdapter(mocks)
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'Generic OpenAI-compatible',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://llm.example/v1',
    models: ['generic-chat']
  }, guard, {
    record: (entry) => {
      logs.push(entry)
      return { ...entry, id: 'log-1', timestamp: '2026-06-15T00:00:00.000Z' }
    }
  })

  const events = await collect(adapter.runTurn({
    prompt: 'Return handoff',
    cwd: root,
    outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls.length, 2)
  assert.equal(calls[0].output.mode, 'object')
  assert.equal(calls[1].output, undefined)
  assert.match(systemText(calls[1].system), /Structured Output Fallback/)
  assert.match(systemText(calls[1].system), /"required": \[\s*"summary"\s*\]/)
  assert.deepEqual(events[1], { kind: 'message-delta', text: '{"summary":"ok","artifacts":[]}' })
  assert.equal(logs[0].structuredOutput, 'fallback')
})

test('ApiAdapter detects nested response_format unsupported errors before falling back', async () => {
  const calls = []
  const logs = []
  const mocks = mocksFor([])
  mocks.streamText = async (args) => {
    calls.push(args)
    if (args.output) {
      const err = new Error('Provider rejected request')
      err.cause = { error: { message: 'This response_format type is unavailable now' } }
      throw err
    }
    return {
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: '{"summary":"ok","artifacts":[]}' }
        yield { type: 'finish' }
      })()
    }
  }
  const { ApiAdapter } = await importApiAdapter(mocks)
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'Generic OpenAI-compatible',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://llm.example/v1',
    models: ['generic-chat']
  }, guard, {
    record: (entry) => {
      logs.push(entry)
      return { ...entry, id: 'log-1', timestamp: '2026-06-15T00:00:00.000Z' }
    }
  })

  const events = await collect(adapter.runTurn({
    prompt: 'Return handoff',
    cwd: root,
    outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls.length, 2)
  assert.equal(calls[0].output.mode, 'object')
  assert.equal(calls[1].output, undefined)
  assert.match(systemText(calls[1].system), /Structured Output Fallback/)
  assert.deepEqual(events[1], { kind: 'message-delta', text: '{"summary":"ok","artifacts":[]}' })
  assert.equal(logs[0].structuredOutput, 'fallback')
})

test('ApiAdapter retries when native structured output is rejected as a stream error part', async () => {
  const calls = []
  const logs = []
  const responseFormatError = new Error('This response_format type is unavailable now')
  responseFormatError.responseBody = '{"error":{"message":"This response_format type is unavailable now"}}'
  responseFormatError.data = {
    error: { message: 'This response_format type is unavailable now' }
  }
  const mocks = mocksFor([])
  mocks.streamText = async (args) => {
    calls.push(args)
    if (args.output) {
      return {
        fullStream: (async function* () {
          yield { type: 'error', error: responseFormatError }
        })()
      }
    }
    return {
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: '{"summary":"ok","artifacts":[]}' }
        yield { type: 'finish' }
      })()
    }
  }
  const { ApiAdapter } = await importApiAdapter(mocks)
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'Generic OpenAI-compatible',
    format: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://llm.example/v1',
    models: ['generic-chat']
  }, guard, {
    record: (entry) => {
      logs.push(entry)
      return { ...entry, id: 'log-1', timestamp: '2026-06-15T00:00:00.000Z' }
    }
  })

  const events = await collect(adapter.runTurn({
    prompt: 'Return handoff',
    cwd: root,
    outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    abortSignal: new AbortController().signal
  }))

  assert.equal(calls.length, 2)
  assert.equal(calls[0].output.mode, 'object')
  assert.equal(calls[1].output, undefined)
  assert.deepEqual(events[1], { kind: 'message-delta', text: '{"summary":"ok","artifacts":[]}' })
  assert.equal(events.some((event) => event.kind === 'error'), false)
  assert.equal(logs[0].structuredOutput, 'fallback')
})

test('ApiAdapter sends image attachments as multimodal parts for likely vision API models', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const imagePath = join(dir, 'shot.png')
    writeFileSync(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'))
    const calls = []
    const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))
    const adapter = new ApiAdapter({
      id: 'p1',
      name: 'OpenAI',
      format: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://openai.example/v1',
      models: ['gpt-4o'],
      defaultModel: 'gpt-4o'
    }, guard)

    await collect(adapter.runTurn({
      prompt: 'Describe the image',
      cwd: dir,
      attachments: [{ path: imagePath, kind: 'image', mediaType: 'image/png' }],
      abortSignal: new AbortController().signal
    }))

    const content = calls[0].messages[0].content
    assert.equal(Array.isArray(content), true)
    assert.deepEqual(content[0], { type: 'text', text: 'Describe the image' })
    assert.equal(content[1].type, 'image')
    assert.equal(content[1].mediaType, 'image/png')
    assert.equal(Buffer.isBuffer(content[1].image), true)
  } finally {
    cleanup()
  }
})

test('ApiAdapter merges image attachments into the replayed user turn for kimi-k2.6 sessions', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const imagePath = join(dir, 'shot.png')
    writeFileSync(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'))
    const calls = []
    const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))
    const adapter = new ApiAdapter({
      id: 'p1',
      name: 'Volcengine',
      format: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://volcengine.example/v1',
      models: ['kimi-k2.6'],
      defaultModel: 'kimi-k2.6'
    }, guard)

    await collect(adapter.runTurn({
      prompt: 'ignored when replay messages exist',
      cwd: dir,
      model: 'kimi-k2.6',
      messages: [
        { role: 'user', content: 'Earlier turn' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Describe the latest image' }
      ],
      attachments: [{ path: imagePath, kind: 'image', mediaType: 'image/png' }],
      abortSignal: new AbortController().signal
    }))

    const content = calls[0].messages.at(-1).content
    assert.equal(Array.isArray(content), true)
    assert.deepEqual(content[0], { type: 'text', text: 'Describe the latest image' })
    assert.equal(content[1].type, 'image')
    assert.equal(content[1].mediaType, 'image/png')
    assert.equal(Buffer.isBuffer(content[1].image), true)
  } finally {
    cleanup()
  }
})

test('ApiAdapter records API call logs and emits a compact transcript event', async () => {
  const calls = []
  const logs = []
  const logStore = {
    record: (entry) => {
      logs.push(entry)
      return { ...entry, id: 'log-1', timestamp: '2026-06-15T00:00:00.000Z' }
    }
  }
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'text-delta', textDelta: 'logged response' },
    { type: 'finish-step', usage: { inputTokens: 11, outputTokens: 22 } },
    { type: 'finish' }
  ], calls))
  const adapter = new ApiAdapter({
    id: 'p1',
    name: 'DeepSeek',
    format: 'openai-compatible',
    apiKey: 'sk-secret',
    baseUrl: 'https://deepseek.example/v1',
    models: ['deepseek-chat']
  }, guard, logStore)

  const events = await collect(adapter.runTurn({
    prompt: 'Log this',
    cwd: root,
    apiLogSource: 'workflow',
    abortSignal: new AbortController().signal
  }))

  assert.equal(logs.length, 1)
  assert.equal(logs[0].source, 'workflow')
  assert.equal(logs[0].status, 'success')
  assert.equal(logs[0].providerName, 'DeepSeek')
  assert.deepEqual(logs[0].usage, { inputTokens: 11, outputTokens: 22 })
  assert.equal(JSON.stringify(logs).includes('sk-secret'), false)
  assert.equal(events.some((event) => event.kind === 'system' && /API call: DeepSeek\/deepseek-chat/.test(event.text)), true)
})

test('ApiAdapter formats API call durations as readable time units', () => {
  const adapter = source('src/main/adapters/apiAdapter.ts')

  assert.match(adapter, /function formatDuration\(durationMs: number\): string/)
  assert.match(adapter, /formatDuration\(durationMs\)/)
  assert.match(adapter, /if \(ms < 1000\) return `\$\{ms\}ms`/)
  assert.match(adapter, /return `\$\{formatDurationNumber\(seconds\)\}s`/)
  assert.match(adapter, /return `\$\{formatDurationNumber\(minutes\)\}min`/)
  assert.match(adapter, /return `\$\{formatDurationNumber\(minutes \/ 60\)\}h`/)
  assert.match(adapter, /Math\.round\(value \* 10\) \/ 10/)
  assert.doesNotMatch(adapter, /`\$\{durationMs\}ms\$\{tokens\}`/)
})

test('ApiAdapter resolves Anthropic and OpenAI-compatible models with provider options', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))

  await collect(new ApiAdapter({
    id: 'anthropic',
    name: 'Anthropic',
    format: 'anthropic',
    apiKey: 'sk-anthropic',
    baseUrl: 'https://anthropic.example',
    models: ['claude'],
    defaultModel: 'claude'
  }, guard).runTurn({ prompt: 'A', cwd: root, abortSignal: new AbortController().signal }))

  await collect(new ApiAdapter({
    id: 'openai',
    name: 'OpenAI Compatible',
    format: 'openai-compatible',
    apiKey: 'sk-openai',
    baseUrl: 'https://openai.example/v1',
    models: ['gpt'],
    defaultModel: 'gpt'
  }, guard).runTurn({ prompt: 'B', cwd: root, model: 'override', abortSignal: new AbortController().signal }))

  assert.deepEqual(calls[0].model, {
    provider: 'anthropic',
    options: { apiKey: 'sk-anthropic', baseURL: 'https://anthropic.example/v1' },
    modelId: 'claude'
  })
  assert.deepEqual(calls[1].model, {
    provider: 'openai',
    options: { apiKey: 'sk-openai', baseURL: 'https://openai.example/v1' },
    modelId: 'override'
  })
})

test('ApiAdapter normalizes Anthropic-compatible base URL variants', async () => {
  const calls = []
  const { ApiAdapter } = await importApiAdapter(mocksFor([{ type: 'finish' }], calls))

  await collect(new ApiAdapter({
    id: 'glm',
    name: 'GLM',
    format: 'anthropic',
    apiKey: 'sk-glm',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: ['glm-5.1'],
    defaultModel: 'glm-5.1'
  }, guard).runTurn({ prompt: 'A', cwd: root, abortSignal: new AbortController().signal }))

  await collect(new ApiAdapter({
    id: 'anthropic',
    name: 'Anthropic',
    format: 'anthropic',
    apiKey: 'sk-anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    models: ['claude'],
    defaultModel: 'claude'
  }, guard).runTurn({ prompt: 'B', cwd: root, abortSignal: new AbortController().signal }))

  assert.deepEqual(calls[0].model.options, {
    authToken: 'sk-glm',
    baseURL: 'https://open.bigmodel.cn/api/anthropic/v1'
  })
  assert.deepEqual(calls[1].model.options, {
    apiKey: 'sk-anthropic',
    baseURL: 'https://api.anthropic.com/v1'
  })
})
