# API 模式开发任务书

> 本文档包含 22 个可独立执行的开发任务，可直接交给 AI Agent（Codex/Claude Code）执行。
> 每个任务包含：背景上下文、具体要求、参考文件、验证命令。
> 完整技术规格见 `API_MODE_SPEC.md`。

---

## 前置说明

### 项目信息
- 项目路径：Electron + TypeScript + React 桌面应用
- 包管理器：`pnpm`
- 构建工具：`electron-vite`
- 测试框架：`node --test`（Node.js 内置 test runner）
- 类型检查：`pnpm run typecheck`
- 现有测试：`pnpm run test`

### 核心架构概念
- `CliAdapter` 接口（`src/main/adapters/types.ts`）：所有适配器的抽象，核心方法 `runTurn()` 返回 `AsyncIterable<AgentEvent>`
- `AgentEvent`（`src/shared/types.ts`）：统一事件流，包括 message-delta、tool-call、tool-result、turn-done 等
- `AsyncQueue`（`src/main/adapters/AsyncQueue.ts`）：push 式回调到 pull 式异步迭代的桥接
- `RunManager`（`src/main/RunManager.ts`）：运行生命周期管理，只消费 `AsyncIterable<AgentEvent>`
- `AgentStore`（`src/main/AgentStore.ts`）：CRUD 存储模式的参考实现

---

## 第一阶段：类型与基础

### 任务 1：扩展共享类型定义

**背景**：所有后续任务都依赖新的类型定义。需要在 `src/shared/types.ts` 中新增 API 模式相关类型。

**具体要求**：

1. 将 `AgentVendor` 从 `'claude' | 'codex'` 扩展为 `'claude' | 'codex' | 'api'`
2. 更新 `ALL_VENDORS` 数组包含 `'api'`
3. 新增类型：
```typescript
export type ApiProviderFormat = 'anthropic' | 'openai-compatible'

export interface ApiProviderConfig {
  id: string
  name: string
  format: ApiProviderFormat
  apiKey: string
  baseUrl?: string
  models: string[]
  defaultModel?: string
}
```
4. 在 `RunConfig` 接口中新增：
```typescript
apiProviderId?: string
apiMaxSteps?: number
```
5. 在 `AgentDefinition` 接口中新增：
```typescript
apiProviderId?: string
```
6. 在 `IPC` 常量中新增：
```typescript
providersList: 'providers:list',
providersSave: 'providers:save',
providersDelete: 'providers:delete',
providersTest: 'providers:test',
permissionRequest: 'permission:request',
permissionRespond: 'permission:respond',
```

**参考文件**：
- `src/shared/types.ts`（第 10 行 AgentVendor、第 103 行 RunConfig、第 133 行 AgentDefinition、第 443 行 IPC）

**验证命令**：
```bash
pnpm run typecheck
```

---

### 任务 2：安装依赖

**背景**：API 模式需要 Vercel AI SDK 和 Zod。

**具体要求**：

```bash
pnpm add ai @ai-sdk/anthropic @ai-sdk/openai zod
```

确保 `electron.vite.config.ts` 中的 `externalizeDepsPlugin()` 能正确处理这些包（通常自动处理，无需改动）。

**验证命令**：
```bash
node -e "require('ai'); require('@ai-sdk/anthropic'); require('@ai-sdk/openai'); require('zod'); console.log('OK')"
pnpm run typecheck
```

---

### 任务 3：实现 ProviderStore

**背景**：需要一个存储类来管理 API 供应商配置（API Key、Base URL、模型列表等）。参考 `AgentStore.ts` 的实现模式。

**具体要求**：

新建文件 `src/main/ProviderStore.ts`：

1. 使用 Electron 的 `app.getPath('userData')` 确定存储路径，文件名 `providers.json`
2. 实现 `list(): ApiProviderConfig[]` -- 返回所有配置（API Key 保持加密状态）
3. 实现 `save(input: Omit<ApiProviderConfig, 'id'> & { id?: string }): ApiProviderConfig` -- 创建或更新
4. 实现 `remove(id: string): void` -- 删除
5. 实现 `getDecrypted(id: string): ApiProviderConfig` -- 返回解密后的配置
6. API Key 加密：使用 `electron.safeStorage.encryptString()` / `decryptString()`
7. 若 `safeStorage.isEncryptionAvailable()` 为 false，回退到 base64 编码，console.warn 提示
8. 生成 UUID 用 `crypto.randomUUID()`

**参考文件**：
- `src/main/AgentStore.ts` -- CRUD 存储模式参考
- `src/main/AppSettingsStore.ts` -- 简单 JSON 存储参考

**验证命令**：
```bash
node --test tests/provider-store.test.mjs
```

**需同时编写的测试** `tests/provider-store.test.mjs`：
- 测试 `save()` 创建新配置并返回带 id 的对象
- 测试 `list()` 返回所有配置
- 测试 `save()` 更新已有配置
- 测试 `remove()` 删除配置
- 测试 `getDecrypted()` 返回解密的 API Key
- 注意：测试中需要 mock `electron` 模块的 `app` 和 `safeStorage`

---

## 第一阶段：工具执行器

### 任务 4：实现 FileRead 工具

**背景**：Agent 需要读取项目文件。这是最基础的工具之一。

**具体要求**：

新建文件 `src/main/adapters/api-tools/fileRead.ts`：

