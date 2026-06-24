/**
 * useAgentCreateCapture.ts — 监听当前 single session 的助手输出，
 * 当检测到 nexture_create_agent 标记 JSON 时，解析出 agent 草稿供 UI 确认。
 *
 * 触发时机：每个回合结束（turn-done）后，扫描该回合的 assistant 文本
 * （message / message-delta 拼接），命中标记且通过校验即弹出候选。
 *
 * 去重：按解析出的 agent 定义内容做指纹，跨 session 持久记忆 —— 内容
 * 不变的候选不会重复弹出（切回旧 session、或助手重出相同定义都不重弹）；
 * 只有用户让助手改动后、定义内容变了（指纹不同）才会重新弹出，支持迭代。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '@shared/types'
import { parseAgentDraftFromText, type AgentDraftPayload } from '@shared/agentDefinitionParser'

export interface AgentCreateCapture {
  pendingDraft: AgentDraftPayload | null
  dismiss: () => void
}

export function useAgentCreateCapture(
  events: AgentEvent[],
  running: boolean,
  sessionId: string | undefined
): AgentCreateCapture {
  const [pendingDraft, setPendingDraft] = useState<AgentDraftPayload | null>(null)
  // 已扫描到的 events 下标（按 sessionId 隔离；session 切换时重置）。
  const scannedIndexRef = useRef(0)
  // 已弹出过的候选指纹，跨 session 持久，避免重复弹。
  const seenFingerprintsRef = useRef<Set<string>>(new Set())

  // session 切换：重置扫描进度、清空当前候选（指纹记忆保留）。
  useEffect(() => {
    scannedIndexRef.current = 0
    setPendingDraft(null)
  }, [sessionId])

  useEffect(() => {
    const from = scannedIndexRef.current
    if (from > events.length) {
      scannedIndexRef.current = events.length
      return
    }

    // 在未扫描区间里找最后一个 turn-done；没有则不推进（等下一轮事件）。
    let lastTurnDone = -1
    for (let i = from; i < events.length; i++) {
      if (events[i].kind === 'turn-done') lastTurnDone = i
    }
    if (lastTurnDone < 0) return

    // 拼接该回合的 assistant 文本。
    let text = ''
    for (let i = from; i <= lastTurnDone; i++) {
      const ev = events[i]
      if (ev.kind === 'message' || ev.kind === 'message-delta') {
        text += ev.text
      }
    }
    scannedIndexRef.current = lastTurnDone + 1

    const draft = parseAgentDraftFromText(text)
    if (!draft) return

    const fingerprint = JSON.stringify(draft)
    if (seenFingerprintsRef.current.has(fingerprint)) return
    seenFingerprintsRef.current.add(fingerprint)
    setPendingDraft(draft)
  }, [events, running])

  const dismiss = useCallback(() => setPendingDraft(null), [])

  return { pendingDraft, dismiss }
}
