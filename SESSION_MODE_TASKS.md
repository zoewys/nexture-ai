# SESSION_MODE 任务书

## 任务概览

本任务书对应 `SESSION_MODE_SPEC.md`，目标是为 `Agent Studio` 建立统一的会话模式：

- `Single Agent` 升级为真正的会话型桌面体验
- 同一逻辑会话内允许切模型
- `Workflow` 的 interactive step 统一为 step 会话模型
- `Workflow step 会话` 不进入 `Single` 的全局会话列表

## 功能分级

### P0 核心功能

- `Single` 左侧会话列表：新建 / 切换 / 继续
- `Single` 会话持久化
- 同一逻辑会话切模型
- `Codex` 原生 resume 修正
- `Workflow interactive step` 会话模型统一

### P1 增强功能

- 统一 continuation 策略
- 会话标题 / 最近更新时间 / 当前模型元数据
- `Workflow` 中 conversation 与 rerun 分离

### P2 暂不实现

- 会话搜索
- 重命名
- 删除
- 归档 UI
- 跨会话 memory/search

---

## 任务 1：扩展共享类型与 IPC 契约 ✅

**背景**：会话模式需要先建立统一的类型系统和 IPC 入口，主进程和 renderer 才能围绕同一套 session contract 工作。

**具体要求**：

1. 修改 `src/shared/types.ts`，新增以下类型：
   - `SessionScope`
   - `SessionStatus`
   - `SessionContinuationStrategy`
   - `SessionRoute`
   - `SessionSegment`
   - `ConversationState`
   - `SingleSession`
   - `SingleSessionDetail`
2. 扩展 `AdapterCapabilities`，增加 `nativeResume: boolean`
3. 为 `WorkflowStepExecution` 增加可选 `conversation?: ConversationState`
4. 新增 Single Session IPC 常量与对应 payload 类型：
   - `singleSessionsList`
   - `singleSessionCreate`
   - `singleSessionGet`
   - `singleSessionSend`
   - `singleSessionAbort`
   - `singleSessionEvent`
5. 定义主进程到 renderer 的事件 envelope，用于广播 Single Session 的状态更新和嵌套 agent event

**参考文件**：
- `src/shared/types.ts` — 现有 `RunConfig`、`WorkflowRun`、`WorkflowStepExecution` 定义
- `src/shared/types.ts` — 现有 `IPC`、`RunEventEnvelope`、`WorkflowEventEnvelope` 模式

**验证命令**：
```bash
pnpm run typecheck
```

**测试用例**：
- 类型文件中能找到新增的 `SingleSession` / `ConversationState`
- `AdapterCapabilities` 包含 `nativeResume`
- IPC 常量中包含新的 `singleSession*` 通道

**依赖关系**：无，最先实现

**适合 AI Agent 直接执行**：✅

---

## 任务 2：实现 SingleSessionStore 持久化层 ✅

**背景**：`Single` 目前没有会话元数据存储，只有底层 transcript 文件。需要一层产品级会话存储，保存列表、标题、状态和当前路由。

**具体要求**：

1. 新建 `src/main/SingleSessionStore.ts`
2. 存储位置使用 `app.getPath('userData')/single-sessions/`
3. 持久化格式为“一会话一 JSON 文件”，与 `WorkflowStore` 的 run 存储模式保持一致
4. 暴露以下方法：
   - `list(): SingleSession[]`
   - `get(id: string): SingleSession | null`
   - `create(input: { cwd: string; route?: SessionRoute; title?: string }): SingleSession`
   - `save(session: SingleSession): void`
5. `create()` 默认生成：
   - `status: 'active'`
   - 空的 `ConversationState`
   - 默认标题（如 `New Session`）
6. 第一版不实现删除和归档 API，但数据结构中保留 `status`

**参考文件**：
- `src/main/WorkflowStore.ts` — 一文件一 JSON 的存储模式
- `src/main/AgentStore.ts` — 同步读写风格

**验证命令**：
```bash
pnpm run typecheck
node --test tests/session-mode.test.mjs
```