1. 导出函数 `createFileReadTool(cwd: string)` 返回 Vercel AI SDK 的 `tool()` 定义
2. 参数 schema：
```typescript
z.object({
  file_path: z.string().describe('文件的绝对路径'),
  offset: z.number().optional().describe('起始行号（从 0 开始）'),
  limit: z.number().optional().describe('最大读取行数，默认 2000'),
})
```
3. execute 实现：
   - 使用 `fs.readFileSync(path, 'utf8')` 读取
   - 按 `\n` 拆分，应用 offset 和 limit（默认 limit=2000）
   - 返回格式：每行添加行号前缀 `{行号}\t{内容}`
   - 文件不存在时返回错误信息字符串（不 throw）
   - 安全检查：`file_path` 必须是绝对路径

**参考文件**：
- `API_MODE_SPEC.md` 第 8.3 节

**验证命令**：
```bash
node --test tests/api-tools.test.mjs
```

**需同时编写的测试**（在 `tests/api-tools.test.mjs` 中，后续工具的测试也加入此文件）：
- 读取存在的文件，验证返回内容包含行号
- 使用 offset=5 limit=3 读取，验证只返回 3 行
- 读取不存在的文件，验证返回错误信息
- 读取空文件，验证不崩溃

---

### 任务 5：实现 FileWrite 工具

**背景**：Agent 需要创建和覆盖文件。

**具体要求**：

新建文件 `src/main/adapters/api-tools/fileWrite.ts`：

1. 导出函数 `createFileWriteTool(cwd: string, guard: PermissionGuard, onFileChanged?: callback)` 返回 `tool()` 定义
2. 参数 schema：
```typescript
z.object({
  file_path: z.string().describe('文件的绝对路径'),
  content: z.string().describe('要写入的内容'),
})
```
3. execute 实现：
   - 权限检查：`await guard.request('file_write', file_path)`，被拒绝时返回错误信息
   - `fs.mkdirSync(dirname(file_path), { recursive: true })`
   - 判断文件是否已存在（用于确定 op 是 create 还是 modify）
   - `fs.writeFileSync(file_path, content, 'utf8')`
   - 调用 `onFileChanged?.(file_path, op)`
   - 返回成功信息，包含写入的字节数
4. 注意：此任务中 `PermissionGuard` 尚未实现，先定义接口类型，execute 中预留调用位置，用简单的 pass-through 占位

**验证命令**：
```bash
node --test tests/api-tools.test.mjs
```

**测试用例**：
- 写入新文件，验证文件存在且内容正确
- 覆盖已有文件，验证内容更新
- 写入深层目录，验证自动创建父目录
- 路径非绝对路径时返回错误

---

### 任务 6：实现 FileEdit 工具

**背景**：Agent 需要精确编辑文件（字符串替换），而非整文件覆盖。

**具体要求**：

新建文件 `src/main/adapters/api-tools/fileEdit.ts`：

1. 导出函数 `createFileEditTool(cwd: string, guard: PermissionGuard, onFileChanged?: callback)` 返回 `tool()` 定义
2. 参数 schema：
```typescript
z.object({
  file_path: z.string().describe('文件的绝对路径'),
  old_string: z.string().describe('要查找的精确文本'),
  new_string: z.string().describe('替换文本'),
  replace_all: z.boolean().optional().describe('是否替换所有匹配项，默认 false'),
})
```
3. execute 实现：
   - 权限检查（同 fileWrite，预留 guard 调用）
   - 读取文件内容
   - 统计 `old_string` 出现次数
   - 0 次：返回错误 "未找到匹配文本"
   - 多次且 `replace_all !== true`：返回错误 "找到多个匹配，请使用 replace_all"
   - 执行替换并写回
   - 调用 `onFileChanged?.(file_path, 'modify')`
   - 返回成功信息

**验证命令**：
```bash
node --test tests/api-tools.test.mjs
```

**测试用例**：
- 单次匹配替换成功
- `replace_all` 替换多个匹配
- 未找到匹配文本返回错误
- 多匹配但未设 replace_all 返回错误
- old_string === new_string 返回错误

---

### 任务 7：实现 Glob 工具

**背景**：Agent 需要按模式查找项目中的文件。

**具体要求**：

新建文件 `src/main/adapters/api-tools/glob.ts`：

1. 导出函数 `createGlobTool(cwd: string)` 返回 `tool()` 定义
2. 参数 schema：
```typescript
z.object({
  pattern: z.string().describe('Glob 模式，如 "src/**/*.ts"'),
  path: z.string().optional().describe('基础目录，默认为项目根目录'),
})
```
3. execute 实现：
   - 基础目录为 `path ?? cwd`
   - 递归遍历目录，匹配文件名（可用 `minimatch` 或自实现简单 glob）
   - 硬排除：`node_modules`、`.git`、`dist`、`out`、`.next`、`__pycache__`
   - 结果上限 1000 个文件，超过时返回前 1000 个并附提示
   - 返回相对路径列表（每行一个）
   - 目录不存在时返回错误信息

**验证命令**：
```bash
node --test tests/api-tools.test.mjs
```

**测试用例**：
- 在临时目录创建文件结构，验证 `*.ts` 匹配正确
- 验证 node_modules 被排除
- 空匹配返回空列表

---

### 任务 8：实现 Grep 工具

**背景**：Agent 需要按正则搜索代码内容。

**具体要求**：

新建文件 `src/main/adapters/api-tools/grep.ts`：

