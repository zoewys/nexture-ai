# 会话模式（Session Mode）技术规格说明书

## 1. 背景与动机

当前 `Agent Studio` 的 `Single Agent` 模式已经具备“当前面板内继续发下一条消息”的能力，但底层仍然以“临时 run”为中心，而不是以“用户可管理的会话”为中心：

- `Single` 没有左侧会话列表，也没有显式的会话元数据存储。
- `Single` 的继续对话逻辑主要依赖当前 React 状态中的 `events` 和 `sessionId`，关闭应用后不能以产品级“聊天会话”的方式恢复。
- 不同 vendor 的真实续聊能力不一致：`Claude` 最完整，`Codex` 当前未正确走原生 resume，`API` 模式依赖单轮 `prompt`，没有真正的底层多轮。
- `Workflow` 的 interactive step 已支持多轮状态机，但这套能力尚未上升为统一的“会话模型”。

目标是将产品升级为接近 `Codex App / OpenCode / Cline` 这一类“会话优先”的桌面 Agent 体验：

- `Single Agent` 拥有全局会话列表，支持 `新建 / 切换 / 继续`。
- 同一逻辑会话内允许切模型；对用户来说仍是一条聊天，对系统来说则按 vendor 能力切换底层续聊策略。
- `Workflow` 不与 `Single` 共用全局会话列表，但其 interactive step 使用同一套会话抽象。
- 整体设计以 App 自己管理的 `Session` 为主，vendor 的原生 `session/thread/task` 只是底层执行细节。

## 2. 设计原则

### 2.1 会话优先，Run 次之

用户看到和操作的一级对象应该是“会话（Session）”，而不是“某次 run”。  
`Run` 负责单轮执行，`Session` 负责多轮延续和产品级持久化。

### 2.2 逻辑会话与底层模型会话解耦

同一条逻辑会话内允许切模型，但切模型后不要求继续同一个 vendor 的原生 session。  
逻辑会话保持不变，底层可新建新的 vendor segment 接手。

### 2.3 原生 resume 优先，回放兜底

- `Claude`：优先使用 resident stdin / native resume
- `Codex`：优先使用 `codex exec resume`
- `API`：默认使用历史回放（history replay）

当原生 resume 失败时，统一回退到 transcript/history replay。

### 2.4 Single 与 Workflow 共享会话抽象，但不共享展示入口

- `Single`：全局会话列表
- `Workflow`：`run -> interactive step 会话`

`Workflow step 会话` 不出现在 `Single` 的全局会话列表中。

### 2.5 保持现有运行层可复用

`RunManager`、`TranscriptStore`、`WorkflowManager`、adapter 层继续保留。  
本次改造以“新增会话层 + 修正 continuation 策略”为主，不重写整个执行引擎。

## 3. 整体架构

### 3.1 目标结构

```text
┌──────────────────────────────── Renderer ────────────────────────────────┐
│                                                                          │
│  SingleSessionSidebar   SingleRunPanel           WorkflowWorkspace       │
│          │                    │                         │                │
│          └────── useSingleSessions ────────────────────┘                │
│                                │                                        │
└────────────────────────────────┼─────────────────────────────────────────┘
                                 │ IPC
┌────────────────────────────────┼─────────────────────────────────────────┐
│                              Main Process                               │
│                                                                          │
│   SingleSessionManager          WorkflowManager                          │
│          │                           │                                   │
│          │                           └── workflow step conversation      │
│          │                                                               │
│          ├── SingleSessionStore                                          │
│          ├── TranscriptStore                                             │
│          └── RunManager ──> Claude / Codex / API Adapters               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心对象关系

```text
Single Session
  ├── metadata（标题、状态、时间、当前路由）
  ├── conversation state
  │     ├── segment 1（Claude，原生 session A）
  │     ├── segment 2（Codex，history replay 后新建 session B）
  │     └── segment 3（API，基于逻辑历史回放）
  └── timeline（由 TranscriptStore 聚合）

Workflow Run
  └── Workflow Step Execution
         └── conversation state
                ├── segment 1
                └── segment 2（同一步骤继续聊）