**测试用例**：
- `create()` 后能在 `single-sessions/` 下生成对应 JSON
- `list()` 返回按更新时间倒序排列的会话
- `save()` 更新标题 / 状态 / 路由后可重新读取

**依赖关系**：依赖任务 1

**适合 AI Agent 直接执行**：✅

---

## 任务 3：扩展 TranscriptStore 支持逻辑会话回放 ✅

**背景**：当前 `TranscriptStore` 只能按单个底层 `sessionId` 回放。逻辑会话跨模型后会产生多个 segment，需要聚合多个 transcript。

**具体要求**：

1. 修改 `src/main/TranscriptStore.ts`
2. 保持现有 `record()` / `recordUserInput()` / `buildResumePrompt()` 兼容
3. 新增能力：
   - `readSessionTimeline(sessionIds: string[]): TranscriptRecord[]`
   - `buildReplayPromptFromTimeline(sessionIds: string[], newText: string): string`
4. 聚合策略：
   - 按传入的 `sessionIds` 顺序拼接
   - 只抽取 `user` 记录和 `message` 事件
   - 默认忽略 `stderr`、`system`、`permission` 一类噪声事件
5. 保留最近 N 轮的截断逻辑，避免 replay prompt 无限增长
6. 生成的 replay prompt 需要明确告诉模型：“这是继续之前的逻辑会话”

**参考文件**：
- `src/main/TranscriptStore.ts` — 现有单 session 回放逻辑
- `src/main/RunManager.ts` — resume failure fallback 的接入点

**验证命令**：
```bash
pnpm run typecheck
node --test tests/session-mode.test.mjs tests/transcript-scroll.test.mjs
```

**测试用例**：
- 多个 transcript sessionId 按顺序聚合后，prompt 中用户/助手顺序正确
- 噪声事件不会进入 replay prompt
- 历史过长时会被截断而非全部拼接

**依赖关系**：依赖任务 1

**适合 AI Agent 直接执行**：✅

---

## 任务 4：实现 SingleSessionManager 与主进程 continuation 策略 ✅

**背景**：`Single` 需要从“当前 run 状态”升级为“主进程管理的多轮逻辑会话”。这一层负责决定是直接 push、原生 resume，还是回放历史后开新 segment。

**具体要求**：

1. 新建 `src/main/SingleSessionManager.ts`
2. 构造时注入：
   - `SingleSessionStore`
   - `RunManager`
   - `TranscriptStore`
   - `MemoryInjector`
   - 事件发射函数
3. 实现：
   - `listSessions()`
   - `createSession()`
   - `getSessionDetail()`
   - `sendMessage()`
   - `abortSessionRun()`
4. `sendMessage()` continuation 决策：
   - route 未变化 + 有 live resident process：`runManager.push()`
   - route 未变化 + 有 `nativeSessionId` + adapter 支持 `nativeResume`：走 `resumeFrom`
   - route 变化：创建新 `SessionSegment`，用逻辑会话 replay prompt 启动
   - route 未变化但原生 resume 失败：自动 fallback 到 logic replay
5. 同一逻辑会话切模型的规则必须明确：
   - 会话 ID 不变
   - active segment 切换
   - 新模型接手同一条会话
6. 会话标题自动更新策略：
   - 若标题仍为默认值，则首条用户输入后根据内容生成标题
7. 会话 preview 自动更新策略：
   - 取最后一条用户输入或助手回复的截断内容

**参考文件**：
- `src/main/RunManager.ts` — 单轮执行与 resume fallback
- `src/main/ipc.ts` — 现有 runStart / runPush / runAbort 注册方式
- `src/main/WorkflowManager.ts` — 主进程编排器写法参考

**验证命令**：
```bash
pnpm run typecheck
node --test tests/session-mode.test.mjs
```

**测试用例**：
- 新建会话后发送第一条消息，会创建首个 segment
- 同模型继续时优先沿用原 continuation 策略
- 切模型后创建新 segment，但 `SingleSession.id` 不变
- 原生 resume 失败时自动切到 replay

**依赖关系**：依赖任务 1、2、3

