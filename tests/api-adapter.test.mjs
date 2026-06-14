import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

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
      /import\s+\{\s*generateText,\s*streamText,\s*stepCountIs\s*\}\s+from\s+['"]ai['"];?/,
      'const { generateText, streamText, stepCountIs } = globalThis.__apiAdapterMocks;'
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
    createAnthropic: (options) => (modelId) => ({ provider: 'anthropic', options, modelId }),
    createOpenAI: (options) => ({ chat: (modelId) => ({ provider: 'openai', options, modelId }) }),
    buildToolSet: () => ({ bash: { execute: async () => ({ exitCode: 0, output: '' }) } })
  }
}

const guard = {
  request: async () => true,
  respond: () => {}
}

test('ApiAdapter emits session-started first, maps text deltas, and emits turn-done on finish', async () => {
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
  assert.equal(events[2].kind, 'turn-done')
  assert.equal(events[2].sessionId, events[0].sessionId)
  assert.equal(calls[0].prompt, 'Say hi')
  assert.equal(calls[0].system, 'system text')
  assert.deepEqual(calls[0].stopWhen, { stepCount: 10 })
})

test('ApiAdapter maps tool call, tool result, usage, and finish events', async () => {
  const { ApiAdapter } = await importApiAdapter(mocksFor([
    { type: 'tool-call', toolCallId: 'tool-1', toolName: 'bash', args: { command: 'echo hi' } },
    { type: 'tool-result', toolCallId: 'tool-1', result: { exitCode: 0, output: 'hi\n' } },
    { type: 'step-finish', usage: { inputTokens: 3, outputTokens: 4 } },
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
  assert.deepEqual(events[3], { kind: 'usage', inputTokens: 3, outputTokens: 4 })
  assert.equal(events[4].kind, 'turn-done')
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
  assert.equal(events[2].kind, 'turn-done')
  assert.equal(calls.length, 1)
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
