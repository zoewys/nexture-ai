import { randomUUID } from 'node:crypto'
import type {
  AgentDefinition,
  AgentEvent,
  HandoffArtifact,
  JSONSchema,
  MemorySignal,
  RouteSuggestion,
  RunConfig,
  StepRule,
  WorkflowEventEnvelope,
  WorkflowRun,
  WorkflowRunGitSafety,
  WorkflowRunStep,
  WorkflowStartInput,
  WorkflowStartResult,
  WorkflowStepExecution,
  WorkflowTemplate,
  WorkflowTemplateStep
} from '@shared/types'
import { isParallelGroup } from '@shared/types'
import type { AgentStore } from './AgentStore'
import type { RunManager } from './RunManager'
import type { TranscriptStore } from './TranscriptStore'
import type { WorkflowStore } from './WorkflowStore'
import { inspectWorkflowGitSafety } from './gitSafety'
import type { MemoryInjector } from './memory/MemoryInjector'
import type { SignalCollector } from './memory/SignalCollector'
import { summarizeTranscript } from './memory/transcriptSummarizer'
import {
  createWorktree,
  removeWorktree,
  cleanupOrphanedWorktrees,
  isGitRepo
} from './worktreeManager'

type EmitWorkflow = (envelope: WorkflowEventEnvelope) => void
type RunSettledHandler = (run: WorkflowRun) => void

interface LiveStep {
  workflowRunId: string
  childRunId: string
  stepIndex: number
  executionId: string
}

const HANDOFF_HINT = [
  'When this step is complete, output a single JSON object (NOT markdown, NOT a code block) with this exact structure:',
  '',
  '{',
  '  "summary": "<one-paragraph summary of what you did and key decisions>",',
  '  "artifacts": [',
  '    {',
  '      "path": "<relative file path>",',
  '      "description": "<what this file contains and why it matters>",',
  '      "type": "requirement|design|code|test|other"',
  '    }',
  '  ],',
  '  "nextStepGuidance": "<optional: what the next agent should focus on>",',
  '  "routeSuggestion": { "action": "continue|retry-prev|skip-next|goto", "target": 0, "reason": "..." }',
  '}',
  '',
  'Output ONLY the JSON object. Do not wrap it in ``` fences. Do not add any other text before or after.',
  'The routeSuggestion field is optional — only include it if you believe the workflow should deviate from the default next step.'
].join('\n')

const INTERACTIVE_HINT = [
  'This step runs in interactive mode — you are communicating directly with the user.',
  '',
  'Behavior rules:',
  '- Ask the user questions to clarify requirements. Output natural language only (do NOT output the handoff JSON yet).',
  '- Keep each round focused: ask 2-3 key questions, not a long list.',
  '- When you are confident that the requirements are fully clear, output the handoff JSON to conclude this step.',
  '- The handoff JSON signals "conversation over" — do not output it until you are ready to hand off.'
].join('\n')

const HANDOFF_OUTPUT_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'artifacts'],
  properties: {
    summary: { type: 'string' },
    artifacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'description'],
        properties: {
          path: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string', enum: ['requirement', 'design', 'code', 'test', 'other'] }
        }
      }
    },
    nextStepGuidance: { type: 'string' },
    routeSuggestion: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['continue', 'retry-prev', 'skip-next', 'goto'] },
        target: { type: 'number' },
        reason: { type: 'string' }
      }
    }
  }
}

export class WorkflowManager {
  private runs = new Map<string, WorkflowRun>()
  private liveByRunId = new Map<string, LiveStep[]>()
  private settledRunIds = new Set<string>()
  private runSettledHandler: RunSettledHandler | null = null
  private gotoCountByRun = new Map<string, number>()

  constructor(
    private readonly agentStore: AgentStore,
    private readonly workflowStore: WorkflowStore,
    private readonly runManager: RunManager,
    private readonly transcripts: TranscriptStore,
    private readonly emit: EmitWorkflow,
    private readonly signalCollector?: SignalCollector,
    private readonly memoryInjector?: MemoryInjector
  ) {
    for (const run of this.markInterruptedRunsOnStartup(workflowStore.listRuns())) {
      this.runs.set(run.id, run)
    }
  }

  setRunSettledHandler(handler: RunSettledHandler | null): void {
    this.runSettledHandler = handler
  }

  start(input: WorkflowStartInput): WorkflowStartResult {
    const template = this.workflowStore
      .listTemplates()
      .find((candidate) => candidate.id === input.templateId)
    if (!template) throw new Error(`Workflow template not found: ${input.templateId}`)
    if (template.steps.length === 0) throw new Error('Workflow template has no steps')

    const safety = inspectWorkflowGitSafety(input.projectPath, this.listRuns())
    if (safety.level === 'requires-confirmation' && !input.allowUnsafeSameGitRoot) {
      throw new Error(safety.message ?? 'Workflow requires confirmation before starting')
    }

    const now = Date.now()
    const run: WorkflowRun = {
      id: randomUUID(),
      templateId: template.id,
      templateName: template.name,
      runName: input.runName?.trim() || undefined,
      projectPath: input.projectPath,
      initialPrompt: input.initialPrompt,
      status: 'running',
      currentStepIndex: 0,
      startedAt: now,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      budgetUsd: template.budgetUsd,
      autoConfirm: input.autoConfirm,
      scheduledBy: input.scheduledBy,
      steps: this.flattenTemplateSteps(template)
    }
    this.runs.set(run.id, run)
    this.workflowStore.saveRun(run)
    this.emitUpdate(run)
    this.startNextNode(run.id, 0)
    return { run }
  }