**适合 AI Agent 直接执行**：✅

---

## 任务 5：修正 adapter continuation 能力（Claude / Codex / API）✅

**背景**：当前跨 vendor 的续聊能力不一致，是会话模式最核心的底层缺口。

**具体要求**：

1. 修改 `src/main/adapters/types.ts`
   - 为 `AdapterCapabilities` 补 `nativeResume`
2. 修改 `src/main/adapters/claudeAdapter.ts`
   - 声明 `nativeResume: true`
   - 保持现有 resident stdin 行为
3. 修改 `src/main/adapters/codexArgs.ts`
   - 将参数构造拆分为“初始执行”和“恢复执行”两种
4. 修改 `src/main/adapters/codexAdapter.ts`
   - 当 `resumeFrom` 存在时，改用 `codex exec resume <SESSION_ID> <PROMPT>`
   - 保留 `--json`、`--model`、`--dangerously-bypass-approvals-and-sandbox`、`--skip-git-repo-check` 等参数
5. 修改 `src/main/adapters/apiAdapter.ts`
   - 声明 `nativeResume: false`
   - 保持“单轮执行 + App 层 replay”策略，不在 adapter 内新增伪 resume
6. 修改 `src/main/RunManager.ts`
   - continuation 失败提示文案保持兼容
   - 为 `SingleSessionManager` / `WorkflowManager` 提供更明确的 resume 失败判断边界

**参考文件**：
- `src/main/adapters/claudeAdapter.ts`
- `src/main/adapters/codexAdapter.ts`
- `src/main/adapters/codexArgs.ts`
- `src/main/adapters/apiAdapter.ts`
- `src/main/RunManager.ts`

**验证命令**：
```bash
pnpm run typecheck
node --test tests/session-mode.test.mjs tests/api-adapter.test.mjs tests/api-mode-contract.test.mjs tests/codex-stderr-noise.test.mjs
```

**测试用例**：
- `Claude` capability 中存在 `nativeResume: true`
- `Codex` 在 `resumeFrom` 存在时构造 `exec resume`
- `API` capability 中 `nativeResume: false`
- resume 失败仍会触发 fallback 提示

**依赖关系**：依赖任务 1、3、4

**适合 AI Agent 直接执行**：✅

---

## 任务 6：接通 Single Session 的 IPC / preload / renderer hook ✅

**背景**：主进程会话层建好后，需要从 renderer 能拿到会话列表、当前会话详情和消息发送能力。

**具体要求**：

1. 修改 `src/main/ipc.ts`
   - 初始化 `SingleSessionStore` 和 `SingleSessionManager`
   - 注册 Single Session IPC handler
   - 提供 session event 转发给 renderer
2. 修改 `src/preload/index.ts`
   - 暴露对应 API：
     - `listSingleSessions`
     - `createSingleSession`
     - `getSingleSession`
     - `sendSingleSessionMessage`
     - `abortSingleSession`
     - `onSingleSessionEvent`
3. 新建 `src/renderer/src/useSingleSessions.ts`
   - 在 mount 时加载 session 列表
   - 支持创建、选择、发送、停止
   - 当前选中会话变更时自动拉取详情
   - 订阅主进程 event，增量更新列表与详情
4. `useSingleSessions` 需要暴露：
   - `sessions`
   - `selectedSession`
   - `selectedSessionId`
   - `createSession`
   - `selectSession`
   - `sendMessage`
   - `abortSession`

**参考文件**：
- `src/preload/index.ts` — `runStart / workflowStart` 的桥接方式
- `src/renderer/src/useWorkflows.ts` — 列表 + 详情 + 事件订阅的模式
- `src/renderer/src/useAgents.ts` — 简单 CRUD hook 模式

**验证命令**：
```bash
pnpm run typecheck
node --test tests/session-mode.test.mjs
```

**测试用例**：
- renderer API 暴露了 Single Session 通道
- `useSingleSessions` 能加载列表并响应主进程事件
- 发送消息后当前会话详情更新

**依赖关系**：依赖任务 1、2、4

**适合 AI Agent 直接执行**：✅

