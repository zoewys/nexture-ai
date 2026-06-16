import { tool } from 'ai'
import { z } from 'zod'

const MAX_BODY_CHARS = 100 * 1024

export function createFetchTool() {
  return tool({
    description: 'Fetch an HTTP(S) URL. Use this for web/API content; use file_read for local files.',
    inputSchema: z.object({
      url: z.string().describe('HTTP or HTTPS URL to fetch.'),
      format: z.enum(['text', 'json']).optional().describe('Response format. Use json to parse and pretty-print JSON; defaults to text.')
    }),
    execute: async (input: { url: string; format?: 'text' | 'json' }) => {
      let url: URL
      try {
        url = new URL(input.url)
      } catch {
        return `错误: invalid URL: ${input.url}`
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      timeout.unref?.()
      try {
        const response = await fetch(url, { signal: controller.signal })
        const body = truncate(await response.text())
        if (!response.ok) return `错误: HTTP ${response.status} ${response.statusText}\n${body}`
        if (input.format === 'json') {
          try {
            return JSON.stringify(JSON.parse(body), null, 2)
          } catch (err) {
            return `错误: JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
          }
        }
        return body
      } catch (err) {
        return `错误: ${err instanceof Error ? err.message : String(err)}`
      } finally {
        clearTimeout(timeout)
      }
    }
  })
}

function truncate(value: string): string {
  return value.length > MAX_BODY_CHARS ? `${value.slice(0, MAX_BODY_CHARS)}\n[输出已截断]` : value
}