```

### 3.3 为什么 Workflow 不采用“整个 run 一条大聊天”

`Workflow` 中一个 run 往往跨越多个角色和任务类型，例如：

- 产品澄清
- 技术设计
- 编码
- 测试
- Review

如果整个 run 共用一条大 session，会产生三个问题：

1. 不同步骤上下文互相污染  
2. rerun / skip / goto 时难以局部恢复  
3. token 历史持续膨胀

因此本次明确采用：

- `run` 是任务容器
- `interactive step` 才是多轮会话单元

## 4. 依赖项

### 4.1 现有内部依赖

- `src/main/RunManager.ts`
- `src/main/TranscriptStore.ts`
- `src/main/WorkflowManager.ts`
- `src/main/WorkflowStore.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/shared/types.ts`
- `src/renderer/src/SingleRunPanel.tsx`
- `src/renderer/src/useRun.ts`
- `src/renderer/src/WorkflowWorkspace.tsx`

### 4.2 外部能力依赖

- Claude CLI 原生 session / resume
- Codex CLI `exec resume`
- API provider 继续使用 AI SDK `streamText()`；多轮由 App 层组装历史

### 4.3 非本次范围依赖

- 数据导入导出中对 `Single Session` 的备份支持
- 会话搜索 / 重命名 / 删除 / 归档 UI
- 跨会话 memory / semantic search

## 5. 类型变更

本节给出本次建议新增的核心类型。字段级命名应以实现时的实际命名为准，但数据责任边界必须保持一致。

### 5.1 新增：逻辑会话范围与状态

```ts
export type SessionScope = 'single' | 'workflow-step'

export type SessionStatus = 'active' | 'idle' | 'archived'

export type SessionContinuationStrategy =
  | 'resident-stdin'
  | 'native-resume'
  | 'history-replay'
```

### 5.2 新增：会话路由（决定“谁来接手这条会话”）

```ts
export interface SessionRoute {
  vendor: AgentVendor
  model?: string
  apiProviderId?: string
  agentId?: string
  permissionMode?: PermissionMode
  /**
   * 用于判断底层是否还能安全复用同一原生 session。
   * 推荐实现为：vendor + model + provider + agentId + permissionMode + systemPromptHash
   */
  fingerprint: string
}
```

### 5.3 新增：底层执行 segment

一个逻辑会话内，切模型或续聊失败重建时，会产生新的 segment。

```ts
export interface SessionSegment {
  id: string
  route: SessionRoute
  strategy: SessionContinuationStrategy
  startedAt: number
  updatedAt: number
  nativeSessionId?: string
  transcriptSessionIds: string[]
  status: 'running' | 'idle' | 'error'
  lastError?: string
}
```

### 5.4 新增：共享 conversation state

```ts
export interface ConversationState {
  id: string
  scope: SessionScope
  activeSegmentId: string | null
  segments: SessionSegment[]
}
```

### 5.5 新增：Single 会话元数据

```ts
export interface SingleSession {
  id: string
  title: string
  status: SessionStatus
  createdAt: number
  updatedAt: number
  cwd: string
  preview: string
  activeRoute?: SessionRoute
  conversation: ConversationState
}
```

### 5.6 新增：Single 会话视图模型

用于 renderer 展示。

```ts
export interface SingleSessionDetail extends SingleSession {
  events: AgentEvent[]
  running: boolean
}
```

### 5.7 修改：WorkflowStepExecution

当前 `WorkflowStepExecution` 已有 `sessionId`、`runId`、`events`。  
本次需要补充正式的 conversation state，使“一步里的多轮会话”成为一等对象。

```ts
export interface WorkflowStepExecution {
  // existing fields...
  conversation?: ConversationState
}
```

### 5.8 修改：AdapterCapabilities

当前 capability 只有 `bidirectionalStdin / structuredOutputSchema / partialTokenStream`。  
会话层需要显式区分“是否支持原生 resume”。

```ts
export interface AdapterCapabilities {
  bidirectionalStdin: boolean
  structuredOutputSchema: boolean
  partialTokenStream: boolean
  nativeResume: boolean
}
```

### 5.9 修改：RunConfig

`RunConfig` 不应承担完整的产品会话语义，但需要足够让底层 run 知道“这次是否为恢复某个底层 session”。

保留现有：

```ts
resumeFrom?: ResumeHandle
```

新增不建议把 `SingleSession` 全量塞进 `RunConfig`；  
产品级会话上下文应由 `SingleSessionManager / WorkflowManager` 在主进程消化后，再生成最终 `RunConfig`。

## 6. 各模块详细设计

### 6.1 新增 `SingleSessionStore`

职责：

- 持久化 `SingleSession` 元数据
- 提供 `list/get/save/create` 能力
- 不负责原始 transcript 内容

建议文件结构：

```text
{userData}/single-sessions/
  ├── {sessionId}.json
  └── ...