---

## 任务 7：升级 Single 模式 UI 为“会话型桌面布局” ✅

**背景**：`Single` 当前是“配置栏 + transcript”的单次运行面板，不像桌面端会话 App。需要增加左侧会话列表和当前会话头部。

**具体要求**：

1. 新建 `src/renderer/src/SingleSessionSidebar.tsx`
2. 修改 `src/renderer/src/App.tsx`
   - `single` 模式改用 `useSingleSessions`
   - 传入当前会话、会话列表和发送接口
3. 修改 `src/renderer/src/SingleRunPanel.tsx`
   - 改造成“会话列表 + 当前会话 + 配置抽屉/侧栏”的结构
   - 不再以 `useRun.state.events` 作为唯一数据源
4. 第一版必须支持：
   - 新建会话
   - 选择旧会话
   - 在当前会话内继续聊天
   - 当前会话显示标题、当前模型、项目目录、运行状态
5. 用户切到另一个会话时：
   - 如果当前会话有 live run，先提示停止或取消切换
6. 会话列表不显示：
   - `Workflow step` 会话
   - 归档/删除入口

**确认的 UI 方案**：方案 B + 方案 A

- `Single 会话型主界面布局`：方案 B — 会话列表更宽，配置并入聊天头部
- `Single 会话列表样式`：方案 A — 卡片式列表

**补充实现细节**：

1. `Single` 主界面改为三栏：
   - `ModeRail`
   - `SingleSessionSidebar`
   - `Single 会话主区`
2. 不再保留独立的第四栏固定配置面板；原 `vendor / model / provider / cwd` 相关配置并入当前会话头部
3. 会话列表使用卡片式样式，而不是纯文本行列表：
   - 建议外层类名：`single-session-sidebar`
   - 建议列表容器：`single-session-cards`
   - 建议单卡片：`single-session-card`
   - 激活态卡片：`single-session-card-active`
4. 每张会话卡片至少展示：
   - 标题
   - 当前接手模型或 route 摘要
   - 最近更新时间
   - 一行 preview
5. 当前会话头部需支持：
   - 会话标题
   - 当前 route / model pill
   - 项目目录摘要
   - 直接切换 vendor / model / provider 的入口
6. `新建会话` 按钮固定在会话列表头部，不放入聊天头部
7. `Workflow step` 会话仍不得出现在该侧栏中

**参考文件**：
- `src/renderer/src/WorkflowRunsList.tsx` — 左侧列表形态参考
- `src/renderer/src/TemplatesView.tsx` — 侧栏布局与折叠模式参考
- `src/renderer/src/SingleRunPanel.tsx` — 当前运行区与 Composer 参考
- `ui-session-mode-designs.html` — `single-workspace` 方案 B + `single-session-list` 方案 A

**验证命令**：
```bash
pnpm run typecheck
pnpm build
```

**测试用例**：
- 新建会话后左侧立即出现新项并选中
- 切换旧会话后 transcript 正确切换
- 当前会话头部能显示模型与状态
- 正在运行时切会话会出现保护提示

**依赖关系**：依赖任务 6

**适合 AI Agent 直接执行**：✅

---

## 任务 8：统一 Single 内“切模型继续同一会话”的交互与状态展示 ✅

**背景**：你已经确认“同一逻辑会话内允许切模型”。UI 需要把这件事表达清楚，否则用户会误以为换模型等于换会话。

**具体要求**：

1. 修改 `src/renderer/src/SingleRunPanel.tsx`
2. 在当前会话头部或消息区增加“当前接手模型”的明确提示
3. 当用户切换 vendor / model / provider 后再发送消息时：
   - 不新建逻辑会话
   - 但 UI 要提示“后续由新模型继续当前话题”
4. 如果 route 变化导致新建底层 segment：
   - transcript 中可插入一条简短 system 分割提示
   - 文案要说明“模型已切换，会话保持不变”
5. 避免让用户误解为“当前旧模型的原生 session 仍被复用”

**确认的 UI 方案**：方案 A — 顶部 Banner 明示切换

