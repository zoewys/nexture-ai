import { randomUUID } from 'node:crypto'
import type {
  AgentDefinition,
  AgentEvent,
  HandoffArtifact,
  RunConfig,
  WorkflowEventEnvelope,
  WorkflowRun,
  WorkflowStartInput,
  WorkflowStartResult,
  WorkflowStepExecution,
  WorkflowTemplate
} from '@shared/types'
import type { AgentStore } from './AgentStore'
import type { RunManager } from './RunManager'
import type { TranscriptStore } from './TranscriptStore'
import type { WorkflowStore } from './WorkflowStore'

type EmitWorkflow = (envelope: WorkflowEventEnvelope) => void

interface LiveStep {
  workflowRunId: string
  childRunId: string
  stepIndex: number
  executionId: string
}

const HANDOFF_SCHEMA_TEXT = `
When this step is complete, respond with only JSON matching this shape:
{
  "summary": "what this step completed and what downstream agents need to know",
  "artifacts": [
    { "path": "relative/or/absolute/path", "description": "what this artifact contains", "type": "other" }
  ],
  "nextStepGuidance": "optional advice for the next step"
}
Do not wrap the JSON in markdown fences.
`.trim()

export class WorkflowManager {
  private runs = new Map<string, WorkflowRun>()
  private liveByRunId = new Map<string, LiveStep>()

  constructor(
    private readonly agentStore: AgentStore,
    private readonly workflowStore: WorkflowStore,
    private readonly runManager: RunManager,
    private readonly transcripts: TranscriptStore,
    private readonly emit: EmitWorkflow
  ) {
    for (const run of workflowStore.listRuns()) this.runs.set(run.id, run)
  }

  start(input: WorkflowStartInput): WorkflowStartResult {
    const template = this.workflowStore
      .listTemplates()
      .find((candidate) => candidate.id === input.templateId)
    if (!template) throw new Error(`Workflow template not found: ${input.templateId}`)
    if (template.steps.length === 0) throw new Error('Workflow template has no steps')

    const now = Date.now()
    const run: WorkflowRun = {
      id: randomUUID(),
      templateId: template.id,
      templateName: template.name,
      projectPath: input.projectPath,
      initialPrompt: input.initialPrompt,
      status: 'running',
      currentStepIndex: 0,
      startedAt: now,
      steps: template.steps.map((step) => ({
        agentId: step.agentId,
        status: 'pending',
        executions: []
      }))
    }
    this.runs.set(run.id, run)
    this.workflowStore.saveRun(run)
    this.emitUpdate(run)
    this.startStep(run.id, 0)
    return { run }
  }

  confirmStep(runId: string): WorkflowRun {
    const run = this.getRun(runId)
    const step = run.steps[run.currentStepIndex]
    const execution = latestExecution(step)
    if (!execution || execution.status !== 'awaiting-confirm') {
      throw new Error('Current step is not awaiting confirmation')
    }

    execution.status = 'done'
    execution.finishedAt = execution.finishedAt ?? Date.now()
    step.status = 'done'

    const nextIndex = run.currentStepIndex + 1
    if (nextIndex >= run.steps.length) {
      run.status = 'completed'
      run.finishedAt = Date.now()
      this.persistAndEmit(run)
      return run
    }

    run.currentStepIndex = nextIndex
    run.status = 'running'
    this.persistAndEmit(run)
    this.startStep(run.id, nextIndex)
    return run
  }

  rerunStep(runId: string, stepIndex: number): WorkflowRun {
    const run = this.getRun(runId)
    if (stepIndex < 0 || stepIndex >= run.steps.length) throw new Error('Invalid step index')

    const live = this.liveByRunId.get(run.id)
    if (live) this.runManager.abort(live.childRunId)

    markDownstreamStale(run, stepIndex)

    run.currentStepIndex = stepIndex
    run.status = 'running'
    this.persistAndEmit(run)
    this.startStep(run.id, stepIndex)
    return run
  }

