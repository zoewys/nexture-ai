# Agent 记忆系统 V1 实现 Spec

> 本文档是 V1 版本完整实现规格，交给 AI 编码助手作为实施依据。
> 关联文档：
> - 设计方案：`MEMORY_SYSTEM_V1.md`
> - 论文研究：`MEMORY_RESEARCH.md`
> - 概念划分：`CONCEPT_HIERARCHY.md`
> - 摘要方案：`TRANSCRIPT_SUMMARY_COMPARISON.md`

---

## 一、目标与范围

### 1.1 目标

为 Agent Studio 中的每个 agent 实现跨 workflow run 的经验积累机制。让 agent 在同一项目中越用越懂场景、越用越懂用户偏好。

### 1.2 V1 范围（必做）

- ✅ 信号收集器：监听 confirm/rerun/error/done 事件
- ✅ 反思引擎：用 Claude Haiku 从 transcript 提取经验
- ✅ 记忆存储：JSON 文件，分 global 和 project 两层
- ✅ 运行时注入器：在 buildPrompt 中注入相关经验
- ✅ 遗忘曲线：strength 字段 + Ebbinghaus 衰减
- ✅ 强化机制：被使用且 run 成功时强化
- ✅ 最小 UI：Agent 详情页添加 "记忆" tab
- ✅ 反思 agent 配置：默认 haiku，用户可改

### 1.3 不做（推后到后续版本）

- ❌ Single Run 模式的记忆（用 CLI 自带）
- ❌ Skill Library（V2/V3）
- ❌ 睡眠整合（V2）
- ❌ 向量数据库 / embedding 检索
- ❌ Memory 编辑功能（V1 只能查看和删除）

---

## 二、数据结构定义

### 2.1 新增类型（写入 `src/shared/types.ts`）

```typescript
// ── Memory System ─────────────────────────────────────────────────────

/** 单条记忆条目 */
export interface MemoryEntry {
  /** UUID */
  id: string
  /** 所属 agent */
  agentId: string
  /** 作用范围 */
  scope: 'global' | 'project'
  /** scope=project 时必填，存储项目路径的 hash（避免长路径） */
  projectHash?: string
  /** scope=project 时必填，存原始路径供 UI 展示 */
  projectPath?: string
  /** 记忆分类 */
  category: MemoryCategory
  /** 一句话经验内容 */
  content: string
  /** 经验来源（runId + 信号类型） */
  evidence: string
  /** 当前强度（0-1），遗忘曲线计算后的实时值不写入这里 */
  strength: number
  /** 创建时间戳（ms） */
  createdAt: number
  /** 上次被强化的时间戳（ms） */
  lastReinforcedAt: number
  /** 累计被强化次数 */
  reinforceCount: number
}

export type MemoryCategory = 'method' | 'knowledge' | 'preference' | 'avoidance'

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'method',
  'knowledge',
  'preference',
  'avoidance'
]

/** 触发学习的信号 */
export interface MemorySignal {
  type: 'positive' | 'negative' | 'format-error' | 'completion'
  source: 'user-confirmed' | 'user-rerun' | 'handoff-failed' | 'workflow-done'
  runId: string
  workflowRunId: string
  stepIndex: number
  agentId: string
  projectPath: string
  timestamp: number
  /** 精简后的 transcript 文本 */
  transcript: string
  /** 该 step 的 handoff，若有 */
  handoff?: HandoffArtifact
  /** 错误信息，若有 */
  error?: string
  /** 用户在 rerun 时的修复指令，若有 */
  userAction?: string
}

/** 反思引擎产出的原始结果（写入磁盘前） */
export interface ReflectionResult {
  category: MemoryCategory
  scope: 'global' | 'project'
  content: string
  confidence: number
}

/** Agent 维度的统计信息 */
export interface AgentMemoryMeta {
  agentId: string
  totalRuns: number
  totalMemories: number
  lastReflectionAt?: number
}

/** 反思引擎全局配置 */
export interface ReflectionEngineConfig {
  vendor: AgentVendor
  model: string
  /** 是否启用反思（用户可关闭） */
  enabled: boolean
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionEngineConfig = {
  vendor: 'claude',
  model: 'claude-haiku-4-5-20251001',
  enabled: true
}
```

