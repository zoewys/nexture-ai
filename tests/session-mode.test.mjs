import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

const shared = source('src/shared/types.ts')
const singleStore = source('src/main/SingleSessionStore.ts')
const singleManager = source('src/main/SingleSessionManager.ts')
const transcriptStore = source('src/main/TranscriptStore.ts')
const runManager = source('src/main/RunManager.ts')
const factory = source('src/main/adapters/factory.ts')
const claudeAdapter = source('src/main/adapters/claudeAdapter.ts')
const codexAdapter = source('src/main/adapters/codexAdapter.ts')
const codexArgs = source('src/main/adapters/codexArgs.ts')
const apiAdapter = source('src/main/adapters/apiAdapter.ts')
const ipc = source('src/main/ipc.ts')
const preload = source('src/preload/index.ts')
const app = source('src/renderer/src/App.tsx')
const singlePanel = source('src/renderer/src/SingleRunPanel.tsx')
const singleSidebar = source('src/renderer/src/SingleSessionSidebar.tsx')
const singleHook = source('src/renderer/src/useSingleSessions.ts')
const workflowManager = source('src/main/WorkflowManager.ts')
const workflowDetail = source('src/renderer/src/WorkflowRunDetail.tsx')
const styles = source('src/renderer/src/styles.css')

test('shared session contract exposes session types, workflow conversation, native resume, and IPC channels', () => {
  for (const name of [
    'SessionScope',
    'SessionStatus',
    'SessionContinuationStrategy',
    'SessionRoute',
    'SessionSegment',
    'ConversationState',
    'SingleSession',
    'SingleSessionDetail',
    'SingleSessionEventEnvelope'
  ]) {
    assert.match(shared, new RegExp(`(?:type|interface) ${name}\\b`))
  }
  assert.match(shared, /nativeResume: boolean/)
  assert.match(shared, /conversation\?: ConversationState/)
  assert.match(shared, /cwd: string[\s\S]*route: SessionRoute/)
  assert.match(shared, /Working directory used when this segment was launched/)
  for (const channel of [
    'singleSessionsList',
    'singleSessionCreate',
    'singleSessionGet',
    'singleSessionSend',
    'singleSessionAbort',
    'singleSessionDelete',
    'singleSessionEvent'
  ]) {
    assert.match(shared, new RegExp(`${channel}: 'single:sessions:`))
  }
})

test('single session store persists one active JSON file per session', () => {
  assert.equal(existsSync(join(root, 'src/main/SingleSessionStore.ts')), true)
  assert.match(singleStore, /app\.getPath\('userData'\).*'single-sessions'/s)
  assert.match(singleStore, /create\(input: SingleSessionCreateInput\): SingleSession/)
  assert.match(singleStore, /status: 'active'/)
  assert.match(singleStore, /title: input\.title\?\.trim\(\) \|\| 'New Session'/)
  assert.match(singleStore, /scope: 'single'/)
  assert.match(singleStore, /segments: \[\]/)
  assert.match(singleStore, /events: \[\]/)
  assert.match(singleStore, /\.filter\(\(session\) => session\.status === 'active'\)/)
  assert.match(singleStore, /\.sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)/)
  assert.match(singleStore, /writeFileSync\(this\.pathFor\(next\.id\), JSON\.stringify\(next, null, 2\)\)/)
  assert.match(singleStore, /delete\(id: string\): void/)
  assert.match(singleStore, /status: 'deleted'/)
})

test('transcript store can aggregate logical session timelines and build replay prompts', () => {
  assert.match(transcriptStore, /export type TranscriptRecord/)
  assert.match(transcriptStore, /readSessionTimeline\(sessionIds: string\[\]\): TranscriptRecord\[\]/)
  assert.match(transcriptStore, /for \(const sessionId of sessionIds\)/)
  assert.match(transcriptStore, /rec\.kind === 'user'/)
  assert.match(transcriptStore, /rec\.event\.kind === 'message'/)
  assert.match(transcriptStore, /rec\.event\.kind === 'message-delta'/)
  assert.match(transcriptStore, /flushDeltaMessage/)
  assert.match(transcriptStore, /buildReplayPromptFromTimeline\(sessionIds: string\[\], newText: string\): string/)
  assert.match(transcriptStore, /buildReplayMessagesFromTimeline\(sessionIds: string\[\], newText: string\): ApiConversationMessage\[\]/)
  assert.match(transcriptStore, /tool-call/)
  assert.match(transcriptStore, /tool-result/)
  assert.match(transcriptStore, /toolCallId/)
  assert.match(transcriptStore, /这是继续之前的逻辑会话/)
  assert.match(transcriptStore, /const MAX_RESUME_TURNS = 10/)
  assert.match(transcriptStore, /buildResumePrompt\(sessionId: string, newText: string\): string/)
})

