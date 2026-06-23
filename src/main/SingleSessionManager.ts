import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type {
  AgentEvent,
  ApiConversationMessage,
  RunConfig,
  SessionContinuationStrategy,
  SessionRoute,
  SessionSegment,
  SingleSession,
  SingleSessionCreateInput,
  SingleSessionDetail,
  SingleSessionEventEnvelope,
  SingleSessionSendInput
} from '@shared/types'
import type { MemoryInjector } from './memory/MemoryInjector'
import { RunManager } from './RunManager'
import { SkillStore, type SkillPromptContext } from './SkillStore'
import { SingleSessionStore } from './SingleSessionStore'
import { TranscriptStore } from './TranscriptStore'

type EmitSingleSessionEvent = (envelope: SingleSessionEventEnvelope) => void

export class SingleSessionManager {
  constructor(
    private readonly store: SingleSessionStore,
    private readonly runManager: RunManager,
    private readonly transcripts: TranscriptStore,
    private readonly skillStore: SkillStore,
    private readonly memoryInjector: MemoryInjector,
    private readonly emit: EmitSingleSessionEvent
  ) {}

  listSessions(): SingleSession[] {
    return this.store.list()
  }

  createSession(input: SingleSessionCreateInput): SingleSession {
    return this.store.create(input)
  }

  getSessionDetail(id: string): SingleSessionDetail {
    return this.toDetail(this.requireSession(id))
  }

  sendMessage(input: SingleSessionSendInput): SingleSessionDetail {
    const clean = input.text.trim()
    if (!clean) return this.getSessionDetail(input.sessionId)
    const targetCwd = input.cwd.trim()
    if (!targetCwd) throw new Error('Project directory is required')

    const session = this.requireSession(input.sessionId)
    const activeSegment = this.getActiveSegment(session)
    const sameRoute = !!activeSegment && routesEqual(activeSegment.route, input.route)
    const sameCwd = !!activeSegment && cwdEqual(activeSegment.cwd ?? session.cwd, targetCwd)
    const sameContext = sameRoute && sameCwd
    const liveRunId = activeSegment?.runId
    const liveCapabilities = liveRunId ? this.runManager.getLiveRunCapabilities(liveRunId) : null
    const skillContext = this.skillStore.buildPrompt(input.skillIds)

    this.recordVisibleUserInput(session, clean)

    if (sameContext && liveRunId && liveCapabilities?.bidirectionalStdin) {
      this.recordSkillUsage(session, skillContext)
      this.mergeSegmentSkills(activeSegment, skillContext)
      session.cwd = targetCwd
      this.persistAndEmit(session)
      this.transcripts.recordUserInput(liveRunId, clean)
      void this.runManager.push(liveRunId, prependSkillPrompt(clean, skillContext.text)).catch((err) => {
        this.handleAgentEvent(session.id, activeSegment.id, liveRunId, {
          kind: 'error',
          recoverable: false,
          message: err instanceof Error ? err.message : String(err)
        })
      })
      return this.toDetail(session)
    }

    const strategy = this.chooseStrategy(session, activeSegment, input.route, sameContext)
    const previousCwd = session.cwd
    const segment = this.createSegment(
      session,
      input.route,
      strategy,
      targetCwd,
      !cwdEqual(previousCwd, targetCwd),
      skillContext
    )
    this.recordSkillUsage(session, skillContext)
    const previousSessionIds = this.nativeSessionIdsBefore(session, segment.id)
    const replayMessages = strategy === 'logic-replay' && input.route.vendor === 'api'
      ? this.transcripts.buildReplayMessagesFromTimeline(previousSessionIds, clean)
      : undefined
    const prompt = strategy === 'logic-replay' && input.route.vendor !== 'api'
      ? this.transcripts.buildReplayPromptFromTimeline(previousSessionIds, clean)
      : clean
    const config = this.withSkillContext(
      this.buildRunConfig(session, input, prompt, strategy, activeSegment, replayMessages),
      skillContext
    )
    const { launchConfig, injectedMemoryIds } = this.withMemoryContext(config)
    if (injectedMemoryIds.length > 0) {
      session.injectedMemoryIds = mergeIds(session.injectedMemoryIds ?? [], injectedMemoryIds)
      session.conversation.events.push({
        kind: 'system',
        text: `Injected ${injectedMemoryIds.length} memory reference${injectedMemoryIds.length === 1 ? '' : 's'}`
      })
    }

    const runId = this.runManager.start(launchConfig, (_runId, event) => {
      this.handleAgentEvent(session.id, segment.id, runId, event)
    })
    segment.runId = runId
    this.transcripts.recordUserInput(runId, launchConfig.messages ? clean : launchConfig.prompt)
    this.persistAndEmit(session)
    return this.toDetail(session)
  }

  abortSessionRun(sessionId: string): SingleSessionDetail {
    const session = this.requireSession(sessionId)
    const activeSegment = this.getActiveSegment(session)
    if (activeSegment?.runId && this.runManager.hasLiveRun(activeSegment.runId)) {
      this.runManager.abort(activeSegment.runId)
    }
    return this.toDetail(session)
  }

