# 工作流编排能力扩展 — 实现规格

> 状态：待实现  
> 日期：2026-06-10  
> 前置文档：`WORKFLOW_ORCHESTRATION_DESIGN.md`（设计概要）

---

## Phase 1：并行分支

### 1.1 数据模型变更

**文件**：`src/shared/types.ts`

```ts
// 新增类型
type WorkflowStepNode = WorkflowTemplateStep | WorkflowParallelGroup

interface WorkflowParallelGroup {
  parallel: WorkflowTemplateStep[]
  join: boolean  // true = fan-out/fan-in, false = 独立并行
}

// 修改 WorkflowTemplate.steps 类型
interface WorkflowTemplate {
  id: string
  name: string
  description?: string
  steps: WorkflowStepNode[]  // 原来是 WorkflowTemplateStep[]
  promptTemplate?: string
  budgetUsd?: number
}
```

**向后兼容**：`WorkflowTemplateStep` 本身就是 `WorkflowStepNode` 的子集（union type），旧 template JSON 反序列化后自动满足新类型。加一个 migration 函数在 `WorkflowStore.listTemplates()` 中 normalize 旧数据。

**WorkflowRun.steps 展开策略**：

Template 的嵌套结构在 `start()` 时展平为 `WorkflowRun.steps`（运行时结构），并记录 parallelGroupId：

```ts
interface WorkflowRunStep {
  // 现有字段...
  agentId: string
  displayName?: string
  role?: string
  status: StepStatus
  executions: WorkflowStepExecution[]
  // 新增字段
  parallelGroupId?: string   // 同一并行组的 step 共享此 id
  parallelGroupJoin?: boolean // 该组是否需要汇合
  worktreePath?: string      // 并行 step 的隔离 worktree 路径
}
```

### 1.2 状态机

**并行组的状态流转**：

```
              ┌─ step-2a: pending → running → awaiting-confirm → done ─┐
start(group) ─┤                                                         ├─ 推进下一个 node
              └─ step-2b: pending → running → awaiting-confirm → done ─┘
```

**规则**：
- 并行组内所有 step 启动时同时从 pending → running
- 每个 step 独立到达 awaiting-confirm，独立被用户 confirm
- `join: true` 时：所有 step 都 done 后才推进下一个 WorkflowStepNode
- `join: false` 时：每个 step done 即视为完成，不影响其他 step 或后续节点
- 并行组的 `run.currentStepIndex`：指向组内第一个 step 的展平 index

**错误处理**：
- 并行组内一个 step error：其余 step 继续跑（不中止）
- 并行组内所有 step 都 error：整个 run 标记 error
- 并行组内部分 done、部分 error：run 状态为 error，用户可以单独 rerun error 的 step
- 用户 rerun 并行组内单个 step：只重跑该 step，不影响组内其他 step；如果 join=true 且有下游已 done/stale，下游标记 stale
- 用户 abort：kill 并行组内所有活跃进程

### 1.3 WorkflowManager 改动

**文件**：`src/main/WorkflowManager.ts`

| 函数 | 改动 |
|------|------|
| `start()` | 展平 template steps 为 run steps，生成 parallelGroupId |
| `startStep()` | 新增 `startParallelGroup(runId, groupStepIndices)`，同时启动多个 step |
| `handleAgentEvent()` | 不变，每个 step 仍独立处理 |
| `finishStepWithHandoff()` | 完成后检查：如果是并行组成员，判断组内是否全部完成再决定是否推进 |
| `confirmStep()` | confirm 后检查并行组完成状态 |
| `rerunStep()` | 支持只重跑并行组内单个 step |
| `buildPrompt()` | 汇合点 step 接收多个上游 handoff |
| `liveByRunId` | 改为 `liveSteps: Map<string, LiveStep[]>`，一个 run 支持多个活跃 step |
| `abort()` | 遍历 run 的所有活跃 step 逐一 abort |

**新增函数**：

```ts
private startParallelGroup(runId: string, stepIndices: number[]): void
private isParallelGroupComplete(run: WorkflowRun, groupId: string): boolean
private getNextNodeAfterGroup(run: WorkflowRun, groupId: string): number | null
private setupWorktree(projectPath: string, stepIndex: number): string  // 返回 worktree path
private cleanupWorktree(worktreePath: string): void
```

### 1.4 Git Worktree 隔离

**文件**：新建 `src/main/worktreeManager.ts`