  listRuns(): WorkflowRun[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  deleteRun(runId: string): void {
    const run = this.getRun(runId)
    if (run.status === 'running' || run.status === 'awaiting-input') {
      throw new Error('Stop a running workflow before deleting it')
    }
    const liveSteps = this.liveByRunId.get(runId) ?? []
    for (const live of liveSteps) this.runManager.abort(live.childRunId)
    this.liveByRunId.delete(runId)
    for (const step of run.steps) {
      if (step.worktreePath) {
        try { removeWorktree(run.projectPath, step.worktreePath) } catch { /* best-effort */ }
      }
    }
    this.runs.delete(runId)
    this.workflowStore.deleteRun(runId)
  }

  inspectGitSafety(projectPath: string): WorkflowRunGitSafety {
    return inspectWorkflowGitSafety(projectPath, this.listRuns())
  }

  confirmStep(runId: string, stepIndex?: number): WorkflowRun {
    const run = this.getRun(runId)
    const idx = stepIndex ?? run.currentStepIndex
    const step = run.steps[idx]
    const execution = latestExecution(step)
    if (!execution || execution.status !== 'awaiting-confirm') {
      throw new Error('Current step is not awaiting confirmation')
    }

    execution.status = 'done'
    execution.finishedAt = execution.finishedAt ?? Date.now()
    step.status = 'done'
    this.collectMemorySignal('positive', 'user-confirmed', run, idx, execution)

    if (step.parallelGroupId) {
      if (step.worktreePath) {
        try { removeWorktree(run.projectPath, step.worktreePath) } catch { /* best-effort */ }
        step.worktreePath = undefined
      }
      if (step.parallelGroupJoin && !this.isParallelGroupComplete(run, step.parallelGroupId)) {
        this.persistAndEmit(run)
        return run
      }
      if (step.parallelGroupJoin) {
        const nextIndex = this.getNextNodeAfterGroup(run, step.parallelGroupId)
        if (nextIndex === null) {
          run.status = 'completed'
          run.finishedAt = Date.now()
          this.persistAndEmit(run)
          return run
        }
        run.currentStepIndex = nextIndex
        run.status = 'running'
        this.persistAndEmit(run)
        this.startNextNode(run.id, nextIndex)
        return run
      }
      this.persistAndEmit(run)
      return run
    }

    const nextIndex = idx + 1
    if (nextIndex >= run.steps.length) {
      run.status = 'completed'
      run.finishedAt = Date.now()
      this.persistAndEmit(run)
      return run
    }

    run.currentStepIndex = nextIndex
    run.status = 'running'
    this.persistAndEmit(run)
    this.startNextNode(run.id, nextIndex)
    return run
  }

  rerunStep(runId: string, stepIndex: number): WorkflowRun {
    const run = this.getRun(runId)
    if (stepIndex < 0 || stepIndex >= run.steps.length) throw new Error('Invalid step index')

    const liveSteps = this.liveByRunId.get(run.id) ?? []
    const targetLive = liveSteps.find((ls) => ls.stepIndex === stepIndex)
    if (targetLive) {
      this.runManager.abort(targetLive.childRunId)
      const filtered = liveSteps.filter((ls) => ls.stepIndex !== stepIndex)
      if (filtered.length === 0) this.liveByRunId.delete(run.id)
      else this.liveByRunId.set(run.id, filtered)
    }

    const previous = latestExecution(run.steps[stepIndex])
    if (previous) {
      this.collectMemorySignal('negative', 'user-rerun', run, stepIndex, previous)
    }

    markDownstreamStale(run, stepIndex)

    run.currentStepIndex = stepIndex
    run.status = 'running'
    this.persistAndEmit(run)
    this.startStep(run.id, stepIndex)
    return run
  }

  updatePrompt(runId: string, newPrompt: string): WorkflowRun {
    const run = this.getRun(runId)
    run.initialPrompt = newPrompt
    this.persistAndEmit(run)
    return run
  }

  abort(runId: string): WorkflowRun {
    const run = this.getRun(runId)
    const liveSteps = this.liveByRunId.get(run.id) ?? []
    for (const live of liveSteps) this.runManager.abort(live.childRunId)
    this.liveByRunId.delete(run.id)

    run.status = 'aborted'
    run.finishedAt = Date.now()
    for (const step of run.steps) {
      const execution = latestExecution(step)
      if (execution?.status === 'running' || execution?.status === 'awaiting-input') {
        execution.status = 'error'
        execution.finishedAt = Date.now()
        execution.error = 'Workflow aborted'
        step.status = 'error'
      }
      if (step.worktreePath) {
        try { removeWorktree(run.projectPath, step.worktreePath) } catch { /* best-effort */ }
        step.worktreePath = undefined
      }
    }
    this.persistAndEmit(run)
    return run
  }

  async pushInput(runId: string, stepIndex: number, text: string): Promise<WorkflowRun> {
    const clean = text.trim()
    if (!clean) return this.getRun(runId)

    const run = this.getRun(runId)
    if (stepIndex < 0 || stepIndex >= run.steps.length) throw new Error('Invalid step index')

    const liveSteps = this.liveByRunId.get(run.id) ?? []
    const live = liveSteps.find((ls) => ls.stepIndex === stepIndex)
    if (live) {
      const step = run.steps[live.stepIndex]
      const execution = step?.executions.find(
        (item) => item.id === live.executionId
      )
      if (!execution) throw new Error('Live workflow execution not found')
      if (step.status === 'awaiting-input') {
        execution.status = 'running'
        step.status = 'running'
        run.status = 'running'
        run.finishedAt = undefined
      }
      execution.events.push({ kind: 'system', text: `↳ ${clean}` })
      this.persistAndEmit(run)
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

    const mainPrompt = [
      clean,
      '',
      '# Handoff requirement',
      HANDOFF_HINT
    ].join('\n')
    const prompt = mainPrompt
    const injectedMemoryIds: string[] = []
    const execution: WorkflowStepExecution = {
      id: randomUUID(),
      stepIndex,
      agentId: agent.id,
      status: 'running',
      startedAt: Date.now(),
      injectedMemoryIds,
      events: [{ kind: 'system', text: `↳ ${clean}` }],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0
    }
    step.executions.push(execution)
    step.status = 'running'
    markDownstreamStale(run, stepIndex)
    run.currentStepIndex = stepIndex
    run.status = 'running'
    run.finishedAt = undefined
    this.persistAndEmit(run)

    // Budget check: stop before launching if cap exceeded
    if (run.budgetUsd !== undefined && run.totalCostUsd >= run.budgetUsd) {
      this.finishStepWithError(
        run,
        stepIndex,
        execution,
        `Budget exceeded: $${run.totalCostUsd.toFixed(2)} / $${run.budgetUsd.toFixed(2)}`
      )
      return run
    }

    const config: RunConfig = {
      vendor: agent.vendor,
      prompt,
      cwd: run.projectPath,
      model: agent.model?.trim() || undefined,
      codexReasoningEffort: agent.codexReasoningEffort,
      codexServiceTier: agent.codexServiceTier?.trim() || undefined,
      apiProviderId: agent.apiProviderId,
      appendSystemPrompt: agent.systemPrompt,
      outputSchema: HANDOFF_OUTPUT_SCHEMA,
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
    this.addLiveStep(run.id, {
      workflowRunId: run.id,
      childRunId,
      stepIndex,
      executionId: execution.id
    })
    this.persistAndEmit(run)
    return run
  }

  finishInteractiveStep(runId: string, stepIndex: number): WorkflowRun {
    const run = this.getRun(runId)
    if (stepIndex < 0 || stepIndex >= run.steps.length) throw new Error('Invalid step index')
    const step = run.steps[stepIndex]
    const execution = latestExecution(step)
    if (!execution || step.status !== 'awaiting-input') {
      throw new Error('Selected workflow step is not awaiting input')
    }

    const fallbackHandoff: HandoffArtifact = {
      summary: this.extractConversationSummary(execution.events),
      artifacts: [],
      nextStepGuidance: ''
    }

    execution.handoff = fallbackHandoff
    execution.status = 'done'
    execution.finishedAt = Date.now()
    step.status = 'done'
    this.completeLiveStep(run.id, execution.id, true)
    this.aggregateStepCost(run, execution)
    this.collectMemorySignal('positive', 'user-confirmed', run, stepIndex, execution)

    if (step.parallelGroupId) {
      if (step.worktreePath) {
        try { removeWorktree(run.projectPath, step.worktreePath) } catch { /* best-effort */ }
        step.worktreePath = undefined
      }
      if (step.parallelGroupJoin && !this.isParallelGroupComplete(run, step.parallelGroupId)) {
        run.status = this.hasLiveSteps(run.id) ? 'running' : 'awaiting-confirm'
        this.persistAndEmit(run)
        return run
      }
      if (step.parallelGroupJoin) {
        this.cleanupGroupWorktrees(run, step.parallelGroupId)
        const nextIndex = this.getNextNodeAfterGroup(run, step.parallelGroupId)
        if (nextIndex === null) {
          run.status = 'completed'
          run.finishedAt = Date.now()
          this.persistAndEmit(run)
          return run
        }
        run.currentStepIndex = nextIndex
        run.status = 'running'
        this.persistAndEmit(run)
        this.startNextNode(run.id, nextIndex)
        return run
      }
      if (run.steps.every((s) => s.status === 'done' || s.status === 'error' || s.status === 'stale')) {
        run.status = run.steps.some((s) => s.status === 'error') ? 'error' : 'completed'
        run.finishedAt = Date.now()
      } else {
        run.status = this.hasLiveSteps(run.id) ? 'running' : 'awaiting-confirm'
      }
      this.persistAndEmit(run)
      return run
    }

    const nextIndex = stepIndex + 1
    if (nextIndex >= run.steps.length) {
      run.status = 'completed'
      run.finishedAt = Date.now()
      this.collectMemorySignal('completion', 'workflow-done', run, stepIndex, execution, { handoff: fallbackHandoff })
      this.persistAndEmit(run)
      return run
    }

    run.currentStepIndex = nextIndex
    run.status = 'running'
    this.persistAndEmit(run)
    this.startNextNode(run.id, nextIndex)
    return run
  }

  abortAll(): void {
    for (const liveSteps of this.liveByRunId.values()) {
      for (const live of liveSteps) this.runManager.abort(live.childRunId)
    }
    this.liveByRunId.clear()
  }

  private startStep(runId: string, stepIndex: number): void {
    const run = this.getRun(runId)
    const step = run.steps[stepIndex]
    const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
    const agent = this.agentStore.list().find((candidate) => candidate.id === step.agentId)
    if (!agent) {
      this.failStep(run, stepIndex, `Agent not found: ${step.agentId}`)
      return
    }

    const { prompt, injectedMemoryIds } = this.buildPrompt(run, stepIndex, agent)
    const execution: WorkflowStepExecution = {
      id: randomUUID(),
      stepIndex,
      agentId: agent.id,
      status: 'running',
      startedAt: Date.now(),
      injectedMemoryIds,
      events: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0
    }
    step.executions.push(execution)
    step.status = 'running'
    if (!step.parallelGroupId) run.currentStepIndex = stepIndex
    run.status = 'running'
    this.persistAndEmit(run)

    // Budget check before running
    if (run.budgetUsd !== undefined && run.totalCostUsd >= run.budgetUsd) {
      this.finishStepWithError(
        run,
        stepIndex,
        execution,
        `Budget exceeded: $${run.totalCostUsd.toFixed(2)} / $${run.budgetUsd.toFixed(2)}`
      )
      return
    }

    const cwd = step.worktreePath ?? run.projectPath
    const config: RunConfig = {
      vendor: agent.vendor,
      prompt,
      cwd,
      model: agent.model?.trim() || undefined,
      codexReasoningEffort: agent.codexReasoningEffort,
      codexServiceTier: agent.codexServiceTier?.trim() || undefined,
      apiProviderId: agent.apiProviderId,
      appendSystemPrompt: agent.systemPrompt,
      outputSchema: HANDOFF_OUTPUT_SCHEMA,
      keepStdinOpenAfterTurnDone: templateStep?.interactive === true,
      permissionMode: agent.permissionMode
    }

    const childRunId = this.runManager.start(config, (_childRunId, event) => {
      this.handleAgentEvent(run.id, stepIndex, execution.id, event)
    })
    execution.runId = childRunId
    this.transcripts.recordUserInput(childRunId, prompt)
    this.addLiveStep(run.id, {
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
    if (
      event.kind === 'turn-done' &&
      execution.status !== 'running' &&
      execution.status !== 'awaiting-input'
    ) {
      return
    }

    execution.events.push(event)
    if (event.kind === 'session-started') execution.sessionId = event.sessionId
    if (event.kind === 'usage') {
      execution.totalInputTokens += event.inputTokens
      execution.totalOutputTokens += event.outputTokens
      execution.totalCostUsd += event.costUsd ?? 0
    }

    if (event.kind === 'error' && !event.recoverable) {
      this.finishStepWithError(run, stepIndex, execution, event.message)
      return
    }

    if (event.kind === 'turn-done') {
      if (event.reason === 'complete') {
        this.finishStepWithHandoff(run, stepIndex, execution)
      } else {
        this.finishStepWithError(run, stepIndex, execution, `Step ${event.reason}`)
      }
    } else {
      this.persist(run)
      this.emitAgentEvent(run.id, stepIndex, executionId, event)
    }
  }

  private finishStepWithHandoff(
    run: WorkflowRun,
    stepIndex: number,
    execution: WorkflowStepExecution
  ): void {
    const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
    const handoff = parseHandoff(execution.events)

    if (!handoff) {
      if (templateStep?.interactive === true) {
        this.enterAwaitingInput(run, stepIndex)
        return
      }
      this.collectMemorySignal(
        'format-error',
        'handoff-failed',
        run,
        stepIndex,
        execution,
        { error: 'Could not parse handoff JSON' }
      )
      this.finishStepWithError(run, stepIndex, execution, 'Could not parse handoff JSON')
      return
    }
    this.completeLiveStep(run.id, execution.id, templateStep?.interactive === true)
    this.aggregateStepCost(run, execution)
    execution.handoff = handoff
    const shouldAutoAdvance = run.autoConfirm || templateStep?.interactive === true
    execution.status = shouldAutoAdvance ? 'done' : 'awaiting-confirm'
    execution.finishedAt = Date.now()
    run.steps[stepIndex].status = execution.status

    // Check P2 rules on done
    const rule = this.evaluateRules(run, stepIndex, 'done')
    if (rule && this.canApplyRule(run, rule)) {
      this.collectMemorySignal('positive', 'user-confirmed', run, stepIndex, execution)
      this.applyRule(run, stepIndex, rule)
      return
    }

    const step = run.steps[stepIndex]

    // Parallel group handling
    if (step.parallelGroupId) {
      if (shouldAutoAdvance) {
        this.collectMemorySignal('positive', 'user-confirmed', run, stepIndex, execution)
        step.status = 'done'
        execution.status = 'done'
      }
      if (step.parallelGroupJoin) {
        if (!this.isParallelGroupComplete(run, step.parallelGroupId)) {
          run.status = this.hasLiveSteps(run.id) ? 'running' : 'awaiting-confirm'
          this.persistAndEmit(run)
          return
        }
        this.cleanupGroupWorktrees(run, step.parallelGroupId)
        const nextIndex = this.getNextNodeAfterGroup(run, step.parallelGroupId)
        if (nextIndex === null) {
          run.status = 'completed'
          run.finishedAt = Date.now()
          this.persistAndEmit(run)
          return
        }
        if (shouldAutoAdvance) {
          run.currentStepIndex = nextIndex
          run.status = 'running'
          this.persistAndEmit(run)
          this.startNextNode(run.id, nextIndex)
        } else {
          run.status = 'awaiting-confirm'
          this.persistAndEmit(run)
        }
      } else {
        if (step.worktreePath) {
          try { removeWorktree(run.projectPath, step.worktreePath) } catch { /* best-effort */ }
          step.worktreePath = undefined
        }
        if (run.steps.every((s) => s.status === 'done' || s.status === 'error' || s.status === 'stale')) {
          run.status = run.steps.some((s) => s.status === 'error') ? 'error' : 'completed'
          run.finishedAt = Date.now()
        } else {
          run.status = this.hasLiveSteps(run.id) ? 'running' : 'awaiting-confirm'
        }
        this.persistAndEmit(run)
      }
      return
    }

    // Sequential step handling
    if (shouldAutoAdvance) {
      this.collectMemorySignal('positive', 'user-confirmed', run, stepIndex, execution)
      const nextIndex = run.currentStepIndex + 1
      if (nextIndex >= run.steps.length) {
        run.status = 'completed'
        run.finishedAt = Date.now()
        if (stepIndex === run.steps.length - 1) {
          this.collectMemorySignal('completion', 'workflow-done', run, stepIndex, execution, { handoff })
        }
        this.persistAndEmit(run)
      } else {
        run.currentStepIndex = nextIndex
        run.status = 'running'
        this.persistAndEmit(run)
        this.startNextNode(run.id, nextIndex)
      }
      return
    }

    run.status = 'awaiting-confirm'
    if (stepIndex === run.steps.length - 1) {
      this.collectMemorySignal('completion', 'workflow-done', run, stepIndex, execution, { handoff })
    }
    this.persistAndEmit(run)
  }

  private enterAwaitingInput(run: WorkflowRun, stepIndex: number): void {
    const step = run.steps[stepIndex]
    const execution = step.executions.at(-1)
    if (!execution) return
    execution.status = 'awaiting-input'
    step.status = 'awaiting-input'
    run.currentStepIndex = stepIndex
    run.status = 'awaiting-input'
    this.persistAndEmit(run)
  }

  private finishStepWithError(
    run: WorkflowRun,
    stepIndex: number,
    execution: WorkflowStepExecution,
    message: string
  ): void {
    const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
    this.aggregateStepCost(run, execution)
    execution.status = 'error'
    execution.error = message
    execution.finishedAt = Date.now()
    run.steps[stepIndex].status = 'error'
    this.completeLiveStep(run.id, execution.id, templateStep?.interactive === true)

    const trigger = message === 'Could not parse handoff JSON' ? 'handoff-failed' as const : 'error' as const
    const rule = this.evaluateRules(run, stepIndex, trigger)
    if (rule && this.canApplyRule(run, rule)) {
      this.applyRule(run, stepIndex, rule)
      return
    }

    const strategy = templateStep?.failureStrategy
    if (strategy && strategy.type !== 'stop') {
      const retryCount = run.steps[stepIndex].executions.length - 1
      if (retryCount < (strategy.maxRetries ?? 3)) {
        run.status = 'running'
        run.finishedAt = undefined
        this.persistAndEmit(run)
        this.startStep(run.id, stepIndex)
        return
      }
      if (
        strategy.type === 'retry-then-goto' &&
        strategy.gotoTarget !== undefined &&
        strategy.gotoTarget >= 0 &&
        strategy.gotoTarget < run.steps.length
      ) {
        markDownstreamStale(run, strategy.gotoTarget)
        run.currentStepIndex = strategy.gotoTarget
        run.status = 'running'
        run.finishedAt = undefined
        this.persistAndEmit(run)
        this.startNextNode(run.id, strategy.gotoTarget)
        return
      }
    }

    const step = run.steps[stepIndex]
    if (step.parallelGroupId) {
      this.removeLiveStep(run.id, execution.id)
      if (step.parallelGroupJoin) {
        if (!this.isParallelGroupComplete(run, step.parallelGroupId)) {
          run.status = this.hasLiveSteps(run.id) ? 'running' : 'error'
          this.persistAndEmit(run)
          return
        }
        const allError = run.steps
          .filter((s) => s.parallelGroupId === step.parallelGroupId)
          .every((s) => s.status === 'error')
        if (allError) {
          run.status = 'error'
          run.finishedAt = Date.now()
        } else {
          this.cleanupGroupWorktrees(run, step.parallelGroupId)
          const nextIndex = this.getNextNodeAfterGroup(run, step.parallelGroupId)
          if (nextIndex === null) {
            run.status = 'error'
            run.finishedAt = Date.now()
          } else {
            run.currentStepIndex = nextIndex
            run.status = 'running'
            this.persistAndEmit(run)
            this.startNextNode(run.id, nextIndex)
            return
          }
        }
        this.persistAndEmit(run)
        return
      }
      this.persistAndEmit(run)
      return
    }

    run.status = 'error'
    run.finishedAt = Date.now()
    this.removeLiveStep(run.id, execution.id)
    this.persistAndEmit(run)
  }

  /** Aggregate a completed execution's cost into the parent run totals. */
  private aggregateStepCost(run: WorkflowRun, execution: WorkflowStepExecution): void {
    run.totalInputTokens += execution.totalInputTokens
    run.totalOutputTokens += execution.totalOutputTokens
    run.totalCostUsd += execution.totalCostUsd
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
      error: message,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0
    }
    run.steps[stepIndex].executions.push(execution)
    run.steps[stepIndex].status = 'error'
    run.status = 'error'
    run.finishedAt = Date.now()
    this.persistAndEmit(run)
  }

  private buildPrompt(run: WorkflowRun, stepIndex: number, agent: AgentDefinition): {
    prompt: string
    injectedMemoryIds: string[]
  } {
    const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
    let mainPrompt: string
    if (stepIndex === 0) {
      const sections = [
        '# User request',
        run.initialPrompt
      ]
      if (templateStep?.interactive) {
        sections.push('', '# Interaction mode', INTERACTIVE_HINT)
      }
      sections.push('', '# Handoff requirement', HANDOFF_HINT)
      mainPrompt = sections.join('\n')
      return this.withMemoryContext(agent, run.projectPath, mainPrompt)
    }

    // Check if predecessor is part of a join parallel group
    const prevStep = run.steps[stepIndex - 1]
    if (prevStep?.parallelGroupId && prevStep.parallelGroupJoin) {
      return this.buildPromptForJoinStep(run, stepIndex, agent, prevStep.parallelGroupId)
    }

    const previous = latestCompletedHandoff(run, stepIndex - 1)
    const sections: string[] = [
      '# User request',
      run.initialPrompt
    ]

    const progress = buildWorkflowProgress(run, stepIndex)
    if (progress) {
      sections.push('', progress)
    }

    if (!previous) {
      sections.push(
        '',
        '# Missing upstream handoff',
        'The previous step did not provide a valid handoff. Explain the issue and output a handoff JSON.'
      )
    } else {
      const upstreamLabel = run.steps[stepIndex - 1]?.displayName ?? `Step ${stepIndex}`
      sections.push(
        '',
        `# Upstream handoff (from ${upstreamLabel})`,
        previous.summary,
        '',
        '# Artifacts',
        previous.artifacts.map((artifact) => `- ${artifact.path}: ${artifact.description}`).join('\n') || '(none)'
      )
      if (previous.nextStepGuidance) {
        sections.push('', '# Next-step guidance', previous.nextStepGuidance)
      }
    }

    if (templateStep?.interactive) {
      sections.push('', '# Interaction mode', INTERACTIVE_HINT)
    }
    sections.push('', '# Handoff requirement', HANDOFF_HINT)
    mainPrompt = sections.join('\n')
    return this.withMemoryContext(agent, run.projectPath, mainPrompt)
  }

  private buildPromptForJoinStep(
    run: WorkflowRun,
    stepIndex: number,
    agent: AgentDefinition,
    groupId: string
  ): { prompt: string; injectedMemoryIds: string[] } {
    const groupSteps = run.steps
      .map((s, i) => ({ step: s, index: i }))
      .filter(({ step }) => step.parallelGroupId === groupId)

    const sections: string[] = ['# User request', run.initialPrompt]
    const progress = buildWorkflowProgress(run, stepIndex)
    if (progress) sections.push('', progress)

    sections.push('', '# Upstream handoffs (parallel group)')

    for (const { step, index } of groupSteps) {
      const handoff = latestCompletedHandoff(run, index)
      const label = step.displayName ?? step.role ?? `Step ${index + 1}`
      sections.push('', `## From ${label}`)
      if (handoff) {
        sections.push(
          handoff.summary,
          '',
          '# Artifacts',
          handoff.artifacts.map((a) => `- ${a.path}: ${a.description}`).join('\n') || '(none)'
        )
        if (handoff.nextStepGuidance) sections.push('', '# Next-step guidance', handoff.nextStepGuidance)
      } else {
        sections.push('(no handoff available)')
      }
    }

    const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
    if (templateStep?.interactive) {
      sections.push('', '# Interaction mode', INTERACTIVE_HINT)
    }
    sections.push('', '# Handoff requirement', HANDOFF_HINT)
    const mainPrompt = sections.join('\n')
    return this.withMemoryContext(agent, run.projectPath, mainPrompt)
  }

  private markInterruptedRunsOnStartup(runs: WorkflowRun[]): WorkflowRun[] {
    return runs.map((run) => {
      if (run.status !== 'running' && run.status !== 'awaiting-input') return run

      const interrupted: WorkflowRun = {
        ...run,
        finishedAt: run.finishedAt ?? Date.now(),
        steps: run.steps.map((step) => {
          if (step.status !== 'running' && step.status !== 'awaiting-input') return step
          return {
            ...step,
            status: 'error' as const,
            worktreePath: undefined,
            executions: step.executions.map((execution, executionIndex, list) => {
              if (
                executionIndex !== list.length - 1 ||
                (execution.status !== 'running' && execution.status !== 'awaiting-input')
              ) {
                return execution
              }
              return {
                ...execution,
                status: 'error' as const,
                finishedAt: execution.finishedAt ?? Date.now(),
                error: 'App restarted before this workflow step finished'
              }
            })
          }
        })
      }
      interrupted.status = 'interrupted'

      // Cleanup orphaned worktrees from interrupted runs
      try { cleanupOrphanedWorktrees(run.projectPath, new Set()) } catch { /* best-effort */ }

      this.workflowStore.saveRun(interrupted)
      return interrupted
    })
  }

  skipStep(runId: string): WorkflowRun {
    const run = this.getRun(runId)
    const nextIndex = run.currentStepIndex + 2
    if (nextIndex >= run.steps.length) {
      run.steps[run.currentStepIndex + 1].status = 'done'
      run.status = 'completed'
      run.finishedAt = Date.now()
      this.persistAndEmit(run)
      return run
    }
    run.steps[run.currentStepIndex + 1].status = 'done'
    run.currentStepIndex = nextIndex
    run.status = 'running'
    this.persistAndEmit(run)
    this.startNextNode(run.id, nextIndex)
    return run
  }

  gotoStep(runId: string, targetIndex: number): WorkflowRun {
    const run = this.getRun(runId)
    if (targetIndex < 0 || targetIndex >= run.steps.length) {
      throw new Error('Invalid target step index')
    }
    markDownstreamStale(run, targetIndex)
    run.currentStepIndex = targetIndex
    run.status = 'running'
    this.persistAndEmit(run)
    this.startNextNode(run.id, targetIndex)
    return run
  }

  private flattenTemplateSteps(template: WorkflowTemplate): WorkflowRunStep[] {
    const result: WorkflowRunStep[] = []
    for (const node of template.steps) {
      if (isParallelGroup(node)) {
        const groupId = randomUUID()
        for (const step of node.parallel) {
          const agent = this.agentStore.list().find((a) => a.id === step.agentId)
          result.push({
            agentId: step.agentId,
            displayName: agent?.name,
            role: step.role,
            status: 'pending',
            executions: [],
            parallelGroupId: groupId,
            parallelGroupJoin: node.join
          })
        }
      } else {
        const agent = this.agentStore.list().find((a) => a.id === node.agentId)
        result.push({
          agentId: node.agentId,
          displayName: agent?.name,
          role: node.role,
          status: 'pending',
          executions: []
        })
      }
    }
    return result
  }

  private startNextNode(runId: string, startIndex: number): void {
    const run = this.getRun(runId)
    if (startIndex >= run.steps.length) {
      run.status = 'completed'
      run.finishedAt = Date.now()
      this.persistAndEmit(run)
      return
    }

    const step = run.steps[startIndex]
    if (step.parallelGroupId) {
      const groupId = step.parallelGroupId
      const groupIndices = run.steps
        .map((s, i) => (s.parallelGroupId === groupId ? i : -1))
        .filter((i) => i >= 0)
      this.startParallelGroup(runId, groupIndices)
    } else {
      this.startStep(runId, startIndex)
    }
  }

  private startParallelGroup(runId: string, stepIndices: number[]): void {
    const run = this.getRun(runId)

    if (isGitRepo(run.projectPath)) {
      for (const idx of stepIndices) {
        const step = run.steps[idx]
        try {
          const wt = createWorktree(run.projectPath, `${run.id.slice(0, 8)}-step-${idx}`)
          step.worktreePath = wt.path
        } catch {
          step.worktreePath = undefined
        }
      }
    }

    run.currentStepIndex = stepIndices[0]
    this.persistAndEmit(run)

    for (const idx of stepIndices) {
      this.startStep(runId, idx)
    }
  }

  private isParallelGroupComplete(run: WorkflowRun, groupId: string): boolean {
    return run.steps
      .filter((s) => s.parallelGroupId === groupId)
      .every((s) => s.status === 'done' || s.status === 'error')
  }

  private getNextNodeAfterGroup(run: WorkflowRun, groupId: string): number | null {
    const lastGroupIndex = run.steps.reduce(
      (max, s, i) => (s.parallelGroupId === groupId ? Math.max(max, i) : max),
      -1
    )
    const nextIndex = lastGroupIndex + 1
    return nextIndex < run.steps.length ? nextIndex : null
  }

  private cleanupGroupWorktrees(run: WorkflowRun, groupId: string): void {
    for (const step of run.steps) {
      if (step.parallelGroupId === groupId && step.worktreePath) {
        try { removeWorktree(run.projectPath, step.worktreePath) } catch { /* best-effort */ }
        step.worktreePath = undefined
      }
    }
  }

  private addLiveStep(runId: string, liveStep: LiveStep): void {
    const steps = this.liveByRunId.get(runId) ?? []
    steps.push(liveStep)
    this.liveByRunId.set(runId, steps)
  }

  private removeLiveStep(runId: string, executionId: string): LiveStep | null {
    const steps = this.liveByRunId.get(runId)
    if (!steps) return null
    const removed = steps.find((ls) => ls.executionId === executionId) ?? null
    const filtered = steps.filter((ls) => ls.executionId !== executionId)
    if (filtered.length === 0) this.liveByRunId.delete(runId)
    else this.liveByRunId.set(runId, filtered)
    return removed
  }

  private completeLiveStep(runId: string, executionId: string, closeInput: boolean): void {
    const live = this.removeLiveStep(runId, executionId)
    if (closeInput && live) this.runManager.closeInput(live.childRunId)
  }

  private hasLiveSteps(runId: string): boolean {
    return (this.liveByRunId.get(runId)?.length ?? 0) > 0
  }

  private evaluateRules(
    run: WorkflowRun,
    stepIndex: number,
    trigger: 'error' | 'handoff-failed' | 'done'
  ): StepRule | null {
    const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
    if (!templateStep?.rules) return null

    for (const rule of templateStep.rules) {
      if (rule.on !== trigger) continue
      if (rule.action === 'retry') {
        const retryCount = run.steps[stepIndex].executions.length - 1
        if (retryCount >= (rule.maxRetries ?? 1)) continue
      }
      return rule
    }
    return null
  }

  private getTemplateStepForRunStep(run: WorkflowRun, stepIndex: number): WorkflowTemplateStep | null {
    const template = this.workflowStore.listTemplates().find((t) => t.id === run.templateId)
    if (!template) return null
    const flatSteps: WorkflowTemplateStep[] = []
    for (const node of template.steps) {
      if (isParallelGroup(node)) {
        for (const s of node.parallel) flatSteps.push(s)
      } else {
        flatSteps.push(node)
      }
    }
    return flatSteps[stepIndex] ?? null
  }

  private canApplyRule(run: WorkflowRun, rule: StepRule): boolean {
    if (rule.action === 'goto') {
      const count = this.gotoCountByRun.get(run.id) ?? 0
      if (count >= 5) return false
      this.gotoCountByRun.set(run.id, count + 1)
    }
    return true
  }

  private applyRule(run: WorkflowRun, stepIndex: number, rule: StepRule): void {
    switch (rule.action) {
      case 'retry':
        run.status = 'running'
        this.persistAndEmit(run)
        this.startStep(run.id, stepIndex)
        break
      case 'skip': {
        const nextIndex = stepIndex + 2
        if (nextIndex >= run.steps.length) {
          run.status = 'completed'
          run.finishedAt = Date.now()
          this.persistAndEmit(run)
        } else {
          run.steps[stepIndex + 1].status = 'done'
          run.currentStepIndex = nextIndex
          run.status = 'running'
          this.persistAndEmit(run)
          this.startNextNode(run.id, nextIndex)
        }
        break
      }
      case 'goto':
        if (rule.target !== undefined) {
          markDownstreamStale(run, rule.target)
          run.currentStepIndex = rule.target
          run.status = 'running'
          this.persistAndEmit(run)
          this.startNextNode(run.id, rule.target)
        }
        break
    }
  }

  private getRun(runId: string): WorkflowRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    return run
  }

  private persistAndEmit(run: WorkflowRun): void {
    this.workflowStore.saveRun(run)
    this.emitUpdate(run)
    this.emitSettledIfNeeded(run)
  }

  private persist(run: WorkflowRun): void {
    this.workflowStore.saveRun(run)
  }

  private emitUpdate(run: WorkflowRun): void {
    this.emit({ runId: run.id, event: { kind: 'run-updated', run } })
  }

  private emitSettledIfNeeded(run: WorkflowRun): void {
    if (run.status !== 'completed' && run.status !== 'error') return
    if (this.settledRunIds.has(run.id)) return
    this.settledRunIds.add(run.id)
    this.runSettledHandler?.(run)
  }

  private emitAgentEvent(runId: string, stepIndex: number, executionId: string, event: AgentEvent): void {
    this.emit({ runId, event: { kind: 'agent-event', runId, stepIndex, executionId, event } })
  }

  private collectMemorySignal(
    type: MemorySignal['type'],
    source: MemorySignal['source'],
    run: WorkflowRun,
    stepIndex: number,
    execution: WorkflowStepExecution,
    patch: Partial<Pick<MemorySignal, 'error' | 'handoff' | 'userAction'>> = {}
  ): void {
    if (!this.signalCollector) return
    this.signalCollector.collect({
      type,
      source,
      runId: execution.runId ?? execution.sessionId ?? execution.id,
      workflowRunId: run.id,
      stepIndex,
      agentId: execution.agentId,
      projectPath: run.projectPath,
      timestamp: Date.now(),
      transcript: summarizeTranscript(execution.events),
      injectedMemoryIds: execution.injectedMemoryIds,
      handoff: patch.handoff ?? execution.handoff,
      error: patch.error ?? execution.error,
      userAction: patch.userAction
    })
  }

  private extractConversationSummary(events: AgentEvent[]): string {
    const lines = events.flatMap((event) => {
      if (event.kind === 'message') return [`Agent: ${event.text.trim()}`]
      if (event.kind === 'system' && event.text.startsWith('↳')) {
        return [`User: ${event.text.slice(1).trim()}`]
      }
      return []
    })
    const summary = lines.slice(-8).join('\n').trim()
    return summary || 'Interactive conversation finished without a handoff JSON.'
  }

  private withMemoryContext(
    agent: AgentDefinition,
    projectPath: string,
    mainPrompt: string
  ): { prompt: string; injectedMemoryIds: string[] } {
    if (!this.memoryInjector) return { prompt: mainPrompt, injectedMemoryIds: [] }
    const { text, injectedMemoryIds } = this.memoryInjector.build(agent.id, projectPath)
    return {
      prompt: text ? `${text}\n${mainPrompt}` : mainPrompt,
      injectedMemoryIds
    }
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
      run.steps[i].status === 'awaiting-input' ||
      run.steps[i].status === 'awaiting-confirm' ||
      run.steps[i].status === 'error'
    ) {
      run.steps[i].status = 'stale'
      const execution = latestExecution(run.steps[i])
      if (execution) execution.status = 'stale'
    }
  }
}

function buildWorkflowProgress(run: WorkflowRun, currentStepIndex: number): string | null {
  if (currentStepIndex <= 1) return null
  const lines: string[] = []
  for (let i = 0; i < currentStepIndex - 1; i++) {
    const step = run.steps[i]
    const label = step.displayName ?? `Step ${i + 1}`
    const handoff = latestCompletedHandoff(run, i)
    if (handoff) {
      const summary = handoff.summary.length > 150
        ? handoff.summary.slice(0, 150) + '...'
        : handoff.summary
      lines.push(`- Step ${i + 1} (${label}): ${summary}`)
    } else {
      lines.push(`- Step ${i + 1} (${label}): (no handoff available)`)
    }
  }
  if (lines.length === 0) return null
  return ['# Workflow progress', ...lines].join('\n')
}

function parseHandoff(events: AgentEvent[]): HandoffArtifact | null {
  const messages = events
    .filter((e): e is Extract<AgentEvent, { kind: 'message' }> => e.kind === 'message')
    .reverse()

  for (const msg of messages) {
    const result = tryParseHandoffFromText(msg.text)
    if (result) return result
  }
  return null
}

function tryParseHandoffFromText(text: string): HandoffArtifact | null {
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
          typeof parsed.nextStepGuidance === 'string' ? parsed.nextStepGuidance : undefined,
        routeSuggestion: isValidRouteSuggestion((parsed as any).routeSuggestion)
          ? (parsed as any).routeSuggestion
          : undefined
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

function isValidRouteSuggestion(val: unknown): val is RouteSuggestion {
  if (!val || typeof val !== 'object') return false
  const rs = val as Record<string, unknown>
  return ['continue', 'retry-prev', 'skip-next', 'goto'].includes(rs.action as string)
}
