# 定时 Workflow Run — 实现规格

> 状态：待实现  
> 日期：2026-06-10

## 1. 概述

用户可以在 Workflow 页面的 Schedules tab 中创建定时计划，绑定一个 workflow template，配置 cron 表达式。到时间后 App 自动启动 workflow run 并全自动跑完（auto-confirm），无需人工值守。

## 2. 核心决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 调度器位置 | Electron 主进程内 | 用户不需要懂 crontab，状态与 WorkflowManager 统一 |
| 调度格式 | 标准 5 字段 cron 表达式 | 最灵活，高级用户熟悉 |
| 触发后行为 | auto-confirm（全自动） | 定时任务的核心价值就是无人值守 |
| 关窗口行为 | 最小化到 Tray 保持后台运行 | 否则定时任务关窗就失效 |
| 失败通知 | macOS 系统通知 + Tray 红点 | App 在后台时用户仍能感知 |
| Schedules 入口 | Workflow 页 Tab 切换（Runs / Schedules） | 方案 A，最干净 |
| 新建/编辑表单 | 右侧 Drawer 弹出 | 和现有 New Run 交互一致 |
| 选中 schedule | 右侧主内容区显示详情 + 历史触发记录 | 可追溯每次触发的结果 |

## 3. 数据模型

### 3.1 新增类型

**文件**：`src/shared/types.ts`

```ts
interface WorkflowSchedule {
  id: string
  templateId: string
  name: string
  cron: string                  // 标准 5 字段 cron
  enabled: boolean
  projectPath: string
  initialPrompt: string
  createdAt: number
  lastTriggeredAt?: number
  lastRunId?: string
  lastRunStatus?: 'completed' | 'error' | 'running'
}
```

### 3.2 现有类型扩展

```ts
// WorkflowStartInput 新增
interface WorkflowStartInput {
  // ...现有字段
  autoConfirm?: boolean     // 定时 run 传 true
  scheduledBy?: string      // schedule id
}

// WorkflowRun 新增
interface WorkflowRun {
  // ...现有字段
  autoConfirm?: boolean
  scheduledBy?: string      // 关联的 schedule id
}

// AppSettings 新增
interface AppSettings {
  showMemoryReferences: boolean
  minimizeToTray: boolean   // 默认 true
}
```

### 3.3 IPC 通道

```ts
// shared/types.ts IPC 对象新增
schedulesList: 'schedules:list',
schedulesSave: 'schedules:save',
schedulesDelete: 'schedules:delete',
schedulesToggle: 'schedules:toggle',
```

### 3.4 持久化

**文件**：新建 `src/main/ScheduleStore.ts`

路径：`userData/schedules.json`

```ts
export class ScheduleStore {
  list(): WorkflowSchedule[]
  save(input: Omit<WorkflowSchedule, 'id'> & { id?: string }): WorkflowSchedule
  remove(id: string): void
  toggle(id: string, enabled: boolean): WorkflowSchedule
  updateLastTriggered(id: string, runId: string, status: string): void
}
```

## 4. Cron 解析器

**文件**：新建 `src/main/cronParser.ts`

自己实现，不引入外部依赖。

```ts
export interface CronFields {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

export function parseCron(expression: string): CronFields
export function nextFireTime(expression: string, after?: Date): Date
export function isValidCron(expression: string): boolean
export function describeCron(expression: string): string  // "每天 09:00" 这样的人类可读描述
```

支持语法：
- 数字：`0 9 * * *`
- 范围：`0 9 * * 1-5`
- 列表：`0 9,18 * * *`
- 步进：`*/30 * * * *`
- 通配：`*`

约束：
- 最小间隔 1 分钟（拒绝 `* * * * *` 这种每秒触发的）
- 不支持秒级、`@daily` 别名、`L/W/#` 扩展

## 5. 调度器

**文件**：新建 `src/main/Scheduler.ts`

