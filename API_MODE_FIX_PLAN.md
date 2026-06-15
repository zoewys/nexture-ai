# API 模式修复计划

> 目标：让 API 模式（DeepSeek / Kimi / GLM 等第三方模型）达到接近 Claude Code 的可用度。
> 本文档逐项与用户对齐后填写，作为后续实施依据。

## 背景

API 模式当前能 build / typecheck / 跑通测试，但实际"用不了"——模型拿到一句话 + 一堆工具定义，不知道自己是 coding agent，往往直接聊天而不主动调用工具编辑文件。

核心代码位置：`src/main/adapters/apiAdapter.ts`

---

## 问题清单与对齐结论

| # | 问题 | 影响 | 对齐结论 |
|---|------|------|----------|
| 1 | 没有基础 system prompt | 致命 | ✅ 纳入。完整版 + 领域中立（不限定 coding agent）。分层：base 核心指令始终在 + agent.systemPrompt 追加 |
| 2 | 没有环境上下文注入（cwd/OS/日期/目录） | 高 | ✅ 纳入。cwd+OS+日期 + git 状态 + 顶层目录(深度1) + CLAUDE.md/AGENTS.md + addDirs。记忆已由 MemoryInjector 注入，不在本项范围 |
| 3 | 跨轮次无结构化消息历史（prompt 字符串而非 messages） | 中 | ✅ 纳入。方案 C：新增结构化读取函数构造 messages 数组，adapter 改用 messages:。磁盘数据已全，不动存储 |
| 4 | 工具集少于 Claude Code + 现有工具有 bug | 中 | ✅ 纳入。新增：LS 工具 / file_edit 多处编辑 / bash 持久 shell 状态。并修复现有工具 bug（见下） |
| 5 | 没有 prompt caching（anthropic 格式尤其贵/慢） | 中 | ✅ 纳入。全格式处理：anthropic 加 cache_control；openai-compatible 多数自动缓存，能显式则显式 |
| 6 | 没设 maxOutputTokens（长回复被截断） | 中 | ✅ 纳入。adapter 给较大默认值；ApiProviderConfig 加可配置字段 + ProviderSettings UI |
| 7 | 工具描述太单薄（一句话中文，小模型难正确调用） | 中 | ✅ 纳入。重写所有 9+3 个工具及参数描述：何时用/何时不用/参数含义/注意事项。语言与 #1 统一 |
| 8 | 其它：无 thinking 事件 / 图片附件仅拼路径 / todo 不渲染 UI | 低 | ✅ 全部纳入：thinking/reasoning 事件 + 图片附件多模态读取 + todo_write 渲染 UI |
| **9** | **🔴 AI SDK v6 事件映射坏了（已查证 ai@6.0.202）** | **致命** | ✅ 纳入。`step-finish`→`finish-step`（usage 一直丢）；`tool-error`/`abort`/`tool-output-denied` 未处理 |
| **10** | **🔴 流式从不补发完整 message → 多轮/记忆/handoff 读不到 assistant 回复** | **致命** | ✅ 纳入。finish 前聚合 delta 补发 `message`；旧 delta-only transcript 也要能聚合。**修正 #3 的错误判断** |
| **11** | Workflow/scheduled 权限死锁（PermissionGuard 5 分钟超时） | 高 | ✅ 纳入。API 默认 bypassPermissions；headless run 需授权时快速失败 + 写日志，不挂 5 分钟 |
| **12** | `outputSchema` 被 API 静默忽略（workflow handoff 不可靠） | 高 | ✅ 纳入。支持结构化输出则走 structured；否则强化 handoff prompt + parser fallback，日志标记 |
| **13** | 无 API 调用日志（"用不了"无法排查） | 高 | ✅ 纳入。本地 JSONL 日志 + Settings 查看区 + transcript compact 事件。密钥脱敏 |
| **14** | temperature/topP 硬编码且不合理（=1/0.95，对编码太随机）；bash 不上报文件变更 | 中 | ✅ 纳入。默认 0.2/1 且可配置（agent+provider）；bash 执行前后 cwd snapshot diff 上报变更 |

---