```ts
export interface WorktreeInfo {
  path: string
  branch: string
}

export function createWorktree(projectPath: string, name: string): WorktreeInfo
export function removeWorktree(projectPath: string, worktreePath: string): void
export function listWorktrees(projectPath: string): WorktreeInfo[]
export function isGitRepo(path: string): boolean
```

实现：
- `git worktree add .agent-studio/worktrees/{name} -b agent-studio/{name}` 创建
- `git worktree remove` 清理
- 非 git 项目：退化为拷贝目录（`cp -r projectPath tempDir`）或拒绝并行（抛错提示用户初始化 git）

**清理时机**：
- 并行 step done + 用户 confirm 后清理 worktree
- Run 被删除时清理所有 worktree
- App 启动时扫描孤立 worktree 并清理

### 1.5 buildPrompt 多上游 handoff

汇合点（`join: true` 的并行组之后的第一个 step）接收所有并行 step 的 handoff：

```ts
private buildPromptForJoinStep(run: WorkflowRun, stepIndex: number, agent: AgentDefinition, upstreamIndices: number[]): {
  prompt: string
  injectedMemoryIds: string[]
}
```

Prompt 结构：
```
# User request
{run.initialPrompt}

# Workflow progress
- Step 1 (需求分析): ...

# Upstream handoffs (parallel group)

## From 前端开发
{summary}
Artifacts:
- public/index.html: 前端页面
- public/app.js: 交互逻辑

## From 后端开发
{summary}
Artifacts:
- server.mjs: API 服务
- models/todo.js: 数据模型

# Handoff requirement
{HANDOFF_HINT}
```

### 1.6 UI 变更

**Template 编辑器**：由 DAG 画布替代（见 Phase 4）。并行组在画布上通过框选节点 → 右键"创建并行组"操作，不使用包围框，仅通过连线分叉/汇合表达并行关系。属性面板中可配置 join toggle。

**Run 详情 step chips** (`WorkflowRunDetail.tsx`)：
- 并行 step 在 chip bar 中**垂直堆叠**，左侧用蓝色竖条标识并行组
- 点击 chip 切换查看对应步骤的转录

**并行运行转录查看**：使用 **Tab 切换**模式，每个并行步骤一个 tab，tab 上带运行状态指示器（脉冲动画 = running，实心绿点 = done）。

**IPC 无变更**：template 的 `steps` 字段类型变了，但 IPC 传输仍是 JSON，透明。

### 1.7 测试计划

| 测试 | 验证 |
|------|------|
| 旧 template 加载 | 平坦 steps 数组能被新类型正确反序列化 |
| 并行启动 | 并行组内 2 个 step 同时进入 running |
| 独立完成 | 一个 step done 不影响另一个继续跑 |
| 汇合推进 | join=true 时两个都 done 后下游才启动 |
| 独立并行 | join=false 时每个 done 独立，run 在全部结束后 completed |
| 错误隔离 | 一个 error 不 kill 另一个 |
| Rerun 单个 | 只重跑并行组内一个 step |
| Worktree 创建 | 并行 step 的 cwd 指向正确 worktree |
| Worktree 清理 | confirm 后 worktree 被删除 |
| buildPrompt 多上游 | 汇合点 prompt 包含所有并行 step 的 handoff |

---

## Phase 2：条件跳转

### 2.1 数据模型变更

**文件**：`src/shared/types.ts`

```ts
// 新增
interface StepRule {
  on: 'error' | 'handoff-failed' | 'done'
  action: 'retry' | 'skip' | 'goto'
  target?: number        // goto 目标（展平后的 step index）
  maxRetries?: number    // retry 上限，默认 1
}

// WorkflowTemplateStep 新增字段
interface WorkflowTemplateStep {
  agentId: string
  role?: string
  rules?: StepRule[]  // 新增
}

// HandoffArtifact 扩展
interface HandoffArtifact {
  summary: string
  artifacts: { path: string; description: string; type?: string }[]
  nextStepGuidance?: string
  routeSuggestion?: RouteSuggestion  // 新增
}

interface RouteSuggestion {
  action: 'continue' | 'retry-prev' | 'skip-next' | 'goto'
  target?: number
  reason?: string
}
```

### 2.2 WorkflowManager 改动

**文件**：`src/main/WorkflowManager.ts`

新增 rule 评估逻辑：

