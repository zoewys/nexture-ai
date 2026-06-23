import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import type { SkillDefinition, SkillSummary } from '@shared/types'

export interface SkillScanRoot {
  root: string
  sourceLabel: string
  maxDepth: number
  pluginRoot?: boolean
}

export interface SkillPromptContext {
  text: string
  skills: SkillSummary[]
}

export class SkillStore {
  constructor(private readonly roots = defaultSkillRoots()) {}

  list(): SkillSummary[] {
    return this.listDefinitions().map(({ content: _content, ...summary }) => summary)
  }

  buildPrompt(skillIds: string[] | undefined): SkillPromptContext {
    const wanted = new Set((skillIds ?? []).map((id) => id.trim()).filter(Boolean))
    if (wanted.size === 0) return { text: '', skills: [] }

    const skills = this.listDefinitions().filter((skill) => wanted.has(skill.id))
    if (skills.length === 0) return { text: '', skills: [] }

    return {
      skills: skills.map(({ content: _content, ...summary }) => summary),
      text: buildSkillPrompt(skills)
    }
  }

  private listDefinitions(): SkillDefinition[] {
    const byName = new Map<string, SkillDefinition>()

    for (const root of this.roots) {
      for (const filePath of collectSkillFiles(root.root, root.maxDepth)) {
        const parsed = readSkill(filePath, root)
        if (!parsed) continue
        const key = parsed.name.trim().toLowerCase()
        if (!byName.has(key)) byName.set(key, parsed)
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}

export function defaultSkillRoots(): SkillScanRoot[] {
  const home = homedir()
  const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex')
  return [
    { root: join(codexHome, 'skills'), sourceLabel: 'Codex', maxDepth: 3 },
    { root: join(home, '.agents', 'skills'), sourceLabel: 'Agents', maxDepth: 3 },
    { root: join(codexHome, 'plugins', 'cache'), sourceLabel: 'Plugin', maxDepth: 8, pluginRoot: true }
  ]
}

function collectSkillFiles(root: string, maxDepth: number): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry.name)
      if (entry.isFile() && entry.name === 'SKILL.md') {
        files.push(entryPath)
        continue
      }
      if (entry.isDirectory()) visit(entryPath, depth + 1)
    }
  }

  visit(root, 0)
  return files
}

function readSkill(filePath: string, root: SkillScanRoot): SkillDefinition | null {
  try {
    if (!statSync(filePath).isFile()) return null
    const content = readFileSync(filePath, 'utf8')
    const metadata = parseFrontmatter(content)
    const fallbackName = basename(filePath.split(sep).at(-2) ?? 'skill')
    const name = (metadata.name || fallbackName).trim()
    if (!name) return null
    return {
      id: toSkillId(name),
      name,
      description: metadata.description,
      sourceLabel: root.pluginRoot ? pluginSourceLabel(filePath, root.sourceLabel) : root.sourceLabel,
      path: filePath,
      content
    }
  } catch {
    return null
  }
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { name: '', description: '' }
  const fields = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) continue
    fields.set(field[1].toLowerCase(), unquote(field[2].trim()))
  }
  return {
    name: fields.get('name') ?? '',
    description: fields.get('description') ?? ''
  }
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function toSkillId(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id || 'skill'
}

function pluginSourceLabel(filePath: string, fallback: string): string {
  const parts = filePath.split(sep)
  const skillsIndex = parts.lastIndexOf('skills')
  const pluginName = skillsIndex >= 2 ? parts[skillsIndex - 2] : ''
  return pluginName ? `Plugin: ${pluginName}` : fallback
}

function buildSkillPrompt(skills: SkillDefinition[]): string {
  const blocks = skills.map((skill) => [
    `<selected_skill name="${escapeAttribute(skill.name)}" source="${escapeAttribute(skill.sourceLabel)}" path="${escapeAttribute(skill.path)}">`,
    skill.content.trim(),
    '</selected_skill>'
  ].join('\n'))

  return [
    'The user selected the following Agent Studio skills for this turn.',
    'Apply these instructions as additional task context. If a skill references extra files, read them only when they are needed for the user request.',
    '<selected_skills>',
    ...blocks,
    '</selected_skills>'
  ].join('\n\n')
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