```ts
export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly scheduleStore: ScheduleStore,
    private readonly workflowManager: WorkflowManager,
    private readonly workflowStore: WorkflowStore,
    private readonly emit: EmitWorkflow
  ) {}

  start(): void
  register(schedule: WorkflowSchedule): void
  unregister(scheduleId: string): void
  stopAll(): void
  
  private scheduleNext(schedule: WorkflowSchedule): void
  private fire(schedule: WorkflowSchedule): void
}
```

### 5.1 调度逻辑

```ts
private scheduleNext(schedule: WorkflowSchedule): void {
  this.unregister(schedule.id)
  if (!schedule.enabled) return

  const next = nextFireTime(schedule.cron)
  const delay = next.getTime() - Date.now()
  if (delay < 0) return

  const timer = setTimeout(() => {
    this.fire(schedule)
    // 触发后重新加载 schedule（可能已被编辑/禁用）
    const latest = this.scheduleStore.list().find(s => s.id === schedule.id)
    if (latest?.enabled) this.scheduleNext(latest)
  }, delay)

  this.timers.set(schedule.id, timer)
}
```

### 5.2 触发执行

```ts
private fire(schedule: WorkflowSchedule): void {
  try {
    const result = this.workflowManager.start({
      templateId: schedule.templateId,
      projectPath: schedule.projectPath,
      initialPrompt: schedule.initialPrompt,
      runName: `[scheduled] ${schedule.name}`,
      autoConfirm: true,
      scheduledBy: schedule.id
    })
    this.scheduleStore.updateLastTriggered(schedule.id, result.run.id, 'running')
  } catch (err) {
    // template 被删、项目目录不存在等
    this.scheduleStore.updateLastTriggered(schedule.id, '', 'error')
    this.notifyError(schedule, err)
  }
}
```

### 5.3 Run 完成后更新 schedule

在 `WorkflowManager` 中，run 进入 `completed` 或 `error` 终态时，如果 `run.scheduledBy` 存在，通知 Scheduler 更新 schedule 的 `lastRunStatus`。

## 6. WorkflowManager auto-confirm 支持

**文件**：`src/main/WorkflowManager.ts`

### 6.1 start() 变更

`WorkflowRun` 创建时记录 `autoConfirm` 和 `scheduledBy`。

### 6.2 finishStepWithHandoff() 变更

```ts
private finishStepWithHandoff(run, stepIndex, execution): void {
  const handoff = parseHandoff(execution.events)
  this.aggregateStepCost(run, execution)

  if (!handoff) {
    this.finishStepWithError(run, stepIndex, execution, 'Could not parse handoff JSON')
    return
  }

  execution.handoff = handoff
  execution.status = run.autoConfirm ? 'done' : 'awaiting-confirm'
  execution.finishedAt = Date.now()
  run.steps[stepIndex].status = execution.status

  if (run.autoConfirm) {
    // 自动推进
    this.collectMemorySignal('positive', 'user-confirmed', run, stepIndex, execution)
    const nextIndex = run.currentStepIndex + 1
    if (nextIndex >= run.steps.length) {
      run.status = 'completed'
      run.finishedAt = Date.now()
      if (stepIndex === run.steps.length - 1) {
        this.collectMemorySignal('completion', 'workflow-done', run, stepIndex, execution, { handoff })
      }
      this.persistAndEmit(run)
    } else {
      run.currentStepIndex = nextIndex
      run.status = 'running'
      this.persistAndEmit(run)
      this.startStep(run.id, nextIndex)
    }
  } else {
    // 现有逻辑
    run.status = 'awaiting-confirm'
    if (stepIndex === run.steps.length - 1) {
      this.collectMemorySignal('completion', 'workflow-done', run, stepIndex, execution, { handoff })
    }
    this.persistAndEmit(run)
  }
}
```

## 7. Tray 后台运行

**文件**：`src/main/index.ts`

### 7.1 创建 Tray

