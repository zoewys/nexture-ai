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
const skillStore = source('src/main/SkillStore.ts')
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
const composerBar = source('src/renderer/src/ComposerBar.tsx')
const pastedImages = source('src/renderer/src/pastedImages.ts')
const workflowWorkspace = source('src/renderer/src/WorkflowWorkspace.tsx')
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
    'SingleSessionEventEnvelope',
    'SkillSummary',
    'SkillDefinition'
  ]) {
    assert.match(shared, new RegExp(`(?:type|interface) ${name}\\b`))
  }
  assert.match(shared, /nativeResume: boolean/)
  assert.match(shared, /conversation\?: ConversationState/)
  assert.match(shared, /cwd: string[\s\S]*route: SessionRoute/)
  assert.match(shared, /skillIds\?: string\[\]/)
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
  assert.match(shared, /skillsList: 'skills:list'/)
})

test('skill store discovers local SKILL.md files and builds prompt context', () => {
  assert.equal(existsSync(join(root, 'src/main/SkillStore.ts')), true)
  assert.match(skillStore, /export class SkillStore/)
  assert.match(skillStore, /CODEX_HOME/)
  assert.match(skillStore, /\.codex'[\s\S]*'skills'/)
  assert.match(skillStore, /\.agents'[\s\S]*'skills'/)
  assert.match(skillStore, /plugins'[\s\S]*'cache'/)
  assert.match(skillStore, /parseFrontmatter/)
  assert.match(skillStore, /description/)
  assert.match(skillStore, /pluginSourceLabel/)
  assert.match(skillStore, /buildPrompt\(skillIds: string\[\] \| undefined\)/)
  assert.match(skillStore, /selected_skills/)
})

test('composer can save pasted clipboard images as attachments', () => {
  assert.match(shared, /export interface PastedImageInput/)
  assert.match(shared, /savePastedImage: 'clipboard:image:save'/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.savePastedImage/)
  assert.match(ipc, /app\.getPath\('userData'\)[\s\S]*'pasted-attachments'/)
  assert.match(ipc, /mediaType\.toLowerCase\(\)\.startsWith\('image\/'\)/)
  assert.match(preload, /savePastedImage: \(input: PastedImageInput\): Promise<string>/)
  assert.match(pastedImages, /file\.arrayBuffer\(\)/)
  assert.match(pastedImages, /window\.api\.savePastedImage/)
  assert.match(composerBar, /onPasteImages\?: \(files: File\[\]\) => Promise<void>/)
  assert.match(composerBar, /event\.clipboardData\.items/)
  assert.match(composerBar, /item\.type\.startsWith\('image\/'\)/)
  assert.match(composerBar, /onPaste=\{handlePaste\}/)
  assert.match(singlePanel, /onPasteImages=\{handlePasteImages\}/)
  assert.match(workflowWorkspace, /onPasteImages=\{handlePasteImages\}/)
  assert.match(workflowDetail, /onPasteImages: \(files: File\[\]\) => Promise<void>/)
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
  assert.match(singleManager, /this\.skillStore\.buildPrompt\(input\.skillIds\)/)
  assert.match(singleManager, /this\.runManager\.push\(liveRunId, prependSkillPrompt\(clean, skillContext\.text\)\)/)
  assert.match(singleManager, /appendSystemPrompt\(config\.appendSystemPrompt, skillContext\.text\)/)
  assert.match(singleManager, /text: `Using skill: \$\{skillContext\.skills\.map/)
  assert.match(singleManager, /skillIds: skillContext\.skills\.length > 0/)
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
  assert.match(ipc, /new SkillStore\(\)/)
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
  assert.match(ipc, /ipcMain\.handle\(IPC\.skillsList/)
  for (const method of [
    'listSingleSessions',
    'createSingleSession',
    'getSingleSession',
    'sendSingleSessionMessage',
    'abortSingleSession',
    'deleteSingleSession',
    'listSkills',
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
  assert.match(singlePanel, /useSkills\(\)/)
  assert.match(singlePanel, /parseSkillCommand\(message, skillState\.skills, selectedSkillIds\)/)
  assert.match(singlePanel, /onlySelectedSkill/)
  assert.match(singlePanel, /skillIds: parsedMessage\.skillIds/)
  assert.match(composerBar, /composer-skill-menu/)
  assert.match(composerBar, /ArrowDown/)
  assert.match(composerBar, /ArrowUp/)
  assert.match(composerBar, /event\.key === 'Tab' \|\| event\.key === 'Enter'/)
  assert.match(composerBar, /selectedSkills\?: SkillSummary\[\]/)
  assert.match(composerBar, /const description = skill\.description\.trim\(\)/)
  assert.match(composerBar, /\{description \? <span>\{description\}<\/span> : null\}/)
  assert.doesNotMatch(composerBar, /skill\.description \|\| skill\.sourceLabel/)
  assert.doesNotMatch(composerBar, /\.slice\(0,\s*8\)/)
  assert.match(styles, /\.composer-skill-menu/)
  assert.match(styles, /\.composer-skill-menu\s*\{[\s\S]*overflow-y:\s*auto;/)
  assert.match(styles, /\.composer-skill-menu-header\s*\{[\s\S]*position:\s*sticky;/)
  assert.doesNotMatch(styles, /\.composer-skill-menu\s*\{[^}]*overflow:\s*hidden;/)
  assert.match(styles, /\.composer-skill-chip/)
  assert.match(styles, /\.single-session-sidebar/)
  assert.match(styles, /\.single-session-card/)
  assert.match(styles, /\.single-session-card-delete/)
  assert.match(styles, /\.single-session-card-delete:hover,\s*\n\.single-session-card-delete:focus-visible\s*\{[\s\S]*color:\s*var\(--semantic-error,\s*var\(--red\)\);/)
  assert.doesNotMatch(styles, /\.single-session-card-delete:hover[^{]*\{[^}]*#ffd0d0/)
  assert.match(styles, /\.single-session-card-meta/)
  assert.match(styles, /\.transcript-chat/)
  assert.match(styles, /\.chat-bubble-user/)
  assert.match(styles, /\.chat-bubble-assistant/)
  assert.match(styles, /\.single-session-toolbar-main\s*\{[\s\S]*grid-template-columns:/)
  assert.match(styles, /\.single-session-toolbar-chip\b/)
  assert.match(styles, /\.single-session-advanced-panel\b/)
  assert.match(styles, /\.chat-system\s*\{[\s\S]*align-self:\s*flex-start;[\s\S]*text-align:\s*left;/)
  assert.match(styles, /\.single-session-transcript\s*\{[\s\S]*overflow:\s*hidden !important;/)
  assert.match(styles, /\.single-session-transcript \.transcript-chat\s*\{[\s\S]*overflow-y:\s*auto !important;/)
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

test('single route controls render as a compact toolbar instead of large cards', () => {
  const compactToolbarSection = styles.slice(
    styles.indexOf('/* Real-data Single/Agents fixes'),
    styles.indexOf('/* Real-data layout corrections after green redesign QA.')
  )
  const block = (pattern) => compactToolbarSection.match(pattern)?.[1] ?? ''
  const routePanelBlock = block(/\.single-session-route-panel\s*\{([^}]*)\}/)
  const toolbarBlock = block(/\.single-session-toolbar-main\s*\{([^}]*)\}/)
  const toolbarChildrenBlock = block(/\.single-session-toolbar-main > \*\s*\{([^}]*)\}/)
  const toolbarContextBlock = block(/\.single-session-toolbar-context\s*\{([^}]*)\}/)
  const clusterBlock = block(/\.single-session-toolbar-cluster\s*\{([^}]*)\}/)
  const inlineBlock = block(/\.single-session-toolbar-inline\s*\{([^}]*)\}/)
  const runtimeInputBlock = block(/\.single-session-toolbar-runtime \.single-session-toolbar-input\s*\{([^}]*)\}/)
  const toolbarTriggerBlock = block(/\.single-session-toolbar-input \.select-trigger,\s*\n\.single-session-toolbar-input \.runtime-model-cascade-trigger\s*\{([^}]*)\}/)
  const toolbarTriggerTextBlock = block(/\.single-session-toolbar-input \.select-trigger > span:first-child,\s*\n\.single-session-toolbar-input \.runtime-model-cascade-trigger > span:first-child\s*\{([^}]*)\}/)
  const agentIconBlock = block(/\.single-session-agent-icon-button\s*\{([^}]*)\}/)
  const contextInlineBlock = block(/\.single-session-toolbar-inline-context\s*\{([^}]*)\}/)
  const contextPathBlock = block(/\.single-session-toolbar-context \.single-session-path-shell\s*\{([^}]*)\}/)
  const advancedContextPathBlock = block(/\.single-session-toolbar-main-codex-advanced \.single-session-toolbar-context \.single-session-path-shell\s*\{([^}]*)\}/)
  const inlineAdvancedBlock = block(/\.single-session-inline-advanced-controls\s*\{([^}]*)\}/)
  const inlineAdvancedOptionsBlock = block(/\.single-session-inline-advanced-controls \.codex-options\s*\{([^}]*)\}/)
  const inlineAdvancedTriggerBlock = block(/\.single-session-inline-advanced-controls \.select-trigger\s*\{([^}]*)\}/)
  const pathNameBlock = block(/\.single-session-path-name\s*\{([^}]*)\}/)
  const pathPickerBlock = block(/\.single-session-path-picker\s*\{([^}]*)\}/)

  assert.match(routePanelBlock, /padding:\s*8px 24px 7px !important;/)
  assert.match(toolbarBlock, /width:\s*100% !important;/)
  assert.match(toolbarBlock, /display:\s*flex !important;/)
  assert.match(toolbarBlock, /flex-wrap:\s*nowrap !important;/)
  assert.doesNotMatch(toolbarBlock, /1\.45fr/)
  assert.doesNotMatch(toolbarBlock, /grid-template-columns:/)
  assert.match(toolbarBlock, /align-items:\s*flex-start !important;/)
  assert.match(toolbarChildrenBlock, /flex:\s*1 1 0 !important;/)
  assert.match(toolbarChildrenBlock, /min-width:\s*0 !important;/)
  assert.match(toolbarContextBlock, /flex:\s*2 1 0 !important;/)
  assert.doesNotMatch(compactToolbarSection, /\.single-session-toolbar-main-codex-advanced\s*\{[\s\S]*grid-template-columns:/)
  assert.match(clusterBlock, /width:\s*100% !important;/)
  assert.match(clusterBlock, /border:\s*0 !important;/)
  assert.match(clusterBlock, /background:\s*transparent !important;/)
  assert.match(clusterBlock, /grid-template-rows:\s*auto 34px !important;/)
  assert.match(inlineBlock, /flex-wrap:\s*nowrap !important;/)
  assert.match(runtimeInputBlock, /max-width:\s*240px !important;/)
  assert.match(toolbarTriggerBlock, /text-align:\s*left !important;/)
  assert.match(toolbarTriggerTextBlock, /text-align:\s*left !important;/)
  assert.match(agentIconBlock, /width:\s*34px !important;/)
  assert.match(agentIconBlock, /padding:\s*0 !important;/)
  assert.match(contextInlineBlock, /align-items:\s*center !important;/)
  assert.match(contextPathBlock, /max-width:\s*300px !important;/)
  assert.match(advancedContextPathBlock, /max-width:\s*240px !important;/)
  assert.match(inlineAdvancedBlock, /width:\s*auto !important;/)
  assert.match(inlineAdvancedBlock, /align-self:\s*flex-start !important;/)
  assert.match(inlineAdvancedOptionsBlock, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\) !important;/)
  assert.match(inlineAdvancedTriggerBlock, /height:\s*34px !important;/)
  assert.match(styles, /\.single-session-toolbar-input \.select-trigger,\s*\n\.single-session-toolbar-input \.runtime-model-cascade-trigger\s*\{[\s\S]*height:\s*34px !important;/)
  assert.match(styles, /\.single-session-path-shell\s*\{[\s\S]*height:\s*34px !important;/)
  assert.match(pathNameBlock, /text-overflow:\s*ellipsis !important;/)
  assert.match(pathNameBlock, /white-space:\s*nowrap !important;/)
  assert.match(pathPickerBlock, /width:\s*24px !important;/)
  assert.match(pathPickerBlock, /border:\s*0 !important;/)
  assert.doesNotMatch(compactToolbarSection, /\.single-session-path-shell input/)
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
