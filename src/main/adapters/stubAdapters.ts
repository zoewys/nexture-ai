import type { AdapterCapabilities, AgentEvent, AgentVendor } from '@shared/types'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'

/**
 * Placeholder adapters for vendors that are not yet implemented.
 * See codexAdapter.ts for the real Codex implementation.
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