### 2.2 IPC 通道新增（追加到 `IPC` 常量）

```typescript
export const IPC = {
  // ... 现有通道保持不变 ...

  /** 列出某个 agent 的所有记忆 */
  memoryList: 'memory:list',
  /** 删除一条记忆 */
  memoryDelete: 'memory:delete',
  /** 获取记忆统计信息 */
  memoryMeta: 'memory:meta',
  /** 获取反思引擎配置 */
  reflectionConfigGet: 'reflection:config:get',
  /** 保存反思引擎配置 */
  reflectionConfigSave: 'reflection:config:save'
} as const
```

---

## 三、磁盘布局

```
<userData>/memories/
├── config.json                     # ReflectionEngineConfig
├── agents/
│   └── <agentId>/
│       ├── meta.json               # AgentMemoryMeta
│       ├── global.json             # MemoryEntry[]（scope=global）
│       └── projects/
│           └── <projectHash>.json  # MemoryEntry[]（scope=project）
└── raw/
    └── <workflowRunId>.json        # MemorySignal[]（暂存的信号，反思失败时保留）
```

**projectHash 生成规则**：`crypto.createHash('sha256').update(resolve(projectPath)).digest('hex').slice(0, 16)`

---

## 四、任务拆分（按优先级排序）

> 每个 task 标注：依赖、工作量估算、关键文件。
> 一个 task 实现完成后必须可以独立运行和测试（即使后续 task 没做也不报错）。

---

### Task 1：基础类型 + MemoryStore（核心存储层）

**优先级**：P0（基础）
**依赖**：无
**工作量**：4-6 小时

**目标**：实现记忆条目的增删查改 + 持久化。

**新增文件**：
- `src/main/memory/MemoryStore.ts`

**修改文件**：
- `src/shared/types.ts`（新增类型定义，见第二章）

**`MemoryStore` 实现要求**：

```typescript
export class MemoryStore {
  private readonly dir: string  // <userData>/memories

  constructor()

  // === 记忆条目 ===

  /** 列出某 agent 的所有记忆（global + 指定项目） */
  list(agentId: string, projectPath?: string): MemoryEntry[]

  /** 列出某 agent 的所有项目记忆（用于 UI 展示） */
  listAll(agentId: string): MemoryEntry[]

  /** 新增一条记忆 */
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastReinforcedAt' | 'reinforceCount'>): MemoryEntry

  /** 删除一条记忆 */
  remove(memoryId: string): void

  /** 批量删除某 agent 的所有记忆（agent 被删除时调用） */
  removeByAgent(agentId: string): void

  /** 强化一条记忆（lastReinforcedAt = now, reinforceCount++, strength 重置） */
  reinforce(memoryId: string): void

  // === 元数据 ===

  /** 读取/写入 agent 元数据 */
  getMeta(agentId: string): AgentMemoryMeta
  updateMeta(agentId: string, patch: Partial<AgentMemoryMeta>): void

  // === 信号暂存 ===

  /** 反思引擎崩溃时，信号写入 raw/<workflowRunId>.json，下次启动重试 */
  saveRawSignal(signal: MemorySignal): void
  popRawSignals(): MemorySignal[]  // 读取并清空所有暂存信号

  // === 配置 ===

  getReflectionConfig(): ReflectionEngineConfig
  saveReflectionConfig(config: ReflectionEngineConfig): void
}
```

**实现约束**：
- 文件 I/O 模式与 `AgentStore.ts` 一致：同步、best-effort、try-catch 吞掉错误
- 目录不存在时自动创建（`mkdirSync({ recursive: true })`）
- `projectHash` 函数集中在 `MemoryStore` 里实现一次，供其他模块复用（导出为 `hashProjectPath(path: string): string`）

**验收标准**：
- 单元测试：增删查改全覆盖
- 手动测试：手动写入一条 JSON，重启 app 后能正常读取

---

### Task 2：遗忘曲线（Forgetting Curve）

**优先级**：P0（基础）
**依赖**：Task 1
**工作量**：2-3 小时

**目标**：实现 strength 实时计算和过滤逻辑，封装为纯函数模块。

**新增文件**：
- `src/main/memory/forgettingCurve.ts`

**核心函数**：

