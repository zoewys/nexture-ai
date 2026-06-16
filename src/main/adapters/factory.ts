import type { AdapterCapabilities, AgentEvent, AgentVendor, RunConfig } from '@shared/types'
import type { CliAdapter } from './types'
import { ClaudeAdapter } from './claudeAdapter'
import { CodexAdapter } from './codexAdapter'
import { ApiAdapter } from './apiAdapter'
import { PermissionGuard } from './api-tools/PermissionGuard'
import type { ProviderStore } from '../ProviderStore'
import type { ApiCallLogStore } from '../ApiCallLogStore'

const noopEmit = (): void => {}

export interface AdapterContext {
  providerStore?: ProviderStore
  apiCallLogStore?: ApiCallLogStore
  runConfig?: RunConfig
  emitEvent?: (event: AgentEvent) => void
}

export function getAdapterCapabilities(vendor: AgentVendor): AdapterCapabilities {
  switch (vendor) {
    case 'claude':
      return {
        bidirectionalStdin: true,
        nativeResume: true,
        structuredOutputSchema: false,
        partialTokenStream: true
      }
    case 'codex':
      return {
        bidirectionalStdin: false,
        nativeResume: true,
        structuredOutputSchema: true,
        partialTokenStream: true
      }
    case 'api':
      return {
        bidirectionalStdin: false,
        nativeResume: false,
        structuredOutputSchema: false,
        partialTokenStream: true
      }
    default: {
      const _exhaustive: never = vendor
      throw new Error(`Unknown vendor: ${String(_exhaustive)}`)
    }
  }
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
      const guard = new PermissionGuard(
        ctx.runConfig.permissionMode ?? 'bypassPermissions',
        ctx.emitEvent ?? noopEmit,
        { headless: ctx.runConfig.headless }
      )
      return new ApiAdapter(providerConfig, guard, ctx.apiCallLogStore)
    }
    default: {
      const _exhaustive: never = vendor
      throw new Error(`Unknown vendor: ${String(_exhaustive)}`)
    }
  }
}
