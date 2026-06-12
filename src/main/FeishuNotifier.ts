import * as lark from '@larksuiteoapi/node-sdk'
import type {
  FeishuConfig,
  FeishuConnectionStatus,
  HandoffArtifact,
  HandoffArtifactItem,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowStepExecution
} from '@shared/types'

type CardAction = 'approve' | 'reject' | 'rerun'
type StatusCallback = (status: FeishuConnectionStatus) => void
type CardActionCallback = (runId: string, action: CardAction, stepIndex: number) => void

interface LarkClientLike {
  im?: {
    v1?: {
      message?: {
        create?: (payload: unknown) => Promise<{ data?: { message_id?: string } }>
        patch?: (payload: unknown) => Promise<unknown>
      }
    }
    message?: {
      create?: (payload: unknown) => Promise<{ data?: { message_id?: string } }>
      patch?: (messageId: string, payload: unknown) => Promise<unknown>
    }
  }
}

interface LarkWSClientLike {
  start: (params?: unknown) => Promise<void>
  destroy?: () => void
  close?: (params?: { force?: boolean }) => void
  on?: (eventName: string, handler: (data: unknown) => Promise<unknown>) => void
}

interface LarkEventDispatcherLike {
  register: (handlers: Record<string, (data: unknown) => Promise<unknown>>) => unknown
}

interface LarkSdkLike {
  Client: new (options: Record<string, unknown>) => LarkClientLike
  WSClient: new (options: Record<string, unknown>) => LarkWSClientLike
  EventDispatcher?: new (options: Record<string, unknown>) => LarkEventDispatcherLike
}

interface ReceiveTarget {
  receive_id_type: 'chat_id' | 'open_id'
  receive_id: string
}

export class FeishuNotifier {
  private config: FeishuConfig | null = null
  private client: LarkClientLike | null = null
  private wsClient: LarkWSClientLike | null = null
  private status: FeishuConnectionStatus = 'disconnected'
  private onStatusChange: StatusCallback = () => {}
  private onCardAction: CardActionCallback = () => {}
  private notifiedKeys = new Set<string>()
  private messageIds = new Map<string, string>()

  constructor(private readonly larkSdk: LarkSdkLike = lark as unknown as LarkSdkLike) {}

  async configure(
    config: FeishuConfig,
    onStatusChange: StatusCallback,
    onCardAction: CardActionCallback
  ): Promise<void> {
    this.destroy()
    this.config = normalizeConfig(config)
    this.onStatusChange = onStatusChange
    this.onCardAction = onCardAction

    if (!this.config.enabled || !this.config.appId || !this.config.appSecret) {
      this.setStatus('disconnected')
      return
    }

    const auth = { appId: this.config.appId, appSecret: this.config.appSecret }
    this.client = new this.larkSdk.Client(auth)
    const handler = (data: unknown) => this.handleCardAction(data)
    this.wsClient = new this.larkSdk.WSClient({
      ...auth,
      autoReconnect: true,
      source: 'agent-studio',
      onReady: () => this.setStatus('connected'),
      onError: (err: Error) => {
        console.error('[FeishuNotifier] websocket error:', err)
        this.setStatus('error')
      },
      onReconnecting: () => this.setStatus('connecting'),
      onReconnected: () => this.setStatus('connected')
    })

    if (typeof this.wsClient.on === 'function') {
      this.wsClient.on('card.action.trigger', handler)
    }

    this.setStatus('connecting')
    try {
      const eventDispatcher = this.createEventDispatcher(handler)
      if (eventDispatcher) await this.wsClient.start({ eventDispatcher })
      else await this.wsClient.start()
      if (this.status === 'connecting') this.setStatus('connected')
    } catch (err) {
      console.error('[FeishuNotifier] websocket start failed:', err)
      this.setStatus('error')
    }
  }

  destroy(): void {
    if (this.wsClient) {
      try {
        if (typeof this.wsClient.destroy === 'function') this.wsClient.destroy()
        else this.wsClient.close?.({ force: true })
      } catch (err) {
        console.error('[FeishuNotifier] websocket destroy failed:', err)
      }
    }
    this.wsClient = null
    this.client = null
    this.setStatus('disconnected')
  }

  getStatus(): FeishuConnectionStatus {
    return this.status
  }

  async handleRunUpdate(run: WorkflowRun): Promise<void> {
    if (!this.config?.enabled || !this.client) return
    if (run.status === 'awaiting-confirm') {
      await this.notifyAwaitingConfirm(run)
    } else if (run.status === 'completed') {
      await this.notifyCompleted(run)
    } else if (run.status === 'error') {
      await this.notifyError(run)
    }
  }

