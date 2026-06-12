import type { AgentEvent, AgentVendor, RunConfig } from '@shared/types'
import type { CliAdapter } from './types'
import { ClaudeAdapter } from './claudeAdapter'
import { CodexAdapter } from './codexAdapter'
import { ApiAdapter } from './apiAdapter'
import { PermissionGuard } from './api-tools/PermissionGuard'
import type { ProviderStore } from '../ProviderStore'

export interface AdapterContext {
  providerStore?: ProviderStore
  runConfig?: RunConfig
  emitEvent?: (event: AgentEvent) => void
}

/** Resolve a fresh adapter instance for a vendor. One per run. */
export function createAdapter(vendor: AgentVendor, ctx?: AdapterContext): CliAdapter {
  switch (vendor) {
    case 'claude':
      return new ClaudeAdapter()
    case 'codex':
      return new CodexAdapter()
    case 'api': {
      if (!ctx?.providerStore) throw new Error('API provider store is required')
      if (!ctx.runConfig?.apiProviderId) throw new Error('API provider id is required')
      const providerConfig = ctx.providerStore.getDecrypted(ctx.runConfig.apiProviderId)
      const guard = new PermissionGuard(ctx.runConfig.permissionMode ?? 'default', ctx.emitEvent ?? (() => {}))
      return new ApiAdapter(providerConfig, guard)
    }
    default: {
      const _exhaustive: never = vendor
      throw new Error(`Unknown vendor: ${String(_exhaustive)}`)
    }
  }
}
