# API 模式技术规格说明书

> Agent Studio：无需安装 CLI，通过直接调用 LLM API 驱动编码智能体。

## 1. 背景与动机

Agent Studio 目前要求用户在本地安装 Claude CLI 和/或 Codex CLI，这带来了以下问题：

- 用户在使用应用前必须安装和配置 CLI 工具，门槛较高
- 国产大模型（DeepSeek、Kimi 等）没有对应的 CLI，完全无法接入
- CLI 更新可能导致应用兼容性问题

**API 模式**允许用户仅配置 API Key + Base URL 即可立即使用 Agent Studio，支持任何提供 Chat Completions API 的模型供应商。

## 2. 设计原则

- **纯增量变更** -- 现有 CLI 适配器（`claudeAdapter`、`codexAdapter`）保持不变
- **三种模式共存** -- Claude CLI、Codex CLI 和 API 模式同时可用
- **统一接口** -- 新适配器实现 `CliAdapter` 接口，输出 `AsyncIterable<AgentEvent>`，`RunManager` 和 `WorkflowManager` 无需修改
- **供应商无关** -- 一个适配器通过 Vercel AI SDK 统一处理 Anthropic、OpenAI、DeepSeek、Kimi 及任何 OpenAI 兼容供应商

## 3. 整体架构

```
现有（不变）                              新增
─────────────────────                   ─────────────────────
RunManager                              ApiAdapter（实现 CliAdapter）
  ├── claudeAdapter（CLI 进程）            ├── Vercel AI SDK（Agent 循环 + 流式输出）
  ├── codexAdapter（CLI 进程）             ├── ToolExecutor（工具执行器）
  └── apiAdapter（新增）◄────────────────┤    ├── bash.ts
                                          │    ├── fileRead.ts
WorkflowManager（不变）                   │    ├── fileEdit.ts
AgentStore（不变）                        │    ├── fileWrite.ts
Scheduler（不变）                         │    ├── glob.ts
MemoryInjector（不变）                    │    ├── grep.ts
                                          │    ├── fetch.ts
                                          │    ├── sourcegraph.ts
                                          │    ├── todoWrite.ts
                                          │    └── askUser.ts（P1）
                                          ├── PermissionGuard（权限守卫）
                                          └── ProviderStore（供应商配置存储）
```

### 数据流

1. 渲染进程发送 `RunConfig`（含 `vendor: 'api'` + `apiProviderId`）通过 IPC `run:start`
2. `ipc.ts` 注入 Memory 上下文，调用 `RunManager.start()`
3. `RunManager` 调用 `createAdapter('api', ctx)` 创建 `ApiAdapter`
4. `ApiAdapter.runTurn()` 调用 Vercel AI SDK 的 `streamText()` 并注册工具
5. AI SDK 管理 Agent 循环（模型调用工具 → 本地执行 → 将结果回传 → 重复）
6. 流式事件被映射为 `AgentEvent` 并推入 `AsyncQueue`
7. `RunManager.pump()` 遍历事件并转发到渲染进程 -- 与 CLI 流程完全一致

## 4. 依赖项

```bash
pnpm add ai @ai-sdk/anthropic @ai-sdk/openai zod
```

| 包名 | 用途 |
|------|------|
| `ai` | 核心：`streamText()`、`tool()`、Agent 循环（`stopWhen`） |
| `@ai-sdk/anthropic` | Anthropic Claude 供应商 |
| `@ai-sdk/openai` | OpenAI + 任何 OpenAI 兼容供应商（DeepSeek、Kimi、自定义） |
| `zod` | 类型安全的工具参数 Schema |

## 5. 类型变更（`src/shared/types.ts`）

### 5.1 扩展 AgentVendor

```typescript
export type AgentVendor = 'claude' | 'codex' | 'api'
export const ALL_VENDORS: AgentVendor[] = ['claude', 'codex', 'api']
```

### 5.2 新增供应商类型

```typescript
export type ApiProviderFormat = 'anthropic' | 'openai-compatible'

export interface ApiProviderConfig {
  id: string                    // UUID
  name: string                  // 显示名称，如 "我的 DeepSeek"
  format: ApiProviderFormat     // 决定使用哪个 AI SDK 供应商
  apiKey: string                // 静态加密存储（通过 safeStorage）
  baseUrl?: string              // DeepSeek/Kimi/自定义时必填
  models: string[]              // 用户维护的模型列表
  defaultModel?: string         // 预选模型
}
```