1. 导出函数 `createGrepTool(cwd: string)` 返回 `tool()` 定义
2. 参数 schema：
```typescript
z.object({
  pattern: z.string().describe('搜索的正则表达式'),
  path: z.string().optional().describe('搜索的文件或目录，默认为项目根目录'),
  include: z.string().optional().describe('文件过滤模式，如 "*.ts"'),
})
```
3. execute 实现：
   - 优先尝试使用 ripgrep（`rg`）：`spawn('rg', [pattern, searchPath, '--json', ...])`
   - 若 `rg` 不可用，回退到纯 Node.js 实现：递归遍历 + 逐行正则匹配
   - 输出格式：`文件路径:行号:匹配内容`（每行一条）
   - 结果上限 500 条
   - 排除二进制文件
   - 硬排除：`node_modules`、`.git`
   - 正则无效时返回错误信息

**验证命令**：
```bash
node --test tests/api-tools.test.mjs
```

**测试用例**：
- 搜索已知关键词，验证返回匹配行
- include 过滤只搜索指定文件类型
- 无匹配返回空列表
- 无效正则返回错误

---

### 任务 9：实现 Bash 工具

**背景**：Agent 需要执行 Shell 命令（运行测试、安装依赖、git 操作等）。这是最重要也最危险的工具。

**具体要求**：

新建文件 `src/main/adapters/api-tools/bash.ts`：

1. 导出函数 `createBashTool(cwd: string, signal: AbortSignal, guard: PermissionGuard)` 返回 `tool()` 定义
2. 参数 schema：
```typescript
z.object({
  command: z.string().describe('要执行的 Shell 命令'),
  timeout: z.number().optional().describe('超时时间（毫秒），默认 120000，最大 600000'),
  description: z.string().optional().describe('命令用途描述'),
})
```
3. execute 实现：
   - 权限检查：`await guard.request('bash', description ?? command)`
   - Shell 路径：`process.env.SHELL || '/bin/bash'`
   - 使用 `child_process.spawn(shell, ['-c', command], { cwd, env: process.env })`
   - 捕获 stdout 和 stderr（合并）
   - 超时处理：默认 120s，最大 600s，超时后 SIGTERM → 3s 后 SIGKILL
   - AbortSignal 处理：signal 触发时立即 kill 子进程
   - 输出截断：超过 100KB 时截断并附 "[输出已截断]" 提示
   - 返回 `{ exitCode, output }` 对象

**参考文件**：
- `src/main/adapters/ProcessManager.ts` -- 进程管理参考（kill 逻辑、stderr 截断）

**验证命令**：
```bash
node --test tests/api-tools.test.mjs
```

**测试用例**：
- 执行 `echo hello`，验证返回 `hello\n`
- 执行 `exit 1`，验证 exitCode 为 1
- 超时测试：`sleep 999` + timeout=500，验证进程被终止
- 输出截断测试

---

### 任务 10：实现工具注册表

**背景**：将所有工具统一注册，供 ApiAdapter 使用。

**具体要求**：

新建文件 `src/main/adapters/api-tools/index.ts`：

1. 导出函数 `buildToolSet(cwd, signal, guard, onFileChanged?)` 返回工具映射对象
2. 导入所有 9 个工具的创建函数
3. 同时导出 `PermissionGuard` 的接口类型（或类，取决于任务 20 是否已完成）：
```typescript
// 临时占位实现（任务 20 会替换为完整版）
export class PermissionGuard {
  constructor(private mode: string) {}
  async request(_tool: string, _desc: string): Promise<boolean> {
    return true // 暂时全部允许
  }
  respond(_id: string, _allowed: boolean): void {}
}
```
4. 返回的对象 key 即为工具名：`bash`、`file_read`、`file_edit`、`file_write`、`glob`、`grep`、`fetch`、`sourcegraph`、`todo_write`
5. 注意：fetch、sourcegraph、todoWrite 暂时用空占位工具（任务 22 实现），返回 "工具未实现"

**验证命令**：
```bash
pnpm run typecheck
```

---

### 任务 11：实现 ApiAdapter 核心

**背景**：这是 API 模式的核心适配器，使用 Vercel AI SDK 的 `streamText()` 驱动 Agent 循环，将流式事件映射为 `AgentEvent`。

**具体要求**：

新建文件 `src/main/adapters/apiAdapter.ts`：

1. 实现 `ApiAdapter` 类，实现 `CliAdapter` 接口
2. capabilities：`{ bidirectionalStdin: false, structuredOutputSchema: false, partialTokenStream: true }`
3. 构造函数接收 `ApiProviderConfig` 和 `PermissionGuard`
4. `runTurn(input)` 方法：
   - 创建 `AsyncQueue<AgentEvent>`
   - 异步启动 `run()` 方法，返回 queue
5. `run()` 方法：
   - 生成 sessionId（`randomUUID()`）
   - 推送 `{ kind: 'session-started', sessionId, vendor: 'api' }`
   - 解析模型：`resolveModel(config, input.model ?? config.defaultModel ?? config.models[0])`
   - 调用 `streamText()` 并配置 tools、stopWhen、abortSignal
   - 遍历 `result.fullStream` 映射事件（见下表）
   - 异常时推送 `{ kind: 'error', recoverable: false, message }`
   - 最终调用 `queue.close()`
6. `resolveModel()` 函数：
   - `format === 'anthropic'` → `createAnthropic({ apiKey, baseURL? })(modelId)`
   - `format === 'openai-compatible'` → `createOpenAI({ apiKey, baseURL? })(modelId)`
7. 事件映射表：