test('adapters declare native resume capabilities and Codex builds exec resume args', () => {
  assert.match(claudeAdapter, /nativeResume: true/)
  assert.match(codexAdapter, /nativeResume: true/)
  assert.match(apiAdapter, /nativeResume: false/)
  assert.match(factory, /getAdapterCapabilities/)
  assert.match(factory, /case 'api':[\s\S]*nativeResume: false/)
  assert.match(codexArgs, /buildCodexInitialArgs/)
  assert.match(codexArgs, /buildCodexResumeArgs/)
  assert.match(codexArgs, /const args = \['exec', 'resume', sessionId\]/)
  assert.match(codexAdapter, /resumeFrom: input\.resumeFrom\?\.sessionId/)
  assert.match(runManager, /getLiveRunCapabilities/)
  assert.match(runManager, /getAdapterCapabilities\(vendor: AgentVendor\)/)
  assert.match(runManager, /resume failed, retrying with transcript context/)
})

test('single session manager implements continuation decisions and emits session events', () => {
  assert.equal(existsSync(join(root, 'src/main/SingleSessionManager.ts')), true)
  for (const method of [
    'listSessions',
    'createSession',
    'getSessionDetail',
    'sendMessage',
    'abortSessionRun',
    'deleteSession'
  ]) {
    assert.match(singleManager, new RegExp(`${method}\\(`))
  }
  assert.match(singleManager, /liveCapabilities\?\.bidirectionalStdin/)
  assert.match(singleManager, /const sameContext = sameRoute && sameCwd/)
  assert.match(singleManager, /sameContext && liveRunId && liveCapabilities\?\.bidirectionalStdin/)
  assert.match(singleManager, /this\.runManager\.push\(liveRunId, clean\)/)
  assert.match(singleManager, /cwdEqual\(activeSegment\.cwd \?\? session\.cwd, targetCwd\)/)
  assert.match(singleManager, /项目目录已切换/)
  assert.match(singleManager, /cwd: input\.cwd\.trim\(\)/)
  assert.match(singleManager, /nativeResume/)
  assert.match(singleManager, /buildReplayPromptFromTimeline/)
  assert.match(singleManager, /buildReplayMessagesFromTimeline/)
  assert.match(singleManager, /route\.vendor === 'api'/)
  assert.match(singleManager, /messages: replayMessages/)
  assert.match(singleManager, /continuationStrategy: strategy/)
  assert.match(singleManager, /session\.title === 'New Session'/)
  assert.match(singleManager, /session\.preview = truncate/)
  assert.match(singleManager, /this\.runManager\.abort\(activeSegment\.runId\)/)
  assert.match(singleManager, /this\.store\.delete\(sessionId\)/)
  assert.match(singleManager, /SingleSessionEventEnvelope/)
  assert.match(singleManager, /kind: 'session-updated'/)
  assert.match(singleManager, /kind: 'agent-event'/)
})