  abort(runId: string): WorkflowRun {
    const run = this.getRun(runId)
    const live = this.liveByRunId.get(run.id)
    if (live) this.runManager.abort(live.childRunId)

    run.status = 'aborted'
    run.finishedAt = Date.now()
    const step = run.steps[run.currentStepIndex]
    const execution = latestExecution(step)
    if (execution?.status === 'running') {
      execution.status = 'error'
      execution.finishedAt = Date.now()
      execution.error = 'Workflow aborted'
      step.status = 'error'
    }
    this.persistAndEmit(run)
    return run
  }

  async pushInput(runId: string, stepIndex: number, text: string): Promise<WorkflowRun> {
    const clean = text.trim()
    if (!clean) return this.getRun(runId)

    const run = this.getRun(runId)
    if (stepIndex < 0 || stepIndex >= run.steps.length) throw new Error('Invalid step index')

    const live = this.liveByRunId.get(run.id)
    if (live) {
      if (live.stepIndex !== stepIndex) {
        throw new Error('Only the running workflow step can accept live input')
      }
      const execution = run.steps[live.stepIndex]?.executions.find(
        (item) => item.id === live.executionId
      )
      if (!execution) throw new Error('Live workflow execution not found')
      execution.events.push({ kind: 'system', text: `↳ User: ${clean}` })
      this.workflowStore.saveRun(run)
      this.emitUpdate(run)
      this.transcripts.recordUserInput(live.childRunId, clean)
      await this.runManager.push(live.childRunId, clean)
      return run
    }

    const step = run.steps[stepIndex]
    const previous = latestExecution(step)
    if (!previous?.sessionId) {
      throw new Error('Selected workflow step has no session to continue')
    }

    const agent = this.agentStore.list().find((candidate) => candidate.id === step.agentId)
    if (!agent) throw new Error(`Agent not found: ${step.agentId}`)

    const prompt = [
      clean,
      '',
      '# Handoff requirement',
      HANDOFF_SCHEMA_TEXT
    ].join('\n')
    const execution: WorkflowStepExecution = {
      id: randomUUID(),
      stepIndex,
      agentId: agent.id,
      status: 'running',
      startedAt: Date.now(),
      events: [{ kind: 'system', text: `↳ User: ${clean}` }]
    }
    step.executions.push(execution)
    step.status = 'running'
    markDownstreamStale(run, stepIndex)
    run.currentStepIndex = stepIndex
    run.status = 'running'
    run.finishedAt = undefined
    this.persistAndEmit(run)

    const config: RunConfig = {
      vendor: agent.vendor,
      prompt,
      cwd: run.projectPath,
      model: agent.model?.trim() || undefined,
      codexReasoningEffort: agent.codexReasoningEffort,
      codexServiceTier: agent.codexServiceTier?.trim() || undefined,
      appendSystemPrompt: agent.systemPrompt,
      permissionMode: agent.permissionMode,
      resumeFrom: {
        sessionId: previous.sessionId,
        vendor: agent.vendor,
        transcriptPath: this.transcripts.getTranscriptPath(previous.sessionId)
      }
    }

    const childRunId = this.runManager.start(config, (_childRunId, event) => {
      this.handleAgentEvent(run.id, stepIndex, execution.id, event)
    })
    execution.runId = childRunId
    this.transcripts.recordUserInput(childRunId, prompt)
    this.liveByRunId.set(run.id, {
      workflowRunId: run.id,
      childRunId,
      stepIndex,
      executionId: execution.id
    })
    this.persistAndEmit(run)
    return run
  }

  abortAll(): void {
    for (const live of this.liveByRunId.values()) this.runManager.abort(live.childRunId)
    this.liveByRunId.clear()
  }

