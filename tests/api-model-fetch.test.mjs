import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importApiModelFetch() {
  const absPath = join(root, 'src/main/apiModelFetch.ts')
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}#${Date.now()}-${Math.random()}`
  return import(dataUrl)
}

test('OpenAI-compatible model list candidates support root and v1 base URLs', async () => {
  const { modelListEndpointCandidates } = await importApiModelFetch()

  assert.deepEqual(
    modelListEndpointCandidates({ format: 'openai-compatible' }, 'https://api.deepseek.com'),
    ['https://api.deepseek.com/models', 'https://api.deepseek.com/v1/models']
  )
  assert.deepEqual(
    modelListEndpointCandidates({ format: 'openai-compatible' }, 'https://api.deepseek.com/v1'),
    ['https://api.deepseek.com/v1/models', 'https://api.deepseek.com/models']
  )
})

test('model list candidates normalize full endpoint URLs before probing models', async () => {
  const { modelListEndpointCandidates } = await importApiModelFetch()

  assert.deepEqual(
    modelListEndpointCandidates({ format: 'openai-compatible' }, 'https://api.deepseek.com/v1/chat/completions'),
    ['https://api.deepseek.com/v1/models', 'https://api.deepseek.com/models']
  )
})

test('provider HTTP errors preserve actionable response messages without leaking keys', async () => {
  const { formatProviderHttpError, formatModelEndpointFailures } = await importApiModelFetch()

  const message = formatProviderHttpError(
    401,
    '{"error":{"message":"Authentication Fails, Your api key: sk-live-secret123 is invalid"}}'
  )
  assert.equal(message, 'HTTP 401: Authentication Fails, Your api key: sk-*** is invalid')

  assert.equal(
    formatModelEndpointFailures([{ url: 'https://api.deepseek.com/models', error: message }]),
    'https://api.deepseek.com/models (HTTP 401: Authentication Fails, Your api key: sk-*** is invalid)'
  )
})