**补充实现细节**：

1. 模型切换反馈放在当前会话头部 banner，而不是只放进 transcript
2. 建议新增：
   - `single-session-banner`
   - `single-session-banner-active-route`
   - `single-session-banner-meta`
3. 当用户改变 `vendor / model / provider` 后，下一次发送消息前后需要满足：
   - 当前逻辑会话 ID 不变
   - 会话头部 banner 明确说明“当前话题不变，后续由新模型接手”
   - banner 文案需要包含来源模型与目标模型
4. transcript 中可以保留一条轻量 system 记录，但它只是辅助；主提示必须在顶部 banner
5. UI 不得暗示“跨模型仍在复用同一个原生 sessionId”

**参考文件**：
- `src/renderer/src/SingleRunPanel.tsx`
- `src/renderer/src/TranscriptViewer.tsx`
- `ui-session-mode-designs.html` — `route-switch-feedback` 方案 A

**验证命令**：
```bash
pnpm run typecheck
pnpm build
```

**测试用例**：
- 同一会话切模型后，UI 仍停留在当前会话
- transcript 中能看出接手模型变化
- 后续回复继续追加到同一会话而非新列表项

**依赖关系**：依赖任务 4、6、7

**适合 AI Agent 直接执行**：✅

---

## 任务 9：正规化 Workflow interactive step 的会话模型 ✅

**背景**：`Workflow` 目前已经能多轮，但还需要正式纳入统一会话抽象，并明确“继续聊天”和“rerun step”是两回事。

**具体要求**：

1. 修改 `src/main/WorkflowManager.ts`
2. 为 `interactive step execution` 维护 `conversation: ConversationState`
3. 区分两种行为：
   - `pushInput` 继续当前 interactive 会话：沿用当前 execution 的 conversation
   - `rerunStep`：新建 execution + 新 conversation
4. 保持以下已有能力不回退：
   - `awaiting-input`
   - `finishInteractiveStep`
   - 手动结束对话后进入下一步
5. 明确保证：
   - `Workflow step 会话` 不会进入 Single 的 session list
   - 一个 run 中不同时刻的 step conversation 仍可独立查看

**参考文件**：
- `src/main/WorkflowManager.ts` — 现有 `pushInput()`、`finishInteractiveStep()`、`enterAwaitingInput()`
- `src/shared/types.ts` — `WorkflowStepExecution`
- `tests/interactive-mode.test.mjs` — 现有 interactive step source-contract 测试

**验证命令**：
```bash
pnpm run typecheck
node --test tests/interactive-mode.test.mjs tests/session-mode.test.mjs tests/workflow-runs-state.test.mjs
```

**测试用例**：
- interactive step 多轮输入都落在同一 conversation
- rerun step 后出现新的 execution 和新的 conversation
- `Workflow step` 会话不会出现在 Single session 列表

**依赖关系**：依赖任务 1、3、4

**适合 AI Agent 直接执行**：✅

---

## 任务 10：补充 Workflow 运行视图中的会话提示与文案 ✅

**背景**：既然 `Workflow` 的 interactive step 也被定义为正式会话，需要在运行视图中把“当前是在 step 会话里聊天”表达得更清楚。

**具体要求**：

1. 修改 `src/renderer/src/WorkflowWorkspace.tsx`
2. 修改 `src/renderer/src/WorkflowRunDetail.tsx`
3. 目标效果：
   - 在 interactive step 中，用户能明确感知“你正在当前步骤内与 Agent 对话”
   - 与 `Single` 会话列表体验区分开，不造成入口混淆
4. 建议至少补充：
   - 当前 step 会话状态提示
   - 当前 step 所属 agent / 模型提示
   - 结束对话进入下一步的按钮语义优化
5. 保持不新增全局 session list 入口

**确认的 UI 方案**：方案 A — 顶部 Step 对话条

**补充实现细节**：

1. 在当前 step transcript 上方增加固定的 step conversation 顶部条，而不是把说明挪到右侧说明卡
2. 顶部条至少包含：
   - `Step N · 步骤名`
   - 当前状态，例如 `INPUT`
   - 当前 step agent / model pill
   - 一句解释：你正在当前步骤内与 Agent 对话；对话结束后才会进入下一步
