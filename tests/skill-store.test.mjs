import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importSkillStore() {
  const absPath = join(root, 'src/main/SkillStore.ts')
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

test('SkillStore scans SKILL.md files, parses frontmatter, and deduplicates by root priority', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-studio-skills-'))
  try {
    const codexRoot = join(dir, 'codex-skills')
    const agentsRoot = join(dir, 'agents-skills')
    const pluginRoot = join(dir, 'plugins-cache')
    writeSkill(join(codexRoot, 'commit', 'SKILL.md'), 'commit', 'Codex commit skill', 'codex body')
    writeSkill(join(agentsRoot, 'commit', 'SKILL.md'), 'commit', 'Agents duplicate', 'agents body')
    writeSkill(join(agentsRoot, 'manual', 'SKILL.md'), '', '', 'manual body')
    writeSkill(
      join(pluginRoot, 'openai-curated', 'cloudflare', 'a89a13d7', 'skills', 'wrangler', 'SKILL.md'),
      'wrangler',
      'Cloudflare Workers CLI',
      'plugin body'
    )

    const { SkillStore } = await importSkillStore()
    const store = new SkillStore([
      { root: codexRoot, sourceLabel: 'Codex', maxDepth: 3 },
      { root: agentsRoot, sourceLabel: 'Agents', maxDepth: 3 },
      { root: pluginRoot, sourceLabel: 'Plugin', maxDepth: 8, pluginRoot: true }
    ])
    const skills = store.list()

    assert.equal(skills.filter((skill) => skill.name === 'commit').length, 1)
    assert.equal(skills.find((skill) => skill.name === 'commit')?.description, 'Codex commit skill')
    assert.equal(skills.find((skill) => skill.name === 'manual')?.sourceLabel, 'Agents')
    assert.equal(skills.find((skill) => skill.name === 'wrangler')?.sourceLabel, 'Plugin: cloudflare')

    const prompt = store.buildPrompt(['commit', 'wrangler'])
    assert.match(prompt.text, /selected_skills/)
    assert.match(prompt.text, /codex body/)
    assert.match(prompt.text, /plugin body/)
    assert.deepEqual(prompt.skills.map((skill) => skill.id), ['commit', 'wrangler'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeSkill(path, name, description, body) {
  mkdirSync(dirname(path), { recursive: true })
  const frontmatter = name
    ? `---\nname: ${name}\ndescription: "${description}"\n---\n\n`
    : ''
  writeFileSync(path, `${frontmatter}# ${name || dirname(path).split(/[\\/]/).at(-1)}\n\n${body}`, 'utf8')
}