```typescript
/**
 * 计算当前 strength。
 * 基于 Ebbinghaus 遗忘曲线变体：
 *   strength_now = strength_initial * exp(-days_since_reinforced / (stability * 7))
 * stability 随强化次数增长，被反复使用的记忆衰减越慢。
 */
export function computeStrength(entry: MemoryEntry, now: number): number {
  const days = (now - entry.lastReinforcedAt) / (1000 * 60 * 60 * 24)
  const stability = 1 + entry.reinforceCount * 0.5  // 0次=1, 1次=1.5, 3次=2.5, 5次=3.5
  const decay = Math.exp(-days / (stability * 7))
  return Math.max(0, Math.min(1, entry.strength * decay))
}

/** 过滤掉低于阈值的记忆 */
export function filterAlive(entries: MemoryEntry[], threshold = 0.3, now = Date.now()): MemoryEntry[]

/** 标记 strength < 0.2 的为待清理 */
export function listExpired(entries: MemoryEntry[], now = Date.now()): MemoryEntry[]
```

**验收标准**：
- 纯函数 + 单元测试覆盖
- 测试用例：
  - 刚创建的记忆 strength 不变
  - 7 天未强化、reinforceCount=0 → strength ≈ 0.37 * original
  - 7 天未强化、reinforceCount=3 → strength ≈ 0.67 * original
  - 30 天未强化、reinforceCount=0 → strength ≈ 0.01 * original（应被清理）

---

### Task 3：Transcript 摘要器

**优先级**：P0（反思引擎依赖）
**依赖**：无（纯逻辑）
**工作量**：3-4 小时

**目标**：从 `AgentEvent[]` 中按规则提取关键信息，输出 3000 tokens 以内的纯文本摘要。

**新增文件**：
- `src/main/memory/transcriptSummarizer.ts`

**核心函数**：

```typescript
export interface SummarizeOptions {
  maxTokens?: number  // 默认 3000
}

/**
 * 将一个 step 的事件序列精简为反思引擎可用的文本摘要。
 * 提取规则见文档：TRANSCRIPT_SUMMARY_COMPARISON.md
 */
export function summarizeTranscript(
  events: AgentEvent[],
  options?: SummarizeOptions
): string
```

**提取规则**（严格遵循）：

| 事件类型 | 处理方式 |
|---------|---------|
| `thinking` | 保留最后 500 字符 |
| `message` | 完整保留（如超过 2000 tokens，保留头 1000 + 尾 1000） |
| `tool-call` | 只保留 `name` 字段，合并为单行列表 |
| `error` | 完整保留 |
| `system` 且 text 以 `↳ ` 开头 | 完整保留（用户输入） |
| 其他（`message-delta`, `tool-result`, `stderr`, `usage`, `file-changed`, `session-started`, `turn-done`） | 丢弃 |

**输出格式**：

```
[用户输入]
↳ 请帮我分析这个需求

[Agent 思考]（最后部分）
我需要先识别敏感数据流，然后...

[工具调用]
read_file, edit_file, bash, read_file

[Agent 输出]
## 需求分析
...完整文本...

[错误]
（无）
```

**Token 估算**：使用 `Math.ceil(text.length / 3)` 作为粗估（中英混合场景下相对准确）。

**截断策略**：
- 优先截断 `[Agent 思考]`（保留 message 输出最重要）
- 仍超过 → 截断 `[Agent 输出]` 中间部分

**验收标准**：
- 单元测试覆盖 5 种以上事件组合
- 摘要输出始终在 maxTokens 范围内

---

### Task 4：反思 Agent 抽象

**优先级**：P0（反思引擎核心）
**依赖**：Task 1（读取配置）
**工作量**：4-5 小时

**目标**：用 Agent Studio 现有的 CLI adapter 机制调用便宜模型，封装为反思能力。

**新增文件**：
- `src/main/memory/ReflectionAgent.ts`

**核心类**：

```typescript
export class ReflectionAgent {
  constructor(
    private readonly runManager: RunManager,
    private readonly memoryStore: MemoryStore
  ) {}

  /**
   * 对一个信号做反思，返回提取的经验列表（已过滤 confidence < 0.6）。
   * 失败时抛出异常，调用方负责重试或暂存。
   */
  async reflect(
    signal: MemorySignal,
    agentDefinition: AgentDefinition,
    existingMemories: MemoryEntry[]
  ): Promise<ReflectionResult[]>
}
```

