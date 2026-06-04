import { spawn } from 'node:child_process'
import type {
  AgentVendor,
  CodexReasoningEffort,
  CodexServiceTierOption,
  ModelCatalog,
  ModelOption,
  VendorModelCatalog
} from '@shared/types'
import { CODEX_REASONING_EFFORTS } from '@shared/types'
import { withCliPath } from './cliEnv'

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  error?: string
  timedOut: boolean
}

interface CodexRawModel {
  slug?: unknown
  display_name?: unknown
  visibility?: unknown
  default_reasoning_level?: unknown
  supported_reasoning_levels?: unknown
  service_tiers?: unknown
}

const PROBE_MODEL = '__agent_studio_model_probe__'

export async function listCliModels(): Promise<ModelCatalog> {
  const [claude, codex] = await Promise.all([
    listVendorModels('claude'),
    listVendorModels('codex')
  ])
  return { claude, codex }
}

async function listVendorModels(vendor: AgentVendor): Promise<VendorModelCatalog> {
  switch (vendor) {
    case 'claude':
      return listClaudeModels()
    case 'codex':
      return listCodexModels()
  }
}

async function listClaudeModels(): Promise<VendorModelCatalog> {
  const probe = await runCommand(
    'claude',
    ['-p', '--model', PROBE_MODEL, '--max-budget-usd', '0.01', 'model probe'],
    8000
  )
  const probeModels = extractSupportedModelNames(`${probe.stdout}\n${probe.stderr}`)
  if (probeModels.length > 0) {
    return {
      models: toOptions(probeModels),
      source: 'cli',
      message: 'Read from Claude CLI model validation'
    }
  }

  const help = await runCommand('claude', ['--help'], 5000)
  const helpModels = extractModelExamples(`${help.stdout}\n${help.stderr}`)
  if (helpModels.length > 0) {
    return {
      models: toOptions(helpModels),
      source: 'cli-help',
      message: 'Claude CLI only exposes model aliases in help text'
    }
  }

  return unavailable('Claude CLI did not expose available models')
}

async function listCodexModels(): Promise<VendorModelCatalog> {
  const result = await runCommand('codex', ['debug', 'models'], 8000)
  const raw = parseJsonObject(result.stdout)
  const rawModels = Array.isArray(raw?.models) ? (raw.models as CodexRawModel[]) : []
  const models = rawModels
    .filter((model) => model.visibility === 'list')
    .map((model): ModelOption | null => {
      const id = typeof model.slug === 'string' ? model.slug : ''
      const label = typeof model.display_name === 'string' ? model.display_name : id
      return id
        ? {
            id,
            label,
            codexReasoningEfforts: parseReasoningEfforts(model.supported_reasoning_levels),
            codexDefaultReasoningEffort: parseReasoningEffort(model.default_reasoning_level),
            codexServiceTiers: parseServiceTiers(model.service_tiers)
          }
        : null
    })
    .filter((model): model is ModelOption => model !== null)

  if (models.length > 0) {
    return {
      models,
      source: 'cli',
      message: 'Read from codex debug models'
    }
  }
  return unavailable('Codex CLI did not return model catalog')
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, {
        env: withCliPath(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      finish({
        code: null,
        stdout,
        stderr,
        error: err instanceof Error ? err.message : String(err),
        timedOut: false
      })
      return
    }

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      finish({ code: null, stdout, stderr, timedOut: true })
    }, timeoutMs)
    timer.unref?.()

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (err) => {
      finish({ code: null, stdout, stderr, error: err.message, timedOut: false })
    })

    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut: false })
    })
  })
}

function extractSupportedModelNames(text: string): string[] {
  const patterns = [
    /supported API model names are ([^.]+?)(?:,?\s+but you passed|\.|\n)/i,
    /supported models? (?:are|:)\s*([^\n.]+)/i,
    /available models? (?:are|:)\s*([^\n.]+)/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return unique(extractModelIds(match[1]))
  }
  return []
}

function extractModelExamples(text: string): string[] {
  const quoted = Array.from(text.matchAll(/'([^']+)'/g), (match) => match[1])
  return unique(
    quoted.filter((value) => ['sonnet', 'opus', 'haiku'].includes(value) || /^claude-[\w.-]+$/.test(value))
  )
}

function extractChoicesForOption(text: string, option: string): string[] {
  const line = text
    .split('\n')
    .find((candidate) => candidate.includes(option) && candidate.includes('[choices:'))
  if (!line) return []
  const match = line.match(/\[choices:\s*([^\]]+)\]/)
  return match?.[1] ? unique(extractModelIds(match[1])) : []
}

function extractModelIds(text: string): string[] {
  return text
    .replace(/\b(?:and|or)\b/gi, ',')
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^["'`]+|["'`.)]+$/g, ''))
    .filter((part) => /^[a-z0-9][a-z0-9._:-]*$/i.test(part))
    .filter((part) => !['model', 'models', 'name', 'names', 'are', 'is'].includes(part.toLowerCase()))
}

function parseJsonObject(text: string): { models?: unknown } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as { models?: unknown }
  } catch {
    return null
  }
}

function parseReasoningEfforts(value: unknown): CodexReasoningEffort[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      return parseReasoningEffort((item as Record<string, unknown>).effort)
    })
    .filter((effort): effort is CodexReasoningEffort => effort !== null)
}

function parseReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  return typeof value === 'string' && isCodexReasoningEffort(value) ? value : undefined
}

function parseServiceTiers(value: unknown): CodexServiceTierOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): CodexServiceTierOption | null => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Record<string, unknown>
      const id = typeof raw.id === 'string' ? raw.id : ''
      if (!id) return null
      return {
        id,
        label: typeof raw.name === 'string' && raw.name ? raw.name : id,
        description: typeof raw.description === 'string' ? raw.description : undefined
      }
    })
    .filter((tier): tier is CodexServiceTierOption => tier !== null)
}

function isCodexReasoningEffort(value: string): value is CodexReasoningEffort {
  return (CODEX_REASONING_EFFORTS as string[]).includes(value)
}

function toOptions(ids: string[]): ModelOption[] {
  return ids.map((id) => ({ id, label: id }))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function unavailable(message: string): VendorModelCatalog {
  return { models: [], source: 'unavailable', message }
}