```ts
import { Tray, Menu, nativeImage, Notification } from 'electron'

let tray: Tray | null = null

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray-icon.png'))
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Agent Studio')
  updateTrayMenu()
}

function updateTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Agent Studio', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]))
}
```

### 7.2 窗口关闭行为

```ts
mainWindow.on('close', (event) => {
  const settings = appSettingsStore.get()
  if (settings.minimizeToTray) {
    event.preventDefault()
    mainWindow.hide()
  }
})
```

### 7.3 Tray 红点

Schedule run 失败时在 Tray 图标上设置 badge：

```ts
// macOS
app.dock?.setBadge('!')
// 或者更新 tray 图标为带红点的版本
tray?.setImage(trayIconWithBadge)
```

用户打开 App 窗口后清除 badge。

### 7.4 系统通知

```ts
function notifyScheduleResult(schedule: WorkflowSchedule, run: WorkflowRun): void {
  if (run.status === 'error') {
    new Notification({
      title: `定时任务失败：${schedule.name}`,
      body: `${run.steps[run.currentStepIndex]?.displayName ?? 'Step'} 执行出错`
    }).show()
  } else if (run.status === 'completed') {
    new Notification({
      title: `定时任务完成：${schedule.name}`,
      body: `${run.steps.length} 步全部完成`
    }).show()
  }
}
```

### 7.5 Settings 集成

`SettingsPanel.tsx` 新增 `minimizeToTray` 开关。默认 true。

## 8. UI

### 8.1 Workflow 页 Tab 切换

**文件**：`src/renderer/src/WorkflowWorkspace.tsx`

顶部新增 tab 切换：

```tsx
const [activeTab, setActiveTab] = useState<'runs' | 'schedules'>('runs')

// 左侧 sidebar 顶部
<div className="workflow-tabs">
  <button className={activeTab === 'runs' ? 'active' : ''} onClick={() => setActiveTab('runs')}>
    Runs
  </button>
  <button className={activeTab === 'schedules' ? 'active' : ''} onClick={() => setActiveTab('schedules')}>
    Schedules
  </button>
</div>

// 左侧内容
{activeTab === 'runs' ? <RunList ... /> : <ScheduleList ... />}

// 底部按钮
{activeTab === 'runs'
  ? <button onClick={openNewRunDrawer}>+ New Run</button>
  : <button onClick={openNewScheduleDrawer}>+ New Schedule</button>
}
```

### 8.2 ScheduleList 组件

**文件**：新建 `src/renderer/src/ScheduleList.tsx`

每个 schedule 条目展示：
- 名称
- cron 表达式（monospace 样式）
- 下次触发时间（由 `describeCron` + `nextFireTime` 计算）
- 启用/禁用 toggle
- 选中态高亮

点击选中后右侧显示 `ScheduleDetail`。

### 8.3 ScheduleDetail 组件

**文件**：新建 `src/renderer/src/ScheduleDetail.tsx`

右侧主内容区展示选中 schedule 的详情：