## 详细方案

### #1 基础 system prompt（分层 + 领域中立）

**目标**：让没选 agent 的 single agent 默认就具备主动用工具干活的能力；自定义 agent 在此基础上叠加自己的 prompt。

**分层逻辑**（`apiAdapter.ts`）：
```
system = BASE_CORE_PROMPT
       + (input.appendSystemPrompt ? "\n\n" + input.appendSystemPrompt : "")
```
- 没选 agent（manual config）→ 仅 BASE_CORE_PROMPT
- 选了自定义 agent → BASE_CORE_PROMPT + agent.systemPrompt（追加，不覆盖）
- 语义与 Codex adapter 对齐：base 始终在，agent prompt 是增量

**BASE_CORE_PROMPT 设计要点**：
- 定位为「有能力的通用 agent，配备文件/命令/搜索/抓取工具」——**不写死 coding agent**，避免非编码角色别扭
- 完整版，包含：角色与工具总览 / 工具使用规范（文件编辑先 read、并行调用、bash 用途）/ 任务执行（复杂任务用 todo_write、不猜路径先探索）/ 输出风格（简洁、markdown、引用文件位置）/ 安全约束（破坏性操作确认、不泄露密钥）
- 去掉纯 coding 特有内容（commit 规范、README 约定等），这些留给 agent prompt

**改动文件**：`src/main/adapters/apiAdapter.ts`（新增 BASE_CORE_PROMPT 常量 + 拼接逻辑）

**语言**：英文（见文末「全局：语言选择」）

### #2 环境上下文注入

**目标**：让模型知道自己在哪、用什么系统、今天几号、项目长什么样、项目有什么规矩。注入到 **system**（与记忆注入到 prompt 互不冲突）。

**注入内容**（拼成一段 environment context，附加在 BASE_CORE_PROMPT 之后、agent prompt 之前或之后均可）：
- **cwd**：工作目录绝对路径（解决 file_read 相对路径基准问题）
- **OS**：`process.platform` / 版本
- **日期**：今天日期（运行时生成）
- **git 状态**：是否 git 仓库、当前分支、是否有未提交变更（复用现有 `gitSafety.ts` 能力，避免重复实现）
- **目录结构**：仅 cwd 顶层一层（深度 1），大项目不爆 token，深入让模型自己 glob
- **CLAUDE.md / AGENTS.md**：读 cwd 下 CLAUDE.md，找不到则 AGENTS.md，存在就拼入（让 agent 懂具体项目规矩）
- **addDirs**：`RunTurnInput.addDirs` 已有字段但 API adapter 未用；有额外目录时一并声明

**记忆**：已由 `SingleSessionManager.withMemoryContext` → `MemoryInjector` 注入到 prompt，vendor 无关，API 模式已生效。**不在本项范围**。

**改动文件**：
- `src/main/adapters/apiAdapter.ts`（组装 environment context）
- 可能复用 `src/main/gitSafety.ts`（git 状态）
- 注意：`Date.now()` 等运行时信息在 adapter 内生成即可（非 workflow 脚本环境，无限制）

### #3 结构化消息历史（方案 C）

> ⚠️ **修正（来自 Codex 对照）**：原查证结论「磁盘数据已全，不动存储」对 **tool 事件成立，但对 assistant 文本是错的**。
> API 流式回复只产出 `message-delta` 碎片、**从不补发完整 `message`**（见 #10），而 `readSessionTimeline` 只保留 `message`、丢弃所有 delta。
> 所以 **#3 依赖 #10 先落地**：必须先让流式结束时补发完整 `message`（或在读取时聚合 delta），#3 的「结构化重读」才有 assistant 内容可读。

**查证结论（修正后）**：
- 磁盘 `.jsonl` 存了所有 event（`TranscriptStore.record` 不过滤）——tool-call/tool-result 在；但 **assistant 文本只有 message-delta 碎片，无完整 message**
- `readSessionTimeline`（TranscriptStore.ts:79-99）读取时只保留 user + message，丢弃 tool 事件**和所有 delta**；`buildTimelinePrompt` 再拍平成文本、砍到最近 10 轮
- 结构丢失发生在「读取重建」环节；assistant 文本丢失发生在「流式不补 message」环节（#10）。**存储层 record 无需改，但必须先解决 #10**

