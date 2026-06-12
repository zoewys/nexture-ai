import type { AgentEvent, PermissionMode } from '@shared/types'
import { randomUUID } from 'node:crypto'

interface PendingPermission {
  resolve: (allowed: boolean) => void
  timer: NodeJS.Timeout
  clear: () => void
}

const pendingByRequestId = new Map<string, PendingPermission>()

export class PermissionGuard {
  private pending = new Map<string, PendingPermission>()
  private timeoutMs = 300_000

  constructor(
    private readonly mode: PermissionMode,
    private readonly emitEvent: (event: AgentEvent) => void
  ) {}

  async request(toolName: string, description: string): Promise<boolean> {
    if (this.mode === 'bypassPermissions') return true
    if (this.mode === 'plan') return false
    if (this.mode === 'acceptEdits' && isEditTool(toolName)) return true

    const requestId = randomUUID()
    this.emitEvent({
      kind: 'system',
      text: JSON.stringify({
        type: 'permission-request',
        requestId,
        toolName,
        description
      })
    })

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        pendingByRequestId.delete(requestId)
        resolve(false)
      }, this.timeoutMs)
      const pending = { resolve, timer, clear: () => this.pending.delete(requestId) }
      this.pending.set(requestId, pending)
      pendingByRequestId.set(requestId, pending)
    })
  }

  respond(requestId: string, allowed: boolean): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pendingByRequestId.delete(requestId)
    pending.resolve(allowed)
  }
}

export function isEditTool(name: string): boolean {
  return name === 'file_edit' || name === 'file_write'
}

export function respondToPermissionRequest(requestId: string, allowed: boolean): void {
  const pending = pendingByRequestId.get(requestId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingByRequestId.delete(requestId)
  pending.clear()
  pending.resolve(allowed)
}
