import type { ApiProviderConfig, ApiProviderFormat } from '@shared/types'

export interface ModelEndpointFailure {
  url: string
  error: string
}

export function modelListEndpointCandidates(
  provider: Pick<ApiProviderConfig, 'format'>,
  normalizedBaseUrl: string
): string[] {
  const base = normalizedBaseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|responses|models)$/i, '')
  if (!base) return []

  if (provider.format === 'anthropic') return unique([`${base}/models`])

  return unique([
    `${base}/models`,
    openAiCompatibleAlternateModelsUrl(provider.format, base)
  ].filter(Boolean))
}

export function formatProviderHttpError(statusCode: number | undefined, body: string): string {
  const status = statusCode ? `HTTP ${statusCode}` : 'HTTP 请求失败'
  const detail = extractProviderErrorMessage(body)
  return detail ? `${status}: ${redactProviderError(detail)}` : status
}

export function formatModelEndpointFailures(failures: ModelEndpointFailure[]): string {
  if (failures.length === 0) return '请检查 API Key 和 Base URL'
  return failures
    .map((failure) => `${failure.url} (${redactProviderError(failure.error)})`)
    .join('；')
}

export function extractProviderErrorMessage(body: string): string | undefined {
  const text = body.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: unknown }
      message?: unknown
      error_description?: unknown
    }
    if (typeof parsed.error === 'object' && parsed.error && typeof parsed.error.message === 'string') {
      return parsed.error.message
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.error_description === 'string') return parsed.error_description
  } catch {
    // Fall through to the raw text snippet below.
  }
  return text.slice(0, 300)
}

export function redactProviderError(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9._-]{6,}\b/g, 'sk-***')
    .replace(/\b(api[_-]?key|token|secret)(["':=\s]+)[A-Za-z0-9._-]{8,}/gi, '$1$2***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
}

function openAiCompatibleAlternateModelsUrl(format: ApiProviderFormat, base: string): string {
  if (format !== 'openai-compatible') return ''
  return /\/v1$/i.test(base) ? `${base.replace(/\/v1$/i, '')}/models` : `${base}/v1/models`
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