3. 建议新增：
   - `workflow-step-conversation-bar`
   - `workflow-step-conversation-meta`
   - `workflow-step-conversation-actions`
4. `结束对话，进入下一步` 作为顶部条内的主按钮保留
5. 该提示条必须明确区分 `Workflow step 会话` 与 `Single` 的全局会话，不新增全局列表入口

**参考文件**：
- `src/renderer/src/WorkflowWorkspace.tsx`
- `src/renderer/src/WorkflowRunDetail.tsx`
- `ui-session-mode-designs.html` — `workflow-step-conversation` 方案 A

**验证命令**：
```bash
pnpm run typecheck
pnpm build
```

**测试用例**：
- interactive step 状态提示与 `Single` 不混淆
- 用户能明确看到“结束对话，进入下一步”的行为边界
- workflow 运行视图不出现全局会话列表

**依赖关系**：依赖任务 9

**适合 AI Agent 直接执行**：✅

---

## 任务 11：补充测试与端到端验证 ✅

**背景**：本次功能跨越 shared types、main process、renderer、workflow 和多 vendor continuation，必须补足自动验证。

**具体要求**：

1. 新建或扩展 `tests/session-mode.test.mjs`
2. 覆盖以下断言：
   - 新增类型与 IPC 通道存在
   - `SingleSessionStore` / `SingleSessionManager` 存在
   - `Codex` 使用 `exec resume`
   - `API` 标记为 `nativeResume: false`
   - `SingleRunPanel` / `App` 引入会话列表
   - `WorkflowStepExecution` 存在 `conversation`
3. 复用并扩展以下测试文件：
   - `tests/interactive-mode.test.mjs`
   - `tests/api-mode-contract.test.mjs`
   - `tests/workflow-ui-layout.test.mjs`
4. 最后执行全量校验：
   - `pnpm test`
   - `pnpm run typecheck`
   - `pnpm build`

**参考文件**：
- `tests/interactive-mode.test.mjs`
- `tests/api-mode-contract.test.mjs`
- `tests/workflow-ui-layout.test.mjs`
- `tests/memory-references-ui.test.mjs`

**验证命令**：
```bash
pnpm test
pnpm run typecheck
pnpm build
```

**测试用例**：
- Single 新建 / 切换 / 继续会话
- 同一会话切模型
- resume fallback
- Workflow step conversation 与 rerun 分离

**依赖关系**：依赖任务 1-10

**适合 AI Agent 直接执行**：✅

---

## 依赖关系总结

```text
任务 1
 ├── 任务 2
 ├── 任务 3
 └── 任务 5

任务 2 + 3
 └── 任务 4

任务 4 + 5
 └── 任务 6

任务 6
 └── 任务 7
      └── 任务 8

任务 4
 └── 任务 9
      └── 任务 10

任务 1-10
 └── 任务 11
```

## 并行执行建议

最大并行度建议为 `2`：

- 并行组 A：
  - 任务 2（SingleSessionStore）
  - 任务 3（TranscriptStore 扩展）

- 并行组 B：
  - 任务 7（Single UI）
  - 任务 9（Workflow conversation 统一）
  - 前提是任务 6 与 4 已完成

## 执行顺序建议

1. 任务 1
2. 任务 2、3（可并行）
3. 任务 4
4. 任务 5
5. 任务 6
6. 任务 7
7. 任务 8
8. 任务 9
9. 任务 10
10. 任务 11

## UI 选择已确认

本任务书对应的 UI 选型已确认并回写：

- 任务 7：`Single 会话型主界面布局` 采用方案 B，`会话列表样式` 采用方案 A
- 任务 8：`同一会话切模型的提示方式` 采用方案 A
- 任务 10：`Workflow Step 会话提示方式` 采用方案 A

执行这些任务时，统一参考：

- `ui-session-mode-designs.html`
- `SESSION_MODE_SPEC.md` 末尾 `UI 规格` 章节