**实现细节**：

1. **构造反思 Prompt**（详见 §5.1）

2. **复用 RunManager 启动反思 run**：
   - `config.vendor` 和 `config.model` 取自 `MemoryStore.getReflectionConfig()`
   - `config.cwd` 用反思配置文件所在目录（不需要项目上下文）
   - `config.permissionMode` 设为 `'default'`（反思不应改文件）
   - **不走 workflow 系统**——直接调 `runManager.start()`，把所有事件收集到内存
   - 等待 `turn-done` 事件后从最后一条 `message` 解析 JSON

3. **JSON 解析**：
   - 与 `WorkflowManager.parseHandoff` 类似的多重 fallback：先纯 JSON，再 markdown code fence
   - 解析失败 → 抛 `ReflectionParseError`
   - 解析成功 → 过滤 confidence < 0.6 → 返回

4. **重试策略**：
   - 反思 run 启动失败（CLI 不存在等）→ 立即抛出，不重试
   - LLM 返回无法解析 → 重试 1 次（用同样的 prompt）
   - 还是失败 → 信号写入 `raw/`，下次启动重试

**验收标准**：
- 单元测试用 mock RunManager 验证 prompt 构造和结果解析
- 集成测试：手动触发一次反思，确认从真实 haiku 返回了有效 JSON

---

### Task 5：信号收集器（接入 WorkflowManager）

**优先级**：P0（数据来源）
**依赖**：Task 3, Task 4
**工作量**：3-4 小时

**目标**：在 WorkflowManager 的关键点位发出 MemorySignal，触发反思流程。

**修改文件**：
- `src/main/WorkflowManager.ts`

**新增文件**：
- `src/main/memory/SignalCollector.ts`

**`SignalCollector` 职责**：

```typescript
export class SignalCollector {
  constructor(
    private readonly reflectionAgent: ReflectionAgent,
    private readonly memoryStore: MemoryStore,
    private readonly agentStore: AgentStore
  ) {}

  /**
   * 接收信号并异步触发反思。
   * 立即返回，不阻塞调用方。
   * 反思失败时信号写入 raw/ 供后续重试。
   */
  collect(signal: MemorySignal): void

  /**
   * 启动时调用：清空 raw/ 中暂存的信号，重新触发反思。
   */
  drainRawSignals(): Promise<void>
}
```

**信号触发点（修改 WorkflowManager）**：

| 现有方法 | 新增逻辑 |
|---------|---------|
| `confirmStep()` | 信号 `{ type: 'positive', source: 'user-confirmed' }`，包含被确认的 step 的 events |
| `rerunStep()` | 信号 `{ type: 'negative', source: 'user-rerun' }`，包含上次失败的 events，如有 `pushInput` 文本则填入 `userAction` |
| `finishStepWithError()`（handoff 解析失败那条路径） | 信号 `{ type: 'format-error', source: 'handoff-failed' }` |
| `finishStepWithHandoff()` 且这是最后一步 | 信号 `{ type: 'completion', source: 'workflow-done' }` |

**重要约束**：
- 信号收集是**异步的**，不能阻塞 `confirmStep` 等用户操作的返回
- 在 SignalCollector 内部用 `void this.runReflection(signal)` 启动后台任务
- 反思过程中如果用户关闭 app，进行中的反思被丢弃（反正信号已经持久化到 raw/）

**强化逻辑**（也在这里实现）：
- 当 `type === 'positive'`，遍历该 step 的 prompt 中实际注入了哪些 memory（需要 Task 6 配合记录），调用 `memoryStore.reinforce()`

**验收标准**：
- 手动跑一个 workflow，点 confirm，观察后台日志确认反思被触发
- 故意触发 handoff 解析失败，验证信号被发出

---

### Task 6：运行时注入器（接入 buildPrompt）

**优先级**：P0（让 memory 真正起作用）
**依赖**：Task 1, Task 2
**工作量**：3-4 小时

**目标**：在 prompt 构造时注入相关记忆，并记录注入的 memory id 供后续强化。

**新增文件**：
- `src/main/memory/MemoryInjector.ts`