  async notifyAwaitingConfirm(run: WorkflowRun): Promise<void> {
    const stepIndex = run.currentStepIndex
    const step = run.steps[stepIndex]
    const execution = latestExecution(step)
    if (!step || !execution) return

    const dedupKey = `${run.id}:awaiting:${stepIndex}:${execution.id}`
    await this.sendDedupedCard(dedupKey, this.buildAwaitingConfirmCard(run, step, execution, stepIndex))
  }

  async notifyCompleted(run: WorkflowRun): Promise<void> {
    const dedupKey = `${run.id}:completed`
    await this.sendDedupedCard(dedupKey, this.buildCompletedCard(run))
  }

  async notifyError(run: WorkflowRun): Promise<void> {
    const dedupKey = `${run.id}:error`
    await this.sendDedupedCard(dedupKey, this.buildErrorCard(run))
  }

  async sendTestNotification(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.sendCard(
        `test:${Date.now()}`,
        this.buildBaseCard(
          'blue',
          '🧪 Agent Studio 测试通知',
          [{ tag: 'div', text: markdown('飞书 Bot 配置成功！') }]
        ),
        true
      )
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private createEventDispatcher(
    handler: (data: unknown) => Promise<unknown>
  ): LarkEventDispatcherLike | null {
    if (!this.larkSdk.EventDispatcher) return null
    const dispatcher = new this.larkSdk.EventDispatcher({})
    dispatcher.register({ 'card.action.trigger': handler })
    return dispatcher
  }

  private async handleCardAction(data: unknown): Promise<unknown> {
    const value = parseActionValue(data)
    if (!value) return this.buildPostActionCard('approve', false, '无效的审批操作')

    try {
      this.onCardAction(value.runId, value.action, value.stepIndex)
      const card = this.buildPostActionCard(value.action, true)
      const messageId = extractMessageId(data)
      if (messageId) await this.patchCard(messageId, card)
      return card
    } catch (err) {
      const card = this.buildPostActionCard(
        value.action,
        false,
        err instanceof Error ? err.message : String(err)
      )
      const messageId = extractMessageId(data)
      if (messageId) await this.patchCard(messageId, card)
      return card
    }
  }

  private async sendDedupedCard(dedupKey: string, card: object): Promise<void> {
    if (this.notifiedKeys.has(dedupKey)) return
    this.notifiedKeys.add(dedupKey)
    while (this.notifiedKeys.size > 1000) {
      const first = this.notifiedKeys.values().next().value
      if (!first) break
      this.notifiedKeys.delete(first)
      this.messageIds.delete(first)
    }
    await this.sendCard(dedupKey, card)
  }

  private async sendCard(dedupKey: string, card: object, throwOnError = false): Promise<string | null> {
    try {
      if (!this.client) throw new Error('Feishu client is not configured')
      const target = this.getReceiveId()
      const content = JSON.stringify(card)
      let response: { data?: { message_id?: string } } | undefined
      if (this.client.im?.v1?.message?.create) {
        response = await this.client.im.v1.message.create({
          params: { receive_id_type: target.receive_id_type },
          data: {
            receive_id: target.receive_id,
            msg_type: 'interactive',
            content
          }
        })
      } else if (this.client.im?.message?.create) {
        response = await this.client.im.message.create({
          params: { receive_id_type: target.receive_id_type },
          data: {
            receive_id: target.receive_id,
            msg_type: 'interactive',
            content
          },
          receive_id_type: target.receive_id_type,
          receive_id: target.receive_id,
          msg_type: 'interactive',
          content: card
        })
      } else {
        throw new Error('Feishu message API is unavailable')
      }
      const messageId = response?.data?.message_id ?? null
      if (messageId) this.messageIds.set(dedupKey, messageId)
      return messageId
    } catch (err) {
      console.error('[FeishuNotifier] send failed:', err)
      if (throwOnError) throw err
      return null
    }
  }

  private async patchCard(messageId: string, card: object): Promise<void> {
    if (!this.client) return
    try {
      const content = JSON.stringify(card)
      if (this.client.im?.v1?.message?.patch) {
        await this.client.im.v1.message.patch({
          path: { message_id: messageId },
          data: { content }
        })
      } else if (this.client.im?.message?.patch) {
        await this.client.im.message.patch(messageId, { content: card })
      }
    } catch (err) {
      console.error('[FeishuNotifier] card patch failed:', err)
    }
  }

  private getReceiveId(): ReceiveTarget {
    const chatId = this.config?.chatId?.trim()
    if (chatId) return { receive_id_type: 'chat_id', receive_id: chatId }
    const userId = this.config?.userId?.trim()
    if (userId) return { receive_id_type: 'open_id', receive_id: userId }
    throw new Error('No chatId or userId configured')
  }

  private buildAwaitingConfirmCard(
    run: WorkflowRun,
    step: WorkflowRunStep,
    execution: WorkflowStepExecution,
    stepIndex: number
  ): object {
    const handoff = execution.handoff
    const artifacts = formatArtifacts(handoff?.artifacts ?? [])
    return this.buildBaseCard('orange', '🔔 Workflow 需要审批', [
      infoLine('工作流', run.runName || run.templateName),
      infoLine('步骤', step.displayName || `Step ${stepIndex + 1}`),
      { tag: 'div', text: markdown(truncate(handoff?.summary || '当前步骤等待审批。', 500)) },
      { tag: 'div', text: markdown(artifacts || '产物：无') },
      {
        tag: 'action',
        actions: [
          actionButton('批准', 'primary', { action: 'approve', runId: run.id, stepIndex }),
          actionButton('拒绝', 'danger', { action: 'reject', runId: run.id, stepIndex }),
          actionButton('重跑', 'default', { action: 'rerun', runId: run.id, stepIndex })
        ]
      }
    ])
  }

  private buildCompletedCard(run: WorkflowRun): object {
    return this.buildBaseCard('green', 'Workflow 已完成', [
      infoLine('工作流', run.runName || run.templateName),
      infoLine('步骤数', String(run.steps.length)),
      infoLine('耗时', formatDuration(run.startedAt, run.finishedAt)),
      infoLine('费用', `$${run.totalCostUsd.toFixed(4)}`)
    ])
  }

  private buildErrorCard(run: WorkflowRun): object {
    const step = run.steps[run.currentStepIndex]
    const execution = latestExecution(step)
    return this.buildBaseCard('red', 'Workflow 运行出错', [
      infoLine('工作流', run.runName || run.templateName),
      infoLine('出错步骤', step?.displayName || `Step ${run.currentStepIndex + 1}`),
      { tag: 'div', text: markdown(truncate(execution?.error || '未知错误', 500)) }
    ])
  }

  private buildPostActionCard(action: CardAction, ok: boolean, error?: string): object {
    const labels: Record<CardAction, string> = {
      approve: '已批准',
      reject: '已拒绝',
      rerun: '已重跑'
    }
    return this.buildBaseCard(ok ? 'green' : 'red', ok ? labels[action] : '操作失败', [
      { tag: 'div', text: markdown(ok ? labels[action] : `操作失败：${error || 'workflow 状态已变更'}`) }
    ])
  }

  private buildBaseCard(template: string, title: string, elements: object[]): object {
    return {
      config: { wide_screen_mode: true, update_multi: true },
      header: {
        template,
        title: { tag: 'plain_text', content: title }
      },
      elements
    }
  }

  private setStatus(status: FeishuConnectionStatus): void {
    this.status = status
    this.onStatusChange(status)
  }
}

function normalizeConfig(config: FeishuConfig): FeishuConfig {
  return {
    appId: config.appId.trim(),
    appSecret: config.appSecret.trim(),
    chatId: config.chatId?.trim() ?? '',
    userId: config.userId?.trim() ?? '',
    enabled: config.enabled
  }
}

function latestExecution(step: WorkflowRunStep | undefined): WorkflowStepExecution | null {
  if (!step) return null
  return step.executions[step.executions.length - 1] ?? null
}

function markdown(content: string): object {
  return { tag: 'lark_md', content }
}

function infoLine(label: string, value: string): object {
  return { tag: 'div', text: markdown(`**${label}**：${value || '-'}`) }
}

function actionButton(text: string, type: string, value: Record<string, unknown>): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type,
    value
  }
}

