# Data Import / Export — Feature Spec

## 1. 需求来源

用户需要将 Agent Studio 的配置和数据在不同机器间迁移，或备份恢复。

### 1.1 用户原话

> Agent、Workflow 模板、运行历史必选导出；其他数据可选导出。导入时新机器已有的保留，只导入缺失的。导入完提示重启。

### 1.2 交互流程

```
┌────────────────────────────────────────────────────┐
│                   Settings 页面                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  数据管理                                     │  │
│  │  导出 Agent、模板、运行历史…                   │  │
│  │  [导出数据]   [导入数据]                       │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  Templates 侧栏（右键菜单）                         │
│  └→ [导出此模板]                                   │
└────────────────────────────────────────────────────┘
```

## 2. 功能规格

### 2.1 数据范围

| 数据 | 导出 | 导入 |
|------|:--:|:--:|
| Agent 定义 (`agents.json`) | **必选** | **必选** |
| Workflow 模板 (`workflows.json`) | **必选** | **必选** |
| Workflow 运行历史 (`workflow-runs/`) | **必选** | **必选** |
| 定时任务 (`schedules.json`) | 可选 | 可选 |
| App 设置 (`settings.json`) | 可选 | 可选 |
| 记忆库 (`memories/`) | 可选 | 可选 |

不导出：Electron 缓存、Session、Cookie 等运行时数据。

### 2.2 导出 — 设置页全量导出

**步骤：**
1. 用户点击 Settings → 数据管理 →「导出数据」
2. 弹出选项对话框，Agent / Workflow 模板 / 运行历史 三项默认勾选且不可取消（灰底 + 锁定图标）
3. 定时任务 / App 设置 / 记忆库 可选勾选
4. 点击「导出」→ 弹出原生系统保存对话框（默认文件名 `agent-studio-export-yyyy-mm-dd.zip`）
5. 主进程生成 zip，完成后关闭对话框

**zip 内部结构：**
```
agent-studio-export-2026-06-11.zip
├── agents.json
├── workflows.json
├── schedules.json        # 仅当用户勾选
├── settings.json          # 仅当用户勾选
├── workflow-runs/
│   └── <run-id>.json
└── memories/              # 仅当用户勾选
    └── agents/
        └── <agent-id>/
            ├── global.json
            └── projects/
                └── <hash>.json
```

### 2.3 导出 — 模板右键单条导出

**步骤：**
1. 用户在 Templates 侧栏右键点击某个模板
2. 右键菜单出现「导出此模板」选项
3. 点击后弹出系统保存对话框（默认文件名 `<模板名>-yyyy-mm-dd.zip`）
4. 导出该模板 + 它所引用的 Agent（通过 `agentId` 匹配）

**与全量导出的区别：** 不包含运行历史，只包含 1 个模板 + N 个 agent。

### 2.4 导入

**步骤：**
1. 用户点击 Settings → 数据管理 →「导入数据」
2. 弹出系统文件选择对话框（过滤 `.zip` 文件）
3. 主进程解析 zip，提取各数据类型及数量
4. 弹窗展示预览：每条数据显示「X 条新 · Y 条已存在（将跳过）」
5. Agent / 模板 / 运行历史 默认勾选且不可取消
6. 可选数据可取消勾选
7. 底部提示「导入后需要重启应用」
8. 点击「导入并重启」→ 写入 JSON 文件 → 重启 App

**冲突处理：** 跳过已存在的（同 ID 不覆盖），只导入新数据。

### 2.5 导入后重启

导入完成后：
1. 显示 toast：「数据已导入，应用即将重启…」
2. `app.relaunch()` + `app.quit()`

## 3. 技术方案

### 3.1 依赖

- **archiver** — 生成 zip 文件（纯 Node.js，跨平台）
- **adm-zip** — 解析 zip 文件（同步 API，简单可靠）

```bash
pnpm add archiver adm-zip
pnpm add -D @types/archiver
```

### 3.2 IPC 通道

