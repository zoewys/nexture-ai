import type { AgentEvent, HandoffArtifact, HandoffArtifactItem, RouteSuggestion } from '../shared/types'

export function parseHandoff(events: AgentEvent[]): HandoffArtifact | null {
  const texts = collectAssistantTextCandidates(events)
  for (let i = texts.length - 1; i >= 0; i--) {
    const result = tryParseHandoffFromText(texts[i])
    if (result) return result
  }
  return null
}

export function tryParseHandoffFromText(text: string): HandoffArtifact | null {
  const sourceTexts = [
    text,
    ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1])
  ]

  for (const source of sourceTexts) {
    for (const json of extractJsonObjects(source)) {
      try {
        const parsed = JSON.parse(json) as Partial<HandoffArtifact>
        if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.artifacts)) continue
        if (isPlaceholderText(parsed.summary)) continue
        if (parsed.artifacts.some(isPlaceholderArtifactItemLike)) continue
        return {
          summary: parsed.summary,
          artifacts: parsed.artifacts
            .filter(isHandoffArtifactItemLike)
            .map((artifact) => ({
              path: artifact.path,
              description: artifact.description,
              type: normalizeArtifactType(artifact.type)
            })),
          nextStepGuidance:
            typeof parsed.nextStepGuidance === 'string' ? parsed.nextStepGuidance : undefined,
          routeSuggestion: isValidRouteSuggestion((parsed as any).routeSuggestion)
            ? (parsed as any).routeSuggestion
            : undefined
        }
      } catch {
        // Try the next JSON-looking object in this assistant output.
      }
    }
  }
  return null
}

function collectAssistantTextCandidates(events: AgentEvent[]): string[] {
  const texts: string[] = []
  let pendingDelta = ''

  const flushDelta = (): void => {
    const text = pendingDelta.trim()
    if (text) texts.push(text)
    pendingDelta = ''
  }

  for (const event of events) {
    if (event.kind === 'message-delta') {
      pendingDelta += event.text
      continue
    }
    if (event.kind === 'message') {
      flushDelta()
      texts.push(event.text)
      continue
    }
    if (event.kind === 'turn-done' || event.kind === 'error' || event.kind === 'session-started') {
      flushDelta()
    }
  }

  flushDelta()
  return texts
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  const seen = new Set<string>()

  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const end = findBalancedObjectEnd(text, start)
    if (end < 0) continue
    const candidate = text.slice(start, end + 1).trim()
    if (!seen.has(candidate)) {
      seen.add(candidate)
      objects.push(candidate)
    }
  }

  return objects
}

function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return -1
}

function isHandoffArtifactItemLike(value: unknown): value is HandoffArtifactItem {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as any).path === 'string' &&
    typeof (value as any).description === 'string'
  )
}

function isPlaceholderArtifactItemLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const artifact = value as Record<string, unknown>
  return (
    isPlaceholderText(artifact.path) ||
    isPlaceholderText(artifact.description) ||
    (typeof artifact.type === 'string' && artifact.type.includes('|'))
  )
}

function isPlaceholderText(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return (
    normalized === '...' ||
    /^<[^>]+>$/.test(normalized) ||
    normalized.includes('<one-paragraph summary') ||
    normalized.includes('<relative file path') ||
    normalized.includes('<what this file contains') ||
    normalized.includes('<optional:')
  )
}

function normalizeArtifactType(value: unknown): HandoffArtifactItem['type'] {
  return value === 'requirement' ||
    value === 'design' ||
    value === 'code' ||
    value === 'test' ||
    value === 'other'
    ? value
    : undefined
}

function isValidRouteSuggestion(val: unknown): val is RouteSuggestion {
  if (!val || typeof val !== 'object') return false
  const rs = val as Record<string, unknown>
  return ['continue', 'retry-prev', 'skip-next', 'goto'].includes(rs.action as string)
}