```ts
private evaluateRules(run: WorkflowRun, stepIndex: number, trigger: 'error' | 'handoff-failed' | 'done'): StepRule | null {
  const step = run.steps[stepIndex]
  const templateStep = this.getTemplateStep(run, stepIndex)
  if (!templateStep?.rules) return null

  for (const rule of templateStep.rules) {
    if (rule.on !== trigger) continue
    if (rule.action === 'retry') {
      const retryCount = step.executions.length - 1
      if (retryCount >= (rule.maxRetries ?? 1)) continue  // 超限跳过
    }
    return rule
  }
  return null
}
```

**调用点**：

- `finishStepWithError()` → 检查 `on: 'error'` 或 `on: 'handoff-failed'` 规则
  - 命中 `retry`：自动调 `this.startStep(runId, stepIndex)`（不标记 run error）
  - 命中 `skip`：跳过当前 step，推进到下一步
  - 命中 `goto`：设置 `run.currentStepIndex = target`，启动目标 step
- `finishStepWithHandoff()` → 检查 `on: 'done'` 规则（用于实现"成功则跳过下一步"）

**防循环**：
- goto 不允许 target <= 当前 stepIndex - 2（最多回退 2 步）
- 单个 step 在一次 run 中最多被自动 retry 2 次（含 rule 触发 + 手动）
- 连续 goto 跳转上限 5 次，超过则 run error

### 2.3 Handoff routeSuggestion

**解析**：在 `parseHandoff()` 中已有的 JSON 解析基础上，新增对 `routeSuggestion` 字段的提取：

```ts
// 在 tryParseHandoffFromText 中
routeSuggestion: isValidRouteSuggestion(parsed.routeSuggestion)
  ? parsed.routeSuggestion
  : undefined
```

**展示**：`finishStepWithHandoff()` 中，如果 handoff 含 routeSuggestion，将其存入 execution，UI 在 confirm 面板中展示。

### 2.4 Confirm UI 扩展

**文件**：`src/renderer/src/WorkflowRunDetail.tsx`

当前 confirm 只有一个按钮"确认并继续"。扩展为**按钮行 + 下拉**布局：

```tsx
<div className="confirm-btn-row">
  <button className="primary" onClick={onConfirm}>▶ 确认并继续</button>
  <button onClick={onRerun}>↻ 重跑当前步骤</button>
  <button onClick={onSkipNext}>⏭ 跳过下一步</button>
  <select onChange={onGoto}>
    <option value="">↗ 跳转到...</option>
    {run.steps.map((s, i) => <option key={i} value={i}>Step {i+1}: {s.displayName}</option>)}
  </select>
</div>

{/* Agent 路由建议：内联横幅样式 */}
{execution.handoff?.routeSuggestion && (
  <div className="route-suggestion-inline">
    <span>💡</span>
    <div className="route-suggestion-inline-text">
      <strong>Agent 建议：</strong> {execution.handoff.routeSuggestion.reason}
    </div>
    <button className="apply-btn" onClick={() => applyRouteSuggestion(execution.handoff.routeSuggestion)}>
      采纳
    </button>
  </div>
)}
```

**IPC 新增**：

```ts
// shared/types.ts IPC 对象
workflowSkipStep: 'workflow:skip-step',
workflowGotoStep: 'workflow:goto-step',
```

**WorkflowManager 新增方法**：

```ts
skipStep(runId: string): WorkflowRun    // 跳过下一步直接推进
gotoStep(runId: string, targetIndex: number): WorkflowRun  // 跳转到指定步骤
```

### 2.5 HANDOFF_HINT 更新

在 `HANDOFF_HINT` 末尾追加 routeSuggestion 说明（可选输出）：

```
Optionally, if you believe the workflow should deviate from the default next step, add:
"routeSuggestion": { "action": "retry-prev"|"skip-next"|"goto", "target": <step number>, "reason": "..." }
```

### 2.6 测试计划

| 测试 | 验证 |
|------|------|
| Rule retry | step error 时自动重跑，不超过 maxRetries |
| Rule skip | 命中 skip 规则后自动推进下一步 |
| Rule goto | 命中 goto 规则后跳转到目标 step |
| 防循环 | 连续 goto 超过 5 次触发 run error |
| routeSuggestion 解析 | handoff 包含 routeSuggestion 时正确提取 |
| UI 多选项 | confirm 面板显示所有操作选项 |
| 优先级 | 用户手动操作覆盖 template rule |

---

## Phase 3：智能路由

### 3.1 推荐映射

**文件**：新建 `src/main/routeRecommendation.ts`