```typescript
// src/shared/types.ts — IPC 常量新增
export const IPC = {
  // ... existing ...
  dataExport: 'data:export',           // 全量导出
  dataExportTemplate: 'data:export-template', // 单模板导出
  dataImport: 'data:import',           // 导入
  dataImportPreview: 'data:import-preview', // 预览 zip 内容
} as const
```

### 3.3 IPC Handler — src/main/ipc.ts

```typescript
// data:export — 全量导出
ipcMain.handle(IPC.dataExport, async (_e, options: ExportOptions) => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: `agent-studio-export-${formatDate(new Date())}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false }
  await createExportZip(result.filePath, options)
  return { ok: true, path: result.filePath }
})

// data:export-template — 单模板导出
ipcMain.handle(IPC.dataExportTemplate, async (_e, templateId: string) => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: `${templateName}-export.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false }
  await createTemplateExportZip(result.filePath, templateId)
  return { ok: true, path: result.filePath }
})

// data:import-preview — 预览
ipcMain.handle(IPC.dataImportPreview, (_e, filePath: string) => {
  return previewImportZip(filePath) // 返回 ImportPreview
})

// data:import — 执行导入
ipcMain.handle(IPC.dataImport, (_e, filePath: string, options: ImportOptions) => {
  await executeImport(filePath, options)
  return { ok: true }
})
```

### 3.4 导出/导入核心逻辑 — src/main/dataPortability.ts

新建文件，包含：

```typescript
// createExportZip(path, options) → 收集选中数据 → 写入 zip
// createTemplateExportZip(path, templateId) → 收集单模板 + 关联 agent → 写入 zip
// previewImportZip(path) → 解析 zip → 返回各类型数据条数 + 冲突统计
// executeImport(path, options) → 按类型合并写入（skip-existing）
// getExportableData() → 从各 Store 读取原始数据
```

### 3.5 Preload API — src/preload/index.ts

```typescript
// 新增方法：
exportData(options: ExportOptions): Promise<{ ok: boolean; path?: string }>
exportTemplate(templateId: string): Promise<{ ok: boolean; path?: string }>
previewImport(filePath: string): Promise<ImportPreview>
importData(filePath: string, options: ImportOptions): Promise<{ ok: boolean }>
```

### 3.6 UI 组件

| 组件 | 位置 | 职责 |
|------|------|------|
| `SettingsPanel` | 现有组件，新增数据管理 section | 两个按钮：导出 / 导入 |
| `ExportDialog` | 新建 | 选项勾选 + 导出按钮 |
| `ImportDialog` | 新建 | 预览 + 确认导入 |
| 右键菜单（模板侧栏） | `TemplatesView` 侧栏 | 「导出此模板」选项 |

## 4. 类型定义

```typescript
// src/shared/types.ts

export interface ExportOptions {
  agents: true          // 必选，始终为 true
  workflows: true       // 必选
  workflowRuns: true    // 必选
  schedules?: boolean   // 可选
  settings?: boolean    // 可选
  memories?: boolean    // 可选
}

export interface ImportPreview {
  agents:     { total: number; new: number; existing: number }
  workflows:  { total: number; new: number; existing: number }
  workflowRuns: { total: number; new: number; existing: number }
  schedules?: { total: number; new: number; existing: number }
  settings?:  boolean
  memories?:  { total: number; new: number; existing: number }
}

export interface ImportOptions {
  agents: true          // 必选
  workflows: true       // 必选
  workflowRuns: true    // 必选
  schedules?: boolean   // 可选
  settings?: boolean    // 可选
  memories?: boolean    // 可选
}
```

## 5. 验证清单

- [ ] 全量导出 zip 包含所有必选 + 勾选项
- [ ] 单模板导出只包含该模板 + 关联 agent
- [ ] 导入预览正确显示总数 / 新数据 / 冲突数
- [ ] 跳过策略：同 ID 已有数据不被覆盖
- [ ] 导入完成后 app 自动重启
- [ ] 空数据（0 条 agent、0 个 run）也能正常导出
- [ ] 损坏的 zip 给出友好错误提示
- [ ] Linux 上文件路径正常（跨平台）
