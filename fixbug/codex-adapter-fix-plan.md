# Codex 集成修复计划

> 起因：Workflow 里的 codex agent 跑完后报 `Could not parse handoff JSON`，且右侧面板完全看不到 codex 的 thinking / streaming / 工具调用状态。

## 1. 根因复盘（一句话）

[`src/main/adapters/codexParser.ts`](../src/main/adapters/codexParser.ts) 是按 Claude `stream-json` 写的，但 `codex exec --json`（0.137.0）输出的是 `ThreadEvent` 协议 —— 字段名、嵌套结构、变体命名都不一样，所以解析器永远命中不到任何分支，前端拿不到任何 `message`/`thinking`/`tool-*` 事件，进而 `parseHandoff` 找不到 `message` 报 "Could not parse handoff JSON"。

## 2. Codex 真实输出 schema（修改时对照）

每行 stdout 是一个 `ThreadEvent`，外层用 `{"type": "<tag>", ...扁平字段}`：

```jsonc
// thread.started —— 一次会话的起点，唯一带 thread_id 的事件
{"type":"thread.started","thread_id":"019e92…"}

// turn.started —— 一轮 prompt 的开始（payload 为空）
{"type":"turn.started"}

// item.started / item.updated / item.completed —— 共用 ThreadItem 形状
// ThreadItem 用 #[serde(flatten)]，details 被打平到顶层
{
  "type":"item.completed",
  "item":{
    "id":"…",
    "type":"agent_message",          // ← ThreadItemDetails 的 tag
    "text":"final answer text"        // ← AgentMessageItem.text
  }
}

// item.updated 同样形状，text 是当时已经累积到的文本（不是增量）
//   → 想要打字机效果，需要自己 diff 上一次的 text 算 delta

// reasoning item
{"type":"item.completed","item":{"id":"…","type":"reasoning","text":"…"}}

// command_execution
{"type":"item.completed","item":{"id":"…","type":"command_execution",
  "command":"ls /tmp","aggregated_output":"…","exit_code":0,"status":"completed"}}

// mcp_tool_call
{"type":"item.completed","item":{"id":"…","type":"mcp_tool_call",
  "server":"…","tool":"…","arguments":{…},
  "result":{…}|null,"error":{…}|null,"status":"success"|"failed"}}

// file_change
{"type":"item.completed","item":{"id":"…","type":"file_change",
  "changes":[{"path":"a.ts","kind":"update"|"add"|"delete"}],
  "status":"completed"|"failed"}}

// web_search / todo_list / error / collab_tool_call —— 暂时可作降级处理

// turn.completed —— 带 usage（input/cached/output/reasoning tokens）
{"type":"turn.completed","usage":{"input_tokens":…,"cached_input_tokens":…,
  "output_tokens":…,"reasoning_output_tokens":…}}

// turn.failed / error
{"type":"turn.failed","error":{"message":"…"}}
{"type":"error","message":"…"}
```

## 3. 文件清单

### 3.1 重写 [`src/main/adapters/codexParser.ts`](../src/main/adapters/codexParser.ts)（核心）

**入口仍然是 `parseCodexLine(line) → AgentEvent[]`，但内部全部按上面的 schema 重写。**

#### 顶层 switch 分支

