import type {
  AgentDefinition,
  MemoryEntry,
  MemorySignal,
  ReflectionResult
} from '@shared/types'
import type { AgentStore } from '../AgentStore'
import type { MemoryStore } from './MemoryStore'
import type { ReflectionAgent } from './ReflectionAgent'

type SignalReflectionAgent = Pick<ReflectionAgent, 'reflect'>
type SignalMemoryStore = Pick<
  MemoryStore,
  | 'add'
  | 'getMeta'
  | 'getReflectionConfig'
  | 'list'
  | 'popRawSignals'
  | 'removeRawSignal'
  | 'saveRawSignal'
  | 'updateMeta'
>
type SignalAgentStore = Pick<AgentStore, 'list'>

interface ReflectionOptions {
  rawPersisted: boolean
}

export class SignalCollector {
  constructor(
    private readonly reflectionAgent: SignalReflectionAgent,
    private readonly memoryStore: SignalMemoryStore,
    private readonly agentStore: SignalAgentStore
  ) {}

  /**
   * Persist the signal first so app shutdown cannot lose it, then reflect in
   * the background. Successful reflection removes the raw signal.
   */
  collect(signal: MemorySignal): void {
    if (!this.memoryStore.getReflectionConfig().enabled) return
    this.memoryStore.saveRawSignal(signal)
    void this.runReflection(signal, { rawPersisted: true })
  }

  async drainRawSignals(): Promise<void> {
    if (!this.memoryStore.getReflectionConfig().enabled) return
    const signals = this.memoryStore.popRawSignals()
    for (const signal of signals) {
      await this.runReflection(signal, { rawPersisted: false })
    }
  }

  private async runReflection(signal: MemorySignal, options: ReflectionOptions): Promise<void> {
    const agent = this.findAgent(signal.agentId)
    if (!agent) {
      if (!options.rawPersisted) this.memoryStore.saveRawSignal(signal)
      return
    }

    try {
      const existingMemories = this.memoryStore.list(signal.agentId, signal.projectPath)
      const results = await this.reflectionAgent.reflect(signal, agent, existingMemories)
      this.persistResults(signal, results)
      if (options.rawPersisted) this.memoryStore.removeRawSignal(signal)
    } catch {
      if (!options.rawPersisted) this.memoryStore.saveRawSignal(signal)
    }
  }

  private findAgent(agentId: string): AgentDefinition | null {
    return this.agentStore.list().find((agent) => agent.id === agentId) ?? null
  }

  private persistResults(signal: MemorySignal, results: ReflectionResult[]): void {
    for (const result of results) {
      this.memoryStore.add({
        agentId: signal.agentId,
        scope: result.scope,
        projectPath: result.scope === 'project' ? signal.projectPath : undefined,
        category: result.category,
        content: result.content,
        evidence: reflectionEvidence(signal),
        strength: 1
      })
    }

    const meta = this.memoryStore.getMeta(signal.agentId)
    this.memoryStore.updateMeta(signal.agentId, {
      totalRuns: meta.totalRuns + 1,
      lastReflectionAt: Date.now()
    })
  }
}

function reflectionEvidence(signal: MemorySignal): string {
  return [
    `workflow=${signal.workflowRunId}`,
    `run=${signal.runId}`,
    `step=${signal.stepIndex}`,
    `signal=${signal.type}`,
    `source=${signal.source}`
  ].join('; ')
}
