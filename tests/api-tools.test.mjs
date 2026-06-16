import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importTs(relativePath) {
  const absPath = join(root, relativePath)
  const outBase = join(root, '.tmp', 'api-tools-tests')
  mkdirSync(outBase, { recursive: true })
  const outDir = mkdtempSync(join(outBase, 'ts-'))
  const outPath = join(outDir, `${relativePath.replaceAll('/', '-')}-${Date.now()}-${Math.random()}.mjs`)
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  writeFileSync(outPath, transpiled.outputText, 'utf8')
  return import(`${pathToFileURL(outPath).href}?cache=${Date.now()}-${Math.random()}`)
}

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-studio-api-tools-'))
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

function allowGuard(calls = []) {
  return {
    request: async (toolName, description) => {
      calls.push([toolName, description])
      return true
    },
    respond: () => {}
  }
}

test('file_read reads existing files with line numbers', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const file = join(dir, 'sample.txt')
    writeFileSync(file, 'alpha\nbeta\ngamma', 'utf8')
    const { createFileReadTool } = await importTs('src/main/adapters/api-tools/fileRead.ts')

    const output = await createFileReadTool(dir).execute({ file_path: file })

    assert.match(output, /0\talpha/)
    assert.match(output, /1\tbeta/)
  } finally {
    cleanup()
  }
})

test('file_read applies offset and limit', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const file = join(dir, 'lines.txt')
    writeFileSync(file, Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n'), 'utf8')
    const { createFileReadTool } = await importTs('src/main/adapters/api-tools/fileRead.ts')

    const output = await createFileReadTool(dir).execute({ file_path: file, offset: 5, limit: 3 })

    assert.equal(output.split('\n').length, 3)
    assert.match(output, /5\tline-5/)
    assert.doesNotMatch(output, /8\tline-8/)
  } finally {
    cleanup()
  }
})

test('file_read resolves relative paths from cwd, returns missing errors, and handles empty files', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const empty = join(dir, 'empty.txt')
    const relative = join(dir, 'relative.txt')
    writeFileSync(empty, '', 'utf8')
    writeFileSync(relative, 'from cwd', 'utf8')
    const { createFileReadTool } = await importTs('src/main/adapters/api-tools/fileRead.ts')
    const tool = createFileReadTool(dir)

    assert.match(await tool.execute({ file_path: join(dir, 'missing.txt') }), /文件不存在|not found/i)
    assert.match(await tool.execute({ file_path: 'relative.txt' }), /0\tfrom cwd/)
    assert.equal(await tool.execute({ file_path: empty }), '')
  } finally {
    cleanup()
  }
})

test('file_write creates, overwrites, creates parent directories, and resolves relative paths from cwd', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const changes = []
    const calls = []
    const { createFileWriteTool } = await importTs('src/main/adapters/api-tools/fileWrite.ts')
    const tool = createFileWriteTool(dir, allowGuard(calls), (filePath, op) => changes.push([filePath, op]))
    const file = join(dir, 'deep', 'note.txt')

    assert.match(await tool.execute({ file_path: file, content: 'hello' }), /写入|wrote|success/i)
    assert.equal(readFileSync(file, 'utf8'), 'hello')
    assert.match(await tool.execute({ file_path: file, content: 'updated' }), /写入|wrote|success/i)
    assert.equal(readFileSync(file, 'utf8'), 'updated')
    assert.match(await tool.execute({ file_path: 'relative.txt', content: 'from cwd' }), /写入|wrote|success/i)
    assert.equal(readFileSync(join(dir, 'relative.txt'), 'utf8'), 'from cwd')
    assert.deepEqual(changes.map((entry) => entry[1]), ['create', 'modify', 'create'])
    assert.deepEqual(changes.map((entry) => entry[0]), [file, file, join(dir, 'relative.txt')])
    assert.deepEqual(calls.map((entry) => entry[0]), ['file_write', 'file_write', 'file_write'])
    assert.deepEqual(calls.map((entry) => entry[1]), [file, file, join(dir, 'relative.txt')])
  } finally {
    cleanup()
  }
})