| codex 事件 | 输出 AgentEvent |
|---|---|
| `thread.started` | `{kind:'session-started', sessionId: thread_id, vendor:'codex'}` |
| `turn.started` | 不发（或发 `system` 调试） |
| `item.started` + `details.type==='command_execution'` | `{kind:'tool-call', id: item.id, name:'bash', input:{command}}` |
| `item.started` + `details.type==='mcp_tool_call'` | `` {kind:'tool-call', id: item.id, name:`mcp:${server}:${tool}`, input: arguments} `` |
| `item.completed` + `agent_message` | `{kind:'message', role:'assistant', text}` |
| `item.completed` + `reasoning` | `{kind:'thinking', text}` |
| `item.completed` + `command_execution` | `{kind:'tool-result', id, ok: status==='completed' && exit_code===0, output: aggregated_output}` |
| `item.completed` + `mcp_tool_call` | `{kind:'tool-result', id, ok: status==='success', output: result?.content ?? error?.message ?? ''}` |
| `item.completed` + `file_change` | `changes.map(c => {kind:'file-changed', path: c.path, op: c.kind==='add'?'create':c.kind==='delete'?'delete':'modify'})` |
| `item.completed` + `web_search` | `{kind:'tool-result', id, ok:true, output: query}`（或 `system`） |
| `item.completed` + `todo_list` | `{kind:'system', text:'todo: …'}`（先简化） |
| `item.completed` + `error` | `{kind:'error', recoverable:false, message}` |
| `item.updated` + `agent_message` | 需做增量：见下节"流式增量"，输出一个 `message-delta` |
| `item.updated` + `reasoning` | 同上，输出 `thinking`（覆盖式或增量都行，UI 已支持） |
| `turn.completed` | 两条：`{kind:'usage', inputTokens, outputTokens}` + `{kind:'turn-done', sessionId:'', reason:'complete'}` |
| `turn.failed` | `{kind:'error', recoverable:false, message: error.message}` + `{kind:'turn-done', sessionId:'', reason:'error'}` |
| `error` | `{kind:'error', recoverable:false, message}` |
| 其它 / 未知 | 返回 `[]`（不要再走 `obj.text`/`obj.content` 兜底，那是 Claude 残留） |

#### 流式增量（`item.updated` 处理）

由于 codex 给的是**累积文本**而非增量，parser 需要持状态。最干净的做法：把 `parseCodexLine` 改成一个工厂返回带状态的解析器，或者维护一个 `Map<itemId, lastText>`。

建议接口：
```ts
export function createCodexParser() {
  const lastText = new Map<string, string>()
  return function parseCodexLine(line: string): AgentEvent[] { /* … */ }
}
```
然后在 [`codexAdapter.ts:42`](../src/main/adapters/codexAdapter.ts) `runTurn` 顶部 `const parse = createCodexParser()`，回调里调 `parse(line)`。这样每个 turn 一份独立状态，不会跨 turn 串。

逻辑：
- `item.updated/completed` 拿到 `text` 后，跟 `lastText.get(id)` 比较，diff 出 suffix；若新文本不是旧文本前缀（极少见的修正），则发一条完整 `message`/`thinking`，并重置 `lastText`。
- `item.completed` 拿到最终 `text` 后清掉 `lastText.delete(id)`，并发一条**最终事件**（`kind:'message'` 整段，UI 的 `groupEvents` 会把之前的 `message-delta` flush 进同一条）。⚠️ 这里要小心避免**重复**：现在 [`TranscriptViewer.tsx:218-223`](../src/renderer/src/TranscriptViewer.tsx) 的 `flush()` 把 pending delta 合成一条 message，然后 `message` 又 push 一条，会显示两遍。对策二选一：(a) `item.completed` 只发一条 `message-delta` 把剩余 suffix 补完，不再发完整 `message`；(b) 改 `groupEvents` 让 message 到来时丢弃 pending —— 推荐 (a)，最小改动。

#### "Reading additional input from stdin..." 处理

去掉现在 [`codexParser.ts:21-23`](../src/main/adapters/codexParser.ts) 把任意非 JSON 行包成 `system` 的兜底，改成：
- 行匹配 `/^Reading additional input from stdin/` → 返回 `[]`（丢弃）
- 其它非 JSON → 返回 `[{kind:'stderr', text: line}]` 或 `[]`（保守起见用 `[]`）

#### `session-started` 字段修正

`thread.started.thread_id` 落到 `sessionId`。这样 [`WorkflowManager.ts:297`](../src/main/WorkflowManager.ts) 能正确记录 codex 的 `executionId.sessionId`，但目前 [`WorkflowManager.ts:178-180`](../src/main/WorkflowManager.ts) 的 `pushInput` 只允许 Claude vendor 续聊，需要单独考虑 —— 不在本次范围。

### 3.2 调整 [`src/main/adapters/codexAdapter.ts`](../src/main/adapters/codexAdapter.ts)