| AI SDK fullStream part.type | AgentEvent |
|---|---|
| `text-delta` | `{ kind: 'message-delta', text: part.textDelta }` |
| `tool-call` | `{ kind: 'tool-call', id: part.toolCallId, name: part.toolName, input: part.args }` |
| `tool-result` | `{ kind: 'tool-result', id: part.toolCallId, ok: 无 error, output: part.result }` |
| `step-finish` (有 usage) | `{ kind: 'usage', inputTokens, outputTokens }` |
| `finish` | `{ kind: 'turn-done', sessionId, reason: 'complete' }` |
| `error` | `{ kind: 'error', recoverable: false, message }` |

8. System prompt：将 `input.appendSystemPrompt` 作为 system 参数传入 streamText

**参考文件**：
- `src/main/adapters/claudeAdapter.ts` -- 现有适配器参考（AsyncQueue 使用方式）
- `src/main/adapters/AsyncQueue.ts` -- 队列实现
- `API_MODE_SPEC.md` 第 7 节

**验证命令**：
```bash
node --test tests/api-adapter.test.mjs
pnpm run typecheck
```

**需同时编写的测试** `tests/api-adapter.test.mjs`：
- Mock `streamText` 返回预定义的 fullStream 序列
- 验证 session-started 是第一个事件
- 验证 text-delta 正确映射
- 验证 tool-call + tool-result 正确映射
- 验证 turn-done 是最后一个事件
- 验证错误情况产出 error 事件

---

### 任务 12：修改 Adapter Factory

**背景**：`factory.ts` 需要新增 `'api'` 分支，并接受额外上下文参数。

**具体要求**：

修改 `src/main/adapters/factory.ts`：

1. 新增 `AdapterContext` 接口：
```typescript
export interface AdapterContext {
  providerStore?: ProviderStore
  runConfig?: RunConfig
  emitEvent?: (event: AgentEvent) => void
}
```
2. 修改 `createAdapter` 签名为 `createAdapter(vendor: AgentVendor, ctx?: AdapterContext): CliAdapter`
3. 新增 `case 'api':` 分支：
   - 校验 `ctx?.providerStore` 和 `ctx?.runConfig?.apiProviderId` 存在
   - 调用 `providerStore.getDecrypted(apiProviderId)` 获取配置
   - 创建 `PermissionGuard`（使用 `ctx.runConfig.permissionMode`）
   - 返回 `new ApiAdapter(providerConfig, guard)`
4. `'claude'` 和 `'codex'` 分支不变
5. `default` 的 exhaustive check 自动生效（TypeScript 编译器会检查）

**参考文件**：
- `src/main/adapters/factory.ts`（当前 18 行）
- `src/main/adapters/apiAdapter.ts`（任务 11）

**验证命令**：
```bash
pnpm run typecheck
```

---

### 任务 13：修改 RunManager 传递上下文

**背景**：`RunManager` 调用 `createAdapter(config.vendor)` 时需要传递额外上下文，使 API 适配器能获取供应商配置。

**具体要求**：

修改 `src/main/RunManager.ts`：

1. 构造函数新增 `providerStore` 参数（可选）：
```typescript
constructor(
  private readonly transcripts: TranscriptStore,
  private readonly providerStore?: ProviderStore
) {}
```
2. 在 `start()` 方法中，修改 `createAdapter` 调用：
```typescript
const adapter = createAdapter(config.vendor, {
  providerStore: this.providerStore,
  runConfig: config,
  emitEvent: (ev) => onEvent(id, ev)
})
```
3. 在 `runWithResume()` 方法中的 retry 路径同样传递上下文
4. 不改变 `pump()`、`push()`、`abort()` 等方法

**参考文件**：
- `src/main/RunManager.ts`（当前 163 行）

**验证命令**：
```bash
pnpm run typecheck
pnpm run test  # 确保现有测试不 break
```

---

### 任务 14：注册 IPC 处理器

**背景**：主进程需要注册供应商 CRUD 的 IPC 处理器，并将 `ProviderStore` 传递给 `RunManager`。

**具体要求**：

修改 `src/main/ipc.ts`：

1. 在 `registerIpc()` 中实例化 `ProviderStore`：
```typescript
const providerStore = new ProviderStore()
```
2. 将 `providerStore` 传递给 `RunManager` 构造函数
3. 注册新 IPC 处理器：
```typescript
ipcMain.handle(IPC.providersList, () => providerStore.list())
ipcMain.handle(IPC.providersSave, (_e, input) => providerStore.save(input))
ipcMain.handle(IPC.providersDelete, (_e, id: string) => providerStore.remove(id))
ipcMain.handle(IPC.providersTest, async (_e, id: string) => {
  // 尝试用该供应商配置发一个简单请求
  // 成功返回 { ok: true, message: '连接成功' }
  // 失败返回 { ok: false, message: 错误信息 }
})
```
4. 注册权限响应处理器（预留，第三阶段完善）：
```typescript
ipcMain.handle(IPC.permissionRespond, (_e, requestId: string, allowed: boolean) => {
  // TODO: 第三阶段实现，路由到正确的 PermissionGuard
})
```
5. 将 `providerStore` 传递给 `listCliModels` 的调用处（如果已有该函数调用）

**参考文件**：
- `src/main/ipc.ts`（当前 444 行，特别是 164-186 行的 run 处理器模式）

**验证命令**：
```bash
pnpm run typecheck
pnpm run dev  # 手动验证应用启动不崩溃
```

---

## 第二阶段：界面

### 任务 15：实现 useProviders Hook

