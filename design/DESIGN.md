# Nexure (经纶) — DESIGN.md

> 东方群青谱系 × 现代工具美学。以中国传统蓝色谱系为基底，融合极简克制的排版与科技暗色的沉浸感，构建一套精确、冷静、有辨识度的 AI Agent 编排平台界面语言。

---

## 1. Visual Theme & Atmosphere

**设计哲学：** 「青冥工坊」——天的深邃与工具的精确共存。界面如同一间俯瞰云海的指挥台：干净的深蓝底色、条理分明的信息层级、群青在关键时刻精准亮起。

**调性关键词：** 克制、精确、深邃、秩序

- 信息密度适中（Linear 级别），紧凑但不拥挤，每一处空间都有存在的理由
- 色彩以蓝色谱系为主角，大面积使用冷调中性色，让群青在交互焦点和状态指示中「亮」起来
- 中英文混排，英文优先，UI 使用人文无衬线体，代码区使用等宽字体
- 中等圆角（8px），专业但不冰冷，柔和但不圆润
- 暗色模式是「青冥之夜」——深蓝底色带来沉浸感，不是简单的黑白反转
- 亮色模式是「碧落之昼」——清透的浅蓝灰底，保持工具的专业感

---

## 2. Color Palette & Roles

### 品牌色（蓝色谱系 / 中国传统色）

| Token | Name | Hex | Light Mode Role | Dark Mode Role |
|---|---|---|---|---|
| `brand-deepest` | 佛头青 | `#19325f` | — | 画布底色、最深背景 |
| `brand-deep` | 琉璃蓝 | `#244268` | — | 暗色侧边栏/面板底色 |
| `brand-primary` | 群青 | `#2e59a7` | 主操作按钮、链接、焦点环 | 主操作按钮、链接、焦点环 |
| `brand-primary-hover` | 青冥 | `#3271ae` | 主操作悬停态 | 主操作悬停态 |
| `brand-accent` | 鹿其后 | `#0d67bf` | 亮蓝强调、信息提示、选中态 | 亮蓝强调、运行中状态 |
| `brand-secondary` | 明扁豆蓝 | `#619ac3` | 次要强调、图标高亮 | 次要强调、节点高亮 |
| `brand-muted` | 益德 | `#6f94cd` | 标签、徽章、辅助信息 | 标签、徽章、辅助信息 |
| `brand-surface` | 碧落 | `#aed0ee` | 选中态背景（低透明度）、高亮条 | 节点选中态、浅色点缀 |

### 语义色

| Token | Hex (Light) | Hex (Dark) | Role |
|---|---|---|---|
| `semantic-success` | `#4caf88` | `#5cc99b` | 节点执行成功、校验通过 |
| `semantic-warning` | `#e0a030` | `#f0b840` | 节点超时、配置缺失 |
| `semantic-error` | `#d64545` | `#ef6b6b` | 节点失败、连接断开 |
| `semantic-info` | `#3271ae` (青冥) | `#619ac3` (明扁豆蓝) | 运行中状态、信息提示 |
| `semantic-running` | `#2e59a7` (群青) | `#0d67bf` (鹿其后) | 节点执行中脉冲动画色 |

### 中性色 — Light Mode

| Token | Hex | Role |
|---|---|---|
| `neutral-bg` | `#ffffff` | 页面主背景 |
| `neutral-surface` | `#f5f7fa` | 卡片/面板背景 |
| `neutral-surface-raised` | `#ffffff` | 浮层/弹窗/下拉菜单 |
| `neutral-border` | `#d5dbe3` | 默认边框 |
| `neutral-border-subtle` | `#e5e9ef` | 次要分隔线 |
| `neutral-text-primary` | `#1a2332` | 主要文字 |
| `neutral-text-secondary` | `#5a6b7d` | 次要文字/说明 |
| `neutral-text-muted` | `#8a9aaa` | 占位符/禁用态文字 |
| `neutral-canvas` | `#eef1f5` | 画布背景（节点编辑器） |
| `neutral-canvas-dot` | `#d0d6df` | 画布网格点 |