```ts
import type { AgentVendor } from '@shared/types'

interface VendorModelRecommendation {
  vendor: AgentVendor
  model: string
  reason: string
}

const ROLE_RECOMMENDATIONS: Record<string, VendorModelRecommendation> = {
  product: { vendor: 'claude', model: 'sonnet', reason: '需求理解和文档输出能力强' },
  design: { vendor: 'claude', model: 'sonnet', reason: '创意和结构化输出平衡' },
  dev: { vendor: 'codex', model: '', reason: '代码生成效率高、成本低' },
  test: { vendor: 'claude', model: 'sonnet', reason: '测试用例设计需要推理能力' },
  review: { vendor: 'claude', model: 'opus', reason: '代码审查需要深度推理' },
  docs: { vendor: 'claude', model: 'haiku', reason: '文档生成简单任务用小模型省钱' }
}

export function getRecommendation(role: string): VendorModelRecommendation | null {
  return ROLE_RECOMMENDATIONS[role] ?? null
}
```

### 3.2 UI 变更

**文件**：`src/renderer/src/TemplatesView.tsx`

每个 step 行的 agent 选择旁新增"推荐"按钮：

```tsx
<button
  className="recommend-btn"
  onClick={() => applyRecommendation(stepIndex)}
  title="根据角色自动推荐 vendor 和 model"
>
  ✦ 推荐
</button>
```

点击后：
1. 读取该 step 的 role
2. 调用 `getRecommendation(role)`
3. 查找或创建匹配的 agent（vendor + model + 默认 system prompt）
4. 自动填充到该 step 的 agentId

### 3.3 IPC

```ts
// shared/types.ts IPC
routeRecommend: 'route:recommend',
```

Preload 暴露 `routeRecommend(role: string): Promise<VendorModelRecommendation | null>`。

### 3.4 测试计划

| 测试 | 验证 |
|------|------|
| 已知 role 返回推荐 | `getRecommendation('dev')` 返回 codex |
| 未知 role 返回 null | `getRecommendation('unknown')` 返回 null |
| UI 推荐按钮 | 点击后 step 的 agent 被正确填充 |

---

## Phase 4：DAG 画布编辑器

### 4.1 技术选型

选择 **@xyflow/react**（React Flow v12+）：
- 社区活跃、文档完善
- 支持自定义节点、边、拖拽
- Tree-shakeable，实际使用 ~120KB gzipped
- MIT 许可

### 4.2 数据转换

画布内部用 React Flow 的 `Node[]` + `Edge[]` 格式，保存时序列化为 `WorkflowStepNode[]`：

```ts
// 画布 → Template
function canvasToTemplate(nodes: Node[], edges: Edge[]): WorkflowStepNode[]

// Template → 画布
function templateToCanvas(steps: WorkflowStepNode[]): { nodes: Node[]; edges: Edge[] }
```

**节点类型**：
- `agent-node`：对应一个 WorkflowTemplateStep，**详细卡片样式**——直接显示 vendor 图标、名称、角色、模型标签，左右两侧连接端口

**并行组表示**：不使用独立的 ParallelGroupNode，采用**纯连线分叉/汇合**方式。画布上并行步骤通过 fan-out / fan-in 连线自然表达并行关系。序列化时，检测共享同一上游和下游的节点组，序列化为 `{ parallel: [...] }` 结构。

**边类型**：
- `default`：线性连接
- `conditional`：条件边（黄色虚线，附带 StepRule 信息标签）

### 4.3 文件结构

```
src/renderer/src/
  canvas/
    WorkflowCanvas.tsx          # 画布主组件（顶部居中工具栏 + 右侧属性面板 + 右下 minimap）
    AgentNode.tsx               # Agent 节点：详细卡片（图标+名称+角色+模型标签）
    ConditionalEdge.tsx         # 条件边（黄色虚线）
    canvasSerializer.ts         # 双向转换 canvas ↔ template
    useCanvasState.ts           # 画布状态管理 hook
```

### 4.4 交互

**工具栏**（顶部居中，浮于画布上方）：
- 选择模式 / 连线模式切换
- 撤销 / 重做
- 适应画布 / 缩放控制

**节点添加**（两种方式并存）：
- **左侧可折叠 Agent 图标列表**：默认折叠为图标栏（每个 Agent 显示 vendor 图标），展开后显示完整名称，可拖拽到画布
- **右键画布空白处**：弹出菜单，列出所有可用 Agent + "创建并行组"选项

**节点编辑**（右侧属性面板）：
- 选中节点后，右侧展开属性编辑面板
- 面板内容：Agent 选择（下拉）、Role 输入、Rules 配置（内联列表 + 添加按钮）
- 未选中节点时面板隐藏或显示画布总览信息