**背景**：渲染进程需要一个 React Hook 来管理供应商配置的加载和保存。

**具体要求**：

新建文件 `src/renderer/src/useProviders.ts`：

1. 导出 `useProviders()` hook，返回：
```typescript
{
  providers: ApiProviderConfig[]
  loading: boolean
  save: (input: Omit<ApiProviderConfig, 'id'> & { id?: string }) => Promise<void>
  remove: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<{ ok: boolean; message: string }>
  reload: () => Promise<void>
}
```
2. 内部使用 `useState` + `useEffect` + `useCallback`
3. 在 mount 时调用 `window.api.listProviders()` 加载数据
4. `save()` 调用 `window.api.saveProvider(input)` 后 reload
5. `remove()` 调用 `window.api.deleteProvider(id)` 后 reload
6. `testConnection()` 调用 `window.api.testProvider(id)`

**参考文件**：
- `src/renderer/src/useAppSettings.ts` -- Hook 模式参考
- `src/renderer/src/useAgents.ts` -- CRUD Hook 模式参考

**验证命令**：
```bash
pnpm run typecheck
```

---

### 任务 16：实现 ProviderSettings 组件 ✅

**背景**：设置面板需要供应商配置管理 UI。UI 方案已确认。

**确认的 UI 方案**：方案 A — 紧凑行列表 + 列表底部内联展开表单。参考 `ui-api-mode-designs.html` 中的 decision 1 和 decision 2 mockup。

**具体要求**：

新建文件 `src/renderer/src/ProviderSettings.tsx`：

1. Props：`{ providers: ApiProviderConfig[], loading: boolean, onSave, onRemove, onTest }`
2. **供应商列表（紧凑行布局）**：
   - 外层容器：`<div className="provider-grid">`（flex column, gap 8px）
   - 每个供应商一行 `<div className="provider-card">`（flex row, align-items center, gap 12px）：
     - 左侧图标：`<div className="provider-card-icon icon-{format}">`，34x34px 圆角方块，首字母居中
       - CSS 类：`icon-anthropic`（橙色背景）、`icon-openai`（蓝色背景）、`icon-deepseek`（亮蓝背景）、`icon-kimi`（紫色背景）、`icon-custom`（灰色背景）
     - 中间信息：`<div className="provider-card-body">`
       - 名称：`<div className="provider-card-name">`，12px 加粗
       - 元信息行：`<div className="provider-card-meta">`，包含 key-badge（`<span className="key-badge">sk-****xxxx</span>`）+ baseUrl
       - 模型标签：多个 `<span className="model-tag">`，9px monospace 蓝色标签
     - 右侧操作按钮：编辑（✏️）和删除（🗑）图标按钮
   - 列表底部：`<button className="add-provider-btn">＋ 添加供应商</button>`（虚线边框）
3. **添加/编辑表单（内联展开）**：
   - 点击"添加供应商"后在列表底部展开 `<div className="provider-form">`（accent-dim 边框，微蓝背景）
   - 表单标题：`<div className="pf-title">添加新供应商</div>`
   - 字段布局（使用 `pf-field`、`pf-label`、`pf-input`、`pf-select` CSS 类）：
     - 第一行双列（`pf-row`）：格式选择（Anthropic / OpenAI 兼容）+ 名称输入
     - API Key：type=password 输入框
     - Base URL：输入框 + 下方预设按钮行（`preset-row` 内含 `preset-chip`：DeepSeek、Kimi、硅基流动）
     - 模型列表：逗号分隔输入框 + 提示文字（`pf-hint`）
   - 操作按钮行（`pf-actions`，靠右对齐）："测试连接"（`pf-btn success`）、"取消"（`pf-btn`）、"保存"（`pf-btn primary`）
   - 编辑模式：同一表单，标题改为"编辑供应商"，预填已有值
4. State 管理：
   - `editingId: string | null` — null 为新增模式，非 null 为编辑模式
   - `formOpen: boolean` — 控制表单展开/收起
   - 表单字段用单个 `draft` state 对象管理