### 中性色 — Dark Mode

| Token | Hex | Role |
|---|---|---|
| `neutral-bg-dark` | `#101a2a` | 页面主背景 |
| `neutral-surface-dark` | `#162236` | 卡片/面板背景 |
| `neutral-surface-raised-dark` | `#1c2b42` | 浮层/弹窗/下拉菜单 |
| `neutral-border-dark` | `#2a3d5a` | 默认边框 |
| `neutral-border-subtle-dark` | `#1f3048` | 次要分隔线 |
| `neutral-text-primary-dark` | `#dce4f0` | 主要文字 |
| `neutral-text-secondary-dark` | `#8a9fc0` | 次要文字/说明 |
| `neutral-text-muted-dark` | `#5a6d8a` | 占位符/禁用态文字 |
| `neutral-canvas-dark` | `#0d1524` | 画布背景（节点编辑器） |
| `neutral-canvas-dot-dark` | `#1f3048` | 画布网格点 |

---

## 3. Typography Rules

**字体族：**
- UI 主字体：`"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- 中文回退：`"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`
- 等宽字体：`"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace`
- 中文等宽回退：`"Noto Sans Mono SC", monospace`

**字号层级：**

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|
| `display` | 28px | 600 | 1.3 | -0.5px | 页面大标题 |
| `heading-1` | 22px | 600 | 1.35 | -0.3px | 区域标题 |
| `heading-2` | 18px | 600 | 1.4 | -0.2px | 面板/卡片标题 |
| `heading-3` | 15px | 600 | 1.45 | 0 | 小节标题 |
| `body` | 14px | 400 | 1.6 | 0 | 正文/描述 |
| `body-medium` | 14px | 500 | 1.6 | 0 | 正文加粗强调 |
| `caption` | 12px | 400 | 1.5 | 0.2px | 节点标签、辅助说明 |
| `micro` | 10px | 500 | 1.4 | 0.5px | 徽章文字、状态标签 |
| `code-block` | 13px | 400 | 1.7 | 0 | 代码块/JSON 展示 |
| `node-title` | 13px | 600 | 1.3 | 0.3px | 画布节点标题 |
| `chat-message` | 14px | 400 | 1.65 | 0 | AI 聊天消息体 |

---

## 4. Component Styling

### 按钮 (Buttons)

```
Primary:
  bg: brand-primary (#2e59a7)
  text: #ffffff
  border: none
  rounded: 8px
  padding: 8px 16px
  font: body-medium (14px, 500)
  hover → bg: brand-primary-hover (#3271ae)
  active → bg: #244268 (琉璃蓝), transform: translateY(1px)
  disabled → bg: #2e59a7 at 40% opacity, cursor: not-allowed

Secondary:
  bg: transparent
  text: brand-primary (#2e59a7)
  border: 1px solid neutral-border (#d5dbe3)
  rounded: 8px
  hover → bg: neutral-surface (#f5f7fa), border-color: brand-primary
  active → bg: neutral-border-subtle

Ghost:
  bg: transparent
  text: neutral-text-secondary
  border: none
  hover → bg: neutral-surface

Danger:
  bg: semantic-error
  text: #ffffff
  hover → filter: brightness(1.1)
```

### 输入框 (Inputs)

```
Default:
  bg: neutral-bg
  border: 1px solid neutral-border
  rounded: 8px
  padding: 8px 12px
  font: body (14px)
  placeholder-color: neutral-text-muted

Focus:
  border-color: brand-primary (#2e59a7)
  box-shadow: 0 0 0 2px rgba(46, 89, 167, 0.15)

Error:
  border-color: semantic-error
  box-shadow: 0 0 0 2px rgba(214, 69, 69, 0.1)
```