**修改文件**：
- `src/main/WorkflowManager.ts`（修改 `buildPrompt` 方法）

**`MemoryInjector` 职责**：

```typescript
export class MemoryInjector {
  constructor(private readonly memoryStore: MemoryStore) {}

  /**
   * 为一次 step 执行构建记忆上下文文本。
   * 返回的 injectedMemoryIds 供后续强化使用。
   */
  build(
    agentId: string,
    projectPath: string,
    tokenBudget: number = 1500
  ): { text: string; injectedMemoryIds: string[] }
}
```

**选择策略**：

1. 加载该 agent 的 global + 当前 project 记忆
2. 计算 currentStrength（用 forgettingCurve），过滤 < 0.3 的
3. 按 `currentStrength × categoryWeight` 排序：
   - `avoidance`: 1.2
   - `preference`: 1.1
   - `method`: 1.0
   - `knowledge`: 0.9
4. 在 tokenBudget 内取 top-K
5. 格式化输出

**输出格式**：

```
# 你的积累经验
⚠️ 避免：输出 PRD 时遗漏安全风险分析
✓ 偏好：用户喜欢简洁的 PRD 格式，不超过 2 页
→ 方法：先列出边界条件和异常场景，再写正常流程
📌 知识：这个项目前端用 React，后端用 Go

请参考以上经验，但根据当前具体情况灵活应用。

```

**注入位置**：

修改 `WorkflowManager.buildPrompt`，在返回的 prompt 字符串最前面拼接 memoryText（如有）。

```typescript
private buildPrompt(run: WorkflowRun, stepIndex: number, agent: AgentDefinition): {
  prompt: string
  injectedMemoryIds: string[]
} {
  const { text: memoryText, injectedMemoryIds } = this.memoryInjector.build(
    agent.id,
    run.projectPath
  )

  // 原有逻辑构造 mainPrompt
  const mainPrompt = /* 现有的拼接逻辑 */

  const finalPrompt = memoryText ? `${memoryText}\n${mainPrompt}` : mainPrompt
  return { prompt: finalPrompt, injectedMemoryIds }
}
```

**记录注入的 memory id**：
- 修改 `WorkflowStepExecution`，新增 `injectedMemoryIds?: string[]` 字段
- 在 `startStep` 和 `pushInput` 中保存到 execution
- 信号收集器在 `user-confirmed` 时读取该字段做强化

**验收标准**：
- 创建一条手工记忆，启动一个 step，确认 prompt 中包含该记忆
- 验证 injectedMemoryIds 被正确记录到 execution

---

### Task 7：IPC 通道 + 反思配置

**优先级**：P1
**依赖**：Task 1
**工作量**：2-3 小时

**目标**：暴露 IPC 接口给渲染进程，让 UI 能查询和管理记忆。

**修改文件**：
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`

**新增 IPC handler**：

```typescript
ipcMain.handle(IPC.memoryList, (_e, agentId: string, projectPath?: string): MemoryEntry[] =>
  memoryStore.list(agentId, projectPath)
)

ipcMain.handle(IPC.memoryDelete, (_e, memoryId: string): void =>
  memoryStore.remove(memoryId)
)

ipcMain.handle(IPC.memoryMeta, (_e, agentId: string): AgentMemoryMeta =>
  memoryStore.getMeta(agentId)
)

ipcMain.handle(IPC.reflectionConfigGet, (): ReflectionEngineConfig =>
  memoryStore.getReflectionConfig()
)

ipcMain.handle(IPC.reflectionConfigSave, (_e, config: ReflectionEngineConfig): void =>
  memoryStore.saveReflectionConfig(config)
)
```

**Preload API 暴露**：

```typescript
// preload/index.ts 在 window.api 上加入：
memoryList: (agentId: string, projectPath?: string) => ipcRenderer.invoke(IPC.memoryList, agentId, projectPath),
memoryDelete: (id: string) => ipcRenderer.invoke(IPC.memoryDelete, id),
memoryMeta: (agentId: string) => ipcRenderer.invoke(IPC.memoryMeta, agentId),
reflectionConfigGet: () => ipcRenderer.invoke(IPC.reflectionConfigGet),
reflectionConfigSave: (cfg: ReflectionEngineConfig) => ipcRenderer.invoke(IPC.reflectionConfigSave, cfg)
```

**主进程接线（修改 `ipc.ts` 的 `registerIpc`）**：

```typescript
const memoryStore = new MemoryStore()
const reflectionAgent = new ReflectionAgent(runManager, memoryStore)
const signalCollector = new SignalCollector(reflectionAgent, memoryStore, agentStore)
const memoryInjector = new MemoryInjector(memoryStore)

