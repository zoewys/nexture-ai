import type { AdapterCapabilities, AgentEvent, AgentVendor } from '@shared/types'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'

/**
 * Placeholder adapters for gemini/codex. M1 ships claude end-to-end; these
 * keep the factory total so the UI can list all vendors without crashing, and
 * get real implementations in M3 (see IMPLEMENTATION_PLAN.md §5).
 */
class StubAdapter implements CliAdapter {
  readonly capabilities: AdapterCapabilities = {
    bidirectionalStdin: false,
    structuredOutputSchema: false,
    partialTokenStream: false
  }
  constructor(readonly vendor: AgentVendor) {}

  runTurn(_input: RunTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>()
    queue.push({
      kind: 'error',
      recoverable: false,
      message: `The ${this.vendor} adapter is not implemented yet (planned for M3). Use claude for now.`
    })
    queue.close()
    return queue
  }
}

export const geminiAdapter = (): CliAdapter => new StubAdapter('gemini')
export const codexAdapter = (): CliAdapter => new StubAdapter('codex')
