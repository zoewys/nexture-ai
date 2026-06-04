import type { AgentVendor } from '@shared/types'
import type { CliAdapter } from './types'
import { ClaudeAdapter } from './claudeAdapter'
import { CodexAdapter } from './codexAdapter'

/** Resolve a fresh adapter instance for a vendor. One per run. */
export function createAdapter(vendor: AgentVendor): CliAdapter {
  switch (vendor) {
    case 'claude':
      return new ClaudeAdapter()
    case 'codex':
      return new CodexAdapter()
    default: {
      const _exhaustive: never = vendor
      throw new Error(`Unknown vendor: ${String(_exhaustive)}`)
    }
  }
}