**其他操作**：
- 框选多节点 → 右键"创建并行组"（序列化时生成 parallel 结构）
- 右键节点：删除、复制、编辑 rules
- 条件边：双击边可设置触发条件
- Cmd+S 保存（调用 `canvasToTemplate()` 后存入 WorkflowStore）
- 右下角 minimap 显示全局缩略图

### 4.5 Lazy Loading

画布组件仅在 Templates 页面使用，做 lazy import：

```tsx
const WorkflowCanvas = lazy(() => import('./canvas/WorkflowCanvas'))
```

### 4.6 测试计划

| 测试 | 验证 |
|------|------|
| 序列化往返 | template → canvas → template 数据不丢失 |
| 旧 template 渲染 | 线性 template 在画布中正确显示为链式节点 |
| 并行组渲染 | parallel group 在画布中正确包裹 |
| 拖拽创建 | 从 agent 列表拖入画布后生成正确节点 |

---

## UI 交互方案选择结果

> 确认时间：2026-06-11

| 决策点 | 选择 |
|--------|------|
| P4: 画布节点样式 | **方案 B** — 详细卡片（直接显示名称+角色+模型标签） |
| P4: 并行组画布表示 | **方案 B** — 纯连线分叉（无包围框） |
| P4: 画布工具栏 & 节点编辑 | **方案 A** — 顶部工具栏 + 右侧属性面板 |
| P4: 节点添加方式 | **方案 C** — 两者兼备（折叠侧栏 + 右键菜单） |
| P1: 并行步骤 Chips 显示 | **方案 A** — 垂直堆叠 + 蓝色竖条 |
| P1: 并行运行转录查看 | **方案 A** — Tab 切换 |
| P2: 确认面板操作布局 | **方案 A** — 按钮行 + 下拉 |
| P2: Agent 路由建议展示 | **方案 B** — 内联横幅 |

可视化 mockup 参见 `ui-decisions.html`。

---

## 任务列表（按优先级，DAG 画布直接替代线性编辑器）

### Phase 1：并行分支（后端引擎）

| # | 任务 | 依赖 | 预估 |
|---|------|------|------|
| P1-1 | `shared/types.ts` 新增 `WorkflowStepNode`、`WorkflowParallelGroup` 类型，修改 `WorkflowTemplate.steps` 类型 | 无 | 小 |
| P1-2 | `shared/types.ts` 给 `WorkflowRunStep` 新增 `parallelGroupId`、`worktreePath` 字段 | P1-1 | 小 |
| P1-3 | 新建 `src/main/worktreeManager.ts`：create/remove/list/isGitRepo | 无 | 中 |
| P1-4 | `WorkflowStore` 加载旧 template 时 normalize 为新类型（兼容迁移） | P1-1 | 小 |
| P1-5 | `WorkflowManager.start()` 展平嵌套 steps 为 run steps，生成 parallelGroupId | P1-1, P1-2 | 中 |
| P1-6 | `WorkflowManager` 新增 `startParallelGroup()`，同时启动多个 step 并分配 worktree | P1-3, P1-5 | 大 |
| P1-7 | `WorkflowManager` 改 `liveByRunId` 为支持多活跃 step | P1-6 | 中 |
| P1-8 | `WorkflowManager` 完成后检查并行组状态，决定是否推进 | P1-7 | 中 |
| P1-9 | `WorkflowManager.buildPrompt()` 支持多上游 handoff 拼接 | P1-8 | 小 |
| P1-10 | `WorkflowManager.abort()` 支持 kill 并行组内所有活跃进程 | P1-7 | 小 |
| P1-11 | `WorkflowManager.rerunStep()` 支持只重跑并行组内单个 step | P1-8 | 中 |
| P1-12 | Worktree 清理：confirm 后删除、run 删除时删除、app 启动时清理孤立 | P1-3 | 小 |
| P1-15 | 测试：并行启动、独立完成、汇合推进、错误隔离、worktree | P1-8 | 中 |

### Phase 1：并行分支（运行时 UI）

| # | 任务 | 依赖 | UI 方案 | 预估 |
|---|------|------|---------|------|
| P1-14 | `WorkflowRunDetail.tsx` 并行 step chips 显示 | P1-2 | 垂直堆叠 + 蓝色竖条 | 中 |
| P1-14b | 并行运行时转录 Tab 切换 | P1-7 | Tab 切换（每个并行步骤一个 tab，带状态指示器） | 中 |

### Phase 2：条件跳转