### 卡片 (Cards)

```
Default:
  bg: neutral-surface
  border: 1px solid neutral-border-subtle
  rounded: 8px
  padding: 16px

Hoverable (可点击的卡片):
  hover → border-color: neutral-border, box-shadow: shadow-sm

Active / Selected:
  border-color: brand-primary
  bg: rgba(46, 89, 167, 0.04)
```

### 工作流节点 (Workflow Nodes)

```
Base Node:
  bg: neutral-surface-raised
  border: 1.5px solid neutral-border
  rounded: 8px
  padding: 12px 16px
  min-width: 180px
  font-title: node-title

  连接端口 (Ports):
    size: 10px circle
    border: 2px solid neutral-border
    bg: neutral-bg
    connected → bg: brand-primary, border-color: brand-primary

状态驱动变色:
  idle     → border-color: neutral-border
  running  → border-color: semantic-running (#2e59a7 light / #0d67bf dark)
             添加脉冲动画: box-shadow pulse with rgba(46, 89, 167, 0.3)
  success  → border-color: semantic-success (#4caf88)
             左侧 3px accent bar: semantic-success
  error    → border-color: semantic-error (#d64545)
             左侧 3px accent bar: semantic-error
  warning  → border-color: semantic-warning (#e0a030)
             左侧 3px accent bar: semantic-warning
  waiting  → border-color: neutral-text-muted
             border-style: dashed
             左侧 3px accent bar: neutral-text-muted
  disabled → border-color: neutral-border-subtle
             opacity: 0.5
  selected → border-color: brand-surface (#aed0ee)
             box-shadow: 0 0 0 2px rgba(174, 208, 238, 0.3)

连接线 (Edges):
  default: 1.5px solid neutral-border, 贝塞尔曲线
  active/data-flowing: brand-primary, 带流动动画 (dash-offset animation)
  error: semantic-error, dashed
```

### AI 聊天界面 (Chat)

```
Chat Container:
  bg: neutral-bg
  max-width: 720px

User Message:
  bg: brand-primary at 8% opacity
  border-radius: 8px 8px 4px 8px
  padding: 12px 16px
  font: chat-message

AI Message:
  bg: neutral-surface
  border: 1px solid neutral-border-subtle
  border-radius: 8px 8px 8px 4px
  padding: 12px 16px
  font: chat-message

Streaming Indicator:
  三个圆点, 颜色 brand-muted (#6f94cd), 波浪动画

Input Area:
  border-top: 1px solid neutral-border
  bg: neutral-bg
  textarea + send button (brand-primary)
```

### 数据表格 (Data Table)

```
Header:
  bg: neutral-surface
  font: caption (12px, 600), uppercase
  text-color: neutral-text-secondary
  border-bottom: 1.5px solid neutral-border
  padding: 10px 12px

Row:
  bg: neutral-bg
  border-bottom: 1px solid neutral-border-subtle
  padding: 10px 12px
  font: body
  hover → bg: neutral-surface

Selected Row:
  bg: rgba(46, 89, 167, 0.06)
  border-left: 2px solid brand-primary
```

### 表单 & 配置面板 (Form / Config Panel)

```
Section:
  padding: 16px
  border-bottom: 1px solid neutral-border-subtle

Field Label:
  font: body-medium (14px, 500)
  color: neutral-text-primary
  margin-bottom: 6px

Field Description:
  font: caption (12px)
  color: neutral-text-secondary
  margin-bottom: 8px

Panel Layout:
  右侧抽屉滑入, width: 360px (可拖拽调整)
  bg: neutral-surface
  border-left: 1px solid neutral-border
```

### 代码/日志面板 (Code / Log Panel)