### 5.3 扩展 RunConfig

```typescript
export interface RunConfig {
  // ... 现有字段不变 ...
  /** API 模式：使用哪个已保存的供应商配置 */
  apiProviderId?: string
  /** API 模式：Agent 循环最大步数，默认 50 */
  apiMaxSteps?: number
}
```

### 5.4 扩展 AgentDefinition

```typescript
export interface AgentDefinition {
  // ... 现有字段不变 ...
  /** 当 vendor === 'api' 时，引用供应商配置 */
  apiProviderId?: string
}
```

### 5.5 新增 IPC 通道

```typescript
// 添加到 IPC 常量：
providersList: 'providers:list',       // 列出供应商配置
providersSave: 'providers:save',       // 保存供应商配置
providersDelete: 'providers:delete',   // 删除供应商配置
providersTest: 'providers:test',       // 测试供应商连接
permissionRequest: 'permission:request',   // 主进程 → 渲染进程：请求权限
permissionRespond: 'permission:respond',   // 渲染进程 → 主进程：权限响应
```

## 6. 供应商存储（`src/main/ProviderStore.ts`）

新建文件，遵循 `AgentStore.ts` 相同模式：

- 持久化到 `<userData>/providers.json`
- CRUD 操作：`list()`、`save(config)`、`remove(id)`
- API Key 通过 `electron.safeStorage.encryptString()` / `decryptString()` 加密存储
- 若 `safeStorage.isEncryptionAvailable()` 为 false（Linux 无密钥环），回退到 base64 编码并输出警告
- `getDecrypted(id)` 返回解密后的配置，仅供主进程中的适配器使用

## 7. API 适配器（`src/main/adapters/apiAdapter.ts`）

### 7.1 类结构

```typescript
export class ApiAdapter implements CliAdapter {
  readonly vendor = 'api' as const
  readonly capabilities: AdapterCapabilities = {
    bidirectionalStdin: false,       // 单次 Agent 循环
    structuredOutputSchema: false,
    partialTokenStream: true         // streamText 产生 token 增量
  }

  constructor(
    private readonly providerConfig: ApiProviderConfig,
    private readonly permissionGuard: PermissionGuard
  ) {}

  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>()
    void this.run(input, queue)
    return queue
  }
}
```

### 7.2 供应商解析

```typescript
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

function resolveModel(config: ApiProviderConfig, modelId: string) {
  switch (config.format) {
    case 'anthropic':
      return createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl && { baseURL: config.baseUrl })
      })(modelId)
    case 'openai-compatible':
      return createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl && { baseURL: config.baseUrl })
      })(modelId)
  }
}
```

常用 Base URL：

| 供应商 | baseUrl |
|--------|---------|
| Anthropic | （省略，使用默认值） |
| OpenAI | （省略，使用默认值） |
| DeepSeek | `https://api.deepseek.com` |
| Kimi | `https://api.moonshot.cn/v1` |

### 7.3 Agent 循环

```typescript
import { streamText, stepCountIs } from 'ai'

const result = streamText({
  model: resolveModel(providerConfig, modelId),
  system: input.appendSystemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: input.prompt }],
  tools: buildToolSet(input.cwd, input.abortSignal, this.permissionGuard),
  stopWhen: stepCountIs(input.apiMaxSteps ?? 50),
  abortSignal: input.abortSignal,
})
```

### 7.4 事件映射（AI SDK → AgentEvent）

```typescript
for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':
      queue.push({ kind: 'message-delta', text: part.textDelta })
      break
    case 'tool-call':
      queue.push({ kind: 'tool-call', id: part.toolCallId, name: part.toolName, input: part.args })
      break
    case 'tool-result':
      queue.push({ kind: 'tool-result', id: part.toolCallId, ok: !part.result?.error, output: part.result })
      break
    case 'step-finish':
      if (part.usage) {
        queue.push({ kind: 'usage', inputTokens: part.usage.promptTokens, outputTokens: part.usage.completionTokens })
      }
      break
    case 'finish':
      queue.push({ kind: 'turn-done', sessionId, reason: 'complete' })
      break
    case 'error':
      queue.push({ kind: 'error', recoverable: false, message: String(part.error) })
      break
  }
}
```