**方案**：
- 新增 `TranscriptStore.buildReplayMessagesFromTimeline(sessionIds, newText)`：读取时**不过滤** tool 事件、**不拍平**，组装成 AI SDK `ModelMessage[]`：
  - `user` → `{ role: 'user', content }`
  - `message`(assistant) → `{ role: 'assistant', content }`
  - `tool-call` → assistant message 的 `tool-call` part（`toolCallId`/`toolName`/`input`）
  - `tool-result` → `{ role: 'tool', content: [tool-result part] }`（`toolCallId` 配对）
- `apiAdapter.ts` 改用 `messages:` 而非 `prompt:`；当 SingleSessionManager 走 logic-replay 续会时，传 messages 数组
- `SingleSessionManager`：logic-replay 分支为 api vendor 改调新函数（claude/codex 仍用原 prompt 文本路径，因为它们靠 nativeResume，不受影响）

**实现注意（toolCallId 配对）**：
- AI SDK / Anthropic 协议要求 assistant 的 tool_use 后必须紧跟对应 tool_result，靠 `toolCallId` 严格配对，缺失会 400
- event 的 `tool-call.id` / `tool-result.id` 都在，配对可行
- **边界**：某 tool-call 无对应 tool-result（如那轮被 abort）→ 重建时跳过该 tool-call，或补占位 result。必须处理，否则报错
- 同时保留单轮内 AI SDK 自维护的 messages（`stopWhen: stepCountIs`）不受影响——本项只解决「轮与轮之间」

**改动文件**：
- `src/main/TranscriptStore.ts`（新增 buildReplayMessagesFromTimeline）
- `src/main/adapters/apiAdapter.ts`（prompt → messages）
- `src/main/adapters/types.ts`（RunTurnInput 可能需加 messages 字段）
- `src/main/SingleSessionManager.ts`（logic-replay 分支按 vendor 分流）

### #4 工具集增强 + 现有工具修复

#### 4a. 新增工具

**LS 工具**（新文件 `src/main/adapters/api-tools/ls.ts`）：
- 列指定目录的文件/子目录，模型常需要「看看这个目录有什么」
- 支持相对路径（按 cwd 解析，与 file_read 一致）
- 注册进 `index.ts` 的 buildToolSet

**file_edit 多处编辑**（改 `src/main/adapters/api-tools/fileEdit.ts`）：
- 现状只能单次唯一匹配替换（多个匹配报错）
- 增加 edits 数组参数（类 Claude Code MultiEdit）：一次传多个 {old_string,new_string,replace_all}，顺序应用
- 保留单次编辑的向后兼容

**bash 持久 shell 状态**（改 `src/main/adapters/api-tools/bash.ts`）：
- 现状每次 `spawn` 全新进程（bash.ts:29），`cd`/env 不保留
- 改为复用同一 shell 会话，或至少跟踪 cwd 跨命令保留
- 实现注意：常驻 shell 要处理超时/abort/输出截断/进程清理，比无状态复杂；需保证 run abort 时 kill 子进程

#### 4b. 现有工具 bug 修复（确认要修）

**bash 返回对象而非字符串**（bash.ts）：
- 返回 `{exitCode, output}` 对象，AI SDK 对非字符串 tool 返回的序列化各供应商不一，部分模型看到 `[object Object]` 或结构丢失
- 修复：返回格式化字符串（如 `exit code: N\n<output>`），或确保 AI SDK 正确序列化
- 注意：`tests/api-tools.test.mjs:192` 断言返回对象形状，修改后需同步更新测试

**grep ripgrep / node fallback 行为不一致**（grep.ts）：
- ripgrep 路径（grep.ts:38）输出绝对路径、用 rg 的正则方言；node fallback（grep.ts:64）输出相对路径、用 JS RegExp
- 两条路径对同一查询可能给出不同结果格式（路径相对性 + 正则语义），模型行为不可预测
- 修复：统一输出路径相对性（建议都相对 cwd），并在描述里注明正则方言；或 fallback 尽量对齐 rg 输出格式

