# Agent Studio 完整实现方案

## Context

用户需要一个 macOS 桌面软件(类似 Claude Desktop / Codex Desktop),核心功能是"多 AI agent 编排工作流"。当前是绿地项目,需要从零搭建。

**核心需求**:
- 预先定义多个 agent(需求分析/UI设计/写代码/测试),每个 agent 绑定不同的 CLI(claude / gemini / codex)
- agent 串成线性工作流(可复用模板),A 跑完自动交接给 B
- 用户只在交接点确认,不手动编辑交接物
- 用户能中途多轮插话,也能回头重跑之前的 agent
- agent 能读本地文件和图片,能全局改真实代码

**技术路线**: Electron + React + TypeScript + Vite,编排用户机器上已装好的官方 CLI(claude / gemini / codex)作为执行引擎,不自建 LLM tool-loop。

**已确认的关键决策**:
1. **重跑策略**: 回头重跑某 step 后,下游标记 stale 但不自动重跑,等用户手动确认
2. **交接物来源**: 用 schema 强制 agent 自己产出结构化交接物(如 `{summary, artifacts: [{path, desc}]}`)
3. **中途插话**: 插话只影响当前 agent,不记录到工作流历史,下游 agent 看不到
4. **产物隔离**: 子文件夹用 `step-{n}/` 命名,每次重跑产生新序号,历史产物自动保留

---

## 架构设计

### 1. 核心抽象层

#### 1.1 CliAdapter — 统一三家 CLI 的执行接口

三家 CLI 的参数、输出格式、会话恢复机制都不同。设计统一接口,让上层编排引擎不关心底层是哪家。

**关键设计决策**:
- 不抽象成"双向流",抽象成"回合(Turn)":喂输入 → 跑 → 吐归一化事件 → done
- claude 的双向 stdin 是这个模型的超集,用 `capabilities.bidirectionalStdin` 标记
- 三家的 stdout 各自解析成统一的 `AgentEvent` 流

**核心类型** (`src/main/adapters/types.ts`):
```typescript
type AgentVendor = 'claude' | 'gemini' | 'codex';

interface AdapterCapabilities {
  bidirectionalStdin: boolean;    // 仅 claude=true
  structuredOutputSchema: boolean; // claude/codex=true, gemini=false
  partialTokenStream: boolean;     // claude=true
}

type AgentEvent =
  | { kind: 'session-started'; sessionId: string; vendor: AgentVendor }
  | { kind: 'message'; role: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool-call'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; ok: boolean; output: unknown }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'turn-done'; sessionId: string; reason: 'complete'|'error' }
  | { kind: 'error'; recoverable: boolean; message: string };

interface RunTurnInput {
  prompt: string;
  cwd: string;
  addDirs?: string[];
  model?: string;
  appendSystemPrompt?: string;
  outputSchema?: JSONSchema;  // 交接物 schema
  resumeFrom?: { sessionId: string; vendor: AgentVendor; transcriptPath: string };
  abortSignal: AbortSignal;
}

interface CliAdapter {
  readonly vendor: AgentVendor;
  readonly capabilities: AdapterCapabilities;
  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent>;
  pushInput?(text: string): Promise<void>; // 仅 claude 实现
}
```

**三家实现** (`src/main/adapters/{claude,gemini,codex}Adapter.ts`):
- **ClaudeAdapter**: 用 `--output-format stream-json --input-format stream-json` 拿结构化事件,用 `--output-schema` 强制交接物格式,用 `--resume` 恢复会话,实现 `pushInput` 支持中途插话
- **GeminiAdapter**: 用 `-p --approval-mode yolo` 单次 exec,解析文本输出(弱结构化),用自存的 transcript 重建上下文
- **CodexAdapter**: 用 `codex exec --output-schema` 拿结构化输出,用 `codex exec resume` 恢复会话

**关键工程点**:
- gemini 没有结构化 tool 事件,`file-changed` 事件靠跑完后 `git diff` 兜底
- 三家都必须在 app 层自存完整 transcript(gemini session 30 天自动清理,不能当数据源)
- resume 失败时降级为"重建 prompt"(从 transcript 拼接历史消息)

#### 1.2 状态机 — 工作流执行与 stale 传播