## 8. 工具执行器（`src/main/adapters/api-tools/`）

每个工具为独立文件，导出 Vercel AI SDK 的 `tool()` 定义。所有工具基于 `cwd` 参数在本地文件系统上操作。

### 8.1 工具注册表（`index.ts`）

```typescript
import { tool } from 'ai'
import { z } from 'zod'

export function buildToolSet(
  cwd: string,
  signal: AbortSignal,
  guard: PermissionGuard,
  onFileChanged?: (path: string, op: 'create' | 'modify' | 'delete') => void
) {
  return {
    bash: createBashTool(cwd, signal, guard),
    file_read: createFileReadTool(cwd),
    file_edit: createFileEditTool(cwd, guard, onFileChanged),
    file_write: createFileWriteTool(cwd, guard, onFileChanged),
    glob: createGlobTool(cwd),
    grep: createGrepTool(cwd),
    fetch: createFetchTool(),
    sourcegraph: createSourcegraphTool(),
    todo_write: createTodoWriteTool(),
  }
}
```

### 8.2 Bash（`bash.ts`）

在项目目录中执行 Shell 命令。

```typescript
parameters: z.object({
  command: z.string().describe('要执行的 Shell 命令'),
  timeout: z.number().optional().describe('超时时间（毫秒），默认 120000'),
  description: z.string().optional().describe('命令用途描述'),
})
```

实现要点：
- `child_process.spawn(shell, ['-c', command], { cwd })`
- 捕获 stdout + stderr 合并输出
- 支持 `AbortSignal`（中止时 kill 进程）
- 默认超时 120 秒，最大 600 秒
- 输出截断至 100KB，防止上下文溢出
- **需要权限**：通过 `guard.request('bash', description ?? command)` 检查

### 8.3 FileRead（`fileRead.ts`）

读取文件内容，支持行范围。

```typescript
parameters: z.object({
  file_path: z.string().describe('文件的绝对路径'),
  offset: z.number().optional().describe('起始行号（从 0 开始）'),
  limit: z.number().optional().describe('最大读取行数，默认 2000'),
})
```

实现要点：
- `fs.readFileSync(path, 'utf8')`
- 按换行符拆分，应用 offset/limit
- 添加行号前缀（匹配 Claude Code 惯例：`{行号}\t{内容}`）
- 二进制/图片文件：返回类型和大小信息，不返回内容
- **无需权限**（只读操作）

### 8.4 FileEdit（`fileEdit.ts`）

精确字符串替换编辑文件。

```typescript
parameters: z.object({
  file_path: z.string().describe('文件的绝对路径'),
  old_string: z.string().describe('要查找的精确文本'),
  new_string: z.string().describe('替换文本'),
  replace_all: z.boolean().optional().describe('是否替换所有匹配项'),
})
```

实现要点：
- 读取文件，查找 `old_string`
- 未找到：返回错误
- 找到多个且 `replace_all` 为 false：返回错误
- 替换后写回文件
- 触发 `file-changed` 事件，`op: 'modify'`
- **需要权限**（除非 `permissionMode === 'bypassPermissions' || 'acceptEdits'`）

### 8.5 FileWrite（`fileWrite.ts`）

写入或覆盖整个文件。

```typescript
parameters: z.object({
  file_path: z.string().describe('文件的绝对路径'),
  content: z.string().describe('要写入的内容'),
})
```

实现要点：
- `fs.mkdirSync(dirname, { recursive: true })` 自动创建父目录
- `fs.writeFileSync(path, content, 'utf8')`
- 触发 `file-changed` 事件，`op: 'create'` 或 `op: 'modify'`
- **需要权限**（除非 `permissionMode === 'bypassPermissions' || 'acceptEdits'`）

### 8.6 Glob（`glob.ts`）

按模式查找文件。

```typescript
parameters: z.object({
  pattern: z.string().describe('Glob 模式，如 "src/**/*.ts"'),
  path: z.string().optional().describe('基础目录，默认为 cwd'),
})
```