test('ipc and preload expose single session CRUD, send, abort, and event APIs', () => {
  assert.match(ipc, /new SingleSessionStore\(\)/)
  assert.match(ipc, /new SingleSessionManager\(/)
  for (const channel of [
    'singleSessionsList',
    'singleSessionCreate',
    'singleSessionGet',
    'singleSessionSend',
    'singleSessionAbort',
    'singleSessionDelete'
  ]) {
    assert.match(ipc, new RegExp(`ipcMain\\.handle\\(IPC\\.${channel}`))
  }
  assert.match(ipc, /win\.webContents\.send\(IPC\.singleSessionEvent, envelope\)/)
  for (const method of [
    'listSingleSessions',
    'createSingleSession',
    'getSingleSession',
    'sendSingleSessionMessage',
    'abortSingleSession',
    'deleteSingleSession',
    'onSingleSessionEvent'
  ]) {
    assert.match(preload, new RegExp(`${method}:`))
  }
})

test('single renderer uses session hook, sidebar cards, route header, and route-switch banner', () => {
  assert.equal(existsSync(join(root, 'src/renderer/src/useSingleSessions.ts')), true)
  assert.equal(existsSync(join(root, 'src/renderer/src/SingleSessionSidebar.tsx')), true)
  assert.match(app, /useSingleSessions\(\)/)
  assert.doesNotMatch(app, /const run = useRun\(\)/)
  assert.match(singleHook, /window\.api\.listSingleSessions\(\)/)
  assert.match(singleHook, /window\.api\.onSingleSessionEvent/)
  assert.match(singleHook, /window\.api\.deleteSingleSession\(id\)/)
  assert.match(singleHook, /sendMessage/)
  assert.match(singleSidebar, /single-session-sidebar/)
  assert.match(singleSidebar, /single-session-cards/)
  assert.match(singleSidebar, /single-session-card-active/)
  assert.match(singleSidebar, /Trash2/)
  assert.match(singleSidebar, /onDeleteSession/)
  assert.match(singlePanel, /onDeleteSession/)
  assert.match(singlePanel, /SingleSessionSidebar/)
  assert.match(singlePanel, /single-session-header/)
  assert.match(singlePanel, /variant="chat"/)
  assert.match(singlePanel, /cwd: cwd\.trim\(\)/)
  assert.match(singlePanel, /single-session-banner/)
  assert.match(singlePanel, /当前话题不变，后续由新模型接手/)
  assert.match(singlePanel, /跨模型不会复用旧模型的原生 session/)
  assert.match(singlePanel, /window\.confirm/)
  assert.match(styles, /\.single-session-sidebar/)
  assert.match(styles, /\.single-session-card/)
  assert.match(styles, /\.single-session-card-delete/)
  assert.match(styles, /\.single-session-card-meta/)
  assert.match(styles, /\.transcript-chat/)
  assert.match(styles, /\.chat-bubble-user/)
  assert.match(styles, /\.chat-bubble-assistant/)
  assert.match(styles, /\.single-session-route-panel\s*\{[\s\S]*grid-template-columns:[\s\S]*minmax\(165px, 1fr\)/)
  assert.match(styles, /\.chat-bubble-user,[\s\S]*\.message-user \.message-bubble\s*\{[\s\S]*color:\s*var\(--neutral-text-primary\) !important;/)
  assert.doesNotMatch(styles, /\.single-session-card:hover\s*\{[^}]*#202633/)
  assert.doesNotMatch(styles, /\.single-session-card(?:-active|:hover|:focus-visible)?\s*\{[^}]*108, 140, 255/)
  assert.match(styles, /\.single-session-card:not\(\.single-session-card-active\):hover\s*\{[\s\S]*background:\s*rgba\(61, 142, 134, 0\.045\) !important;[\s\S]*transform:\s*none !important;/)
  assert.match(styles, /\.single-session-card:focus-visible\s*\{[\s\S]*outline:\s*none !important;[\s\S]*rgba\(61, 142, 134, 0\.16\)/)
  assert.match(styles, /\.single-session-card\.single-session-card-active\s*\{[\s\S]*inset 3px 0 0 rgba\(61, 142, 134, 0\.62\)/)
  assert.match(styles, /\[data-theme="dark"\] \.agent-item-active:hover\s*\{[\s\S]*background:\s*rgba\(0, 212, 170, 0\.1\) !important;/)
  assert.match(styles, /\[data-theme="dark"\] \.single-session-sidebar-head \.icon-text\s*\{[\s\S]*background:\s*rgba\(15, 25, 45, 0\.72\) !important;[\s\S]*opacity:\s*1 !important;/)
  assert.match(styles, /\.single-session-banner-active-route/)
})

test('workflow interactive steps have conversation state and workflow-only conversation UI', () => {
  assert.match(workflowManager, /conversation: createWorkflowConversation\(agent, 'new'\)/)
  assert.match(workflowManager, /conversation: createWorkflowConversation\(agent, 'native-resume'\)/)
  assert.match(workflowManager, /ensureWorkflowConversation/)
  assert.match(workflowManager, /scope: 'workflow-step'/)
  assert.match(workflowManager, /execution\.conversation\.events\.push\(event\)/)
  assert.match(workflowManager, /activeSegment\.nativeSessionId = event\.sessionId/)
  assert.match(workflowDetail, /workflow-step-conversation-bar/)
  assert.match(workflowDetail, /workflow-step-conversation-meta/)
  assert.match(workflowDetail, /workflow-step-conversation-actions/)
  assert.match(workflowDetail, /不会进入 Single 的全局会话列表/)
  assert.match(workflowDetail, /结束对话，进入下一步/)
  assert.match(styles, /\.workflow-step-conversation-bar/)
  assert.doesNotMatch(singleStore, /workflow-step/)
})