**Step 状态枚举** (`src/main/orchestrator/types.ts`):
```typescript
type StepStatus =
  | 'pending'            // 未开始
  | 'running'            // CLI 进程正在跑
  | 'awaiting-confirm'   // 跑完等用户确认交接
  | 'done'               // 用户已确认
  | 'stale'              // 上游重跑后失效
  | 'error';             // 出错

interface StepExecution {
  stepId: string;
  status: StepStatus;
  sessionId?: string;
  outputDir: string;        // step-{n}/
  handoff?: HandoffArtifact; // 交接物
  transcript: AgentEvent[]; // 完整事件流
  startedAt?: Date;
  finishedAt?: Date;
}
```

**重跑逻辑** (`src/main/orchestrator/StateMachine.ts`):
```typescript
// 回头重跑 stepIndex,下游全部标记 stale
function rerunStep(workflowRun: WorkflowRun, stepIndex: number) {
  // 1. 标记下游 stale
  for (let i = stepIndex + 1; i < workflowRun.steps.length; i++) {
    if (workflowRun.steps[i].status === 'done') {
      workflowRun.steps[i].status = 'stale';
    }
  }
  
  // 2. 当前 step 产生新 execution(新 step 序号,如 step-2-retry-1/)
  const retryCount = workflowRun.steps[stepIndex].executions.length;
  const newExec: StepExecution = {
    stepId: workflowRun.steps[stepIndex].id,
    status: 'pending',
    outputDir: `step-${stepIndex + 1}-retry-${retryCount}`,
    transcript: [],
  };
  workflowRun.steps[stepIndex].executions.push(newExec);
  
  // 3. 启动新 execution
  return runStepExecution(workflowRun, stepIndex, newExec);
}
```

**stale 恢复**: 用户点击 stale 的 step,弹窗提示"上游已变更,是否重跑此步骤?",确认后调用 `rerunStep`。

#### 1.3 交接协议 — A 自己产出 schema 约束的交接物

**交接物 schema** (`src/main/orchestrator/handoff-schema.json`):
```json
{
  "type": "object",
  "required": ["summary", "artifacts"],
  "properties": {
    "summary": {
      "type": "string",
      "description": "本步骤完成了什么,下游需要知道的关键信息"
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "description"],
        "properties": {
          "path": { "type": "string" },
          "description": { "type": "string" },
          "type": { "enum": ["requirement", "design", "code", "test", "other"] }
        }
      }
    },
    "nextStepGuidance": {
      "type": "string",
      "description": "给下游 agent 的建议(可选)"
    }
  }
}
```

**注入到下游** (`src/main/orchestrator/Handoff.ts`):
```typescript
function buildNextStepPrompt(
  userInitialPrompt: string,
  upstreamHandoff: HandoffArtifact,
  currentStepDef: AgentDefinition
): string {
  return `
# 你的角色
${currentStepDef.systemPrompt}

# 上游交接
上一步骤(${upstreamHandoff.fromStep})已完成,交接给你:

${upstreamHandoff.summary}

产物清单:
${upstreamHandoff.artifacts.map(a => `- ${a.path}: ${a.description}`).join('\n')}

${upstreamHandoff.nextStepGuidance ? `\n建议: ${upstreamHandoff.nextStepGuidance}` : ''}

# 用户初始需求
${userInitialPrompt}

# 你的任务
请根据上游产物和用户需求,完成你的工作。完成后用指定的 schema 输出交接物。
`.trim();
}
```

**校验**: claude/codex 用 `--output-schema` 强制输出符合 schema,gemini 靠 prompt 要求并事后校验(JSON.parse 失败时提示用户手动修正或重跑)。

---

### 2. 数据持久化

#### 2.1 存储方案: SQLite + JSON + ShadowGit

**SQLite** (`src/main/persistence/schema.sql`):
```sql
-- Agent 定义(模板)
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,  -- 'requirement'|'design'|'dev'|'test'
  vendor TEXT NOT NULL,  -- 'claude'|'gemini'|'codex'
  model TEXT,
  system_prompt TEXT,
  created_at INTEGER
);

-- 工作流模板
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  steps_json TEXT NOT NULL,  -- [{agentId, order}, ...]
  created_at INTEGER
);

-- 工作流运行实例
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id),
  project_path TEXT NOT NULL,
  user_initial_prompt TEXT,
  status TEXT,  -- 'running'|'paused'|'completed'|'error'
  current_step_index INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);

-- Step 执行记录
CREATE TABLE step_executions (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES workflow_runs(id),
  step_index INTEGER,
  agent_id TEXT REFERENCES agents(id),
  session_id TEXT,
  output_dir TEXT,
  transcript_path TEXT,  -- 完整 transcript JSON 文件路径
  handoff_json TEXT,
  status TEXT,
  started_at INTEGER,
  finished_at INTEGER
);
```

