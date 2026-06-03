import type { AgentStudioApi } from './index'

declare global {
  interface Window {
    api: AgentStudioApi
  }
}

export {}