```
Panel:
  bg: #0d1524 (dark fixed, 不随亮暗模式变化)
  text: #dce4f0
  border: 1px solid neutral-border
  rounded: 8px
  padding: 12px 16px
  font: code-block (13px monospace)

Line Number:
  color: neutral-text-muted
  text-align: right
  user-select: none

Log Level Badge:
  info    → semantic-info
  warn    → semantic-warning
  error   → semantic-error
  debug   → neutral-text-muted
```

### 侧边栏 & 导航 (Sidebar / Navigation)

```
Sidebar:
  width: 240px (可折叠至 48px icon-only)
  bg: neutral-surface (light) / brand-deep #244268 (dark)
  border-right: 1px solid neutral-border

Nav Item:
  padding: 8px 12px
  rounded: 8px
  font: body-medium
  color: neutral-text-secondary
  hover → bg: neutral-surface-raised, color: neutral-text-primary
  active → bg: rgba(46, 89, 167, 0.1), color: brand-primary
```

---

## 5. Layout Principles

**间距 Scale (base: 4px):**

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | 图标与文字间距、紧凑内边距 |
| `space-2` | 8px | 行内元素间距、小卡片内边距 |
| `space-3` | 12px | 表单元素间距 |
| `space-4` | 16px | 卡片内边距、区块间距 |
| `space-5` | 24px | 面板间距 |
| `space-6` | 32px | 区域大间距 |
| `space-8` | 48px | 页面级分隔 |
| `space-10` | 64px | 页头/页脚留白 |

**布局规则：**
- 主布局：sidebar (240px fixed) + main content (fluid) + optional right panel (360px)
- 画布占满可用空间，无内边距
- 配置面板/聊天面板以抽屉形式从右侧滑入
- 最小触控目标：36px × 36px
- 栅格基础：12 列，gutter 16px

---

## 6. Depth & Elevation

| Token | Value (Light) | Value (Dark) | Usage |
|---|---|---|---|
| `shadow-none` | none | none | 默认状态 |
| `shadow-xs` | `0 1px 2px rgba(26,35,50,0.05)` | `0 1px 2px rgba(0,0,0,0.25)` | 微妙浮起，按钮悬停 |
| `shadow-sm` | `0 2px 4px rgba(26,35,50,0.08)` | `0 2px 4px rgba(0,0,0,0.3)` | 卡片悬停、下拉菜单 |
| `shadow-md` | `0 4px 12px rgba(26,35,50,0.1)` | `0 4px 12px rgba(0,0,0,0.35)` | 弹窗、浮层 |
| `shadow-lg` | `0 8px 24px rgba(26,35,50,0.12)` | `0 8px 24px rgba(0,0,0,0.45)` | 模态框 |
| `shadow-focus` | `0 0 0 2px rgba(46,89,167,0.15)` | `0 0 0 2px rgba(13,103,191,0.25)` | 焦点环 |

**层级规则：**
- 画布 (z: 0) → 节点 (z: 1) → 选中节点 (z: 2) → 右侧面板 (z: 10) → 弹窗 (z: 100) → Toast (z: 1000)
- 暗色模式下用更深的背景 + 更强的阴影制造层次

---

## 7. Do's and Don'ts

### Do's ✓

- **用色克制：** 蓝色谱系只用于品牌标识、交互焦点和状态指示，大面积使用冷调中性色
- **状态先行：** 节点的视觉状态（running/success/error/waiting/disabled）必须一目了然，颜色 + 动画双通道
- **暗色独立设计：** 暗色模式使用深蓝底色（佛头青 #19325f / 琉璃蓝 #244268），不是简单的黑白反转
- **边框明确：** 用 1px 细边框清晰划分区域，而非依赖阴影或颜色块
- **动画克制：** 只在状态变化（节点运行、数据流动）时使用动画，持续时间 150-250ms，ease-out
- **8px 圆角统一：** 所有可交互组件统一 8px 圆角，仅微元素（徽章、标签）可用 4px
- **对比度达标：** 所有文字颜色满足 WCAG AA 标准（≥ 4.5:1 正文，≥ 3:1 大文字）

