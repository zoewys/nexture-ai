# UI 组件升级计划：引入 Radix Select / react-resizable-panels / Vaul Drawer

## 背景

项目当前使用原生 `<select>` 元素（6 个文件中共 10 处）、手写的 Drawer（条件渲染，无动画/焦点陷阱）、以及手动实现的 resize 逻辑（mousedown/mousemove/mouseup + 内联 grid-template-columns）。引入三个轻量库以提升 UX 并减少自定义代码：

| 库 | 用途 | 替代方案 |
|---|------|---------|
| `@radix-ui/react-select` | 可定制、键盘可导航、无障碍的下拉选择框 | 替代 10 处原生 `<select>` |
| `react-resizable-panels` | 声明式可拖拽分割面板 | 替代 WorkflowRunDetail 中 ~30 行手写 resize 逻辑 |
| `vaul` | 带手势、动画和焦点陷阱的抽屉组件 | 替代 NewWorkflowRunDrawer 的条件渲染模式 |

---

## 分支

从当前 `dev-0606` 创建 `feat/ui-components` 分支。

## 安装依赖

```bash
pnpm add @radix-ui/react-select react-resizable-panels vaul
```

---

## 变更清单

### 1. 新建 `Select.tsx` — Radix Select 封装组件

对 `@radix-ui/react-select` 做一层薄封装，匹配项目暗色主题。避免在每个使用处重复 Radix 的 Root/Trigger/Portal/Content/Viewport/Item 模板代码。

**接口设计：**

```typescript
interface SelectProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  children: React.ReactNode  // Select.Item 子元素
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
  disabled?: boolean
}
```

**CSS 新增类名：** `.select-trigger`、`.select-content`、`.select-item`、`.select-item[data-highlighted]`

---

### 2. 替换全部 10 处 `<select>` 为 `<Select>`

**替换模式：**

```tsx
// 替换前
<select value={foo} onChange={(e) => setFoo(e.target.value)}>
  <option value="">Default</option>
  {items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
</select>

// 替换后
<Select value={foo} onChange={setFoo} placeholder="Default">
  {items.map(i => <Select.Item key={i.id} value={i.id}>{i.label}</Select.Item>)}
</Select>
```

**涉及文件（共 6 个，10 处 select）：**

| 文件 | select 数量 | 用途 |
|------|------------|------|
| `SingleRunPanel.tsx` | 2 | Agent 选择、CLI Vendor 选择 |
| `AgentManager.tsx` | 2 | Vendor 选择、Permission Mode 选择 |
| `CodexOptions.tsx` | 2 | Reasoning Effort 选择、Service Tier 选择 |
| `ModelSelect.tsx` | 1 | 模型选择（保留 Custom model 自由输入模式切换） |
| `NewWorkflowRunDrawer.tsx` | 1 | Workflow 模板选择 |
| `TemplatesView.tsx` | N | 每个步骤行的 Agent 选择（循环渲染） |

---

### 3. 替换 `WorkflowRunDetail.tsx` 中的手动 resize 为 `react-resizable-panels`

**删除的代码（~30 行）：**
- `handoffWidth` state、`resizing` ref
- `onResizeStart` callback
- `useEffect` 中的 `mousemove` / `mouseup` 全局事件监听
- 内联 `style={{ gridTemplateColumns: ... }}`

**替换为：**

```tsx
<PanelGroup direction="horizontal" className="workflow-detail-body">
  <Panel minSize={30}>
    <TranscriptViewer events={...} />
  </Panel>
  {handoff && handoffOpen && (
    <>
      <PanelResizeHandle className="handoff-resize-handle" />
      <Panel defaultSize={35} minSize={20} maxSize={50}>
        <aside className="handoff-dock">
          <HandoffPanel ... />
        </aside>
      </Panel>
    </>
  )}
</PanelGroup>
```

**CSS 变更：** 删除 `.workflow-detail-body-with-handoff` 的 `grid-template-columns` 规则，增加面板默认尺寸配置。

---

### 4. 升级 `NewWorkflowRunDrawer` 为 Vaul Drawer

**当前问题：**
- 无滑入/滑出动画（直接挂载/卸载 DOM）
- 无背景遮罩（backdrop）
- 无焦点陷阱（focus trap）
- 无 ESC 键关闭

**改造方式：** 在父组件 `WorkflowWorkspace.tsx` 中用 Vaul 的 Drawer 包裹：

```tsx
// WorkflowWorkspace.tsx
<Drawer.Root direction="right" open={newRunDrawerOpen} onOpenChange={setNewRunDrawerOpen}>
  <Drawer.Portal>
    <Drawer.Overlay className="drawer-overlay" />
    <Drawer.Content className="workflow-new-run-drawer">
      <NewWorkflowRunDrawer ... />
    </Drawer.Content>
  </Drawer.Portal>
</Drawer.Root>
```

**获得的能力：** 滑入动画、背景遮罩、ESC 关闭、焦点陷阱、手势拖拽关闭。

**CSS 变更：** 新增 `.drawer-overlay` 遮罩样式，保留现有 `.workflow-new-run-drawer` 布局样式。

---

### 5. CSS 新增内容（`styles.css`）

| 模块 | 估计行数 | 内容 |
|------|---------|------|
| Radix Select 样式 | ~60 行 | trigger 按钮、下拉内容区、选项高亮、滚动条 |
| Drawer 遮罩 | ~10 行 | `.drawer-overlay` 半透明背景 |
| Panel resize handle | ~5 行 | 替换现有 `.handoff-resize-handle` 规则 |

---

## 文件变更总览

**新建：**
- `src/renderer/src/Select.tsx`

**修改：**
| 文件 | 变更类型 |
|------|---------|
| `package.json` | 添加 3 个依赖 |
| `src/renderer/src/styles.css` | 新增 Radix Select + Drawer overlay 样式 |
| `src/renderer/src/SingleRunPanel.tsx` | 2 处 select → Select |
| `src/renderer/src/AgentManager.tsx` | 2 处 select → Select |
| `src/renderer/src/CodexOptions.tsx` | 2 处 select → Select |
| `src/renderer/src/ModelSelect.tsx` | 1 处 select → Select（保留 custom mode） |
| `src/renderer/src/NewWorkflowRunDrawer.tsx` | 1 处 select → Select + 移除自管理开关 |
| `src/renderer/src/TemplatesView.tsx` | N 处 select → Select |
| `src/renderer/src/WorkflowRunDetail.tsx` | 手动 resize → react-resizable-panels |
| `src/renderer/src/WorkflowWorkspace.tsx` | 条件渲染 → Vaul Drawer |

---

## 验证步骤

1. `npm run typecheck` — 无类型错误
2. `npm run dev` — 启动应用逐一验证：
   - **Select：** 所有下拉框可打开、支持键盘导航（上下箭头、字母搜索）、选中后正确回调
   - **Drawer：** 右侧滑入带动画、点击遮罩或 ESC 可关闭、焦点不泄漏到背景
   - **Splitter：** Handoff 面板可拖拽调宽、最小/最大宽度限制生效、折叠/展开正常
3. 各场景测试：Agent 选择器、Vendor 选择器、Model 选择器（含 Custom 模式）、Template 选择器、步骤 Agent 选择器