实现要点：
- 递归 `fs.readdirSync` 配合 minimatch 或类似模式匹配
- 排除 `node_modules`、`.git` 等常见忽略目录
- 返回相对路径列表，上限 1000 条
- **无需权限**

### 8.7 Grep（`grep.ts`）

按正则表达式搜索文件内容。

```typescript
parameters: z.object({
  pattern: z.string().describe('搜索的正则表达式'),
  path: z.string().optional().describe('搜索的文件或目录'),
  include: z.string().optional().describe('文件过滤模式，如 "*.ts"'),
})
```

实现要点：
- 递归遍历文件（遵循 include 过滤器）
- 逐行应用正则匹配
- 以 `文件:行号:内容` 格式返回匹配结果
- 上限 500 条匹配，防止上下文溢出
- 若 PATH 中存在 `rg`（ripgrep），优先使用以提升性能
- **无需权限**

### 8.8 Fetch（`fetch.ts`）

获取 URL 内容（参考 OpenCode 方案）。

```typescript
parameters: z.object({
  url: z.string().describe('要获取的 URL'),
  format: z.enum(['text', 'json', 'markdown']).optional().describe('响应格式，默认 text'),
})
```

实现要点：
- Node.js 内置 `fetch(url)`，30 秒超时
- 响应截断至 100KB
- 可选：`format: 'markdown'` 时进行基础 HTML 转文本
- **无需权限**

### 8.9 Sourcegraph（`sourcegraph.ts`）

跨公开仓库搜索代码（免费，无需 API Key）。

```typescript
parameters: z.object({
  query: z.string().describe('Sourcegraph 搜索查询'),
  count: z.number().optional().describe('最大结果数，默认 10'),
})
```

实现要点：
- HTTP POST 到 `https://sourcegraph.com/.api/search/stream`
- 请求体：`{ query, patternType: "regexp" }`
- 解析流式响应，提取文件匹配
- 返回前 N 条结果，包含仓库名、文件路径和匹配内容
- **无需权限**，无需 API Key

### 8.10 TodoWrite（`todoWrite.ts`）

Agent 内部任务跟踪（运行期间内存中维护）。

```typescript
parameters: z.object({
  todos: z.array(z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
  })).describe('完整的更新后待办列表'),
})
```

实现要点：
- 存储在闭包作用域的数组中（生命周期 = 单次运行）
- 每次写入后返回当前待办列表
- **无需权限**（内部记录用途）

## 9. 权限守卫（`src/main/adapters/api-tools/PermissionGuard.ts`）

桥接工具执行（主进程）和用户确认（渲染进程）。

### 9.1 各权限模式行为

| 模式 | 读工具 | 写工具（FileEdit、FileWrite） | Bash |
|------|--------|------------------------------|------|
| `bypassPermissions` | 允许 | 允许 | 允许 |
| `acceptEdits` | 允许 | 允许 | 提示用户 |
| `default` | 允许 | 提示用户 | 提示用户 |
| `plan` | 允许 | 拒绝 | 拒绝 |

### 9.2 实现机制

```typescript
export class PermissionGuard {
  private pending = new Map<string, { resolve: (allowed: boolean) => void }>()
  private timeoutMs = 300_000  // 5 分钟超时

  constructor(
    private readonly mode: PermissionMode,
    private readonly emitEvent: (event: AgentEvent) => void
  ) {}

  async request(toolName: string, description: string): Promise<boolean> {
    if (this.mode === 'bypassPermissions') return true
    if (this.mode === 'plan') return false
    if (this.mode === 'acceptEdits' && isEditTool(toolName)) return true

    const requestId = randomUUID()
    this.emitEvent({
      kind: 'system',
      text: JSON.stringify({
        type: 'permission-request',
        requestId,
        toolName,
        description
      })
    })

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve(false)  // 超时 → 拒绝
      }, this.timeoutMs)

      this.pending.set(requestId, {
        resolve: (allowed) => {
          clearTimeout(timer)
          resolve(allowed)
        }
      })
    })
  }

  respond(requestId: string, allowed: boolean): void {
    this.pending.get(requestId)?.resolve(allowed)
    this.pending.delete(requestId)
  }
}
```

### 9.3 渲染进程侧

`TranscriptViewer.tsx` 检测 `kind: 'system'` 事件中的 `type: 'permission-request'` JSON，渲染内联审批 UI：