#### 4c. 其余工具体检（已读，暂不强制改，记录备查）

- `sourcegraph`：依赖 sourcegraph.com 公网，离线/内网不可用——属外部依赖，非 bug
- `fetch`：仅返回原始文本/JSON，无 markdown 转换（format 枚举有 'markdown' 但未实现）——描述与实现不符，建议要么实现要么去掉枚举值
- `todo_write`：每个工具实例内存态、不渲染到 UI（见 #8）

**改动文件**：
- 新增 `src/main/adapters/api-tools/ls.ts`
- 改 `fileEdit.ts` / `bash.ts` / `grep.ts`
- 改 `src/main/adapters/api-tools/index.ts`（注册 ls）
- 改 `tests/api-tools.test.mjs`（bash 返回值断言 + 新增 ls/multi-edit 用例）

### #5 prompt caching（全格式）

**目标**：减少 system + 历史的重复计费与重发延迟，anthropic 格式收益最大。

**anthropic 格式**（`@ai-sdk/anthropic`）：
- 通过 `providerOptions.anthropic.cacheControl`（或 message part 上的 cache_control）给稳定前缀加 breakpoint
- 缓存边界放在 **system prompt 末尾**（BASE_CORE_PROMPT + 环境上下文是每轮最稳定的部分），可选再给历史 messages 的较早部分加一个 breakpoint
- 注意 Anthropic 限制最多 4 个 cache breakpoint，且有最小 token 门槛——前缀太短不缓存

**openai-compatible 格式**（`@ai-sdk/openai` .chat()）：
- 多数第三方（DeepSeek/Kimi 等）**自动**做 prefix caching，无需手动标注——保持 system+历史前缀稳定即可命中
- 若某供应商支持显式缓存参数则显式设置；不支持就依赖自动，不强求
- **关键前提**：缓存命中要求前缀字节级稳定。所以环境上下文里的「日期」「git 状态」这类每轮变化的内容，要放在缓存边界**之后**（或单独成段），避免每轮 invalidate 整个 system 缓存

**实现注意**：
- 缓存结构设计要和 #2（环境上下文）协同：稳定部分（BASE_CORE_PROMPT、CLAUDE.md）在前并进缓存；易变部分（日期、git status）在后不进缓存
- 格式分支已有现成判断点：`resolveModel` / `config.format`（apiAdapter.ts:100）

**改动文件**：`src/main/adapters/apiAdapter.ts`

### #6 maxOutputTokens（默认值 + 可配置）

**目标**：避免长回复/大文件写入被供应商默认上限（常见 4096）截断。

**方案**：
- adapter 设一个较大默认值（建议 8192，偏保守通用；过大对某些模型会报错）
- `ApiProviderConfig` 新增可选字段 `maxOutputTokens?: number`，provider 配置时可覆盖默认
- `apiAdapter.ts` 的 streamText/generateText options 加 `maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS`
- ProviderSettings 表单加输入框（数字，留空用默认）

**实现注意**：
- 不同模型上限差异大（有的 4k，有的 8k/16k/64k）；默认值取通用安全值，让用户按模型上调
- ProviderStore 持久化已是整对象序列化，新增字段自动持久化，无需改存储逻辑

**改动文件**：
- `src/shared/types.ts`（ApiProviderConfig 加 maxOutputTokens）
- `src/main/adapters/apiAdapter.ts`（options 加字段）
- `src/main/ProviderStore.ts`（save 时透传新字段）
- `src/renderer/src/ProviderSettings.tsx`（表单字段）

### #7 工具描述重写

**目标**：让非 Claude 模型也能正确判断何时调用哪个工具、参数怎么填。工具描述质量对弱模型的工具调用正确率影响极大。

**范围**：所有工具的 tool description + 每个参数的 .describe()
- 现有 9 个：bash / file_read / file_edit / file_write / glob / grep / fetch / sourcegraph / todo_write
- 新增（来自 #4）：ls + file_edit 多处编辑参数 + bash 持久状态说明