test('file_edit replaces exact text and handles mismatch cases', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const { createFileEditTool } = await importTs('src/main/adapters/api-tools/fileEdit.ts')
    const file = join(dir, 'edit.txt')
    writeFileSync(file, 'one two two', 'utf8')
    const tool = createFileEditTool(dir, allowGuard())

    assert.match(await tool.execute({ file_path: file, old_string: 'one', new_string: 'ONE' }), /替换|success/i)
    assert.equal(readFileSync(file, 'utf8'), 'ONE two two')
    assert.match(await tool.execute({ file_path: 'edit.txt', old_string: 'ONE', new_string: 'one' }), /替换|success/i)
    assert.equal(readFileSync(file, 'utf8'), 'one two two')
    assert.match(await tool.execute({ file_path: file, old_string: 'two', new_string: 'TWO' }), /多个匹配|multiple/i)
    assert.match(await tool.execute({ file_path: file, old_string: 'missing', new_string: 'x' }), /未找到|not found/i)
    assert.match(await tool.execute({ file_path: file, old_string: 'TWO', new_string: 'TWO' }), /相同|same/i)
    assert.match(await tool.execute({ file_path: file, old_string: 'two', new_string: 'TWO', replace_all: true }), /替换|success/i)
    assert.equal(readFileSync(file, 'utf8'), 'one TWO TWO')
  } finally {
    cleanup()
  }
})

test('file_edit applies multiple edits in order with per-edit replace_all support', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const { createFileEditTool } = await importTs('src/main/adapters/api-tools/fileEdit.ts')
    const file = join(dir, 'multi.txt')
    writeFileSync(file, 'alpha beta beta gamma', 'utf8')
    const changes = []
    const tool = createFileEditTool(dir, allowGuard(), (filePath, op) => changes.push([filePath, op]))

    const output = await tool.execute({
      file_path: 'multi.txt',
      edits: [
        { old_string: 'alpha', new_string: 'ALPHA' },
        { old_string: 'beta', new_string: 'BETA', replace_all: true },
        { old_string: 'gamma', new_string: 'GAMMA' }
      ]
    })

    assert.match(output, /3 edits|3 个编辑|success/i)
    assert.equal(readFileSync(file, 'utf8'), 'ALPHA BETA BETA GAMMA')
    assert.deepEqual(changes, [[file, 'modify']])
  } finally {
    cleanup()
  }
})

test('ls lists one directory level with relative paths and file types', async () => {
  const { dir, cleanup } = tempProject()
  try {
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'README.md'), 'hello')
    await writeFile(join(dir, 'src', 'nested.ts'), 'export {}')
    const { createLsTool } = await importTs('src/main/adapters/api-tools/ls.ts')
    const tool = createLsTool(dir)

    const output = await tool.execute({ path: '.' })
    assert.match(output, /README\.md\s+file/)
    assert.match(output, /src\/\s+dir/)
    assert.doesNotMatch(output, /nested\.ts/)
    assert.match(await tool.execute({ path: 'missing' }), /not found|不存在/i)
  } finally {
    cleanup()
  }
})

test('glob matches files, excludes node_modules, and returns empty output for no matches', async () => {
  const { dir, cleanup } = tempProject()
  try {
    await mkdir(join(dir, 'src'), { recursive: true })
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(dir, 'src', 'a.ts'), '')
    await writeFile(join(dir, 'src', 'b.js'), '')
    await writeFile(join(dir, 'node_modules', 'pkg', 'ignored.ts'), '')
    const { createGlobTool } = await importTs('src/main/adapters/api-tools/glob.ts')
    const tool = createGlobTool(dir)

    const output = await tool.execute({ pattern: '**/*.ts' })
    assert.match(output, /src\/a\.ts/)
    assert.doesNotMatch(output, /node_modules/)
    assert.equal(await tool.execute({ pattern: '**/*.go' }), '')
  } finally {
    cleanup()
  }
})

test('grep searches content, supports include filters, handles empty matches and invalid regex', async () => {
  const { dir, cleanup } = tempProject()
  try {
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'a.ts'), 'const needle = 1\n')
    await writeFile(join(dir, 'src', 'b.md'), 'needle in docs\n')
    const { createGrepTool } = await importTs('src/main/adapters/api-tools/grep.ts')
    const tool = createGrepTool(dir)

    const output = await tool.execute({ pattern: 'needle', path: join(dir, 'src'), include: '*.ts' })
    assert.match(output, /src\/a\.ts:1:const needle = 1/)
    assert.doesNotMatch(output, /b\.md/)
    assert.equal(await tool.execute({ pattern: 'absent', path: join(dir, 'src') }), '')
    assert.match(await tool.execute({ pattern: '[' }), /正则|regex/i)
  } finally {
    cleanup()
  }
})