**需新增的 CSS**（添加到 `src/renderer/src/styles.css` 末尾）：
```css
/* ── Provider Settings ── */
.provider-grid { display: flex; flex-direction: column; gap: 8px; }
.provider-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 9px; background: rgba(36,40,51,.6); border: 1px solid var(--border-soft); }
.provider-card-icon { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; }
.icon-anthropic { background: rgba(232,164,90,.15); color: #d4874d; }
.icon-openai { background: rgba(108,140,248,.15); color: var(--accent); }
.icon-deepseek { background: rgba(96,165,250,.15); color: #60a5fa; }
.icon-kimi { background: rgba(180,142,173,.15); color: var(--purple); }
.icon-custom { background: rgba(154,163,181,.1); color: var(--text-dim); }
.provider-card-body { flex: 1; min-width: 0; }
.provider-card-name { font-size: 12px; font-weight: 600; color: var(--text-strong); }
.provider-card-meta { font-size: 10px; color: var(--text-dim); margin-top: 2px; }
.key-badge { font-family: ui-monospace, SFMono, monospace; font-size: 9px; color: var(--text-dim); background: rgba(154,163,181,.1); padding: 1px 5px; border-radius: 3px; }
.model-tag { font-size: 9px; padding: 1px 6px; border-radius: 3px; background: rgba(108,140,255,.1); color: var(--accent); font-family: ui-monospace, SFMono, monospace; display: inline-block; margin: 2px 2px 0 0; }
.provider-card-actions { display: flex; gap: 4px; flex-shrink: 0; }
.provider-card-actions button { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: var(--text-dim); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.provider-card-actions button:hover { color: var(--accent); background: rgba(108,140,255,.08); }
.add-provider-btn { width: 100%; padding: 9px; border-radius: 7px; border: 1px dashed var(--border); background: transparent; color: var(--text-dim); cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; gap: 5px; }
.add-provider-btn:hover { border-color: var(--accent); color: var(--accent); }
.provider-form { border: 1px solid var(--accent-dim); border-radius: 9px; background: rgba(108,140,255,.03); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.pf-title { font-size: 12px; font-weight: 600; color: var(--text-strong); }
.pf-row { display: flex; gap: 8px; }
.pf-row > * { flex: 1; }
.pf-field { display: flex; flex-direction: column; gap: 3px; }
.pf-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.pf-input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text); border-radius: 5px; padding: 7px 9px; font-size: 12px; font-family: inherit; width: 100%; }
.pf-input:focus { outline: none; border-color: var(--accent); }
.pf-select { background: var(--bg-input); border: 1px solid var(--border); color: var(--text); border-radius: 5px; padding: 7px 9px; font-size: 12px; width: 100%; appearance: none; }
.pf-hint { font-size: 10px; color: var(--text-dim); }
.pf-actions { display: flex; gap: 6px; justify-content: flex-end; }
.pf-btn { padding: 5px 12px; border-radius: 5px; font-size: 11px; cursor: pointer; border: 1px solid var(--border); background: var(--bg-input); color: var(--text); }
.pf-btn:hover { border-color: var(--accent); }
.pf-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.pf-btn.success { background: var(--green); border-color: var(--green); color: #fff; font-weight: 600; }
.preset-row { display: flex; gap: 3px; margin-top: 3px; }
.preset-chip { font-size: 9px; padding: 2px 7px; border-radius: 3px; border: 1px solid var(--border-soft); background: transparent; color: var(--text-dim); cursor: pointer; }
.preset-chip:hover { border-color: var(--accent); color: var(--accent); }
```

**参考文件**：
- `ui-api-mode-designs.html` — 方案 A mockup（decision 1 + decision 2）
- `src/renderer/src/SettingsPanel.tsx` — settings-section 布局参考
- `src/renderer/src/AgentManager.tsx` — 编辑表单状态管理参考

**验证命令**：
```bash
pnpm run typecheck
```

---

### 任务 17：修改 SettingsPanel 加入供应商区域 ✅

**背景**：在设置面板中嵌入供应商管理 UI。

**具体要求**：

修改 `src/renderer/src/SettingsPanel.tsx`：

1. 顶部新增 import：`import { ProviderSettings } from './ProviderSettings'` 和 `import { useProviders } from './useProviders'`
2. 组件内调用 `const providerState = useProviders()`
3. 在 CLI 管理 `</section>` 和 `<hr className="settings-divider" />` 之后、数据管理区域之前，插入：
```tsx
<hr className="settings-divider" />
<section className="settings-section">
  <div className="settings-section-head">
    <div>
      <h3 className="settings-section-title">API 供应商</h3>
      <p className="settings-section-desc">配置 API Key 直接调用大模型，无需安装 CLI。</p>
    </div>
  </div>
  <ProviderSettings {...providerState} />
</section>
```
4. 不改动现有 CLI、数据管理、记忆系统、后台运行区域

**参考文件**：
- `src/renderer/src/SettingsPanel.tsx`（第 134 行 `{/* ── divider ── */}` 之后插入）

**验证命令**：
```bash
pnpm run typecheck
```

---

### 任务 18：修改运行面板支持 API 供应商选择 ✅

**背景**：SingleRunPanel 和 AgentManager 中的供应商选择需要支持 `'api'` 选项。

**确认的 UI 方案**：方案 A — 标签页切换。参考 `ui-api-mode-designs.html` 中的 decision 3 mockup。

**具体要求**：

1. **修改 `src/renderer/src/SingleRunPanel.tsx`**：
   - 将现有 vendor 选择改为三个平级 tab 按钮：
   ```tsx
   <div className="vendor-tabs">
     <button className={`vendor-tab${vendor === 'claude' ? ' active' : ''}`} onClick={() => setVendor('claude')}>Claude CLI</button>
     <button className={`vendor-tab${vendor === 'codex' ? ' active' : ''}`} onClick={() => setVendor('codex')}>Codex CLI</button>
     <button className={`vendor-tab${vendor === 'api' ? ' active' : ''}`} onClick={() => setVendor('api')}>API</button>
   </div>
   ```
   - 需新增 CSS（添加到 styles.css）：
   ```css
   .vendor-tabs { display: flex; gap: 4px; }
   .vendor-tab { padding: 5px 12px; border-radius: 5px; font-size: 11px; font-weight: 600; border: 1px solid var(--border); background: transparent; color: var(--text-dim); cursor: pointer; }
   .vendor-tab:hover { border-color: var(--accent); color: var(--text); }
   .vendor-tab.active { background: rgba(108,140,255,.14); border-color: rgba(108,140,255,.58); color: #fff; }
   ```
   - 当 `vendor === 'api'` 时：
     - 显示"API 供应商"下拉（`<select>`，从 `useProviders()` 获取列表，value 为 `provider.id`）
     - 显示"模型"下拉（从选中供应商的 `models` 数组渲染 options）
     - 隐藏 Codex 专属选项（`CodexOptions` 组件 / reasoning effort / service tier 选择器）
   - state 新增：`selectedProviderId: string`
   - `handleStart` 中当 `vendor === 'api'` 时，`RunConfig` 包含 `apiProviderId: selectedProviderId`