**每个工具描述应包含**：
- 一句话功能 + **何时用 / 何时不用**（如「搜文件内容用 grep，不要用 bash 里的 grep」「找文件名用 glob」）
- 参数含义、格式、默认值、边界（如路径相对/绝对、offset 从 0 开始）
- 注意事项（如 file_edit 的 old_string 必须唯一匹配；bash 长任务用 timeout）

**语言**：与 #1 BASE_CORE_PROMPT 统一，见文末「全局：语言选择」。当前工具描述是中文，若 #1 定英文则一并改为英文（system 与工具描述语言一致，避免模型困惑）。

**改动文件**：`src/main/adapters/api-tools/` 下所有工具文件

### #8 其它细节（全部纳入）

#### 8a. thinking / reasoning 事件
- `mapStreamPart`（apiAdapter.ts:135）不处理 reasoning delta，带思考的模型（DeepSeek-R1 等）推理过程丢失
- AI SDK fullStream 有 `reasoning` / `reasoning-delta` part 类型；映射为已有的 `thinking` event（types.ts:76 已定义 `{ kind: 'thinking'; text }`）
- TranscriptViewer 已有 thinking 渲染分支（grep 显示 chat-thinking），打通即可
- **改动**：`src/main/adapters/apiAdapter.ts`（mapStreamPart 加 reasoning 分支）

#### 8b. 图片附件多模态读取
- 现状：附件只是把路径拼成文本（SingleRunPanel.tsx:188），图片无法真正被模型看到
- 改为：图片附件作为多模态 content part 传给模型（AI SDK message content 支持 image part，需读文件转 base64/data URL）
- 边界：仅对支持视觉的模型有效；非视觉模型应降级（仍拼路径文本或提示不支持）。要判断模型能力，无法判断时安全降级
- **改动较大**：涉及 SingleRunPanel（附件传递）→ SingleSessionSendInput 类型 → SingleSessionManager → RunConfig → apiAdapter（构造 content part）。需要一条贯穿的附件数据通道
- **改动文件**：`SingleRunPanel.tsx` / `shared/types.ts` / `SingleSessionManager.ts` / `apiAdapter.ts`

#### 8c. todo_write 渲染到 UI
- 现状：todo 是工具实例内存态（todoWrite.ts:11），仅作为 tool-result 文本返回，不在 UI 单独呈现
- 改为：todo 列表作为结构化状态呈现（如固定面板或特殊 tool-result 渲染），让用户看到 agent 任务进度
- 选项：① 简单——TranscriptViewer 对 todo_write 的 tool-result 做特殊格式化渲染；② 完整——单独的 todo 状态区。建议先做 ①
- **改动文件**：`src/renderer/src/TranscriptViewer.tsx`（todo_write tool-result 特殊渲染）

---

## 运行时正确性（来自 Codex 对照，含已查证的 v6 真 bug）

> 这批是**当前已存在、正在让 API 模式坏掉的 bug**，不是新功能。优先级最高。
> 已对照 `node_modules/ai/dist/index.d.ts`（实际安装版本 **ai@6.0.202** / @ai-sdk/anthropic@3.0.83 / @ai-sdk/openai@3.0.70）逐条查证。

### #9 🔴 AI SDK v6 事件映射修复

**根因**：`mapStreamPart`（apiAdapter.ts:135）的 `switch(part.type)` 监听的类型名与 v6 实际吐出的 `TextStreamPart` 对不上，静默失效。

**已查证的 v6 正确类型名**（`index.d.ts:2546-2628` TextStreamPart）：
- `text-delta`（字段 `text`）✓ 现有正确
- `reasoning-delta`（字段 `text`）— 现有未处理（见 #8a）
- **`finish-step`**（字段 `usage` / `finishReason`）— **现有写成 `step-finish`（apiAdapter.ts:158），永不命中 → usage 一直丢失**
- `finish`（字段 `totalUsage`）✓ 现有处理
- **`tool-error`**（字段 `error`，独立 part）— **现有只在 `tool-result` 读 `part.error`（apiAdapter.ts:154），v6 工具失败走 tool-error → 失败被静默吞掉**
- **`tool-output-denied`** / **`abort`** — 现有未处理
- `tool-call` / `tool-result` ✓ 现有处理

