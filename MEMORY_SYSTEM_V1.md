# Agent 记忆系统 V1 设计方案

## 设计哲学

四个来源各取一个核心洞察：

| 来源 | 取什么 | 为什么 |
|------|--------|--------|
| **Reflexion** | 信号驱动学习——只在明确信号时学习 | Agent Studio 有天然信号（confirm/rerun/error），不需要猜 |
| **Voyager** | 只存验证过的成功模式 | 避免垃圾记忆积累，正面经验比负面更有指导价值 |
| **MemoryBank** | 遗忘曲线——越用越牢，不用就衰减 | 解决记忆无限增长 + 过时记忆污染 |
| **Claude Code** | 文件存储，无外部依赖 | 桌面 App 不想让用户装 ChromaDB |

---

## 整体架构

```
                    ┌─────────────────────────────────┐
                    │         Agent Studio            │
                    └────────────┬────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
    ┌─────────────────┐  ┌────────────┐  ┌─────────────────┐
    │  信号收集器       │  │  记忆存储   │  │  运行时注入器     │
    │  (Signal        │  │  (Memory   │  │  (Injector)     │
    │   Collector)    │  │   Store)   │  │                 │
    └────────┬────────┘  └─────┬──────┘  └────────┬────────┘
             │                 │                   │
             │    写入          │    读取            │
             ▼                 ▼                   ▼
    ┌──────────────────────────────────────────────────────┐
    │                  记忆文件系统                           │
    │                                                      │
    │  <userData>/memories/                                 │
    │    ├── agents/                                       │
    │    │   ├── <agentId>/                               │
    │    │   │   ├── meta.json        (记忆元数据+统计)     │
    │    │   │   ├── global.json      (全局规则)           │
    │    │   │   └── projects/                            │
    │    │   │       └── <hash>.json  (项目级记忆)         │
    │    │   └── ...                                      │
    │    └── raw/                                          │
    │        └── <runId>.json         (未整合的碎片)        │
    └──────────────────────────────────────────────────────┘
```

---

## 组件一：信号收集器（Signal Collector）

**只在四种明确信号时触发学习**：

```typescript
interface MemorySignal {
  type: 'positive' | 'negative' | 'format-error' | 'completion'
  source: 'user-confirmed' | 'user-rerun' | 'handoff-failed' | 'workflow-done'
  runId: string
  stepIndex: number
  agentId: string
  projectPath: string
  timestamp: number
  transcript: string        // 该 step 的精简 transcript
  handoff?: HandoffArtifact
  error?: string
  userAction?: string       // 用户重跑时输入的修复指令
}
```

| 信号 | 触发时机 | 学到什么 | 对应论文 |
|------|---------|---------|---------|
| `user-confirmed` | 用户点"确认并继续" | 这次做得对，记住方法 | Voyager（成功技能） |
| `user-rerun` | 用户点"重新运行" | 上次不够好，分析原因 | Reflexion（失败反思） |
| `handoff-failed` | JSON 解析失败 | 输出格式问题 | Reflexion（失败反思） |
| `workflow-done` | 整个 workflow 完成 | 全流程总结 | Stanford GA（反思） |

**不学习的场景**：
- agent 正在运行中 → 不学
- 用户只是在看 transcript → 不学
- agent 被 abort → 不学（没有结果信号）

---

## 组件二：反思引擎（Reflection Engine）

信号触发后，用便宜模型对 transcript 做反思，提取结构化经验。

**数据结构**：

```typescript
interface MemoryEntry {
  id: string
  agentId: string
  scope: 'global' | 'project'
  projectPath?: string
  category: 'method' | 'knowledge' | 'preference' | 'avoidance'
  content: string           // 自然语言描述的经验/规则
  evidence: string          // 来自哪次 run 的什么信号
  strength: number          // 0-1，遗忘曲线管理
  createdAt: number
  lastReinforcedAt: number
  reinforceCount: number    // 被强化了几次
}
```

**反思 Prompt 模板**：

```
你是一个经验提取器。分析以下 agent 运行记录，提取值得记住的经验。

## Agent 角色
名称：{{agent.name}}
角色：{{agent.role}}

## 本次运行信号
类型：{{signal.type}}（{{signal.source}}）
{{#if signal.type === 'positive'}}
用户确认了这次输出，说明方法是对的。提取"什么做法导致了成功"。
{{/if}}
{{#if signal.type === 'negative'}}
用户重跑了这一步，说明上次不满意。分析"哪里做得不够好"。
{{#if signal.userAction}}用户的修复指令是：{{signal.userAction}}{{/if}}
{{/if}}

## 运行 Transcript（精简版）
{{signal.transcript}}

## 已有记忆（避免重复）
{{existingMemories.map(m => `- ${m.content}`).join('\n')}}

## 输出要求
提取 0-3 条经验。每条经验：
- category：method | knowledge | preference | avoidance
- scope：global | project
- content：一句话描述（具体、可操作、面向未来）
- confidence：0-1

输出 JSON：
[{"category": "...", "scope": "...", "content": "...", "confidence": 0.8}]
```