| # | 任务 | 依赖 | UI 方案 | 预估 |
|---|------|------|---------|------|
| P2-1 | `shared/types.ts` 新增 `StepRule`、`RouteSuggestion` 类型 | 无 | — | 小 |
| P2-2 | `shared/types.ts` `WorkflowTemplateStep` 新增 `rules` 字段 | P2-1 | — | 小 |
| P2-3 | `shared/types.ts` `HandoffArtifact` 新增 `routeSuggestion` 字段 | P2-1 | — | 小 |
| P2-4 | `WorkflowManager` 新增 `evaluateRules()`，在 error/done 时检查规则 | P2-2 | — | 中 |
| P2-5 | `WorkflowManager` 新增 `skipStep()`、`gotoStep()` 方法 | P2-4 | — | 中 |
| P2-6 | `WorkflowManager` 防循环逻辑（goto 上限、retry 上限） | P2-5 | — | 小 |
| P2-7 | `parseHandoff()` 提取 `routeSuggestion` | P2-3 | — | 小 |
| P2-8 | `HANDOFF_HINT` 追加 routeSuggestion 说明 | P2-3 | — | 小 |
| P2-9 | IPC 新增 `workflowSkipStep`、`workflowGotoStep` 通道 | P2-5 | — | 小 |
| P2-10 | `preload/index.ts` 暴露新 API | P2-9 | — | 小 |
| P2-11 | `WorkflowRunDetail.tsx` confirm 面板多操作 | P2-9, P2-10 | 按钮行 + 下拉（主操作突出，次要操作普通按钮，跳转用下拉选择） | 中 |
| P2-12 | `WorkflowRunDetail.tsx` 展示 agent routeSuggestion | P2-7 | 内联横幅（紫色竖线 + 文字 + "采纳"按钮） | 小 |
| P2-13 | 节点 rules 配置（集成到画布右侧属性面板） | P2-2, P4-5 | 随画布属性面板编辑方式 | 中 |
| P2-14 | 测试：自动 retry、skip、goto、防循环、routeSuggestion | P2-6 | — | 中 |

### Phase 3：智能路由

| # | 任务 | 依赖 | 预估 |
|---|------|------|------|
| P3-1 | 新建 `src/main/routeRecommendation.ts` | 无 | 小 |
| P3-2 | IPC 新增 `routeRecommend` 通道 + preload 暴露 | P3-1 | 小 |
| P3-3 | 画布属性面板新增"推荐"按钮 | P3-2, P4-5 | 小 |
| P3-4 | 点击推荐后自动匹配或创建 agent | P3-3 | 中 |
| P3-5 | 测试：推荐映射正确性 | P3-1 | 小 |

### Phase 4：DAG 画布编辑器（替代线性 TemplatesView）

| # | 任务 | 依赖 | UI 方案 | 预估 |
|---|------|------|---------|------|
| P4-1 | 安装 `@xyflow/react` 依赖 | 无 | — | 小 |
| P4-2 | 新建 `canvasSerializer.ts`：template ↔ canvas 双向转换 | P1-1 | — | 中 |
| P4-3 | 新建 `AgentNode.tsx` 自定义节点 | P4-1 | 详细卡片：图标+名称+角色+模型标签，连接端口在左右两侧 | 中 |
| P4-3b | 并行组表示（纯连线，无 ParallelGroupNode） | P4-3 | 纯连线分叉/汇合，不使用包围框 | 小 |
| P4-4 | 新建 `ConditionalEdge.tsx` 条件边渲染 | P2-1, P4-1 | 黄色虚线，附带条件标签 | 小 |
| P4-5 | 新建 `WorkflowCanvas.tsx` 主画布组件 | P4-2, P4-3, P4-4 | 顶部居中工具栏（选择/连线/撤销/重做/适应/缩放）+ 右侧属性面板 + 右下角 minimap | 大 |
| P4-6 | 节点添加交互 | P4-5 | 左侧可折叠 Agent 图标列表（拖拽）+ 画布右键菜单 | 中 |
| P4-7 | 新建 `useCanvasState.ts` 画布状态 hook | P4-5 | — | 中 |
| P4-8 | `TemplatesView.tsx` 切换为画布编辑器（lazy load） | P4-5, P4-7 | — | 中 |
| P4-9 | 支持框选 → 右键"创建并行组"（序列化为 parallel 结构） | P4-8 | — | 中 |
| P4-10 | 测试：序列化往返、旧 template 渲染 | P4-2 | — | 中 |