  private startStep(runId: string, stepIndex: number): void {
    const run = this.getRun(runId)
    const step = run.steps[stepIndex]
    const agent = this.agentStore.list().find((candidate) => candidate.id === step.agentId)
    if (!agent) {
      this.failStep(run, stepIndex, `Agent not found: ${step.agentId}`)
      return
    }

    const prompt = this.buildPrompt(run, stepIndex, agent)
    const execution: WorkflowStepExecution = {
      id: randomUUID(),
      stepIndex,
      agentId: agent.id,
      status: 'running',
      startedAt: Date.now(),
      events: []
    }
    step.executions.push(execution)
    step.status = 'running'
    run.currentStepIndex = stepIndex
    run.status = 'running'
    this.persistAndEmit(run)

    const config: RunConfig = {
      vendor: agent.vendor,
      prompt,
      cwd: run.projectPath,
      model: agent.model?.trim() || undefined,
      codexReasoningEffort: agent.codexReasoningEffort,
      codexServiceTier: agent.codexServiceTier?.trim() || undefined,
      appendSystemPrompt: agent.systemPrompt,
      permissionMode: agent.permissionMode
    }

    const childRunId = this.runManager.start(config, (_childRunId, event) => {
      this.handleAgentEvent(run.id, stepIndex, execution.id, event)
    })
    execution.runId = childRunId
    this.transcripts.recordUserInput(childRunId, prompt)
    this.liveByRunId.set(run.id, {
      workflowRunId: run.id,
      childRunId,
      stepIndex,
      executionId: execution.id
    })
    this.persistAndEmit(run)
  }

  private handleAgentEvent(
    runId: string,
    stepIndex: number,
    executionId: string,
    event: AgentEvent
  ): void {
    const run = this.runs.get(runId)
    if (!run) return
    const execution = run.steps[stepIndex]?.executions.find((item) => item.id === executionId)
    if (!execution) return

    execution.events.push(event)
    if (event.kind === 'session-started') execution.sessionId = event.sessionId
    this.emit({
      runId,
      event: { kind: 'agent-event', runId, stepIndex, executionId, event }
    })

    if (event.kind === 'error' && !event.recoverable) {
      this.finishStepWithError(run, stepIndex, execution, event.message)
      return
    }

    if (event.kind === 'turn-done') {
      this.liveByRunId.delete(run.id)
      if (event.reason === 'complete') {
        this.finishStepWithHandoff(run, stepIndex, execution)
      } else {
        this.finishStepWithError(run, stepIndex, execution, `Step ${event.reason}`)
      }
    } else {
      this.workflowStore.saveRun(run)
    }
  }

  private finishStepWithHandoff(
    run: WorkflowRun,
    stepIndex: number,
    execution: WorkflowStepExecution
  ): void {
    const handoff = parseHandoff(execution.events)
    if (!handoff) {
      this.finishStepWithError(run, stepIndex, execution, 'Could not parse handoff JSON')
      return
    }
    execution.handoff = handoff
    execution.status = 'awaiting-confirm'
    execution.finishedAt = Date.now()
    run.steps[stepIndex].status = 'awaiting-confirm'
    run.status = 'awaiting-confirm'
    this.persistAndEmit(run)
  }

  private finishStepWithError(
    run: WorkflowRun,
    stepIndex: number,
    execution: WorkflowStepExecution,
    message: string
  ): void {
    execution.status = 'error'
    execution.error = message
    execution.finishedAt = Date.now()
    run.steps[stepIndex].status = 'error'
    run.status = 'error'
    run.finishedAt = Date.now()
    this.liveByRunId.delete(run.id)
    this.persistAndEmit(run)
  }

  private failStep(run: WorkflowRun, stepIndex: number, message: string): void {
    const execution: WorkflowStepExecution = {
      id: randomUUID(),
      stepIndex,
      agentId: run.steps[stepIndex].agentId,
      status: 'error',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      events: [{ kind: 'error', recoverable: false, message }],
      error: message
    }
    run.steps[stepIndex].executions.push(execution)
    run.steps[stepIndex].status = 'error'
    run.status = 'error'
    run.finishedAt = Date.now()
    this.persistAndEmit(run)
  }