  deleteSession(sessionId: string): void {
    const session = this.store.get(sessionId)
    if (!session || session.status !== 'active') return
    const activeSegment = this.getActiveSegment(session)
    if (activeSegment?.runId && this.runManager.hasLiveRun(activeSegment.runId)) {
      this.runManager.abort(activeSegment.runId)
    }
    this.store.delete(sessionId)
  }

  private requireSession(id: string): SingleSession {
    const session = this.store.get(id)
    if (!session || session.status !== 'active') throw new Error(`Single session not found: ${id}`)
    return session
  }

  private toDetail(session: SingleSession): SingleSessionDetail {
    const activeSegment = this.getActiveSegment(session)
    return {
      ...session,
      activeSegment,
      running: !!activeSegment?.runId && this.runManager.hasLiveRun(activeSegment.runId)
    }
  }

  private getActiveSegment(session: SingleSession): SessionSegment | undefined {
    const activeId = session.conversation.activeSegmentId
    return (
      session.conversation.segments.find((segment) => segment.id === activeId) ??
      session.conversation.segments.at(-1)
    )
  }

  private chooseStrategy(
    session: SingleSession,
    activeSegment: SessionSegment | undefined,
    route: SessionRoute,
    sameContext: boolean
  ): SessionContinuationStrategy {
    if (!activeSegment) return 'new'
    if (!sameContext) return 'logic-replay'
    const nativeSessionId = activeSegment.nativeSessionId
    const canNativeResume = this.runManager.getAdapterCapabilities(route.vendor).nativeResume
    if (nativeSessionId && canNativeResume) return 'native-resume'
    return 'logic-replay'
  }

  private createSegment(
    session: SingleSession,
    route: SessionRoute,
    strategy: SessionContinuationStrategy,
    cwd: string,
    cwdChanged: boolean,
    skillContext: SkillPromptContext
  ): SessionSegment {
    const segment: SessionSegment = {
      id: randomUUID(),
      scope: 'single',
      route,
      cwd,
      skillIds: skillContext.skills.length > 0 ? skillContext.skills.map((skill) => skill.id) : undefined,
      continuationStrategy: strategy,
      startedAt: Date.now()
    }
    session.conversation.segments.push(segment)
    session.conversation.activeSegmentId = segment.id
    session.cwd = cwd
    session.route = route
    if (strategy === 'logic-replay') {
      session.conversation.events.push({
        kind: 'system',
        text: cwdChanged
          ? '项目目录已切换，会话保持不变；后续由新的底层 session 在新目录接手当前话题。'
          : '模型已切换，会话保持不变；后续由新的底层 session 接手当前话题。'
      })
    }
    return segment
  }

  private buildRunConfig(
    session: SingleSession,
    input: SingleSessionSendInput,
    prompt: string,
    strategy: SessionContinuationStrategy,
    previousSegment: SessionSegment | undefined,
    replayMessages?: ApiConversationMessage[]
  ): RunConfig {
    const route = input.route
    const resumeFrom = strategy === 'native-resume' && previousSegment?.nativeSessionId
      ? {
          sessionId: previousSegment.nativeSessionId,
          vendor: route.vendor,
          transcriptPath: this.transcripts.getTranscriptPath(previousSegment.nativeSessionId)
        }
      : undefined
    return {
      vendor: route.vendor,
      prompt,
      cwd: input.cwd.trim(),
      agentId: route.agentId,
      model: route.model,
      codexReasoningEffort: route.vendor === 'codex' ? route.codexReasoningEffort : undefined,
      codexServiceTier: route.vendor === 'codex' ? route.codexServiceTier : undefined,
      apiProviderId: route.vendor === 'api' ? route.apiProviderId : undefined,
      apiMaxSteps: input.apiMaxSteps,
      apiTemperature: route.vendor === 'api' ? input.apiTemperature ?? route.apiTemperature : undefined,
      apiTopP: route.vendor === 'api' ? input.apiTopP ?? route.apiTopP : undefined,
      messages: replayMessages,
      attachments: route.vendor === 'api' ? input.attachments : undefined,
      apiLogSource: route.vendor === 'api' ? 'single' : undefined,
      addDirs: input.addDirs,
      appendSystemPrompt: input.appendSystemPrompt,
      resumeFrom,
      keepStdinOpenAfterTurnDone: route.vendor === 'claude',
      permissionMode: route.permissionMode
    }
  }

  private withMemoryContext(config: RunConfig): { launchConfig: RunConfig; injectedMemoryIds: string[] } {
    if (!config.agentId) return { launchConfig: config, injectedMemoryIds: [] }
    const { text, injectedMemoryIds } = this.memoryInjector.build(config.agentId, config.cwd)
    if (!text) return { launchConfig: config, injectedMemoryIds }
    return {
      launchConfig: {
        ...config,
        prompt: `${text}\n${config.prompt}`,
        messages: config.messages ? prependMemoryToMessages(config.messages, text) : undefined
      },
      injectedMemoryIds
    }
  }