```
  ┌─────────────────────────────────────────────────┐
  │  🔒 bash 想要执行：                               │
  │  rm -rf dist && npm run build                   │
  │                                                 │
  │  [允许]  [拒绝]  [本次运行全部允许]                 │
  └─────────────────────────────────────────────────┘
```

## 10. 工厂变更（`src/main/adapters/factory.ts`）

### 10.1 扩展签名

```typescript
export interface AdapterContext {
  providerStore?: ProviderStore
  runConfig?: RunConfig
  emitEvent?: (event: AgentEvent) => void
}

export function createAdapter(vendor: AgentVendor, ctx?: AdapterContext): CliAdapter {
  switch (vendor) {
    case 'claude':
      return new ClaudeAdapter()
    case 'codex':
      return new CodexAdapter()
    case 'api': {
      if (!ctx?.providerStore || !ctx.runConfig?.apiProviderId) {
        throw new Error('API 模式需要已配置的供应商')
      }
      const config = ctx.providerStore.getDecrypted(ctx.runConfig.apiProviderId)
      const guard = new PermissionGuard(
        ctx.runConfig.permissionMode ?? 'default',
        ctx.emitEvent ?? (() => {})
      )
      return new ApiAdapter(config, guard)
    }
    default: {
      const _exhaustive: never = vendor
      throw new Error(`未知供应商: ${String(_exhaustive)}`)
    }
  }
}
```

### 10.2 RunManager 变更

在 `RunManager.start()` 中传递上下文给 `createAdapter`：

```typescript
const adapter = createAdapter(config.vendor, {
  providerStore: this.providerStore,
  runConfig: config,
  emitEvent: (ev) => onEvent(id, ev)
})
```

这是对 `RunManager` 的唯一修改 -- `pump()` 循环和恢复逻辑完全不变。

## 11. 模型目录（`src/main/cliModels.ts`）

新增函数，从已保存的 API 供应商配置中列出模型：

```typescript
async function listApiModels(store: ProviderStore): Promise<VendorModelCatalog> {
  const providers = store.list()
  const models: ModelOption[] = providers.flatMap(p =>
    p.models.map(m => ({ id: `${p.id}:${m}`, label: `${m} (${p.name})` }))
  )
  return models.length > 0
    ? { models, source: 'cli' as const, message: '来自 API 供应商配置' }
    : { models: [], source: 'unavailable' as const, message: '未配置 API 供应商' }
}
```

扩展 `listCliModels()`：

```typescript
export async function listCliModels(providerStore?: ProviderStore): Promise<ModelCatalog> {
  const [claude, codex, api] = await Promise.all([
    listVendorModels('claude'),
    listVendorModels('codex'),
    providerStore ? listApiModels(providerStore) : unavailable('无供应商存储')
  ])
  return { claude, codex, api }
}
```

## 12. 设置界面

### 12.1 新增组件

| 文件 | 用途 |
|------|------|
| `src/renderer/src/ProviderSettings.tsx` | 供应商配置管理面板（列表、添加、编辑、删除、测试） |
| `src/renderer/src/useProviders.ts` | 供应商配置的 React Hook（通过 IPC） |

### 12.2 供应商设置 UI

位于 `SettingsPanel.tsx` 中作为新的 "API 供应商" 区域：

- **供应商卡片**：每个已保存的供应商显示名称、格式图标、模型数量、脱敏 API Key（仅显示最后 4 位）
- **添加供应商表单**：格式选择器（Anthropic / OpenAI 兼容）、名称、API Key（密码输入框）、Base URL（条件显示）、模型列表（可编辑标签）、"测试连接"按钮
- **编辑/删除**：卡片内联操作
- **预设 Base URL**：选择 DeepSeek/Kimi 时自动填充对应 Base URL

### 12.3 供应商选择器变更

在 `SingleRunPanel.tsx` 和 `AgentManager.tsx` 中，供应商下拉菜单新增 "API" 选项：

```
  供应商: [ Claude CLI ▾ ]  [ Codex CLI ▾ ]  [ API ▾ ]
```