```

建议接口：

```ts
export class SingleSessionStore {
  list(): SingleSession[]
  get(id: string): SingleSession | null
  create(input: { cwd: string; route?: SessionRoute; title?: string }): SingleSession
  save(session: SingleSession): void
}
```

设计说明：

- 与 `WorkflowStore` 一样，使用“一会话一 JSON 文件”的简单持久化方式
- 第一版不提供删除和归档入口，但数据结构保留 `status`
- `title` 默认由首条用户消息自动生成，例如首行截断 40-60 字符

### 6.2 新增 `SingleSessionManager`

职责：

- 管理 `Single` 模式的产品级会话
- 按当前 route 决定继续原 segment 还是创建新 segment
- 协调 `RunManager`、`TranscriptStore`、`SingleSessionStore`
- 对 renderer 发出单独的 session 事件流

建议接口：

```ts
export class SingleSessionManager {
  listSessions(): SingleSession[]
  createSession(input: { cwd: string; route?: SessionRoute }): SingleSession
  getSessionDetail(id: string): SingleSessionDetail
  sendMessage(input: {
    sessionId: string
    text: string
    route: SessionRoute
    cwd: string
    appendSystemPrompt?: string
    apiProviderId?: string
    model?: string
  }): Promise<SingleSession>
  abortSessionRun(sessionId: string): void
}
```

### 6.3 Session continuation 决策规则

#### 6.3.1 Route 未变化

条件：`route.fingerprint` 与当前 active segment 一致。

处理顺序：

1. 如果存在 live resident process 且 adapter 支持 `bidirectionalStdin`  
   则直接 `runManager.push()`
2. 否则如果 active segment 存在 `nativeSessionId` 且 adapter 支持 `nativeResume`  
   则生成 `resumeFrom`
3. 否则  
   从逻辑会话历史生成 replay prompt，创建新的底层 run

#### 6.3.2 Route 变化（切模型 / 切 Agent / 切 provider）

条件：`route.fingerprint` 变化。

处理规则：

- 逻辑会话不变
- 当前 active segment 结束为 `idle`
- 创建新的 `SessionSegment`
- 新 segment 一律以逻辑会话历史回放为起点
- 新模型从该逻辑会话当前最新上下文继续接手

这条规则解决了“同一会话内允许切模型”的核心问题。

#### 6.3.3 原生 resume 失败

现有 `RunManager` 已支持 resume failure fallback。  
本次需要将 fallback 语义从“单个底层 session 回放”提升为“逻辑会话回放优先”。

建议新增主进程 helper：

```ts
buildLogicalSessionReplayPrompt(
  session: ConversationState,
  transcriptStore: TranscriptStore,
  newText: string
): string
```

### 6.4 `TranscriptStore` 扩展

当前 `TranscriptStore` 只能按单个底层 `sessionId` 回放。  
`Single Session` 的逻辑会话需要跨多个 segment 聚合 transcript。

建议新增：

```ts
readSessionTimeline(sessionIds: string[]): TranscriptRecord[]