| 改动 | 位置 | 内容 |
|---|---|---|
| 改用工厂解析器 | [`codexAdapter.ts:5,44`](../src/main/adapters/codexAdapter.ts) | `import { createCodexParser }` 然后 `const parse = createCodexParser(); onStdoutLine(line) { for (const ev of parse(line)) queue.push(ev) }` |
| `turn-done.sessionId` 透传 | [`codexAdapter.ts:65,73`](../src/main/adapters/codexAdapter.ts) | 现在写死 `sessionId:''`。parser 已经发过 `session-started`，进程退出兜底的 `turn-done` 用 `''` 也 OK；但顺手可以缓存 thread_id 透传，让 WorkflowManager 拿到。可选。 |
| stderr 过滤增强 | [`codexAdapter.ts:90-99`](../src/main/adapters/codexAdapter.ts) | 改成按行过滤而不是整 chunk：`text.split('\n').filter(l => l && !isMcpNoise(l)).join('\n')`，避免一条 chunk 含混合内容时全留或全丢。 |
| 移除 stdout banner 处理 | / | banner 已在 parser 层丢掉，不需要在 adapter 再处理。 |

### 3.3 不需要改的

- [`WorkflowManager.ts`](../src/main/WorkflowManager.ts)：`parseHandoff` 找最后一条 `message` 的逻辑没问题，parser 修好后自然能命中。
- [`TranscriptViewer.tsx`](../src/renderer/src/TranscriptViewer.tsx)：UI 层已经覆盖了所有 `AgentEvent` 类型。
- [`types.ts`](../src/shared/types.ts)：`AgentEvent` 已经够用。

### 3.4 可选：加单测

`src/main/adapters/codexParser.test.ts` —— 把这次 rollout 文件里几行真实样本贴进去断言输出形状。仓库目前没测试基建，可以等后续再加。

## 4. 验证步骤

1. **重启 Electron dev**（这次改 main 进程必须重启，HMR 不覆盖）。
2. 跑现在那个 `需求 → 开发 → 测试` workflow：
   - 第 1 步（Claude 产品经理）应该和原来一样 `Done`。
   - 第 2 步（codex 高级开发者）：右栏应该出现 reasoning 思考、tool-call 卡片、最终 message；状态条出现 `Thinking`/`Streaming`/工具图标。
   - 第 2 步结束时不再报 "Could not parse handoff JSON"，而是 `awaiting-confirm`，能看到 handoff summary/artifacts。
3. **故意写错 handoff**（让 codex 输出非 JSON 的最终消息）：应该才出现 "Could not parse handoff JSON" —— 此时确认是 prompt/模型问题而非解析器问题。
4. **MCP 噪声**：右栏不再出现 `rmcp::transport::worker …` 那一坨 stderr。
5. **快速 smoke**：把一个 codex agent 单独跑（不走 workflow），TranscriptViewer 应该能看到完整的 thinking + tool + message 流。

## 5. 风险点

- **`item.updated` 累积文本 vs 增量**：是这次最容易踩坑的地方，建议先用整段覆盖（每次 `item.updated` 都 push 完整 `message-delta` 累积出来的 suffix），跑通后再优化。
- **重复消息**：如上述，`item.completed` 之后既有累积 delta 又有最终 message 会出现两份。先按方案 (a) 处理。
- **codex 协议跟版本走**：当前是 0.137.0。若用户后续升级 codex，schema 可能微调；建议 parser 对未知 `type` 一律静默忽略（返回 `[]`），保证不崩。
- **`pushInput` 续聊**：目前 [`WorkflowManager.ts:178-180`](../src/main/WorkflowManager.ts) 硬编码只允许 Claude vendor，codex 即使有 sessionId 也续不了。可作为后续 issue 单独提，不阻塞本次修复。

## 6. 参考资料

- codex `ThreadEvent` / `ThreadItemDetails` 定义：[openai/codex `codex-rs/exec/src/exec_events.rs`](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs)
- JSONL 输出实现：[`codex-rs/exec/src/event_processor_with_jsonl_output.rs`](https://github.com/openai/codex/blob/main/codex-rs/exec/src/event_processor_with_jsonl_output.rs)
- 本地真实 rollout 样本（同一协议）：`~/.codex/sessions/2026/06/04/rollout-*.jsonl`