当 `vendor === 'api'` 时：
- 显示供应商下拉菜单（从已保存配置中选择）
- 显示模型下拉菜单（从所选供应商的模型列表中选择）
- 隐藏 CLI 专属选项（Codex 推理强度、服务层级等）
- 隐藏 CLI 安装状态

### 12.4 Preload 桥接新增

```typescript
// src/preload/index.ts 新增 IPC 桥接方法：
listProviders: () => ipcRenderer.invoke(IPC.providersList),
saveProvider: (config) => ipcRenderer.invoke(IPC.providersSave, config),
deleteProvider: (id) => ipcRenderer.invoke(IPC.providersDelete, id),
testProvider: (id) => ipcRenderer.invoke(IPC.providersTest, id),
respondPermission: (requestId, allowed) => ipcRenderer.invoke(IPC.permissionRespond, requestId, allowed),
```

## 13. 文件清单

### 新增文件（16 个）

| 文件 | 用途 |
|------|------|
| `src/main/ProviderStore.ts` | 供应商配置 CRUD + 加密 API Key 存储 |
| `src/main/adapters/apiAdapter.ts` | API 模式适配器（CliAdapter 实现） |
| `src/main/adapters/api-tools/index.ts` | 工具注册表，`buildToolSet()` |
| `src/main/adapters/api-tools/bash.ts` | Shell 命令执行 |
| `src/main/adapters/api-tools/fileRead.ts` | 文件读取（含行范围） |
| `src/main/adapters/api-tools/fileEdit.ts` | 字符串替换式文件编辑 |
| `src/main/adapters/api-tools/fileWrite.ts` | 文件写入/覆盖 |
| `src/main/adapters/api-tools/glob.ts` | 文件模式匹配 |
| `src/main/adapters/api-tools/grep.ts` | 内容正则搜索 |
| `src/main/adapters/api-tools/fetch.ts` | URL 内容获取 |
| `src/main/adapters/api-tools/sourcegraph.ts` | 公开代码搜索 |
| `src/main/adapters/api-tools/todoWrite.ts` | Agent 内部任务跟踪 |
| `src/main/adapters/api-tools/PermissionGuard.ts` | 权限检查桥接 |
| `src/renderer/src/ProviderSettings.tsx` | 供应商配置管理 UI |
| `src/renderer/src/useProviders.ts` | 供应商 CRUD 的 React Hook |
| `API_MODE_SPEC.md` | 本文档 |

### 修改文件（11 个）

| 文件 | 变更内容 |
|------|---------|
| `src/shared/types.ts` | `AgentVendor` 新增 `'api'`；新增 `ApiProviderConfig`；扩展 `RunConfig`、`AgentDefinition`；新增 IPC 通道 |
| `src/main/adapters/factory.ts` | 新增 `'api'` 分支；接受 `AdapterContext` 参数 |
| `src/main/RunManager.ts` | 向 `createAdapter()` 传递 `AdapterContext`（一行改动） |
| `src/main/ipc.ts` | 实例化 `ProviderStore`；注册供应商/权限 IPC 处理器 |
| `src/main/cliModels.ts` | 新增 `listApiModels()`；扩展 `listCliModels()` |
| `src/preload/index.ts` | 新增供应商和权限的 IPC 桥接方法 |
| `src/renderer/src/SettingsPanel.tsx` | 新增 "API 供应商" 区域 |
| `src/renderer/src/SingleRunPanel.tsx` | 新增 `'api'` 供应商处理、供应商选择器 |
| `src/renderer/src/AgentManager.tsx` | 新增 `'api'` 供应商选项、供应商选择器 |
| `src/renderer/src/TranscriptViewer.tsx` | 渲染权限请求区块（含允许/拒绝按钮） |
| `package.json` | 新增 `ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`、`zod` 依赖 |

## 14. 实施阶段

### 第一阶段：基础核心（P0，约 5 天）

端到端跑通核心适配器（无 UI）。

1. 添加 npm 依赖
2. 扩展 `shared/types.ts` 中的类型定义
3. 实现 `ProviderStore.ts`
4. 实现核心工具执行器：`bash`、`fileRead`、`fileEdit`、`fileWrite`、`glob`、`grep`
5. 实现 `apiAdapter.ts`（`streamText` Agent 循环 + 事件映射）
6. 更新 `factory.ts` 和 `RunManager.ts`
7. 在 `ipc.ts` 中注册 IPC 处理器
8. 用硬编码的供应商配置进行测试