  private buildPrompt(run: WorkflowRun, stepIndex: number, _agent: AgentDefinition): string {
    if (stepIndex === 0) {
      return [
        '# User request',
        run.initialPrompt,
        '',
        '# Handoff requirement',
        HANDOFF_SCHEMA_TEXT
      ].join('\n')
    }

    const previous = latestCompletedHandoff(run, stepIndex - 1)
    if (!previous) {
      return [
        '# User request',
        run.initialPrompt,
        '',
        '# Missing upstream handoff',
        'The previous step did not provide a valid handoff. Explain the issue and output a handoff JSON.',
        '',
        '# Handoff requirement',
        HANDOFF_SCHEMA_TEXT
      ].join('\n')
    }

    return [
      '# Upstream handoff',
      previous.summary,
      '',
      '# Artifacts',
      previous.artifacts.map((artifact) => `- ${artifact.path}: ${artifact.description}`).join('\n') || '(none)',
      previous.nextStepGuidance ? `\n# Next-step guidance\n${previous.nextStepGuidance}` : '',
      '',
      '# Original user request',
      run.initialPrompt,
      '',
      '# Handoff requirement',
      HANDOFF_SCHEMA_TEXT
    ].join('\n')
  }

  private getRun(runId: string): WorkflowRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    return run
  }

  private persistAndEmit(run: WorkflowRun): void {
    this.workflowStore.saveRun(run)
    this.emitUpdate(run)
  }

  private emitUpdate(run: WorkflowRun): void {
    this.emit({ runId: run.id, event: { kind: 'run-updated', run } })
  }
}

function latestExecution(step: { executions: WorkflowStepExecution[] }): WorkflowStepExecution | null {
  return step.executions[step.executions.length - 1] ?? null
}

function latestCompletedHandoff(run: WorkflowRun, stepIndex: number): HandoffArtifact | null {
  for (let i = stepIndex; i >= 0; i--) {
    const executions = run.steps[i]?.executions ?? []
    for (let j = executions.length - 1; j >= 0; j--) {
      const execution = executions[j]
      if (execution.handoff && (execution.status === 'done' || execution.status === 'awaiting-confirm')) {
        return execution.handoff
      }
    }
  }
  return null
}

function markDownstreamStale(run: WorkflowRun, stepIndex: number): void {
  for (let i = stepIndex + 1; i < run.steps.length; i++) {
    if (
      run.steps[i].status === 'done' ||
      run.steps[i].status === 'awaiting-confirm' ||
      run.steps[i].status === 'error'
    ) {
      run.steps[i].status = 'stale'
      const execution = latestExecution(run.steps[i])
      if (execution) execution.status = 'stale'
    }
  }
}

function parseHandoff(events: AgentEvent[]): HandoffArtifact | null {
  const text = [...events]
    .reverse()
    .find((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message')
    ?.text
  if (!text) return null

  const candidates = [text, ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1])]
  for (const candidate of candidates) {
    const json = extractJson(candidate)
    if (!json) continue
    try {
      const parsed = JSON.parse(json) as Partial<HandoffArtifact>
      if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.artifacts)) continue
      const artifacts = parsed.artifacts
        .filter((artifact): artifact is HandoffArtifact['artifacts'][number] => {
          return (
            artifact !== null &&
            typeof artifact === 'object' &&
            typeof (artifact as any).path === 'string' &&
            typeof (artifact as any).description === 'string'
          )
        })
        .map((artifact) => ({
          path: artifact.path,
          description: artifact.description,
          type: artifact.type
        }))
      return {
        summary: parsed.summary,
        artifacts,
        nextStepGuidance:
          typeof parsed.nextStepGuidance === 'string' ? parsed.nextStepGuidance : undefined
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function extractJson(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null
}