**方案**：
- `step-finish` → 改为 `finish-step`，从 `part.usage` 读 token（兼容性：可同时保留旧名做 fallback）
- 新增 `tool-error` case → 产出 `tool-result {ok:false}` 或 `error` 事件
- 新增 `abort` case → 产出 `turn-done {reason:'aborted'}`
- 新增 `tool-output-denied` case → 产出失败 tool-result

**改动文件**：`src/main/adapters/apiAdapter.ts`（mapStreamPart）+ `tests/api-adapter.test.mjs`（新增映射断言）

### #10 🔴 流式补发完整 message（多轮/记忆/handoff 根因）

**根因**：流式 happy path 只产出 `message-delta`，`finish` 时只发 `turn-done`，**从不产出 `kind:'message'`**（仅非流式兜底 `runGenerateFallback` 才发）。而下游 `readSessionTimeline` 只认 `message`、丢弃 delta → **API assistant 回复对 replay/memory/summary/handoff 全部不可见**。

**方案**：
- adapter 内累积所有 `text-delta` 的文本，在 `finish`（或 stream 结束）前补发一条完整 `{kind:'message', role:'assistant', text: 累积文本}`，再发 `turn-done`
- 避免与 `message-delta` 重复渲染：约定 delta 用于实时流式显示、message 用于持久化/replay；TranscriptViewer 的 chat 分组已能合并（groupChatEvents），需确认不会出现「delta 段 + message 段」双份气泡
- **旧 delta-only transcript 兼容**：`readSessionTimeline` 在遇到没有完整 message、只有连续 delta 的旧会话时，把连续 delta 聚合成一条 assistant message（向后兼容历史数据）

**与 #3 的关系**：#10 是 #3 的前置。#10 让磁盘/事件流里有完整 assistant 文本，#3 才能把它读成结构化 messages。

**改动文件**：
- `src/main/adapters/apiAdapter.ts`（finish 前补 message）
- `src/main/TranscriptStore.ts`（readSessionTimeline 聚合旧 delta）
- `tests/api-adapter.test.mjs` / `tests/session-mode.test.mjs`

### #11 Workflow/scheduled 权限死锁

**根因**：`PermissionGuard.ts:14` 的 `timeoutMs = 300_000`（5 分钟）。headless 的 workflow / scheduled run 没有人在 UI 上点授权，default 模式下会**卡满 5 分钟才超时拒绝**，run 假死。

**方案**：
- API 默认 `permissionMode` 改为 `bypassPermissions`（factory.ts:56 已 `?? 'default'`，改默认值）
- agent 显式设 `default/acceptEdits/plan` 时仍尊重
- **区分交互场景**：Single（有 UI）可走真授权请求；Workflow/scheduled（headless）遇到需授权时**立即失败并返回明确错误**（"此 run 为无人值守，工具 X 需要授权，请改用 bypassPermissions 或预授权"），同时写入 API 日志（#13）
- 实现：PermissionGuard 增加「headless」标志，headless + 非 bypass + 需授权 → 直接 resolve(false) 并 emit 错误，不挂 timer

**改动文件**：
- `src/main/adapters/api-tools/PermissionGuard.ts`（headless 快速失败）
- `src/main/adapters/factory.ts`（API 默认 bypass + 传 headless 标志）
- `src/main/WorkflowManager.ts`（headless 标志来源）

### #12 outputSchema 不再被 API 静默忽略（workflow handoff）

**根因**：`apiAdapter` 从不读 `input.outputSchema`（types.ts:21 有字段）。Workflow 靠最终 handoff JSON 驱动路由，API 只能纯靠 prompt + `parseHandoff` fallback，不可靠。

