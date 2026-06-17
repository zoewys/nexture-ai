import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importTranscriptStore(userDataDir) {
  globalThis.__transcriptStoreElectron = {
    app: { getPath: () => userDataDir }
  }
  const absPath = join(root, 'src/main/TranscriptStore.ts')
  const outDir = mkdtempSync(join(tmpdir(), 'agent-studio-transcript-store-test-'))
  const outPath = join(outDir, `TranscriptStore-${Date.now()}-${Math.random()}.mjs`)
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const output = transpiled.outputText.replace(
    /import\s+\{\s*app\s*\}\s+from\s+['"]electron['"];?/,
    'const { app } = globalThis.__transcriptStoreElectron;'
  )
  writeFileSync(outPath, output, 'utf8')
  return import(`${pathToFileURL(outPath).href}?cache=${Date.now()}-${Math.random()}`)
}

test('TranscriptStore normalizes replayed tool results to AI SDK output schema', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'agent-studio-transcript-store-'))
  try {
    const { TranscriptStore } = await importTranscriptStore(userDataDir)
    const store = new TranscriptStore()
    const sessionId = 'session-1'
    const transcriptDir = join(userDataDir, 'transcripts')
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`)

    mkdirSync(transcriptDir, { recursive: true })
    writeFileSync(transcriptPath, [
      JSON.stringify({ kind: 'user', text: 'Run the tools' }),
      JSON.stringify({
        kind: 'event',
        event: { kind: 'tool-call', id: 'tool-1', name: 'bash', input: { command: 'echo hi' } }
      }),
      JSON.stringify({
        kind: 'event',
        event: { kind: 'tool-result', id: 'tool-1', ok: true, output: { exitCode: 0, output: 'hi\n' } }
      }),
      JSON.stringify({
        kind: 'event',
        event: { kind: 'tool-call', id: 'tool-2', name: 'file_write', input: { path: 'a.txt' } }
      }),
      JSON.stringify({
        kind: 'event',
        event: { kind: 'tool-result', id: 'tool-2', ok: false, output: 'Tool output was denied.' }
      })
    ].join('\n') + '\n', 'utf8')

    assert.deepEqual(store.buildReplayMessagesFromTimeline([sessionId], 'Continue'), [
      { role: 'user', content: 'Run the tools' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tool-1', toolName: 'bash', input: { command: 'echo hi' } }]
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'tool-1', toolName: 'bash', output: { type: 'json', value: { exitCode: 0, output: 'hi\n' } } }]
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tool-2', toolName: 'file_write', input: { path: 'a.txt' } }]
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'tool-2', toolName: 'file_write', output: { type: 'text', value: 'Tool output was denied.' } }]
      },
      { role: 'user', content: 'Continue' }
    ])
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