2. **修改 `src/renderer/src/AgentManager.tsx`**：
   - Agent 编辑器的 vendor 选择使用相同的 `vendor-tabs` 样式
   - 当 `draft.vendor === 'api'` 时显示供应商下拉菜单
   - `AgentDefinition` 保存时包含 `apiProviderId`

3. **修改 `src/preload/index.ts`**：
   - 新增 IPC 桥接方法：
   ```typescript
   listProviders: () => ipcRenderer.invoke('providers:list'),
   saveProvider: (input: any) => ipcRenderer.invoke('providers:save', input),
   deleteProvider: (id: string) => ipcRenderer.invoke('providers:delete', id),
   testProvider: (id: string) => ipcRenderer.invoke('providers:test', id),
   respondPermission: (requestId: string, allowed: boolean) => ipcRenderer.invoke('permission:respond', requestId, allowed),
   ```

**参考文件**：
- `ui-api-mode-designs.html` — 方案 A mockup（decision 3）
- `src/renderer/src/SingleRunPanel.tsx`（第 65-73 行 state、第 105-118 行 handleStart）
- `src/renderer/src/AgentManager.tsx`（第 177-187 行 vendor 选择）

**验证命令**：
```bash
pnpm run typecheck
```

---

### 任务 19：扩展模型目录支持 API 供应商

**背景**：模型目录需要包含 API 供应商的模型列表。

**具体要求**：

修改 `src/main/cliModels.ts`：

1. 新增函数 `listApiModels(store: ProviderStore): Promise<VendorModelCatalog>`：
   - 从 `store.list()` 获取所有供应商
   - 将每个供应商的 models 展开为 `ModelOption[]`
   - label 格式：`"模型名 (供应商名)"`
   - id 格式：`"供应商id:模型名"`
   - 返回 `VendorModelCatalog`
2. 修改 `listCliModels()` 签名，接受可选的 `ProviderStore` 参数
3. 在 `Promise.all` 中并行调用 `listApiModels()`
4. 返回的 `ModelCatalog` 包含 `api` 键

**参考文件**：
- `src/main/cliModels.ts`（第 32-38 行 listCliModels、第 249-263 行工具函数）

**验证命令**：
```bash
pnpm run typecheck
```

---

## 第三阶段：权限系统

### 任务 20：实现 PermissionGuard

**背景**：API 模式下工具执行前需要权限检查。不同权限模式决定是否需要用户确认。

**具体要求**：

新建文件 `src/main/adapters/api-tools/PermissionGuard.ts`（替换任务 10 中的占位实现）：

1. 实现完整的 `PermissionGuard` 类：
```typescript
export class PermissionGuard {
  private pending: Map<string, { resolve: (allowed: boolean) => void }>
  private timeoutMs: number = 300_000  // 5 分钟

  constructor(mode: PermissionMode, emitEvent: (event: AgentEvent) => void)

  async request(toolName: string, description: string): Promise<boolean>
  respond(requestId: string, allowed: boolean): void
}
```
2. `request()` 逻辑：
   - `bypassPermissions` → 直接返回 true
   - `plan` → 直接返回 false
   - `acceptEdits` + 编辑类工具（file_edit、file_write）→ 返回 true
   - 其他情况 → 通过 `emitEvent` 发送权限请求，等待 `respond()` 被调用
   - 超时（5 分钟）→ 自动返回 false
3. 权限请求事件格式：
```typescript
emitEvent({
  kind: 'system',
  text: JSON.stringify({
    type: 'permission-request',
    requestId,
    toolName,
    description
  })
})
```
4. 辅助函数 `isEditTool(name: string): boolean`：匹配 `file_edit`、`file_write`

**验证命令**：
```bash
node --test tests/permission-guard.test.mjs
```

**需同时编写的测试** `tests/permission-guard.test.mjs`：
- `bypassPermissions` 模式：所有请求返回 true
- `plan` 模式：所有请求返回 false
- `acceptEdits` 模式：file_edit 返回 true，bash 等待
- `default` 模式：发送请求事件并等待
- 测试 `respond(id, true)` 解除等待并返回 true
- 测试 `respond(id, false)` 解除等待并返回 false
- 测试超时自动拒绝

---

### 任务 21：修改 TranscriptViewer 渲染权限审批 UI ✅

**背景**：当 API 模式下工具需要权限时，transcript 中出现权限请求事件，需要渲染允许/拒绝按钮。

**确认的 UI 方案**：方案 A — 醒目卡片式。参考 `ui-api-mode-designs.html` 中的 decision 4 mockup。

**具体要求**：

修改 `src/renderer/src/TranscriptViewer.tsx`：