**Transcript 落盘**: 每个 execution 的完整 `AgentEvent[]` 存到 `~/.agent-studio/transcripts/{run_id}/{step_id}.json`,SQLite 只存路径。

**ShadowGit**: 每个 workflow run 在项目根创建 `.agent-studio/shadow/` 作为 git worktree(或简单的文件快照),每个 step 跑完 commit 一次。`git diff` 用于:
- gemini 的 `file-changed` 事件兜底
- 对比某 step 前后的文件变更
- 重跑某 step 时恢复到该 step 之前的状态

#### 2.2 配置文件

**全局配置** (`~/.agent-studio/config.json`):
```json
{
  "cliPaths": {
    "claude": "/usr/local/bin/claude",
    "gemini": "/usr/local/bin/gemini",
    "codex": "/usr/local/bin/codex"
  },
  "defaultVendor": "claude",
  "defaultModel": {
    "claude": "claude-opus-4",
    "gemini": "gemini-2.0-flash-exp",
    "codex": "gpt-4"
  }
}
```

**项目配置** (`.agent-studio/project.json`,可选):
```json
{
  "name": "MyProject",
  "defaultWorkflow": "full-dev-pipeline"
}
```

---

### 3. UI 设计

#### 3.1 核心界面

**主界面** (`src/renderer/views/Main.tsx`):
- 左侧: Agent 库 + Workflow 模板库
- 中间: 当前 workflow run 的 step 列表(卡片流),每个卡片显示:
  - Agent 名称 + 图标(claude/gemini/codex logo)
  - 状态指示(pending/running/done/stale/error)
  - 简短摘要(handoff.summary 前 100 字)
  - 按钮: 查看详情 / 重跑 / 确认(awaiting-confirm 时)
- 右侧: 当前 step 的详情面板:
  - 完整 transcript(流式滚动)
  - 产物清单(点击打开文件)
  - 交接物完整内容
  - 中途插话输入框(仅 running 状态且 vendor=claude 时显示)

**Workflow 编辑器** (`src/renderer/views/WorkflowEditor.tsx`):
- 可视化拖拽:从 Agent 库拖到画布,自动连线成线性管道
- 每个 step 卡片显示: Agent 名称 + 绑定的 CLI vendor + 简短 system prompt 预览
- 保存为模板(存到 SQLite workflows 表)

**Agent 配置界面** (`src/renderer/views/AgentConfig.tsx`):
- 表单: name / role / vendor / model / system_prompt(多行文本框)
- vendor 下拉选择时,自动填充 defaultModel
- 保存到 SQLite agents 表

#### 3.2 关键交互

**启动 workflow**:
1. 用户选择 workflow 模板 + 填写初始需求(多行文本)
2. 选择项目根目录(文件夹选择器)
3. 点击"开始"→ 创建 workflow_run,启动第一个 step

**Step 运行中**:
- transcript 流式滚动显示(websocket 从 main process 推送 `AgentEvent`)
- claude 时显示"中途插话"输入框,输入后调用 `adapter.pushInput()`
- 跑完后状态变 `awaiting-confirm`,显示交接物 + "确认并继续"按钮

**确认交接**:
- 用户点击"确认",step 状态变 `done`,自动启动下一个 step
- 下一个 step 的 prompt = `buildNextStepPrompt(userInitialPrompt, lastHandoff, currentStepDef)`

**回头重跑**:
- 用户点击已 done 的 step 卡片 → 右侧详情面板显示"重跑此步骤"按钮
- 点击 → 弹窗确认"下游 N 个步骤将标记为过期" → 调用 `rerunStep()`
- 下游 stale 的 step 卡片显示警告图标,用户逐个点击确认重跑

**stale 恢复**:
- 点击 stale 的 step → 弹窗"上游已变更,是否重跑?" → 确认 → 调用 `rerunStep()`

---

### 4. 目录结构