**约束**：
- 只提取 0-3 条——宁缺毋滥
- confidence < 0.6 的直接丢弃
- 与已有记忆去重
- 用便宜模型（haiku / deepseek-flash），成本约 $0.005-0.02 每次

---

## 组件三：遗忘曲线（Forgetting Curve）

```typescript
function computeStrength(memory: MemoryEntry, now: number): number {
  const daysSinceReinforced = (now - memory.lastReinforcedAt) / (1000 * 60 * 60 * 24)
  
  // 稳定性因子：被强化次数越多，衰减越慢
  const stability = 1 + memory.reinforceCount * 0.5
  
  // 艾宾浩斯衰减
  const decay = Math.exp(-daysSinceReinforced / (stability * 7))
  
  return Math.max(0, memory.strength * decay)
}
```

**强化规则**：
- 记忆被注入且该 run 成功 → `reinforceCount++`，strength 重置
- 记忆被注入但 run 失败 → 不强化（不惩罚，可能是其他原因失败）

**清理规则**：
- `strength < 0.2` → 待清理
- 下次启动 app 或手动触发时清理

---

## 组件四：运行时注入器（Injector）

```typescript
function buildMemoryContext(
  agentId: string, 
  projectPath: string, 
  tokenBudget: number = 1500
): string {
  const now = Date.now()
  
  // 1. 加载全局 + 项目记忆
  const globalMemories = loadGlobalMemories(agentId)
  const projectMemories = loadProjectMemories(agentId, projectPath)
  const all = [...globalMemories, ...projectMemories]
  
  // 2. 计算当前 strength，过滤太弱的
  const alive = all
    .map(m => ({ ...m, currentStrength: computeStrength(m, now) }))
    .filter(m => m.currentStrength >= 0.3)
  
  // 3. 排序：strength × category权重
  const categoryWeight = { avoidance: 1.2, preference: 1.1, method: 1.0, knowledge: 0.9 }
  const sorted = alive.sort((a, b) => 
    (b.currentStrength * categoryWeight[b.category]) - 
    (a.currentStrength * categoryWeight[a.category])
  )
  
  // 4. token 预算内选取 top-K
  let tokenCount = 0
  const selected: MemoryEntry[] = []
  for (const m of sorted) {
    const tokens = estimateTokens(m.content)
    if (tokenCount + tokens > tokenBudget) break
    selected.push(m)
    tokenCount += tokens
  }
  
  // 5. 格式化
  if (selected.length === 0) return ''
  
  const lines = selected.map(m => {
    const prefix = m.category === 'avoidance' ? '⚠️ 避免：' :
                   m.category === 'preference' ? '✓ 偏好：' :
                   m.category === 'method' ? '→ 方法：' : '📌 知识：'
    return `${prefix}${m.content}`
  })
  
  return [
    '# 你的积累经验',
    ...lines,
    '',
    '请参考以上经验，但根据当前具体情况灵活应用。'
  ].join('\n')
}
```

**注入位置**：`WorkflowManager.buildPrompt()` 中，prompt 正文最前面。

---

## 存储结构

```
<userData>/memories/
  ├── agents/
  │   ├── <agentId>/
  │   │   ├── meta.json
  │   │   ├── global.json
  │   │   └── projects/
  │   │       └── <projectHash>.json
  │   └── ...
  └── raw/
      └── <runId>.json
```

**`meta.json`**：
```json
{
  "agentId": "agent_pm_01",
  "totalRuns": 23,
  "totalMemories": 12,
  "lastReflectionAt": 1717900000
}
```

**`global.json` / `projects/<hash>.json`**：
```json
[
  {
    "id": "mem_001",
    "category": "method",
    "content": "输出 PRD 时先列出边界条件和异常场景，再写正常流程",
    "evidence": "run_abc123 step 0: user confirmed",
    "strength": 0.92,
    "createdAt": 1717200000,
    "lastReinforcedAt": 1717800000,
    "reinforceCount": 3
  }
]
```

---

## 实现路线

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| V0.1 | 信号收集 + 碎片存储（不反思、不注入） | 2 天 |
| V0.2 | 反思引擎 + 运行时注入 | 2-3 天 |
| V0.3 | 遗忘曲线 + 强化逻辑 | 1-2 天 |
| V0.4 | UI 可视化（查看/删除记忆） | 2-3 天 |
| V0.5 | 睡眠整合（可选） | 3-5 天 |

---

## 方案优劣

**优点**：
- 零外部依赖（纯 JSON 文件）
- 信号明确不过度学习
- 正面为主避免垃圾（Voyager 思路）
- 自动遗忘不会膨胀（MemoryBank 遗忘曲线）
- 可调试（JSON 文件人可读）
- 渐进式实现

**缺点/风险**：
- 反思质量依赖便宜模型
- 没有语义检索（靠分类+排序），记忆量大时可能不精准
- 需要额外 LLM 调用做反思（每次约 $0.005-0.02）
