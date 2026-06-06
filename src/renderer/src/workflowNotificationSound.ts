export type WorkflowNotificationSound = 'confirm' | 'finished'

type AudioContextConstructor = new () => AudioContext

const WORKFLOW_NOTIFICATION_SOUND_ENABLED_KEY = 'agent-studio.workflow.notification-sound-enabled'

let audioContext: AudioContext | null = null

export function readWorkflowNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(WORKFLOW_NOTIFICATION_SOUND_ENABLED_KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeWorkflowNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WORKFLOW_NOTIFICATION_SOUND_ENABLED_KEY, String(enabled))
  } catch {
    // Persisting this preference is best-effort.
  }
}

export function prepareWorkflowNotificationSound(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  void ctx.resume().catch(() => {
    // Browsers may require a user gesture before audio can start.
  })
}

export function playWorkflowNotificationSound(kind: WorkflowNotificationSound): void {
  if (!readWorkflowNotificationSoundEnabled()) return

  const ctx = getAudioContext()
  if (!ctx) return

  void ctx.resume().then(() => {
    if (kind === 'confirm') {
      playTone(ctx, 784, 0, 0.12, 0.065)
      playTone(ctx, 1046.5, 0.1, 0.16, 0.07)
    } else {
      playTone(ctx, 659.25, 0, 0.12, 0.06)
      playTone(ctx, 880, 0.1, 0.12, 0.065)
      playTone(ctx, 1174.66, 0.2, 0.2, 0.07)
    }
  }).catch(() => {
    // Notification sound is best-effort; blocked audio should not affect the workflow.
  })
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null

  const audioWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor
  }
  const AudioContextImpl = window.AudioContext ?? audioWindow.webkitAudioContext
  if (!AudioContextImpl) return null

  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContextImpl()
  }
  return audioContext
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  offset: number,
  duration: number,
  volume: number
): void {
  const startAt = ctx.currentTime + offset
  const endAt = startAt + duration
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, startAt)

  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.018)
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(endAt + 0.02)

  oscillator.addEventListener('ended', () => {
    oscillator.disconnect()
    gain.disconnect()
  }, { once: true })
}