```
agent-studio/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # 入口
│   │   ├── adapters/
│   │   │   ├── types.ts         # CliAdapter 接口定义
│   │   │   ├── claudeAdapter.ts
│   │   │   ├── geminiAdapter.ts
│   │   │   └── codexAdapter.ts
│   │   ├── orchestrator/
│   │   │   ├── types.ts         # WorkflowRun / StepExecution 类型
│   │   │   ├── StateMachine.ts  # 状态机 + 重跑逻辑
│   │   │   ├── Handoff.ts       # 交接物生成/注入
│   │   │   └── handoff-schema.json
│   │   ├── persistence/
│   │   │   ├── db.ts            # better-sqlite3 wrapper
│   │   │   ├── schema.sql
│   │   │   └── ShadowGit.ts     # git diff / worktree 封装
│   │   └── ipc.ts               # IPC handlers
│   ├── renderer/                # React UI
│   │   ├── App.tsx
│   │   ├── views/
│   │   │   ├── Main.tsx
│   │   │   ├── WorkflowEditor.tsx
│   │   │   └── AgentConfig.tsx
│   │   ├── components/
│   │   │   ├── StepCard.tsx
│   │   │   ├── TranscriptViewer.tsx
│   │   │   └── HandoffPanel.tsx
│   │   └── hooks/
│   │       └── useWorkflowRun.ts
│   └── shared/
│       └── types.ts             # 跨进程共享类型
├── package.json
├── tsconfig.json
├── vite.config.ts               # Vite + electron-vite
└── electron-builder.yml
```

---

### 5. 实现里程碑

#### M1: 单 agent 可用(1-2 周)
- CliAdapter 接口 + ClaudeAdapter 实现(其他两家先 stub)
- 最简 UI:一个输入框 + 一个 transcript 面板
- 能启动 claude,流式显示输出,读文件/改文件
- **验证**: 给它一个需求,它能改代码并显示完整过程

#### M2: 双 agent 接力(1-2 周)
- StateMachine + Handoff 逻辑
- 交接物 schema + 注入到下游 prompt
- UI 显示两个 step 卡片,第一个跑完 → 等确认 → 自动启动第二个
- **验证**: "需求分析 agent" → "开发 agent" 接力,开发 agent 能读到需求文档

#### M3: 完整工作流 + 重跑(2-3 周)
- GeminiAdapter + CodexAdapter 实现
- 完整状态机(stale 传播 + 重跑)
- Workflow 编辑器 + Agent 配置界面
- ShadowGit 快照 + 恢复
- **验证**: 4 步工作流(需求→设计→开发→测试),回头重跑设计,开发和测试自动标 stale

#### M4: 中途插话 + 产物管理(1 周)
- claude 的 `pushInput` 实现
- UI 插话输入框 + transcript 高亮插话消息
- 产物清单点击打开文件
- **验证**: 开发 agent 跑的过程中插话"别删那个文件",它停止删除动作

#### M5: 持久化 + 历史回溯(1 周)
- SQLite 完整 schema + transcript 落盘
- UI 显示历史 workflow runs,点击可恢复查看
- step-{n}-retry-{m} 历史产物保留
- **验证**: 重启 app 后,上次未完成的 workflow 能恢复,历史产物能查看对比

---

### 6. 验证方案

#### 端到端测试场景
1. **简单需求全流程**:
   - 启动 4 步 workflow:"需求分析(gemini) → UI 设计(gemini) → 开发(claude) → 测试(claude)"
   - 初始 prompt:"做一个 TODO 应用,支持增删改查"
   - 验证:需求 agent 产出 requirements.md → 设计 agent 产出 design.md + wireframe.png → 开发 agent 写出 todo.ts → 测试 agent 写出 todo.test.ts
   - 确认:每个交接物包含 summary + artifacts,下游能正确读取上游产物

2. **回头重跑**:
   - 在步骤 3(开发)完成后,回头重跑步骤 2(UI 设计)
   - 验证:步骤 3 和 4 标记 stale,UI 显示警告
   - 重跑步骤 3 → 确认新产物落到 step-3-retry-1/,旧产物仍在 step-3/

3. **中途插话**(仅 claude):
   - 开发 agent 跑的过程中,插话"用 Map 而不是数组存 TODO"
   - 验证:它修改实现方式,transcript 显示插话消息
   - 下游测试 agent 看不到这条插话(交接物里没有)

4. **异常恢复**:
   - 开发 agent 跑到一半,手动 kill 进程
   - 验证:UI 显示 error 状态,可点击"重试"恢复

