# Session Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement every requirement in `SESSION_MODE_TASKS.md`: durable Single sessions, route switching inside one logical conversation, native/resume/replay continuation, workflow step conversations, UI affordances, and tests.

**Architecture:** Main owns the product-level session contract through `SingleSessionStore` and `SingleSessionManager`; renderer only calls typed IPC and renders `SingleSessionDetail`. Transcript replay remains app-owned and is shared by Single sessions and resume fallback. Workflow interactive steps get the same `ConversationState` shape but stay scoped to workflow executions and never enter the Single session list.

**Tech Stack:** Electron main/preload IPC, React renderer, TypeScript shared contracts, Node test runner, lucide-react icons.

---

### Task 1: Shared Contracts and Adapter Capabilities

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/adapters/types.ts`
- Test: `tests/session-mode.test.mjs`

- [x] Add session types near the run contract:
  - `SessionScope = 'single' | 'workflow-step'`
  - `SessionStatus = 'active' | 'archived' | 'deleted'`
  - `SessionContinuationStrategy = 'live-push' | 'native-resume' | 'logic-replay' | 'new'`
  - `SessionRoute`, `SessionSegment`, `ConversationState`, `SingleSession`, `SingleSessionDetail`
- [x] Add `nativeResume: boolean` to `AdapterCapabilities`.
- [x] Add `conversation?: ConversationState` to `WorkflowStepExecution`.
- [x] Add `singleSessionsList`, `singleSessionCreate`, `singleSessionGet`, `singleSessionSend`, `singleSessionAbort`, `singleSessionEvent` to `IPC`.
- [x] Add payload/result/event envelope interfaces for Single sessions.
- [x] Verify with `pnpm run typecheck`.

### Task 2: Persistent Single Session Store

**Files:**
- Create: `src/main/SingleSessionStore.ts`
- Test: `tests/session-mode.test.mjs`

- [x] Implement one JSON file per session under `app.getPath('userData')/single-sessions`.
- [x] Implement `list()`, `get(id)`, `create(input)`, `save(session)`.
- [x] Default created sessions to active status, empty conversation state, and `New Session` title.
- [x] Sort `list()` by `updatedAt` descending and ignore malformed JSON.
- [x] Verify create/list/save behavior through source-contract and runtime tests.

### Task 3: Transcript Timeline Replay

**Files:**
- Modify: `src/main/TranscriptStore.ts`
- Test: `tests/session-mode.test.mjs`
- Test: `tests/transcript-scroll.test.mjs`

- [x] Export `TranscriptRecord`.
- [x] Add `readSessionTimeline(sessionIds: string[]): TranscriptRecord[]`.
- [x] Add `buildReplayPromptFromTimeline(sessionIds: string[], newText: string): string`.
- [x] Keep `buildResumePrompt()` compatible by delegating to the shared timeline formatter.
- [x] Include only user records and assistant message events; ignore stderr/system/permission noise.
- [x] Keep the existing recent-turn truncation limit.

### Task 4: Adapter Native Resume

**Files:**
- Modify: `src/main/adapters/claudeAdapter.ts`
- Modify: `src/main/adapters/codexArgs.ts`
- Modify: `src/main/adapters/codexAdapter.ts`
- Modify: `src/main/adapters/apiAdapter.ts`
- Modify: `src/main/RunManager.ts`
- Test: `tests/session-mode.test.mjs`
- Test: `tests/api-adapter.test.mjs`
- Test: `tests/api-mode-contract.test.mjs`
- Test: `tests/codex-stderr-noise.test.mjs`

- [x] Set Claude `nativeResume: true`.
- [x] Split Codex args into initial and resume builders; resume form must be `exec resume <SESSION_ID> <PROMPT>` plus existing flags.
- [x] Set Codex `nativeResume: true`.
- [x] Set API `nativeResume: false`.
- [x] Add `RunManager.hasLiveRun()` and `RunManager.getAdapterCapabilities()` helpers for session orchestration.
- [x] Preserve existing resume-failure fallback system message.

### Task 5: Single Session Manager

**Files:**
- Create: `src/main/SingleSessionManager.ts`
- Modify: `src/main/ipc.ts`
- Test: `tests/session-mode.test.mjs`

- [x] Implement `listSessions()`, `createSession()`, `getSessionDetail()`, `sendMessage()`, `abortSessionRun()`.
- [x] On first send, create the first `SessionSegment`.
- [x] Same route plus live bidirectional process uses `runManager.push()`.
- [x] Same route plus native session and `nativeResume` uses `resumeFrom`.
- [x] Route changes keep the same `SingleSession.id`, create a new segment, and start with replay prompt.
- [x] Resume failures still fall back through `RunManager`.
- [x] Auto-update default title from first user input and preview from recent user/assistant text.
- [x] Emit `singleSessionEvent` envelopes with session updates and nested agent events.

### Task 6: IPC, Preload, and Renderer Hook

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/useSingleSessions.ts`
- Test: `tests/session-mode.test.mjs`

