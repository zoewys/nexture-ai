/**
 * transcriptScroll.ts — Transcript 自动滚动控制逻辑
 *
 * 提供判断函数：是否接近底部（用于决定新事件到来时是否自动滚动）、
 * 以及特定事件类型是否应触发自动跟随（避免 thinking/stderr 等次要事件打断用户浏览）。
 */

export interface TranscriptScrollState {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export interface TranscriptEventLike {
  kind: string
  text?: string
}

const BOTTOM_THRESHOLD_PX = 64

export function isNearTranscriptBottom(
  state: TranscriptScrollState,
  thresholdPx = BOTTOM_THRESHOLD_PX
): boolean {
  if (state.scrollHeight <= state.clientHeight) return true

  const distanceFromBottom = state.scrollHeight - state.clientHeight - state.scrollTop
  return distanceFromBottom <= thresholdPx
}

export function isTranscriptUserInput(event: TranscriptEventLike | undefined): boolean {
  return event?.kind === 'system' && typeof event.text === 'string' && event.text.startsWith('↳')
}

export function shouldAutoFollowTranscriptEvent(
  currentAutoFollow: boolean,
  latestEvent: TranscriptEventLike | undefined,
  eventCount: number
): boolean {
  if (isTranscriptUserInput(latestEvent)) return false
  if (eventCount <= 1) return true
  return currentAutoFollow
}
