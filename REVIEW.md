# Agent Studio 架构与产品评审

## 做得好的地方

### 1. CliAdapter 抽象层设计扎实

`src/main/adapters/types.ts` 的 `CliAdapter` 接口把 claude（常驻双向流）和 codex（单次 exec）两个完全不同的 CLI 抽象为统一的 "Turn" 模型 + `AsyncIterable<AgentEvent>` 事件流。上层 `RunManager` / `WorkflowManager` 完全不关心底层是哪家。`capabilities` 字段让上层按能力降级而非按 vendor 分支。

### 2. 统一事件模型

`AgentEvent` 联合类型（12 种 kind）覆盖了 AI CLI 常见语义：session 生命周期、streaming delta、thinking、tool call/result、file change、usage、error。编排层和 UI 层面向同一份协议编程，扩展性好。

### 3. Handoff 机制

工作流步骤间传递结构化 `HandoffArtifact`（summary + artifacts + nextStepGuidance），`parseHandoff()` 有多种 fallback 策略（纯 JSON → markdown code fence 提取）。比 "把上一步全文丢给下一步" 对 token 效率和可靠性都更优。

### 4. 韧性设计

- Resume 失败自动降级为 transcript 重建（`RunManager.runWithResume`）
- App 重启后自动标记中断的 run 为 `interrupted`
- delta batching（16ms / 256 chars）避免 IPC 风暴
- TranscriptStore 文件写入用异步队列 + per-file Promise chain，不阻塞主线程

### 5. Git Safety

`gitSafety.ts` 主动检测工作流之间的 git 冲突（同目录 / 同 worktree / 相关 worktree），启动前给用户确认。对多 agent 同时操作文件系统的场景是必要的安全网。

---

## 做得不好的地方

### 1. App.tsx 上帝组件（921 行）

`src/renderer/src/App.tsx` 把 state 管理、事件处理、workflow 运行时 UI、single-run UI、handoff panel 全部堆在一起，甚至在文件内部再定义了 `WorkflowRuntime` 和 `HandoffPanel` 两个完整组件。

问题：
- 没有状态管理层（无 context / zustand / reducer），全靠顶层 useState + prop drilling
- 任何修改都要理解整个 921 行的上下文
- UI 组件和业务逻辑混杂
- 无法单独测试逻辑

### 2. 线性工作流 = 产品天花板极低

整个编排模型是纯线性（step[0] → step[1] → step[2]），缺少：
- 并行分支（设计和测试可以同时跑）
- 条件跳转（测试失败 → 回到代码 agent）
- 循环/迭代（跑到满意为止）
- 动态步骤数（agent 自己决定是否需要再加一步）

作为 "多 agent 编排工作流" 产品，线性链是 demo 级别的能力。竞品（CrewAI、LangGraph、Dify）早已实现 DAG。

### 3. 交接物用 prompt 文本指令而非结构化输出约束

`HANDOFF_SCHEMA_TEXT` 是直接拼进 prompt 的文本指令（"respond with only JSON matching this shape"），而不是用 claude 的 `--output-schema` 做硬约束。

后果：
- agent 可能不遵守格式（`parseHandoff` 有各种 fallback 就是证据）
- 整个工作流可能因一个 step 输出不规范就卡死在 "Could not parse handoff JSON"
- `capabilities` 里声明了 `structuredOutputSchema: true` 但没实际使用

### 4. 没有错误恢复和自愈能力

工作流步骤失败后，整个 run status 直接变 `error`，结束。缺少：
- 自动重试（可配次数）
- partial handoff（"80% 完成了，先传下去"）
- 人类接管后恢复的流程
- 错误分类（transient vs permanent）

用户只能手动点 "重新运行"。

### 5. 事件流全量存内存，无分页/惰性加载

`WorkflowStore.saveRun()` 持久化了 run 状态，但 `WorkflowStepExecution.events: AgentEvent[]` 全量存在内存。对一个长工作流（4-5 个 agent，每个跑几分钟），单个 run 的内存可能是几十 MB 事件对象。没有分页、没有惰性加载、没有事件归档策略。

### 6. 前端无集成测试 / E2E 测试

`tests/` 下全是纯逻辑单元测试（scroll 计算、notification sound、git safety），没有任何 Electron 集成测试或 Playwright E2E 测试。UI 回归完全靠人肉。

### 7. UI Review Fixture 是硬编码 mock（429 行）

`src/renderer/src/uiReviewFixture.ts` 是一个巨大的静态 mock 对象。不是 Storybook 那种可维护的 fixture 系统，会随着功能增长严重腐烂。

### 8. 没有日志/可观测性

主进程没有结构化 logging（无 winston / pino / electron-log）。出了问题只能看 Electron devtools console。对于一个要长时间后台跑 agent 的桌面应用，生产环境 debug 极其痛苦。

### 9. Gemini 支持消失

`IMPLEMENTATION_PLAN.md` 设计了三家 CLI（claude / gemini / codex），实际代码只实现了 claude 和 codex。`AgentVendor` 类型只有两个值，`factory.ts` 只有两个分支。计划跟实际脱节，文档未更新。

### 10. 缺乏 token/cost 跟踪和预算控制

`AgentEvent` 里有 `usage` 事件类型，但 `WorkflowManager` 完全没用它。缺少：
- 单步/整个工作流的 cost 累计
- 预算上限（跑了 $X 自动停）
- 任何 cost 相关的 UI 展示

对于编排多个 LLM agent 的产品，cost 是用户核心关注点之一。

---

## 总结

| 维度 | 评价 |
|------|------|
| 架构方向 | 正确（adapter 抽象、事件流、handoff 协议） |
| 代码风格 | 统一，TypeScript 用得规范 |
| 产品完整度 | 远远不够（线性编排太弱、容错差、缺成本控制） |
| 工程质量 | 前端差（上帝组件 + 0 集成测试），后端尚可 |
| 文档与执行 | 典型 "规划完美、执行不足"，IMPLEMENTATION_PLAN 只兑现了约 60% |
| 竞品对比 | 与 CrewAI / LangGraph / Dify 差距在产品完整度而非架构方向 |
