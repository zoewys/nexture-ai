import { tool } from 'ai'
import { z } from 'zod'

export function createSourcegraphTool() {
  return tool({
    inputSchema: z.object({
      query: z.string(),
      count: z.number().optional()
    }),
    execute: async (input: { query: string; count?: number }) => {
      const count = input.count ?? 10
      const url = `https://sourcegraph.com/.api/search/stream?q=${encodeURIComponent(input.query)}&v=V3&t=literal&display=${count}`
      try {
        const response = await fetch(url)
        if (!response.ok) return `错误: Sourcegraph HTTP ${response.status} ${response.statusText}`
        const text = await response.text()
        return parseSourcegraphStream(text, count)
      } catch (err) {
        return `错误: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  })
}

function parseSourcegraphStream(text: string, count: number): string {
  const results: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as { type?: string; data?: unknown }
      const items = extractItems(event.data)
      for (const item of items) {
        const repo = stringField(item, 'repository') || stringField(item, 'repositoryName') || stringField(item, 'repo')
        const path = stringField(item, 'path') || stringField(item, 'file')
        const content = stringField(item, 'content') || stringField(item, 'preview') || ''
        if (repo && path) results.push(`${repo} > ${path}\n${content}`)
        if (results.length >= count) return results.join('\n\n')
      }
    } catch {
      /* Ignore non-JSON stream lines. */
    }
  }
  return results.join('\n\n')
}

function extractItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value)) {
    if (Array.isArray(value.matches)) return value.matches.filter(isRecord)
    if (Array.isArray(value.results)) return value.results.filter(isRecord)
    return [value]
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}