const workflowManager = new WorkflowManager(
  agentStore,
  workflowStore,
  runManager,
  transcriptStore,
  emitWorkflow,
  signalCollector,    // 新增
  memoryInjector      // 新增
)

// 启动时清空 raw/ 重试反思
void signalCollector.drainRawSignals()
```

**验收标准**：
- 渲染进程能成功调用所有新接口
- TypeScript 类型在 preload 和 renderer 两侧都正确

---

### Task 8：最小 UI（Agent 详情页加记忆 tab）

**优先级**：P1
**依赖**：Task 7
**工作量**：4-6 小时

**目标**：让用户能查看、删除某 agent 的记忆。

**修改文件**：
- `src/renderer/src/AgentManager.tsx`

**新增文件**：
- `src/renderer/src/AgentMemoryPanel.tsx`
- `src/renderer/src/useAgentMemories.ts`

**UI 设计**：

在 Agent 编辑视图的 system prompt 编辑区下方，新增一个折叠式区域，标题为 "记忆 (N)"，展开后展示：

```
┌─────────────────────────────────────────────────────────────┐
│ 记忆 (12 条全局 + 5 条项目)                                  │
├─────────────────────────────────────────────────────────────┤
│ [全局] [项目: my-app]                                        │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⚠️ 避免 · strength 0.85 · 强化 2次                       │ │
│ │ 输出 PRD 时遗漏安全风险分析                              │ │
│ │ 来源: run_abc123 · user-rerun · 3 天前                   │ │
│ │ [删除]                                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ → 方法 · strength 0.72 · 强化 5次                        │ │
│ │ 先列出边界条件再写正常流程                                │ │
│ │ 来源: run_def456 · user-confirmed · 1 周前               │ │
│ │ [删除]                                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**`useAgentMemories` Hook**：

```typescript
export function useAgentMemories(agentId: string | null): {
  global: MemoryEntry[]
  byProject: Map<string, { path: string; memories: MemoryEntry[] }>
  meta: AgentMemoryMeta | null
  refresh: () => Promise<void>
  remove: (memoryId: string) => Promise<void>
}
```

**组件层级**：
- `AgentMemoryPanel`（容器）
  - Tab 切换：global / each project
  - 列表渲染 + 删除按钮
- 不做编辑（V1 只读 + 删除）

**Strength 显示**：用 `computeStrength` 计算实时值，不展示原始 strength。

**Category 图标对应**：
- `avoidance`: ⚠️ 避免
- `preference`: ✓ 偏好
- `method`: → 方法
- `knowledge`: 📌 知识

**验收标准**：
- 选中一个 agent，能看到该 agent 的所有记忆
- 删除按钮工作正常
- 没有记忆时显示空状态提示

---

### Task 9：反思配置 UI

**优先级**：P2（可推后）
**依赖**：Task 7
**工作量**：2-3 小时

**目标**：用户可以选择反思引擎用什么 vendor + model，或关闭反思。

**修改文件**：
- `src/renderer/src/App.tsx`（或新建独立 Settings 页）

**UI 设计**：

在主导航或 Agent 管理页加一个 "记忆设置" 入口（首版可放在 Agent 管理页顶部）：

```
┌─────────────────────────────────────────────┐
│ 记忆 / 反思设置                              │
├─────────────────────────────────────────────┤
│ ☑ 启用记忆系统                              │
│                                             │
│ 反思引擎:                                    │
│   Vendor: [claude ▾]                        │
│   Model:  [claude-haiku-4-5-20251001 ▾]    │
│                                             │
│ 说明: 反思每次 workflow step 完成后异步运行,│
│       建议用便宜模型 (haiku / flash) 节省成本│
└─────────────────────────────────────────────┘
```

**验收标准**：
- 修改配置后，下次反思使用新配置
- 关闭后，SignalCollector 不再触发反思（但仍然记录强化）