```
┌─────────────────────────────────────────────────┐
│  每日回归测试                         [编辑] [删除] │
├─────────────────────────────────────────────────┤
│  模板       需求→开发→测试                        │
│  项目       ~/projects/my-app                   │
│  Cron      0 9 * * 1-5                          │
│  上次触发   今天 09:00 · 成功                      │
│  下次触发   明天 09:00                            │
├─────────────────────────────────────────────────┤
│  最近运行记录                                     │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ 06-10 09:00   done   3步  4m32s  $0.12 │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ 06-09 09:00   done   3步  5m10s  $0.14 │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ 06-08 09:00   error  Step 2 失败        │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

点击历史记录条目 → 切换到 Runs tab 并选中该 run。

编辑按钮 → 打开 ScheduleDrawer（预填当前值）。

### 8.4 ScheduleDrawer 组件

**文件**：新建 `src/renderer/src/ScheduleDrawer.tsx`

从右侧滑出，和现有 `NewWorkflowRunDrawer` 交互一致。

表单字段：
- 计划名称（text input）
- Workflow 模板（select，从 templates 列表选择）
- 项目目录（text input + 文件夹选择按钮）
- Cron 表达式（monospace text input + 实时预览下次触发时间）
- 初始 Prompt（textarea）

Cron 输入交互：
- 输入时实时校验 `isValidCron()`
- 合法：下方显示绿色 ✓ + `describeCron()` 人类可读描述 + `nextFireTime()` 下次触发时间
- 非法：下方显示红色提示 "格式错误，请输入 5 字段 cron 表达式"

保存：调用 IPC `schedulesSave` → Scheduler 自动 register。

### 8.5 useSchedules hook

**文件**：新建 `src/renderer/src/useSchedules.ts`

```ts
export function useSchedules(): {
  schedules: WorkflowSchedule[]
  loading: boolean
  save: (input: ...) => Promise<WorkflowSchedule>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  refresh: () => Promise<void>
}
```

### 8.6 Run 列表中标记 scheduled

`WorkflowRunCard` 中，如果 `run.scheduledBy` 存在，名称前加 `[scheduled]` 标签，用不同颜色标识。

## 9. 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/shared/types.ts` | 修改：新增 `WorkflowSchedule`、4 个 IPC 通道、`autoConfirm/scheduledBy` 字段、`AppSettings.minimizeToTray` |
| `src/main/cronParser.ts` | **新建**：cron 解析、nextFire、校验、人类可读描述 |
| `src/main/ScheduleStore.ts` | **新建**：持久化 schedule 列表 |
| `src/main/Scheduler.ts` | **新建**：调度器 |
| `src/main/WorkflowManager.ts` | 修改：`start()` 接收 autoConfirm/scheduledBy；`finishStepWithHandoff()` 支持 auto-confirm |
| `src/main/ipc.ts` | 修改：注册 4 个 schedule handler；初始化 Scheduler；run 终态时更新 schedule |
| `src/main/index.ts` | 修改：创建 Tray、窗口关闭处理、badge/通知 |
| `src/main/AppSettingsStore.ts` | 修改：`minimizeToTray` 默认值 |
| `src/preload/index.ts` | 修改：暴露 4 个 schedule API + `cronDescribe/cronValidate` |
| `src/renderer/src/WorkflowWorkspace.tsx` | 修改：新增 Runs/Schedules tab 切换 |
| `src/renderer/src/useSchedules.ts` | **新建**：schedules 数据 hook |
| `src/renderer/src/ScheduleList.tsx` | **新建**：左侧 schedule 列表 |
| `src/renderer/src/ScheduleDetail.tsx` | **新建**：右侧 schedule 详情 + 历史记录 |
| `src/renderer/src/ScheduleDrawer.tsx` | **新建**：新建/编辑 schedule 的 drawer 表单 |
| `src/renderer/src/SettingsPanel.tsx` | 修改：新增 minimizeToTray 开关 |
| `src/renderer/src/styles.css` | 修改：tab、schedule 列表、详情、drawer 样式 |
| `resources/tray-icon.png` | **新建**：Tray 图标（16x16 template image） |

## 10. 任务列表