5. **产物隔离**:
   - 项目根 `/tmp/test-project/` 下,workflow 运行后产生:
     - `.agent-studio/shadow/` (git worktree)
     - `step-1/` (需求 agent 产物)
     - `step-2/` (设计 agent 产物)
     - `src/todo.ts` (开发 agent 改的真实代码)
   - 验证:开发 agent 能读 step-1/requirements.md,能改 src/todo.ts(全局)

---

### 7. 风险与缓解

#### 风险 1: CLI 子进程管理复杂(僵尸进程/信号处理/重启)
**缓解**:
- 用 `execa` 管理子进程,设置 `killSignal: 'SIGTERM'`,超时后 `SIGKILL`
- 进程 PID 存到 SQLite,app 启动时清理遗留进程
- 每个 step 独立子进程,崩溃不影响其他 step

#### 风险 2: gemini 输出弱结构化,交接物解析可能失败
**缓解**:
- prompt 里给出 JSON 例子,明确要求"必须输出 JSON"
- 解析失败时,UI 显示原始输出 + "交接物格式错误,是否重跑?"
- 提供"手动编辑交接物"兜底(违背"不手动编辑"原则,但总比卡死强)

#### 风险 3: 重跑后产物路径变化,下游可能找不到文件
**缓解**:
- 交接物的 `artifacts[].path` 用绝对路径(基于项目根)
- 重跑时,app 层自动更新交接物里的路径(step-2/ → step-2-retry-1/)
- 或者:重跑时把新产物软链接到固定路径(step-2/ 始终指向最新)

#### 风险 4: 长 workflow token 开销爆炸
**缓解**:
- 每个 step 只接收上游交接物(摘要),不接收完整 transcript
- 用户初始 prompt 只传给第一个 step,后续 step 只看交接物
- claude 的 prompt caching 自动生效(system prompt 固定部分)

#### 风险 5: 用户可能不理解 stale 的含义,误操作
**缓解**:
- UI 明确文案:"上游已变更,此步骤结果可能过期"
- stale 的 step 卡片显眼的黄色警告边框
- 点击 stale step 时弹窗解释:"建议重跑以获取最新结果"

---

### 8. 关键文件与依赖

**新建文件**(按实现顺序):
1. `src/main/adapters/types.ts` — CliAdapter 接口(M1)
2. `src/main/adapters/claudeAdapter.ts` — Claude 实现(M1)
3. `src/main/orchestrator/types.ts` — 状态机类型(M2)
4. `src/main/orchestrator/Handoff.ts` — 交接逻辑(M2)
5. `src/main/orchestrator/StateMachine.ts` — 重跑逻辑(M3)
6. `src/main/persistence/db.ts` — SQLite 封装(M5)
7. `src/renderer/views/Main.tsx` — 主界面(M1 起)
8. `src/renderer/components/StepCard.tsx` — Step 卡片(M2 起)

**核心依赖**:
```json
{
  "electron": "^28.0.0",
  "electron-vite": "^2.0.0",
  "react": "^18.2.0",
  "execa": "^8.0.0",
  "better-sqlite3": "^9.0.0",
  "zod": "^3.22.0"
}
```

**CLI 检测**(启动时):
```typescript
// src/main/cli-check.ts
async function checkClis() {
  const checks = await Promise.all([
    execa('claude', ['--version']).catch(() => null),
    execa('gemini', ['--version']).catch(() => null),
    execa('codex', ['--version']).catch(() => null),
  ]);
  return {
    claude: checks[0] !== null,
    gemini: checks[1] !== null,
    codex: checks[2] !== null,
  };
}
```
app 启动时调用,缺失 CLI 时显示安装指引。

---

## 总结

这是一个工程量不小但架构清晰的项目。核心难点已通过架构 agent 的第二意见压力测试并给出可落地方案。实现顺序按 M1→M5 递进,每个里程碑都有独立的验证点,便于增量交付。

**最关键的三个工程决策**:
1. **不自建 LLM loop,编排现有 CLI** — 省下 90% 工作量,且能享受三家官方 CLI 的持续更新
2. **Turn 抽象而非双向流抽象** — 让 gemini/codex 的单次 exec 模型和 claude 的流式模型统一到同一接口
3. **app 层自存完整 transcript** — CLI 的 session 不可靠,必须自己落盘作为真相源

实现从 M1 开始,先跑通单 agent + claude,验证整个技术栈可行,再逐步加 gemini/codex、工作流、重跑、持久化。