1. 在渲染 `kind: 'system'` 事件时，尝试 `JSON.parse(event.text)`，检测是否含有 `type: 'permission-request'`
2. 若是权限请求，渲染独立的审批卡片（不使用普通 `ev-system` 样式）：
   - **待审批状态**（`perm-block perm-block-pending`）：
     ```tsx
     <div className="perm-block perm-block-pending">
       <div className="perm-header">
         <span className="perm-icon">🔒</span>
         <span className="perm-title perm-title-pending">权限请求</span>
       </div>
       <div className="perm-tool">{toolName} 请求执行命令</div>
       <div className="perm-cmd">{description}</div>
       <div className="perm-btns">
         <button className="pf-btn success" onClick={() => respond(requestId, true)}>✓ 允许</button>
         <button className="pf-btn pf-btn-danger" onClick={() => respond(requestId, false)}>✗ 拒绝</button>
         <button className="pf-btn" onClick={() => allowAll()}>本次全部允许</button>
       </div>
     </div>
     ```
   - **已审批状态**（`perm-block perm-block-resolved`）：
     ```tsx
     <div className="perm-block perm-block-resolved">
       <div className="perm-header">
         <span className="perm-icon">🔒</span>
         <span className="perm-title perm-title-resolved">权限请求</span>
         <span className="perm-badge perm-badge-allowed">✓ 已允许</span>  // 或 perm-badge-denied
       </div>
       <div className="perm-tool">{toolName} · {description}</div>
     </div>
     ```
3. State 管理：用 `Map<string, 'pending' | 'allowed' | 'denied'>` 跟踪每个 requestId 的状态
4. `respond()` 函数：调用 `window.api.respondPermission(requestId, allowed)` 并更新本地状态
5. "本次全部允许"：设置一个 `allowAllForRun` flag，后续权限请求自动批准

**需新增的 CSS**（添加到 `src/renderer/src/styles.css` 末尾）：
```css
/* ── Permission Request ── */
.perm-block { border-radius: 7px; padding: 11px 13px; }
.perm-block-pending { background: rgba(212,165,72,.08); border: 1px solid rgba(212,165,72,.3); }
.perm-block-resolved { background: rgba(76,175,125,.05); border: 1px solid rgba(76,175,125,.2); opacity: 0.7; }
.perm-header { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.perm-icon { font-size: 14px; }
.perm-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.perm-title-pending { color: var(--yellow); }
.perm-title-resolved { color: var(--green); }
.perm-tool { font-size: 12px; font-weight: 600; color: var(--text-strong); margin-bottom: 3px; }
.perm-cmd { font-size: 11px; color: var(--text-soft); font-family: ui-monospace, SFMono, monospace; background: rgba(0,0,0,.25); padding: 5px 9px; border-radius: 4px; margin-bottom: 9px; white-space: pre-wrap; word-break: break-all; }
.perm-btns { display: flex; gap: 6px; }
.pf-btn-danger { border-color: rgba(219,107,107,.5); color: var(--red); }
.pf-btn-danger:hover { border-color: var(--red); }
.perm-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 3px; }
.perm-badge-allowed { background: rgba(76,175,125,.15); color: var(--green); }
.perm-badge-denied { background: rgba(219,107,107,.15); color: var(--red); }
```

**参考文件**：
- `ui-api-mode-designs.html` — 方案 A mockup（decision 4，含待审批和已处理两种状态）
- `src/renderer/src/TranscriptViewer.tsx` — 现有事件渲染逻辑
- `src/renderer/src/WorkflowRunDetail.tsx`（第 208-228 行确认按钮模式参考）

**验证命令**：
```bash
pnpm run typecheck
```

---

## 第四阶段：扩展工具与打磨

### 任务 22：实现 Fetch + Sourcegraph + TodoWrite 工具

**背景**：替换任务 10 中的占位实现，完成剩余 3 个工具。

**具体要求**：

1. **`src/main/adapters/api-tools/fetch.ts`**：
   - 参数：`{ url: string, format?: 'text' | 'json' | 'markdown' }`
   - 使用 Node.js 内置 `fetch(url)`，30 秒超时
   - 响应体截断至 100KB
   - `format: 'json'` 时尝试 JSON.parse
   - 返回内容字符串
   - URL 无效或请求失败时返回错误信息

2. **`src/main/adapters/api-tools/sourcegraph.ts`**：
   - 参数：`{ query: string, count?: number }`
   - HTTP GET 到 `https://sourcegraph.com/.api/search/stream?q=${encodeURIComponent(query)}&v=V3&t=literal&display=${count ?? 10}`
   - 解析响应中的 `content` 匹配
   - 返回格式：每条结果包含 `仓库名 > 文件路径\n匹配内容`
   - 网络错误时返回错误信息

3. **`src/main/adapters/api-tools/todoWrite.ts`**：
   - 参数：`{ todos: Array<{ content: string, status: 'pending' | 'in_progress' | 'completed' }> }`
   - 使用闭包作用域的数组存储
   - 每次调用覆盖整个列表（全量更新）
   - 返回格式化后的当前列表

4. 更新 `api-tools/index.ts`，将占位替换为真实实现

**验证命令**：
```bash
node --test tests/api-tools.test.mjs
pnpm run typecheck
```

**测试用例**：
- fetch：成功获取一个已知 URL（如 https://httpbin.org/get）
- sourcegraph：搜索 "fmt.Println" 返回 Go 代码结果
- todoWrite：写入 3 个 todo，验证返回列表正确；再次写入覆盖

---

## 执行顺序建议

```
可并行           串行依赖
───────          ──────────
任务 1 ──────→ 任务 3 ──→ 任务 14
任务 2 ──────→ 任务 4
             → 任务 5
             → 任务 6
             → 任务 7      全部 → 任务 10 → 任务 11 → 任务 12 → 任务 13
             → 任务 8
             → 任务 9

任务 1 ──────→ 任务 15 → 任务 16 → 任务 17
             → 任务 18
             → 任务 19

任务 1 ──────→ 任务 20 → 任务 21

任务 2 ──────→ 任务 22
```

**最大并行度**：任务 4-9 可以 6 个同时进行（互不依赖）。
