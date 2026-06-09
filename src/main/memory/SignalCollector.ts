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
  | 'reinforce'
  | 'saveRawSignal'
  | 'updateMeta'
>
type SignalAgentStore = Pick<AgentStore, 'list'>

const DEBOUNCE_MS = 8_000

export class SignalCollector {
  private pendingFlush: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly reflectionAgent: SignalReflectionAgent,
    private readonly memoryStore: SignalMemoryStore,
    private readonly agentStore: SignalAgentStore
  ) {}

  /**
   * Persist the signal immediately (crash-safe), then schedule a debounced
   * batch reflection. Multiple signals arriving within DEBOUNCE_MS are
   * combined into a single LLM call per agent.
   */
  collect(signal: MemorySignal): void {
    this.reinforceInjectedMemories(signal)
    if (!this.memoryStore.getReflectionConfig().enabled) return
    this.memoryStore.saveRawSignal(signal)
    this.scheduleFlush()
  }

  async drainRawSignals(): Promise<void> {
    if (!this.memoryStore.getReflectionConfig().enabled) return
    const signals = this.memoryStore.popRawSignals()
    if (signals.length === 0) return
    await this.reflectBatch(signals, false)
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) clearTimeout(this.pendingFlush)
    this.pendingFlush = setTimeout(() => {
      this.pendingFlush = null
      void this.flush()
    }, DEBOUNCE_MS)
  }

  private async flush(): Promise<void> {
    const signals = this.memoryStore.popRawSignals()
    if (signals.length === 0) return
    await this.reflectBatch(signals, false)
  }

  /**
   * Group signals by agentId and run one reflection call per agent.
   */
  private async reflectBatch(signals: MemorySignal[], rawPersisted: boolean): Promise<void> {
    const byAgent = new Map<string, MemorySignal[]>()
    for (const signal of signals) {
      const group = byAgent.get(signal.agentId) ?? []
      group.push(signal)
      byAgent.set(signal.agentId, group)
    }

    for (const [agentId, agentSignals] of byAgent) {
      const agent = this.findAgent(agentId)
      if (!agent) {
        if (!rawPersisted) {
          for (const s of agentSignals) this.memoryStore.saveRawSignal(s)
        }
        continue
      }

      try {
        const projectPath = agentSignals[0].projectPath
        const existingMemories = this.memoryStore.list(agentId, projectPath)
        const results = await this.reflectionAgent.reflect(agentSignals, agent, existingMemories)
        this.persistResults(agentSignals, results)
        for (const s of agentSignals) this.memoryStore.removeRawSignal(s)
      } catch (err) {
        console.error('[reflection] failed for agent', agentId, err)
        if (!rawPersisted) {
          for (const s of agentSignals) this.memoryStore.saveRawSignal(s)
        }
      }
    }
  }

  private findAgent(agentId: string): AgentDefinition | null {
    return this.agentStore.list().find((agent) => agent.id === agentId) ?? null
  }

  private persistResults(signals: MemorySignal[], results: ReflectionResult[]): void {
    const primary = signals[0]
    for (const result of results) {
      this.memoryStore.add({
        agentId: primary.agentId,
        scope: result.scope,
        projectPath: result.scope === 'project' ? primary.projectPath : undefined,
        category: result.category,
        content: result.content,
        evidence: signals.map(reflectionEvidence).join(' | '),
        strength: 1
      })
    }

    const meta = this.memoryStore.getMeta(primary.agentId)
    this.memoryStore.updateMeta(primary.agentId, {
      totalRuns: meta.totalRuns + 1,
      lastReflectionAt: Date.now()
    })
  }

  private reinforceInjectedMemories(signal: MemorySignal): void {
    if (signal.type !== 'positive') return
    for (const memoryId of signal.injectedMemoryIds ?? []) {
      this.memoryStore.reinforce(memoryId)
    }
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