test('bash executes commands, returns formatted strings, keeps cwd across calls, reports file changes, times out, and truncates output', async () => {
  const { dir, cleanup } = tempProject()
  try {
    const calls = []
    const changes = []
    await mkdir(join(dir, 'sub'), { recursive: true })
    const { createBashTool } = await importTs('src/main/adapters/api-tools/bash.ts')
    const tool = createBashTool(dir, new AbortController().signal, allowGuard(calls), (filePath, op) => changes.push([filePath, op]))

    assert.match(await tool.execute({ command: 'echo hello' }), /exit code: 0\nhello/)
    assert.match(await tool.execute({ command: 'cd sub' }), /exit code: 0/)
    assert.match(await tool.execute({ command: 'pwd' }), new RegExp(join(dir, 'sub').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(await tool.execute({ command: 'exit 7' }), /exit code: 7/)
    assert.match(await tool.execute({ command: 'printf created > created.txt' }), /exit code: 0/)
    assert.deepEqual(changes, [[join(dir, 'sub', 'created.txt'), 'create']])
    const timedOut = await tool.execute({ command: 'sleep 999', timeout: 100 })
    assert.match(timedOut, /timed out/i)
    const truncated = await tool.execute({ command: "node -e \"process.stdout.write('x'.repeat(120000))\"" })
    assert.match(truncated, /output truncated|输出已截断/i)
    assert.deepEqual(calls.map((entry) => entry[0]), ['bash', 'bash', 'bash', 'bash', 'bash', 'bash', 'bash'])
  } finally {
    cleanup()
  }
})

test('fetch returns text and parsed json with truncation-safe error handling', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/json') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } else {
      res.end('plain text')
    }
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  try {
    const address = server.address()
    const base = `http://127.0.0.1:${address.port}`
    const { createFetchTool } = await importTs('src/main/adapters/api-tools/fetch.ts')
    const tool = createFetchTool()

    assert.equal(await tool.execute({ url: `${base}/text` }), 'plain text')
    assert.equal(await tool.execute({ url: `${base}/json`, format: 'json' }), JSON.stringify({ ok: true }, null, 2))
    assert.match(await tool.execute({ url: 'not-a-url' }), /URL|invalid/i)
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
  }
})

test('sourcegraph parses streamed content matches and reports network errors', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      new Response(
        [
          JSON.stringify({
            type: 'matches',
            data: [
              {
                repository: 'github.com/example/repo',
                path: 'main.go',
                content: 'fmt.Println("hi")'
              }
            ]
          })
        ].join('\n')
      )
    const { createSourcegraphTool } = await importTs('src/main/adapters/api-tools/sourcegraph.ts')
    const tool = createSourcegraphTool()

    const output = await tool.execute({ query: 'fmt.Println', count: 1 })
    assert.match(output, /github\.com\/example\/repo > main\.go/)
    assert.match(output, /fmt\.Println/)

    globalThis.fetch = async () => {
      throw new Error('network down')
    }
    assert.match(await tool.execute({ query: 'fmt.Println' }), /network down/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('todo_write stores and replaces the full todo list', async () => {
  const { createTodoWriteTool } = await importTs('src/main/adapters/api-tools/todoWrite.ts')
  const tool = createTodoWriteTool()

  const first = await tool.execute({
    todos: [
      { content: 'A', status: 'pending' },
      { content: 'B', status: 'in_progress' },
      { content: 'C', status: 'completed' }
    ]
  })
  assert.match(first, /\[pending\] A/)
  assert.match(first, /\[in_progress\] B/)
  assert.match(first, /\[completed\] C/)

  const second = await tool.execute({ todos: [{ content: 'Only', status: 'pending' }] })
  assert.equal(second, '1. [pending] Only')
})

test('tool registry exports all API tools', () => {
  const source = readFileSync(join(root, 'src/main/adapters/api-tools/index.ts'), 'utf8')

  for (const name of ['bash', 'ls', 'file_read', 'file_edit', 'file_write', 'glob', 'grep', 'fetch', 'sourcegraph', 'todo_write']) {
    assert.match(source, new RegExp(`${name}:`))
  }
})

test('API tool descriptions are English model-facing instructions', () => {
  const files = [
    'bash.ts',
    'fetch.ts',
    'fileEdit.ts',
    'fileRead.ts',
    'fileWrite.ts',
    'glob.ts',
    'grep.ts',
    'ls.ts',
    'sourcegraph.ts',
    'todoWrite.ts'
  ]

  for (const file of files) {
    const absPath = join(root, 'src/main/adapters/api-tools', file)
    const source = readFileSync(absPath, 'utf8')
    const descriptions = [...source.matchAll(/describe\((['"`])([\s\S]*?)\1\)/g)].map((match) => match[2])
    assert.ok(descriptions.length > 0, `${file} should describe its tool inputs`)
    for (const description of descriptions) {
      assert.doesNotMatch(description, /[\u4e00-\u9fff]/, `${file} has a non-English tool description: ${description}`)
    }
    assert.match(source, /Use|Read|Write|Search|Run|Fetch|List|Track/, `${file} should include actionable English tool guidance`)
  }
})