### 第二阶段：界面（P0，约 4 天）

API 模式的设置和运行时界面。

1. 实现 `ProviderSettings.tsx` + `useProviders.ts`
2. 在 `SettingsPanel.tsx` 中添加供应商区域
3. 更新 Preload 桥接
4. 在 `SingleRunPanel.tsx` 和 `AgentManager.tsx` 中添加 `'api'` 选项
5. 显示供应商专属模型下拉菜单
6. 更新 `cliModels.ts` 以支持 API 供应商模型

### 第三阶段：权限系统（P1，约 2 天）

1. 实现 `PermissionGuard.ts`
2. 接通权限请求/响应 IPC 通道
3. 在 `TranscriptViewer.tsx` 中添加内联权限 UI
4. 将守卫集成到 bash、fileEdit、fileWrite 工具中

### 第四阶段：扩展工具与打磨（P1，约 2 天）

1. 添加 `fetch`、`sourcegraph`、`todoWrite` 工具
2. 从 fileEdit/fileWrite 触发 `file-changed` 事件
3. 在供应商设置中添加 "测试连接" 功能
4. Transcript 中显示 Token 用量/费用

### 总计：约 13 天

## 15. 测试策略

### 单元测试

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/api-tools.test.mjs` | 各工具执行器在临时目录上的测试（fileRead、fileEdit、fileWrite、glob、grep、bash） |
| `tests/api-adapter.test.mjs` | AI SDK `fullStream` 事件到 `AgentEvent` 的映射（mock `streamText`） |
| `tests/provider-store.test.mjs` | CRUD 操作、API Key 加密/解密 |
| `tests/permission-guard.test.mjs` | 各模式行为：bypass 全部允许、plan 全部拒绝、default 提示 |

### 集成测试

| 测试 | 描述 |
|------|------|
| 完整 Agent 循环 | Mock AI SDK 供应商返回 tool call；验证适配器执行工具并产生正确的 `AgentEvent` 序列 |
| 多步骤 | 验证 Agent 循环在 tool result 后继续执行直到 `stopWhen` 条件满足 |
| 中止 | 验证 `AbortSignal` 能同时取消 API 流和正在运行的工具 |
| 权限流程 | 验证守卫阻塞执行直到 `respond()` 被调用 |

### 手动测试清单

- [ ] 配置 Anthropic 供应商，运行编码任务，验证流式输出 + 工具调用
- [ ] 配置 OpenAI 供应商，运行相同任务
- [ ] 配置 DeepSeek（自定义 Base URL），验证连通性
- [ ] 配置 Kimi（自定义 Base URL），验证连通性
- [ ] 测试流式输出中途中止
- [ ] 测试权限模式：`default` 对 bash/写操作弹出提示，`bypassPermissions` 跳过
- [ ] 使用 API 模式 Agent 运行 Workflow（验证 WorkflowManager 兼容性）
- [ ] 验证现有 Claude CLI 和 Codex CLI 模式仍正常工作

## 16. 风险缓解

| 风险 | 缓解措施 |
|------|---------|
| Vercel AI SDK 破坏性变更 | 锁定主版本号；`ai@^4.x` |
| 权限守卫死锁（渲染进程未响应） | 5 分钟超时，自动拒绝 |
| bypassPermissions 下的工具安全性 | 与现有 CLI 行为一致；属于有意设计 |
| API Key 泄露 | `safeStorage` 静态加密；Key 永不发送到渲染进程 |
| electron-vite 打包问题 | `ai` 和 `@ai-sdk/*` 需要被 externalize；通过现有 `externalizeDepsPlugin()` 验证 |
| 国产模型 tool calling 质量 | DeepSeek tool calling 能力尚可；Kimi 可能需要 prompt 调优；接受弱模型体验降级 |
| 工具输出导致上下文溢出 | 所有工具限制输出大小（bash/fetch 100KB、grep 500 条、glob 1000 个文件） |

## 17. 后续规划（不在本次范围内）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| MCP 客户端 | P2 | 使用 `@modelcontextprotocol/sdk` 连接外部 MCP 服务器 |
| Monitor 工具 | P2 | 后台进程监控（如监控开发服务器） |
| ScheduleWakeup | P2 | 模型自主节奏控制（如等待 CI 结果） |
| AskUserQuestion（结构化提问） | P1 | Agent 向用户发起多选/单选结构化提问 |
| WebSearch（通用搜索） | P3 | 通用网页搜索；当前使用 Sourcegraph + Fetch 替代 |
| NotebookEdit | -- | 当前场景不需要 |
| REPL | -- | Bash 已覆盖 90% 使用场景 |

## 18. UI 规格

> 以下为用户在 `ui-api-mode-designs.html` 中确认的 UI 方案，所有选择均为方案 A。

### 18.1 供应商列表（任务 16）

- **确认方案**：方案 A — 紧凑行
- **组件结构**：`provider-grid` 容器内，每个供应商一个 `provider-card`（flex row），包含图标 (`provider-card-icon`)、信息区 (`provider-card-body` 内含 `provider-card-name` + `provider-card-meta` + `model-tag` 列表)、操作按钮区 (`provider-card-actions`)
- **CSS 类名**：`provider-grid`、`provider-card`、`provider-card-icon`、`icon-anthropic`/`icon-openai`/`icon-deepseek`/`icon-kimi`/`icon-custom`、`provider-card-body`、`provider-card-name`、`provider-card-meta`、`key-badge`、`model-tag`、`provider-card-actions`、`add-provider-btn`
- **设计参考**：`ui-api-mode-designs.html` decision 1 方案 A

### 18.2 添加/编辑供应商表单（任务 16）

- **确认方案**：方案 A — 列表底部内联展开
- **组件结构**：`provider-form` 容器（accent-dim 边框），内含 `pf-title` 标题 + 多个 `pf-field`（label + input）+ `pf-actions` 按钮行。第一行用 `pf-row` 实现双列布局。Base URL 字段下方有 `preset-row` 预设按钮。
- **CSS 类名**：`provider-form`、`pf-title`、`pf-row`、`pf-field`、`pf-label`、`pf-input`、`pf-select`、`pf-hint`、`pf-actions`、`pf-btn`、`pf-btn primary`、`pf-btn success`、`preset-row`、`preset-chip`
- **交互状态**：收起（只显示 add-provider-btn）→ 展开（显示表单）→ 编辑模式（预填值，标题变"编辑供应商"）
- **设计参考**：`ui-api-mode-designs.html` decision 2 方案 A

### 18.3 运行面板供应商选择（任务 18）

- **确认方案**：方案 A — 标签页切换
- **组件结构**：`vendor-tabs` 容器内三个 `vendor-tab` 按钮（Claude CLI / Codex CLI / API），选中态添加 `active` 类。当 API 被选中时，下方显示供应商下拉（`<select>`）和模型下拉。
- **CSS 类名**：`vendor-tabs`、`vendor-tab`、`vendor-tab active`
- **交互状态**：选择 Claude/Codex 时显示 CLI 专属选项；选择 API 时显示供应商选择 + 模型选择，隐藏 Codex 选项
- **设计参考**：`ui-api-mode-designs.html` decision 3 方案 A

### 18.4 权限请求审批（任务 21）

- **确认方案**：方案 A — 醒目卡片式
- **组件结构**：`perm-block` 容器。待审批态使用 `perm-block-pending`（黄色边框），包含 `perm-header`（锁图标 + "权限请求"标题）、`perm-tool`（工具名）、`perm-cmd`（命令内容，monospace 背景块）、`perm-btns`（三个按钮：允许/拒绝/本次全部允许）。已审批态使用 `perm-block-resolved`（绿色边框，透明度降低），header 内追加 `perm-badge`。
- **CSS 类名**：`perm-block`、`perm-block-pending`、`perm-block-resolved`、`perm-header`、`perm-icon`、`perm-title`、`perm-title-pending`、`perm-title-resolved`、`perm-tool`、`perm-cmd`、`perm-btns`、`pf-btn-danger`、`perm-badge`、`perm-badge-allowed`、`perm-badge-denied`
- **交互状态**：pending（可点按钮）→ allowed（变灰 + 绿色 badge）/ denied（变灰 + 红色 badge）
- **设计参考**：`ui-api-mode-designs.html` decision 4 方案 A