### Don'ts ✗

- **不要大面积使用饱和蓝色：** 避免把品牌色铺满整个区域，会造成视觉疲劳
- **不要混用圆角尺寸：** 统一 8px（组件）和 4px（微元素），不超过两种
- **不要在深色背景上用低对比度蓝色文字：** 确保暗色模式下文字对比度 ≥ 4.5:1
- **不要给画布加边框或投影：** 画布是无限空间，不应有视觉容器感
- **不要在聊天消息里用花哨的气泡：** 保持方正克制，与工具美学一致
- **不要用 transition 超过 300ms：** 工具软件要响应迅速，拒绝拖沓动画
- **不要使用亮色高光模拟深度：** 暗色模式下通过背景深度差 + 阴影表达层级

---

## 8. Responsive Behavior

| Breakpoint | Width | Behavior |
|---|---|---|
| `desktop-lg` | ≥ 1440px | 三栏布局：sidebar + canvas + right panel |
| `desktop` | 1024–1439px | sidebar 可折叠，right panel 覆盖式抽屉 |
| `tablet` | 768–1023px | sidebar 折叠为 icon-only (48px)，right panel 全屏抽屉 |
| `mobile` | < 768px | 底部 tab 导航替代 sidebar，画布支持双指缩放，面板全屏展示 |

**响应式规则：**
- 画布节点编辑器是核心，任何断点下都优先保证画布面积最大化
- 配置面板永远可以收起/关闭，不应遮挡画布
- 聊天界面在移动端为全屏接管模式
- 触控目标：最小 44px × 44px（移动端）、36px × 36px（桌面端）
- 节点连接线在触屏设备上增大端口热区至 20px

---

## 9. Agent Prompt Guide

### 快速色板参考

```
Primary Action:    #2e59a7 (群青)
Primary Hover:     #3271ae (青冥)
Bright Accent:     #0d67bf (鹿其后)
Secondary:         #619ac3 (明扁豆蓝)
Muted/Tag:         #6f94cd (益德)
Soft Highlight:    #aed0ee (碧落)
Dark Canvas:       #0d1524
Dark Surface:      #244268 (琉璃蓝)
Deepest Dark:      #19325f (佛头青)

Success:           #4caf88
Warning:           #e0a030
Error:             #d64545
Running/Info:      #3271ae (青冥)
```

### 推荐 Prompt

当你需要 AI 生成此风格的 UI 时，可以使用以下指令：

> 使用项目 DESIGN.md 中定义的设计系统。品牌色为蓝色谱系（群青 #2e59a7 为主色），Inter 字体用于 UI、JetBrains Mono 用于代码，8px 中等圆角，适中信息密度。节点支持 idle/running/success/error/waiting/disabled 六种状态，用颜色+动画双通道表达。暗色模式底色用深蓝（佛头青 #19325f / 琉璃蓝 #244268），不是纯黑。设计哲学为「青冥工坊」——东方自然 + 科技工具感。

### 组件快速生成指令

- **节点：** "生成一个工作流节点组件，支持 idle/running/success/error/waiting/disabled 六种状态，8px 圆角，参考 DESIGN.md 第 4 节节点规范"
- **聊天：** "生成 AI 聊天界面，用户消息用群青浅底，AI 消息用中性浅灰底，8px 圆角，支持流式输出指示器"
- **表格：** "生成数据表格组件，表头 uppercase caption，行悬停高亮，选中行左侧群青色条"
- **表单：** "生成配置表单面板，输入框 8px 圆角聚焦群青色焦点环，右侧抽屉式布局 360px"
- **代码面板：** "生成代码/日志面板，深色固定底色 #0d1524，JetBrains Mono 13px，行号右对齐不可选"
- **侧边栏：** "生成侧边栏导航，240px 宽可折叠至 48px，暗色模式用琉璃蓝 #244268 底色"
