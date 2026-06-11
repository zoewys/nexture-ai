# Step Interaction Mode — 实现规格

## 1. 背景

当前 workflow 的人机交互仅发生在步骤之间（handoff 确认）。用户需要某些步骤能在执行过程中与人对话（如 PM 沟通需求），同时保持平台逻辑与具体 agent 业务解耦。

## 2. 设计原则

- **平台只管流程控制**：是否允许步骤内对话、失败后怎么处理
- **Agent 负责具体行为**：问什么问题、生成什么文件、是否打开浏览器，全部由 agent system prompt 决定
- **向后兼容**：现有 workflow 模板无需迁移，新字段全部可选

## 3. 类型变更

### 3.1 新增类型 (`src/shared/types.ts`)

```typescript
export type FailureStrategyType = 'stop' | 'retry-then-notify' | 'retry-then-goto'

export interface FailureStrategy {
  type: FailureStrategyType
  /** 最大自动重试次数，默认 3 */
  maxRetries?: number
  /** retry-then-goto 时跳转的目标步骤 index */
  gotoTarget?: number
}
```

### 3.2 扩展 WorkflowTemplateStep

```typescript
export interface WorkflowTemplateStep {
  agentId: string
  role?: string
  rules?: StepRule[]
  /** 是否允许步骤内人机对话，默认 false */
  interactive?: boolean
  /** 失败策略，默认 { type: 'stop' } */
  failureStrategy?: FailureStrategy
}
```

### 3.3 扩展 StepStatus

```typescript
export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting-input'       // 新增：interactive 步骤等待用户输入
  | 'awaiting-confirm'
  | 'done'
  | 'stale'
  | 'error'
```

### 3.4 扩展 WorkflowRunStatus

```typescript
export type WorkflowRunStatus =
  | 'running'
  | 'awaiting-input'        // 新增
  | 'awaiting-confirm'
  | 'completed'
  | 'error'
  | 'aborted'
  | 'interrupted'
```

## 4. WorkflowManager 变更

### 4.1 handleAgentEvent — turn-done 分流

当收到 `turn-done` 且 `reason === 'complete'` 时：

```
parseHandoff(events)
  │
  ├─ 解析成功 → finishStepWithHandoff()（现有逻辑）
  │    └─ interactive 步骤：autoConfirm 行为，直接推进
  │    └─ 非 interactive 步骤：走现有 autoConfirm / awaiting-confirm 逻辑
  │
  └─ 解析失败
       ├─ interactive === true → enterAwaitingInput()
       └─ interactive !== true → finishStepWithError()（现有逻辑）
```

### 4.2 新增方法 enterAwaitingInput()

```typescript
private enterAwaitingInput(run: WorkflowRun, stepIndex: number): void {
  const step = run.steps[stepIndex]
  const execution = step.executions.at(-1)!
  execution.status = 'awaiting-input'
  step.status = 'awaiting-input'
  run.status = 'awaiting-input'
  this.persistAndEmit(run)
}
```

### 4.3 新增方法 finishInteractiveStep()

用户点击"结束对话"按钮时调用，手动推进 interactive 步骤：

```typescript
async finishInteractiveStep(runId: string, stepIndex: number): Promise<WorkflowRun> {
  const run = this.loadRun(runId)
  const step = run.steps[stepIndex]
  const execution = step.executions.at(-1)!

  // 从 execution events 中尝试提取最后的有用信息作为 handoff
  const fallbackHandoff: HandoffArtifact = {
    summary: this.extractConversationSummary(execution.events),
    artifacts: [],
    nextStepGuidance: ''
  }

  execution.handoff = fallbackHandoff
  execution.status = 'done'
  step.status = 'done'

  // 推进到下一步
  this.advanceToNextStep(run, stepIndex)
  return run
}
```

### 4.4 pushInput 行为调整

当 step.status === 'awaiting-input' 时，`pushInput()` 需要：

1. 将 step.status 恢复为 'running'
2. 将 run.status 恢复为 'running'
3. 通过现有 `runManager.push()` 发送用户文本到 agent stdin
4. persistAndEmit 更新状态

### 4.5 finishStepWithError — 集成 failureStrategy

```typescript
// 在现有 evaluateRules() 之后，增加 failureStrategy 检查
private finishStepWithError(run, stepIndex, message, trigger) {
  // 1. 先走现有 StepRule（向后兼容，优先级最高）
  const rule = this.evaluateRules(run, stepIndex, trigger)
  if (rule && this.canApplyRule(run, rule)) {
    this.applyRule(run, stepIndex, rule)
    return
  }

  // 2. 再走 failureStrategy
  const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
  const strategy = templateStep?.failureStrategy
  if (strategy && strategy.type !== 'stop') {
    const retryCount = run.steps[stepIndex].executions.length - 1
    if (retryCount < (strategy.maxRetries ?? 3)) {
      // 自动重试
      run.status = 'running'
      this.persistAndEmit(run)
      this.startStep(run.id, stepIndex)
      return
    }
    // 重试耗尽
    if (strategy.type === 'retry-then-goto' && strategy.gotoTarget !== undefined) {
      markDownstreamStale(run, strategy.gotoTarget)
      run.currentStepIndex = strategy.gotoTarget
      run.status = 'running'
      this.persistAndEmit(run)
      this.startNextNode(run.id, strategy.gotoTarget)
      return
    }
    // retry-then-notify: 跌入默认 error 状态
  }

  // 3. 默认：标记 error
  // （现有逻辑）
}
```