function formatArtifacts(artifacts: HandoffArtifact['artifacts']): string {
  if (artifacts.length === 0) return ''
  return artifacts.map(formatArtifact).join('\n')
}

function formatArtifact(item: HandoffArtifactItem): string {
  const suffix = item.description ? ` — ${item.description}` : ''
  return `- ${item.path}${suffix}`
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function formatDuration(startedAt: number, finishedAt?: number): string {
  const end = finishedAt ?? Date.now()
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

function parseActionValue(data: unknown): { action: CardAction; runId: string; stepIndex: number } | null {
  const raw = (data as { action?: { value?: unknown } } | null)?.action?.value
  const value = typeof raw === 'string' ? safeJson(raw) : raw
  if (!value || typeof value !== 'object') return null
  const candidate = value as { action?: unknown; runId?: unknown; stepIndex?: unknown }
  if (!isCardAction(candidate.action)) return null
  if (typeof candidate.runId !== 'string') return null
  if (typeof candidate.stepIndex !== 'number') return null
  return {
    action: candidate.action,
    runId: candidate.runId,
    stepIndex: candidate.stepIndex
  }
}

function isCardAction(action: unknown): action is CardAction {
  return action === 'approve' || action === 'reject' || action === 'rerun'
}

function extractMessageId(data: unknown): string | null {
  const event = data as {
    context?: { open_message_id?: unknown }
    open_message_id?: unknown
    message_id?: unknown
  } | null
  const candidate = event?.context?.open_message_id ?? event?.open_message_id ?? event?.message_id
  return typeof candidate === 'string' ? candidate : null
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