---

### Task 10：测试 + 文档

**优先级**：P1
**依赖**：所有 P0 任务
**工作量**：3-4 小时

**目标**：保证基本功能可用，给后续维护留下文档。

**测试文件**：
- `tests/memory-store.test.mjs`
- `tests/forgetting-curve.test.mjs`
- `tests/transcript-summarizer.test.mjs`
- `tests/memory-injector.test.mjs`

**测试覆盖**：

| 模块 | 测试要点 |
|------|---------|
| MemoryStore | 增删查改、目录创建、错误吞掉 |
| ForgettingCurve | 各种 reinforceCount × days 组合下的衰减值 |
| TranscriptSummarizer | 各种事件组合、token 截断 |
| MemoryInjector | category 权重排序、token 预算遵循、空记忆返回空字符串 |

**集成测试（手工执行清单）**：

```
□ 创建一个 PM agent
□ 启动一个 workflow run，跑到 awaiting-confirm
□ 点 confirm，等 30 秒后查看 agent 记忆 tab，确认有新记忆
□ 再启动同一个 workflow 在同一项目下
□ 查看新启动 run 的 step 0 的 transcript，确认 prompt 开头有记忆上下文
□ 故意写一个会让 handoff JSON 解析失败的 prompt，触发 handoff-failed 信号
□ 确认这条 negative 信号也产生了 avoidance 类记忆
□ 在记忆 tab 删除一条记忆，确认 UI 和文件都消失
□ 关闭反思设置，confirm 后不再产生新记忆
```

**新增文档**：
- `docs/memory-system.md`：用户视角的功能说明
- 代码注释：每个 manager 类的顶部注释解释职责

---

## 五、关键 Prompt 模板

### 5.1 反思引擎的 Prompt

```
你是一个 agent 经验提取器。分析以下 agent 运行记录，提取值得记住的经验，帮助这个 agent 在未来类似任务中表现更好。

## Agent 角色定义
名称: {{agent.name}}
角色: {{agent.role}}
System Prompt:
{{agent.systemPrompt}}

## 本次运行信号
信号类型: {{signal.type}} (来源: {{signal.source}})
{{#if signal.type === 'positive'}}
说明: 用户确认了这次输出，说明 agent 这次做得对。从 transcript 中提取「什么做法导致了成功」。
{{/if}}
{{#if signal.type === 'negative'}}
说明: 用户重跑了这一步，说明上次输出不够好。分析「哪里做得不够好」、「下次应该怎么改进」。
{{#if signal.userAction}}用户的修复指令: {{signal.userAction}}{{/if}}
{{/if}}
{{#if signal.type === 'format-error'}}
说明: 这次输出无法解析为合法 handoff JSON，提取「应避免的输出格式问题」。
错误: {{signal.error}}
{{/if}}
{{#if signal.type === 'completion'}}
说明: 整个 workflow 顺利完成，提取「全流程中可推广的最佳实践」。
{{/if}}

## 项目路径
{{signal.projectPath}}

## 运行 Transcript (已精简)
{{signal.transcript}}

## 已有记忆（避免重复提取相同经验）
{{#each existingMemories}}
- [{{category}}] {{content}}
{{/each}}

## 输出要求

请提取 0-3 条值得记住的经验。宁缺毋滥——只提取真正有指导价值、且尚未被已有记忆覆盖的内容。

每条经验必须包含:
- category: 必须是以下之一
  - "method"     方法论 (如何做某事)
  - "knowledge"  领域知识 (项目/技术相关事实)
  - "preference" 用户偏好 (用户喜欢/不喜欢什么)
  - "avoidance"  应避免的做法
- scope: 必须是以下之一
  - "global"     跨项目通用 (如方法论、通用规则)
  - "project"    仅限当前项目 (如项目特定技术栈、特定要求)
- content: 一句话描述这条经验，必须是具体的、可操作的、面向未来 agent 行为的指导语
- confidence: 你对这条经验正确性的信心，0 到 1 的浮点数

不要提取:
- 与已有记忆重复的内容
- 过于笼统的废话 (如 "要认真做事")
- 一次性的偶然事件 (没有可推广价值)
- confidence 低于 0.6 的不确定经验

## 输出格式

严格输出 JSON 数组，不要任何额外文字、解释或 markdown 代码块包裹：

[
  {"category": "method", "scope": "global", "content": "...", "confidence": 0.85},
  {"category": "avoidance", "scope": "project", "content": "...", "confidence": 0.75}
]

如果没有值得记的经验，输出空数组: []
```