**方案**：
- provider/模型支持 structured output（OpenAI 的 `response_format: json_schema` / Anthropic 的 tool-based）→ 走结构化输出，日志标记 `structuredOutput: 'native'`
- 不支持 → 强化 handoff prompt（已有 HANDOFF_HINT）+ `parseHandoff` fallback，日志标记 `structuredOutput: 'fallback'`
- handoff 解析失败时，日志保留**最后 assistant 输出摘要 + parse error**，便于排查
- 与 #1 协同：Single 不要求 handoff；Workflow 的 system 必须含 handoff JSON 规则（BASE_CORE_PROMPT 按 logSource/场景区分，或由调用方追加 HANDOFF_HINT）

**改动文件**：
- `src/main/adapters/apiAdapter.ts`（读 outputSchema，能力判断）
- `src/main/WorkflowManager.ts`（handoff 失败日志）

### #13 API 调用日志（排查 "用不了" 的关键工具）

**目标**：每次 API 请求可查 provider/model/cwd/输入消息/工具/响应/usage/错误/耗时，**密钥必须脱敏**。

**存储**：
- 新增 `src/main/ApiCallLogStore.ts`，写 JSONL 到 `app.getPath('userData')/api-call-logs/YYYY-MM-DD.jsonl`
- 保留策略：最近 7 天或最多 20MB（第一版默认开启）

**记录时机**：每次 `streamText` / `generateText` / provider test / model fetch / reflection 调用各记一条

**日志字段**（`ApiCallLogEntry`）：
`id` / `timestamp` / `source`('single'|'workflow'|'provider-test'|'model-fetch'|'reflection') / `providerId` / `providerName` / `format` / `baseUrl` / `model` / `cwd` / `messagesSummary` / `systemSummary` / `toolNames` / `apiMaxSteps` / `temperature` / `topP` / `durationMs` / `status`('started'|'success'|'error'|'aborted') / `usage` / `error` / `structuredOutput`
- **脱敏**：不记 API Key；不记 authorization header；request body 默认只存**截断后的文本摘要**；提供「复制完整脱敏 JSON」用于调试
- `costUsd`：仅当 provider 配了 pricing 才算，否则只记 token usage

**UI（Settings 新增「API 调用日志」区）**：最近日志列表 / 刷新 / 清空 / 打开日志目录 / 复制当前日志

**Transcript compact 事件**：每次 API run 在 transcript 追加一条 compact system 事件，如 `API call: provider/model · 1234ms · 1.2k tokens`，定位是哪次调用

**新增 IPC**：`apiLogs:list` / `apiLogs:clear` / `apiLogs:openDir` / `apiLogs:get`
**新增类型**：`ApiCallLogEntry` / `ApiCallLogStatus`

**改动文件**：
- 新增 `src/main/ApiCallLogStore.ts`
- `src/main/adapters/apiAdapter.ts`（记 single/workflow 调用）
- `src/main/ipc.ts`（provider-test/model-fetch 记录 + 4 个 IPC handler）
- `src/preload/index.ts`（暴露 apiLogs API）
- `src/shared/types.ts`（类型 + IPC 常量）
- `src/renderer/src/SettingsPanel.tsx`（日志区 UI）

### #14 temperature/topP 可配置 + bash 文件变更上报

**14a. temperature/topP**：
- 现状 `apiAdapter.ts:43-44` 硬编码 `temperature:1, topP:0.95`——对编码 agent 太随机
- 默认改 `temperature:0.2`、`topP:1`；可在 agent 和 RunConfig 层覆盖
- 新增 `RunConfig.apiTemperature?` / `apiTopP?`、`AgentDefinition.apiTemperature?` / `apiTopP?`
- Single API 高级项显示 `apiMaxSteps / temperature / topP`

**14b. bash 文件变更上报**：
- 现状只有 file_write/file_edit 通过 `onFileChanged` 上报；bash 改文件 UI 看不到
- bash 执行前后对 cwd 做**轻量 snapshot diff**，上报 create/modify/delete
- **忽略 `.git`/`node_modules`/`dist`/`out`/`.tmp`**，避免大仓库 snapshot 卡顿
- 注意：snapshot 用 mtime+size 而非全文 hash，控制开销