  private withSkillContext(config: RunConfig, skillContext: SkillPromptContext): RunConfig {
    if (!skillContext.text) return config
    return {
      ...config,
      appendSystemPrompt: appendSystemPrompt(config.appendSystemPrompt, skillContext.text)
    }
  }

  private recordSkillUsage(session: SingleSession, skillContext: SkillPromptContext): void {
    if (skillContext.skills.length === 0) return
    session.conversation.events.push({
      kind: 'system',
      text: `Using skill: ${skillContext.skills.map((skill) => skill.name).join(', ')}`
    })
  }

  private mergeSegmentSkills(segment: SessionSegment | undefined, skillContext: SkillPromptContext): void {
    if (!segment || skillContext.skills.length === 0) return
    segment.skillIds = mergeIds(segment.skillIds ?? [], skillContext.skills.map((skill) => skill.id))
  }

  private handleAgentEvent(
    sessionId: string,
    segmentId: string,
    runId: string,
    event: AgentEvent
  ): void {
    const session = this.store.get(sessionId)
    if (!session || session.status !== 'active') return
    const segment = session.conversation.segments.find((item) => item.id === segmentId)
    if (!segment) return

    this.transcripts.record(runId, event)
    session.conversation.events.push(event)
    if (event.kind === 'session-started') {
      segment.nativeSessionId = event.sessionId
    }
    if (event.kind === 'message') {
      session.preview = truncate(event.text, 120)
    }
    if (event.kind === 'turn-done') {
      segment.finishedAt = Date.now()
    }
    if (event.kind === 'error' && !event.recoverable) {
      segment.finishedAt = Date.now()
    }
    session.updatedAt = Date.now()
    this.store.save(session)
    this.emit({
      sessionId,
      event: { kind: 'agent-event', sessionId, segmentId, runId, event }
    })
    this.emit({
      sessionId,
      event: { kind: 'session-updated', session: this.toDetail(session) }
    })
  }

  private recordVisibleUserInput(session: SingleSession, text: string): void {
    session.conversation.events.push({ kind: 'system', text: `↳ ${text}` })
    session.preview = truncate(text, 120)
    if (session.title === 'New Session') {
      session.title = truncate(text.replace(/\s+/g, ' '), 40) || 'New Session'
    }
    session.updatedAt = Date.now()
  }

  private nativeSessionIdsBefore(session: SingleSession, segmentId: string): string[] {
    const ids: string[] = []
    for (const segment of session.conversation.segments) {
      if (segment.id === segmentId) break
      if (segment.nativeSessionId) ids.push(segment.nativeSessionId)
    }
    return ids
  }

  private persistAndEmit(session: SingleSession): void {
    session.updatedAt = Date.now()
    this.store.save(session)
    this.emit({
      sessionId: session.id,
      event: { kind: 'session-updated', session: this.toDetail(session) }
    })
  }
}

function routesEqual(a: SessionRoute, b: SessionRoute): boolean {
  return (
    a.vendor === b.vendor &&
    empty(a.model) === empty(b.model) &&
    empty(a.agentId) === empty(b.agentId) &&
    empty(a.apiProviderId) === empty(b.apiProviderId) &&
    numberEmpty(a.apiTemperature) === numberEmpty(b.apiTemperature) &&
    numberEmpty(a.apiTopP) === numberEmpty(b.apiTopP) &&
    empty(a.codexReasoningEffort) === empty(b.codexReasoningEffort) &&
    empty(a.codexServiceTier) === empty(b.codexServiceTier) &&
    empty(a.permissionMode) === empty(b.permissionMode)
  )
}

function cwdEqual(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

function empty(value: string | undefined): string {
  return value?.trim() ?? ''
}

function numberEmpty(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

function prependMemoryToMessages(
  messages: ApiConversationMessage[],
  text: string
): ApiConversationMessage[] {
  const next = messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : message.content
  }))
  for (let i = next.length - 1; i >= 0; i--) {
    const message = next[i]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') {
      message.content = `${text}\n${message.content}`
      return next
    }
    const textPart = message.content.find((part) => part.type === 'text')
    if (textPart) {
      textPart.text = `${text}\n${String(textPart.text ?? '')}`
    } else {
      message.content.unshift({ type: 'text', text })
    }
    return next
  }
  return [{ role: 'user', content: text }, ...next]
}

function appendSystemPrompt(base: string | undefined, addition: string): string {
  return [base?.trim(), addition.trim()].filter(Boolean).join('\n\n')
}

function prependSkillPrompt(userText: string, skillText: string): string {
  if (!skillText.trim()) return userText
  return `${skillText.trim()}\n\n# User request\n${userText}`
}

function truncate(value: string, max: number): string {
  const clean = value.trim().replace(/\s+/g, ' ')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function mergeIds(existing: string[], next: string[]): string[] {
  const seen = new Set(existing)
  const merged = [...existing]
  for (const id of next) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  return merged
}