---

## 六、改动清单总结

### 新增文件

```
src/main/memory/
├── MemoryStore.ts             (Task 1)
├── forgettingCurve.ts         (Task 2)
├── transcriptSummarizer.ts    (Task 3)
├── ReflectionAgent.ts         (Task 4)
├── SignalCollector.ts         (Task 5)
└── MemoryInjector.ts          (Task 6)

src/renderer/src/
├── AgentMemoryPanel.tsx       (Task 8)
├── useAgentMemories.ts        (Task 8)
└── ReflectionSettings.tsx     (Task 9)

tests/
├── memory-store.test.mjs       (Task 10)
├── forgetting-curve.test.mjs   (Task 10)
├── transcript-summarizer.test.mjs (Task 10)
└── memory-injector.test.mjs    (Task 10)

docs/
└── memory-system.md            (Task 10)
```

### 修改文件

```
src/shared/types.ts              (Task 1: 新增类型 + IPC channels)
src/main/WorkflowManager.ts      (Task 5, Task 6: 信号触发 + 注入)
src/main/ipc.ts                  (Task 7: 接线 + 新 handler)
src/preload/index.ts             (Task 7: 暴露 API)
src/preload/index.d.ts           (Task 7: 类型)
src/renderer/src/AgentManager.tsx (Task 8: 集成记忆 panel)
src/renderer/src/App.tsx          (Task 9: 设置入口)
```

---

## 七、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 反思 LLM 返回低质量经验，污染记忆库 | confidence < 0.6 过滤 + 用户可在 UI 删除 |
| Haiku 不可用（用户没装/没付费） | 反思失败信号暂存 raw/，下次再试；UI 提示 |
| 记忆膨胀（数百条） | 遗忘曲线自动清理 + UI 显示 strength |
| 注入的记忆挤占用户 prompt token | 默认 1500 token 预算，可后续配置 |
| Agent 删除时孤儿记忆 | `agentsDelete` IPC handler 调用 `memoryStore.removeByAgent()` |
| 项目路径迁移（重命名/移动）记忆找不到 | V1 不处理，记录在已知问题里 |

---

## 八、实施顺序建议

```
Day 1-2: Task 1 (MemoryStore) + Task 2 (ForgettingCurve)
         ↓ 此时已有完整存储层
Day 3:   Task 3 (TranscriptSummarizer)
         ↓ 此时摘要可用
Day 4-5: Task 4 (ReflectionAgent) + Task 5 (SignalCollector)
         ↓ 此时能从 workflow 自动产出记忆
Day 6:   Task 6 (MemoryInjector)
         ↓ 此时记忆开始影响 agent 行为（核心闭环完成）
Day 7:   Task 7 (IPC) + Task 10 (核心模块单测)
         ↓ 此时主进程功能稳定
Day 8-9: Task 8 (UI)
         ↓ 此时用户可见可管理
Day 10:  Task 9 (配置 UI) + Task 10 (集成测试 + 文档)
```

**关键里程碑**：完成 Task 6 后系统已经能闭环运行（只是没 UI），可以先内部验证记忆是否真的提升 agent 表现，再决定是否继续推进 UI 部分。

---

## 九、验收标准（整体）

V1 完整版交付时必须满足：

- ✅ 用户跑完一个 workflow 并点 confirm，30 秒内能在 agent 记忆 tab 看到新记忆
- ✅ 同一个 agent 在同一项目下第二次跑同类任务，prompt 中包含上次的经验
- ✅ 用户能在 UI 中查看和删除任何记忆
- ✅ 用户能配置反思引擎用什么模型，或关闭反思
- ✅ 重启 app 后所有记忆和配置保持
- ✅ 反思失败（CLI 异常、JSON 错误）不影响 workflow 正常运行
- ✅ 删除 agent 时其所有记忆一并清理
- ✅ 所有 P0 任务的单元测试通过
- ✅ 集成测试清单全部手工通过