**改动文件**：
- `src/shared/types.ts`（RunConfig/AgentDefinition 加 apiTemperature/apiTopP）
- `src/main/adapters/apiAdapter.ts`（读取 temp/topP）
- `src/main/adapters/api-tools/bash.ts`（snapshot diff + onFileChanged）
- `src/main/adapters/api-tools/index.ts`（bash 传 onFileChanged）
- `src/renderer/src/SingleRunPanel.tsx`（高级项 UI）
- `src/renderer/src/AgentManager.tsx`（agent temp/topP 配置）

---

## 公共接口 / 类型变更汇总

- `RunConfig` / `RunTurnInput` 新增：`messages?: ApiConversationMessage[]`、`apiTemperature?: number`、`apiTopP?: number`、`apiLogSource?: 'single'|'workflow'|'provider-test'|'model-fetch'|'reflection'`
- `AgentDefinition` / `AgentDraft` 新增：`apiTemperature?: number`、`apiTopP?: number`
- `ApiProviderConfig` 新增：`maxOutputTokens?: number`（来自 #6）
- 新增 IPC：`apiLogs:list` / `apiLogs:clear` / `apiLogs:openDir` / `apiLogs:get`
- 新增类型：`ApiCallLogEntry`、`ApiCallLogStatus = 'started'|'success'|'error'|'aborted'`、`ApiConversationMessage`

---

## Assumptions（第一版）

- 日志默认开启，保留最近 7 天或最多 20MB
- 日志必须脱敏 API Key 和 authorization header
- 第一版不接 OpenCode，先修当前 API mode
- `costUsd` 仅在有 provider pricing 配置时计算，否则只记 token usage

---

## 全局：语言选择

**已定案：英文。**
- 影响 #1 BASE_CORE_PROMPT + #2 环境上下文 + #7 工具描述，三者统一英文
- 理由：这三部分纯面向模型、用户不可见不可编辑；英文 system/工具描述的指令遵循度与工具调用稳定性最高
- **不影响用户侧中文体验**：UI 文案、按钮、用户可编辑的 agent systemPrompt 全部不变。agent systemPrompt 追加在英文 BASE_CORE_PROMPT 之后，语言不必一致，模型可处理混合语言 system
- **现有工具描述（中文）需一并改写为英文**（#7 范围内）

---

## 实施顺序建议

> 原则：先修**已坏的运行时 bug**（#9/#10/#11），再补**让模型会干活**的 prompt 层（#1/#2/#7），最后是增强与体验。日志 #13 尽量早做，因为它是后续所有调试的眼睛。

1. **第一批（止血 + 可观测）**：#9 v6 事件映射 + #10 补 message + #13 API 日志 —— 修好「usage 丢失/工具失败吞掉/多轮记不住」三大坏点，并让后续能看到每次请求。**最高优先级**
2. **第二批（核心可用性）**：#1 system prompt + #2 环境上下文 + #7 工具描述 —— 让模型主动用工具干活。强相关，一起做
3. **第三批（多轮质量）**：#3 结构化 messages 历史（依赖 #10 已完成）
4. **第四批（headless 正确性）**：#11 权限快速失败 + #12 outputSchema/handoff —— 让 workflow/scheduled 的 API run 可靠
5. **第五批（工具能力 + 参数）**：#4 工具增强与 bug 修复 + #14 temp/topP 可配 + bash 文件变更
6. **第六批（成本/截断）**：#5 prompt caching + #6 maxOutputTokens —— 协同设计缓存边界与 token 上限
7. **第七批（体验）**：#8a thinking → #8c todo UI → #8b 图片多模态（8b 改动最大放最后）

**验证命令**（每批做完跑）：
- `node --test tests/api-adapter.test.mjs tests/api-tools.test.mjs tests/session-mode.test.mjs tests/interactive-mode.test.mjs tests/api-mode-ui.test.mjs tests/api-mode-contract.test.mjs`
- `pnpm run typecheck` → `pnpm test` → `pnpm run build`
- **手动验收**：用现有 provider 连续两轮 API Single 会话读取/修改临时文件，并在 Settings 看到对应 API 日志

> 注：`tests/api-adapter.test.mjs` / `api-mode-ui.test.mjs` / `api-mode-contract.test.mjs` 为本计划新增的测试文件，当前可能不存在，需随实现创建。