buildReplayPromptFromTimeline(
  sessionIds: string[],
  newText: string
): string
```

关键要求：

- 按 segment 顺序聚合，而不是按文件名
- 只抽取对多轮有效的 `user` / `assistant message`
- 系统噪声（stderr、permission request、resume warning）默认不进入 replay prompt

### 6.5 `Single` renderer 形态调整

`SingleRunPanel` 需要从“两栏配置 + runtime”升级为“会话列表 + 当前会话 + 配置抽屉/侧栏”。

第一版保留以下操作：

- 新建会话
- 切换会话
- 继续当前会话

不做：

- 会话搜索
- 重命名
- 删除
- 归档入口

建议布局：

```text
ModeRail | SingleSessionSidebar | Session Runtime | Config Drawer
```

说明：

- `SingleSessionSidebar` 风格可直接复用 `WorkflowRunsList / TemplatesView` 的侧栏结构
- 当前会话顶部显示：标题、当前模型、cwd、运行状态
- 会话切换时，如当前会话有 live run，先提示用户停止后再切换

### 6.6 `useRun` 的角色调整

当前 `useRun` 只管理“一个临时 run 的生命周期”。  
本次后，`Single` 产品层不再直接依赖 `useRun` 作为一等状态源。

建议：

- 新增 `useSingleSessions`
- `useRun` 可保留为底层/测试辅助 hook，或逐步退场

建议 renderer hook：

```ts
export function useSingleSessions() {
  return {
    sessions,
    selectedSession,
    createSession,
    selectSession,
    sendMessage,
    abortSession
  }
}
```

### 6.7 `Workflow` 的统一方式

本次不引入 `Workflow` 全局会话列表。  
统一点只放在 conversation contract 和 continuation policy。

#### 6.7.1 语义规则

- 一个 `interactive step execution` 拥有一个 `ConversationState`
- 同一步骤内继续追问/澄清，仍然写回同一个 conversation
- `rerun step` 创建新的 execution，也创建新的 conversation

#### 6.7.2 行为调整

当前 `WorkflowManager.pushInput()` 在某些场景下会新建一个新的 `WorkflowStepExecution`。  
本次需要区分：

- `继续当前 interactive 会话`：沿用当前 execution 的 `conversation`
- `rerun step`：新建 execution + 新 conversation

这可以保持“产品需求讨论”这类 interactive step 的多轮记录连续。

### 6.8 Codex adapter 修正

当前 `CodexAdapter` 注释声称支持 `--resume`，但实际参数构造没有传恢复参数。  
根据本地 CLI 帮助，正确调用形态应为：

```bash
codex exec resume <SESSION_ID> <PROMPT> --json ...
```

因此需要：

- 将 `buildCodexExecArgs()` 拆分为 `start` 与 `resume` 两种构造
- 当 `resumeFrom` 存在时，使用 `exec resume`

建议：

```ts
function buildCodexExecResumeArgs(input: CodexExecArgsInput, sessionId: string, prompt: string): string[]
```

### 6.9 API 模式 continuation 策略

API 模式第一版不做 native session 恢复。  
统一采用：

- 每轮由 App 主进程基于逻辑会话构建 replay prompt
- 再调用现有 `ApiAdapter.runTurn()`

优点：

- 不需要一次性重写为 message array engine
- 与“同一逻辑会话切模型”天然兼容

缺点：

- token 成本高于真正 message-based history

但这适合本次范围。

## 7. 文件清单

### 7.1 新增文件

- `src/main/SingleSessionStore.ts`  
  `Single Session` 元数据存储

- `src/main/SingleSessionManager.ts`  
  `Single` 模式主进程会话编排器

- `src/renderer/src/useSingleSessions.ts`  
  `Single` 会话列表与当前会话 hook

- `src/renderer/src/SingleSessionSidebar.tsx`  
  左侧会话列表 UI

- `tests/session-mode.test.mjs`  
  Session contract / source-contract tests

### 7.2 修改文件

- `src/shared/types.ts`  
  新增 session/conversation/segment 类型与 IPC 声明

- `src/preload/index.ts`  
  暴露 single session IPC

- `src/main/ipc.ts`  
  注册 `SingleSessionManager` 与对应 IPC / event 转发

- `src/main/TranscriptStore.ts`  
  支持按逻辑会话聚合 timeline 与 replay

- `src/main/RunManager.ts`  
  将 resume fallback 与逻辑会话 helper 更好协同

- `src/main/adapters/types.ts`  
  capability 增加 `nativeResume`

- `src/main/adapters/claudeAdapter.ts`  
  显式声明 native resume 能力；保持 resident stdin 逻辑

- `src/main/adapters/codexAdapter.ts`  
  支持 `exec resume`

- `src/main/adapters/codexArgs.ts`  
  拆分 start/resume 参数构造

- `src/main/WorkflowManager.ts`  
  interactive step conversation 正规化，避免误把“继续聊天”当 rerun

- `src/renderer/src/App.tsx`  
  `Single` 模式改用 `useSingleSessions`

- `src/renderer/src/SingleRunPanel.tsx`  
  接入会话列表与新会话 UX

- `src/renderer/src/WorkflowWorkspace.tsx`  
  保持 step conversation 继续逻辑与新 contract 一致

- `src/renderer/src/styles.css`  
  增加 `Single` 会话列表布局样式

### 7.3 可能需要补充修改的文件

- `tests/interactive-mode.test.mjs`
- `tests/api-mode-contract.test.mjs`
- `tests/memory-references-ui.test.mjs`
- `tests/workflow-ui-layout.test.mjs`

## 8. 实施阶段

### 阶段 A：共享契约与持久化层（1 天）

- 新增 `SessionScope / SessionStatus / ConversationState / SessionSegment`
- 新增 `SingleSessionStore`
- 新增 Single session IPC contract

### 阶段 B：主进程 Single 会话编排（1.5 天）

- 新增 `SingleSessionManager`
- 接通 `RunManager + TranscriptStore`
- 打通 `新建 / 继续 / 切换` 的主进程会话流

### 阶段 C：vendor continuation 修正（1 天）

- `Codex` 改为 `exec resume`
- `API` 固化为 history replay
- 统一 native resume failure fallback

### 阶段 D：Single UI 升级（1.5 天）

- 会话列表侧栏
- 当前会话标题 / 状态 / 继续发送
- 切会话时的运行保护

### 阶段 E：Workflow interactive 会话统一（1.5 天）

- step conversation 正规化
- 继续聊天与 rerun 分离
- 保持不进入全局列表

### 阶段 F：测试与收尾（1 天）

- source-contract tests
- focused runtime tests
- typecheck / build / 手动体验回归

总估算：约 `6.5 天`

## 9. 测试策略

### 9.1 单元 / source-contract 测试

新增或扩展以下断言：

- `SingleSession` 共享类型与 IPC 定义存在
- `SingleSessionManager` 具备 `create/list/send/abort`
- `WorkflowStepExecution` 增加 `conversation`
- `CodexAdapter` 在 `resumeFrom` 存在时走 `exec resume`
- `SingleRunPanel` 渲染会话列表入口

### 9.2 集成测试

至少覆盖以下场景：

1. `Single` 新建会话 -> 第一轮对话 -> 第二轮继续  
2. `Single` 同一会话切模型 -> 新模型看到前情 -> 继续输出  
3. `Single` 原生 resume 失败 -> 自动 fallback 到 replay  
4. `Workflow interactive step` 多轮追问 -> 仍归属同一 conversation  
5. `Workflow rerun step` -> 创建新的 conversation，而不是污染旧会话  

### 9.3 手动测试

- 打开 `Single`，确认左侧能创建和切换会话
- 关闭 App 再打开，旧会话仍在
- 同一会话在 `Claude -> Codex -> API` 间切换，聊天仍连续
- 在 `Workflow` 中创建一个需求澄清 step，确认多轮消息持续聚合
- 确认 `Workflow step 会话` 不出现在 `Single` 左侧会话列表

## 10. 风险缓解

### 风险 1：跨模型逻辑会话与底层原生 session 语义冲突

缓解：

- 明确采用“逻辑会话不变，切模型新建 segment”的规则
- 不尝试跨模型复用原生 `sessionId`

### 风险 2：逻辑会话历史回放越来越长

缓解：

- 第一版保留最近 N 轮的 replay 截断机制
- 长期再引入 summary / memory

### 风险 3：Workflow 继续聊天与 rerun 语义混淆

缓解：

- 在数据结构上把 `conversation` 与 `execution` 关系说清
- 只有显式 rerun 才新建 execution

### 风险 4：Single 与旧 `useRun` 并存时状态双轨

缓解：

- `Single` UI 全量切到 `useSingleSessions`
- `useRun` 只保留为底层/测试辅助，不再作为产品态主入口

## 11. 后续规划

以下功能明确不在本次范围内：

- `Single Session` 搜索
- `Single Session` 重命名
- `Single Session` 删除
- `Single Session` 归档 UI
- 导入导出包含 `Single Session`
- 跨会话 memory / semantic recall
- 类似 Claude Desktop 的 chat search
- 将 `API` 模式升级为真正 message-array 的持久对话引擎

本次只解决：

- 会话列表
- 真正多轮
- 同一逻辑会话切模型
- `Workflow interactive step` 统一会话模型

## 12. UI 规格

### 12.1 Single 会话型主界面（任务 7）

- **确认方案**：`Single 会话型主界面布局` 采用方案 B，`Single 会话列表样式` 采用方案 A
- **设计参考**：`ui-session-mode-designs.html`
  - `single-workspace`：方案 B
  - `single-session-list`：方案 A
- **布局结构**：
  - `ModeRail`
  - `SingleSessionSidebar`
  - `Single 会话主区`
- **不采用**：独立第四栏固定配置面板
- **组件结构**：
  - 左侧 `SingleSessionSidebar`：
    - 顶部标题 + `新建会话` 按钮
    - 下方卡片式会话列表
  - 右侧当前会话主区：
    - 顶部会话头部
    - 中部 transcript
    - 底部 composer
- **会话卡片内容**：
  - 会话标题
  - 当前 route / 模型摘要
  - 最近更新时间
  - 一行 preview
- **建议 CSS 类名**：
  - `single-session-sidebar`
  - `single-session-sidebar-head`
  - `single-session-cards`
  - `single-session-card`
  - `single-session-card-active`
  - `single-session-card-meta`
  - `single-session-card-preview`
- **交互状态**：
  - 当前选中卡片高亮
  - `live run` 会话切换前先拦截确认
  - `Workflow step` 会话不得显示在此列表中

### 12.2 同一会话切模型提示（任务 8）

- **确认方案**：方案 A — 顶部 Banner 明示切换
- **设计参考**：`ui-session-mode-designs.html`
  - `route-switch-feedback`：方案 A
- **组件结构**：
  - 放置在当前会话头部下方的 banner
  - 右上仍保留当前 route / model pill
- **展示规则**：
  - 逻辑会话保持不变
  - route 切换后，banner 明确提示“后续由新模型接手”
  - banner 中需显示来源模型与目标模型
- **建议 CSS 类名**：
  - `single-session-banner`
  - `single-session-banner-meta`
  - `single-session-banner-route`
- **交互状态**：
  - 切模型后下一条消息发送前后均可显示该提示
  - transcript 中可选插入一条辅助 system 记录
  - 不得暗示跨模型仍在复用同一个原生 session

### 12.3 Workflow Step 会话提示（任务 10）

- **确认方案**：方案 A — 顶部 Step 对话条
- **设计参考**：`ui-session-mode-designs.html`
  - `workflow-step-conversation`：方案 A
- **组件结构**：
  - 当前 step transcript 上方固定一条 step conversation bar
  - bar 内部包含：
    - `Step N · 步骤名`
    - 当前状态，如 `INPUT`
    - 当前 step agent / model pill
    - 说明文案
    - `结束对话，进入下一步` 主按钮
- **建议 CSS 类名**：
  - `workflow-step-conversation-bar`
  - `workflow-step-conversation-meta`
  - `workflow-step-conversation-actions`
  - `workflow-step-conversation-status`
- **文案要求**：
  - 明确说明“你正在当前步骤内与 Agent 对话”
  - 明确说明“对话结束后才会进入下一步”
- **交互边界**：
  - 不新增全局会话列表入口
  - 与 `Single` 的会话入口必须视觉上区分

### 12.4 配置入口整合说明

- `Single` 模式中的 `vendor / model / provider / cwd` 不再作为独立固定配置栏存在
- 这些入口统一收敛到当前会话头部区域
- 这样可以保证：
  - `Single` 更像会话型桌面应用
  - 用户主要注意力保持在会话列表与聊天内容上
  - 模型切换与当前会话语义绑定得更紧
