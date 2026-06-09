/**
 * workflowNotificationSound.ts — 8-bit 风格工作流音效
 *
 * 使用 Web Audio API 合成方波 + 噪声打击乐音效，
 * 在 workflow 步骤完成/出错/需要确认时播放提示音。
 * 需要用户交互后首次调用 prepareWorkflowNotificationSound() 解锁 AudioContext。
 */

export type WorkflowNotificationSound = 'confirm' | 'finished' | 'error' | 'start'

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

/**
 * Play a short 8-bit / chiptune notification. Each kind is a distinct
 * melodic fragment built from square-wave oscillators with optional
 * noise percussion — inspired by CodeIsland's retro sound palette.
 */
export function playWorkflowNotificationSound(kind: WorkflowNotificationSound): void {
  if (!readWorkflowNotificationSoundEnabled()) return

  const ctx = getAudioContext()
  if (!ctx) return

  void ctx.resume().then(() => {
    switch (kind) {
      case 'start':
        playStart(ctx)
        break
      case 'confirm':
        playConfirm(ctx)
        break
      case 'finished':
        playFinished(ctx)
        break
      case 'error':
        playError(ctx)
        break
    }
  }).catch(() => {
    // Notification sound is best-effort; blocked audio should not affect the workflow.
  })
}

// ── audio context ─────────────────────────────────────────────────────────

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

// ── tone primitives ───────────────────────────────────────────────────────

type Waveform = 'square' | 'triangle' | 'sawtooth' | 'sine'

function osc(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  vol: number,
  wave: Waveform = 'square'
): OscillatorNode {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = wave
  o.frequency.setValueAtTime(freq, start)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(vol, start + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g)
  g.connect(ctx.destination)
  o.start(start)
  o.stop(start + dur + 0.02)
  o.addEventListener('ended', () => { o.disconnect(); g.disconnect() }, { once: true })
  return o
}

/** Short burst of white-noise percussion for retro snare / hi-hat feel. */
function noise(ctx: AudioContext, start: number, dur: number, vol: number): void {
  const len = Math.ceil(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.5
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.setValueAtTime(vol, start)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(g)
  g.connect(ctx.destination)
  src.start(start)
  src.stop(start + dur + 0.01)
  src.addEventListener('ended', () => { src.disconnect(); g.disconnect() }, { once: true })
}

/** Quick frequency sweep downward — retro "blip" accent. */
function sweep(
  ctx: AudioContext,
  fromFreq: number,
  toFreq: number,
  start: number,
  dur: number,
  vol: number
): void {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'square'
  o.frequency.setValueAtTime(fromFreq, start)
  o.frequency.exponentialRampToValueAtTime(toFreq, start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(vol, start + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g)
  g.connect(ctx.destination)
  o.start(start)
  o.stop(start + dur + 0.02)
  o.addEventListener('ended', () => { o.disconnect(); g.disconnect() }, { once: true })
}

// ── sound patterns ────────────────────────────────────────────────────────

/** Startup / begin-run: rising arpeggio + soft blip. */
function playStart(ctx: AudioContext): void {
  const t = ctx.currentTime
  // Rising C-major arpeggio
  const notes = [523.25, 659.25, 784, 1046.5]
  notes.forEach((freq, i) => osc(ctx, freq, t + i * 0.07, 0.1, 0.06, 'square'))
  noise(ctx, t + notes.length * 0.07, 0.04, 0.04)
}

/** Confirm / handoff-accepted: two-note ascending chime, brighter. */
function playConfirm(ctx: AudioContext): void {
  const t = ctx.currentTime
  osc(ctx, 784, t, 0.1, 0.07, 'square')       // G5
  osc(ctx, 1174.66, t + 0.08, 0.14, 0.07, 'square') // D6
  noise(ctx, t + 0.2, 0.03, 0.03)
}

/** Finished / turn-done: a little 3-note fanfare with a noise hit. */
function playFinished(ctx: AudioContext): void {
  const t = ctx.currentTime
  osc(ctx, 659.25, t, 0.1, 0.06, 'square')           // E5
  osc(ctx, 880, t + 0.09, 0.1, 0.06, 'square')       // A5
  osc(ctx, 1174.66, t + 0.18, 0.16, 0.07, 'square')  // D6
  noise(ctx, t + 0.3, 0.04, 0.04)
}

/** Error / abort: two descending notes + noise "thud". */
function playError(ctx: AudioContext): void {
  const t = ctx.currentTime
  sweep(ctx, 440, 220, t, 0.12, 0.07)
  osc(ctx, 293.66, t + 0.1, 0.14, 0.06, 'square')  // D4
  noise(ctx, t + 0.08, 0.08, 0.06)
}