- [x] Register Single Session IPC handlers.
- [x] Expose `listSingleSessions`, `createSingleSession`, `getSingleSession`, `sendSingleSessionMessage`, `abortSingleSession`, `onSingleSessionEvent`.
- [x] Hook loads sessions on mount, selects/gets details, sends messages, aborts, and merges events.

### Task 7: Single Session UI

**Files:**
- Create: `src/renderer/src/SingleSessionSidebar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/SingleRunPanel.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/session-mode.test.mjs`
- Test: `tests/workflow-ui-layout.test.mjs`

- [x] Replace `useRun()` for Single mode with `useSingleSessions()`.
- [x] Render three columns: `ModeRail`, `SingleSessionSidebar`, current session main area.
- [x] Sidebar supports create/select and hides workflow-step/archived/deleted sessions.
- [x] Header shows title, route/model pill, cwd summary, running status, and route controls.
- [x] If selected session has a live run, selecting another session asks for confirmation.
- [x] Keep lucide-react icons for all icon UI.

### Task 8: Route Switching Banner

**Files:**
- Modify: `src/renderer/src/SingleRunPanel.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/session-mode.test.mjs`

- [x] Detect pending route changes inside the same logical session.
- [x] Show a top banner before send and after route switch with source and target model labels.
- [x] Do not imply native session reuse across model/vendor/provider changes.
- [x] Continue appending transcript events to the same selected logical session.

### Task 9: Workflow Step Conversation State

**Files:**
- Modify: `src/main/WorkflowManager.ts`
- Test: `tests/interactive-mode.test.mjs`
- Test: `tests/session-mode.test.mjs`
- Test: `tests/workflow-runs-state.test.mjs`

- [x] Initialize `conversation` on every step execution.
- [x] `pushInput()` on live interactive steps updates the same execution conversation.
- [x] Continuing a completed/awaiting step with native resume creates a new execution but references a new conversation segment.
- [x] `rerunStep()` creates a new execution with a fresh conversation.
- [x] Workflow step conversations never enter `SingleSessionStore`.

### Task 10: Workflow Conversation UI

**Files:**
- Modify: `src/renderer/src/WorkflowRunDetail.tsx`
- Modify: `src/renderer/src/WorkflowWorkspace.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/workflow-ui-layout.test.mjs`
- Test: `tests/session-mode.test.mjs`

- [x] Add `workflow-step-conversation-bar` above the selected step transcript for interactive/awaiting steps.
- [x] Show `Step N`, step name, `INPUT`/status, agent/model pill, and a concise scope hint.
- [x] Keep `结束对话，进入下一步` as the primary bar action.
- [x] Do not add any global workflow session list.

### Task 11: Verification

**Files:**
- Create/Modify: `tests/session-mode.test.mjs`
- Modify: `tests/interactive-mode.test.mjs`
- Modify: `tests/api-mode-contract.test.mjs`
- Modify: `tests/workflow-ui-layout.test.mjs`

- [x] Cover shared contracts, store/manager files, Codex resume args, API `nativeResume: false`, Single UI/hook wiring, workflow `conversation`, and UI bars.
- [x] Run:
  - `pnpm test`
  - `pnpm run typecheck`
  - `pnpm build`
- [x] Audit every explicit requirement in `SESSION_MODE_TASKS.md` against current files and command output before marking the goal complete.