### 4.6 buildPrompt — interactive 步骤的 prompt 增强

```typescript
private buildPrompt(run, stepIndex, agent) {
  // ... 现有逻辑 ...

  const templateStep = this.getTemplateStepForRunStep(run, stepIndex)
  if (templateStep?.interactive) {
    sections.push('', '# Interaction mode', INTERACTIVE_HINT)
  }

  sections.push('', '# Handoff requirement', HANDOFF_HINT)
  // ...
}
```

`INTERACTIVE_HINT` 常量：

```typescript
const INTERACTIVE_HINT = [
  'This step runs in interactive mode — you are communicating directly with the user.',
  '',
  'Behavior rules:',
  '- Ask the user questions to clarify requirements. Output natural language only (do NOT output the handoff JSON yet).',
  '- Keep each round focused: ask 2-3 key questions, not a long list.',
  '- When you are confident that the requirements are fully clear, output the handoff JSON to conclude this step.',
  '- The handoff JSON signals "conversation over" — do not output it until you are ready to hand off.'
].join('\n')
```

## 5. IPC 变更

### 5.1 新增 IPC 通道

```typescript
// src/shared/types.ts IPC 对象
workflowFinishInteractive: 'workflow:finish-interactive'
```

### 5.2 preload 新增方法

```typescript
finishInteractiveStep: (runId: string, stepIndex: number) =>
  ipcRenderer.invoke(IPC.workflowFinishInteractive, runId, stepIndex)
```

### 5.3 main/ipc.ts 新增 handler

```typescript
ipcMain.handle(IPC.workflowFinishInteractive, async (_e, runId, stepIndex) => {
  return workflowManager.finishInteractiveStep(runId, stepIndex)
})
```

## 6. UI 变更

### 6.1 DAG Canvas 属性面板 (`WorkflowCanvas.tsx`)

在 NodePropertyPanel 中新增两个配置区：

**区域 1：交互模式**
- 开关（toggle）：「允许步骤内对话」
- 默认关闭

**区域 2：失败策略**
- 下拉选择：停止 / 重试后通知 / 重试后跳转
- 重试次数输入（选择重试系列时出现，默认 3，范围 1-10）
- 目标步骤下拉（选择"重试后跳转"时出现）

### 6.2 WorkflowRunDetail — awaiting-input 状态

当 step.status === 'awaiting-input' 时：

- 步骤芯片：蓝色脉冲动画，图标为对话气泡
- 转录区域正常显示 agent 的消息
- ComposerBar 启用，placeholder = "回复 agent..."
- 操作栏显示「结束对话，进入下一步」按钮（兜底）
- 不显示"确认并继续"按钮

### 6.3 WorkflowWorkspace — composer 启用逻辑

扩展 `workflowCanInterject` 条件：

```typescript
const workflowCanInterject =
  selectedExecution?.status === 'running' && selectedAgent?.vendor === 'claude'
  || selectedExecution?.status === 'awaiting-input'  // 新增
```

### 6.4 步骤芯片颜色

| 状态 | 颜色 | 含义 |
|------|------|------|
| `pending` | 灰色 | 等待中 |
| `running` | 绿色脉冲 | 执行中 |
| `awaiting-input` | 蓝色脉冲 | 等待用户回复 |
| `awaiting-confirm` | 黄色 | 等待确认 |
| `done` | 绿色实心 | 完成 |
| `error` | 红色 | 出错 |
| `stale` | 灰色虚线 | 过期 |

## 7. 向后兼容

| 场景 | 行为 |
|------|------|
| 现有模板无 `interactive` 字段 | 视为 `false`，行为不变 |
| 现有模板无 `failureStrategy` 字段 | 视为 `{ type: 'stop' }`，行为不变 |
| 同时存在 `StepRule` 和 `failureStrategy` | `StepRule` 优先，failureStrategy 作为兜底 |
| `WorkflowStore.normalizeTemplate()` | 无需迁移，新字段全部 optional |

## 8. 测试计划

| 测试 | 描述 |
|------|------|
| interactive 模式 turn-done 无 handoff | 验证进入 awaiting-input 状态 |
| interactive 模式 pushInput 后恢复 running | 验证用户回复后状态恢复 |
| interactive 模式 handoff 输出 | 验证对话结束后自动推进 |
| finishInteractiveStep 手动结束 | 验证兜底按钮功能 |
| failureStrategy retry-then-notify | 验证重试 N 次后停止 |
| failureStrategy retry-then-goto | 验证重试耗尽后跳转 |
| StepRule + failureStrategy 共存 | 验证 StepRule 优先级 |
| 现有模板无新字段 | 验证向后兼容 |

## 9. 实施顺序

1. `src/shared/types.ts` — 新增类型、扩展 StepStatus
2. `src/main/WorkflowManager.ts` — 核心逻辑（enterAwaitingInput、finishInteractiveStep、failureStrategy）
3. `src/main/ipc.ts` + `src/preload/index.ts` — IPC 通道
4. `src/renderer/src/canvas/WorkflowCanvas.tsx` — 属性面板配置 UI
5. `src/renderer/src/WorkflowRunDetail.tsx` — awaiting-input 状态展示
6. `src/renderer/src/WorkflowWorkspace.tsx` — composer 启用逻辑
7. `src/renderer/src/styles.css` — awaiting-input 样式
8. `tests/` — 单元测试