| # | 任务 | 依赖 | 预估 |
|---|------|------|------|
| S-1 | `shared/types.ts` 新增 `WorkflowSchedule`、IPC 通道、`autoConfirm`、`scheduledBy`、`minimizeToTray` | 无 | 小 |
| S-2 | 新建 `cronParser.ts`：parseCron、nextFireTime、isValidCron、describeCron | 无 | 中 |
| S-3 | 新建 `ScheduleStore.ts`：list / save / remove / toggle / updateLastTriggered | S-1 | 小 |
| S-4 | 新建 `Scheduler.ts`：register / unregister / fire / stopAll / scheduleNext | S-2, S-3 | 中 |
| S-5 | `WorkflowManager` 支持 autoConfirm：start 记录字段、finishStepWithHandoff 自动推进 | S-1 | 中 |
| S-6 | `ipc.ts` 注册 4 个 schedule handler + 初始化 Scheduler + run 终态更新 schedule | S-3, S-4 | 中 |
| S-7 | `preload/index.ts` 暴露 schedule API + cronValidate / cronDescribe | S-6 | 小 |
| S-8 | `index.ts` Tray 创建 + 窗口关闭最小化 + badge | S-1 | 中 |
| S-9 | `index.ts` 系统通知：schedule run 完成/失败时推送 Notification | S-8 | 小 |
| S-10 | `AppSettingsStore` + `SettingsPanel` 新增 minimizeToTray 开关 | S-1 | 小 |
| S-11 | `WorkflowWorkspace.tsx` 新增 Runs / Schedules tab 切换 | 无 | 小 |
| S-12 | 新建 `useSchedules.ts` hook | S-7 | 小 |
| S-13 | 新建 `ScheduleList.tsx`：列表 + toggle + 选中态 | S-11, S-12 | 中 |
| S-14 | 新建 `ScheduleDrawer.tsx`：新建/编辑表单 + cron 实时预览 | S-7, S-12 | 中 |
| S-15 | 新建 `ScheduleDetail.tsx`：详情 + 历史触发记录 + 跳转 run | S-12, S-13 | 中 |
| S-16 | Run 列表标记 `[scheduled]` | S-5 | 小 |
| S-17 | Tray icon 资源（16x16 PNG） | 无 | 小 |
| S-18 | 样式：tab、schedule list、detail、drawer | S-13, S-14, S-15 | 中 |
| S-19 | 测试：cron 解析、调度触发、auto-confirm、tray 后台、系统通知 | S-5, S-4 | 中 |

## 11. 测试计划

| 测试 | 验证 |
|------|------|
| cron 解析正确 | `parseCron('0 9 * * 1-5')` 返回正确 fields |
| nextFireTime | 周五 18:01 调用 `nextFireTime('0 18 * * 5')` 返回下周五 18:00 |
| describeCron | `describeCron('0 9 * * 1-5')` 返回 "工作日 09:00" |
| isValidCron | `'abc'` → false，`'* * * * *'` → false（间隔太短），`'0 9 * * *'` → true |
| 调度触发 | 注册 schedule 后到时间自动创建 run |
| auto-confirm | 定时 run 每步自动 done，不停在 awaiting-confirm |
| auto-confirm + error | step error 时 run 停止，不无限继续 |
| 启用/禁用 | 禁用后不触发；重新启用后注册新 timer |
| 编辑 schedule | 编辑 cron 后 timer 重新注册 |
| 删除 schedule | timer 被清理 |
| App 重启 | 重启后 Scheduler.start() 加载所有 enabled schedule |
| Tray 模式 | 关窗口后进程不退出、定时继续触发 |
| Tray 关闭 | 设置关闭 minimizeToTray 后，关窗口 = 退出 |
| 系统通知 | run error 时弹出 macOS 通知 |
| Tray badge | run error 时 Tray 图标/dock 出现 badge |
| 历史记录 | ScheduleDetail 展示该 schedule 的所有历史 run |
| 跳转 run | 点击历史记录条目切换到 Runs tab 并选中对应 run |

## 12. 风险

| 风险 | 缓解 |
|------|------|
| 用户写错 cron 每分钟触发 | `isValidCron` 拒绝间隔 < 1 分钟的表达式 |
| setTimeout 长时间 drift | 每次触发后重算 delay，不累积 |
| 多 schedule 同时触发 | WorkflowManager 已支持并行 run |
| Template 被删后 schedule 触发失败 | fire() catch error 并通知用户 |
| App 后台吃内存 | Tray 模式只保留主进程，窗口 hide 后 renderer 空闲 |
