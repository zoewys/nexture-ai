# AI Workflow Tool — DESIGN.md

> 东方自然色系 × 现代工具美学。以中国传统绿色谱系为基底，融合等宽字体的工程精确感，构建一套克制、专注、有辨识度的 AI 工作流工具界面语言。

---

## 1. Visual Theme & Atmosphere

**设计哲学：** 「竹林工坊」——自然的沉静与工具的精确共存。界面如同一间光线充足的工坊：干净的工作台面、条理分明的工具陈列、恰到好处的绿意点缀。

**调性关键词：** 克制、精确、自然、专注

- 信息密度适中，不拥挤也不空旷——每一处空间都有存在的理由
- 色彩以绿色谱系为主角，但大面积使用中性色，让绿色在关键时刻「亮」起来
- 等宽字体贯穿全局，强化工具感和数据可读性
- 小圆角 + 细边框，利落专业，不做多余的圆润修饰
- 暗色模式不是简单反转，而是「深林夜色」——深沉的墨绿底色带来沉浸感

---

## 2. Color Palette & Roles

### 品牌色（绿色谱系）

| Token | Name | Hex | Light Mode Role | Dark Mode Role |
|---|---|---|---|---|
| `brand-primary` | 铜青 | `#3d8e86` | 主操作按钮、链接、焦点环 | 同左 |
| `brand-primary-hover` | 石绿 | `#206864` | 主操作悬停态 | 同左 |
| `brand-secondary` | 麦苗绿 | `#55bb8b` | 次要强调、图标高亮 | 次要强调、节点高亮 |
| `brand-accent` | 钻色 | `#6abd79` | 成功状态、完成标记 | 同左 |
| `brand-muted` | 苍葭 | `#9ab378` | 标签、徽章、辅助信息 | 同左 |
| `brand-surface` | 浅松绿 | `#77d2d1` | 选中态背景（低透明度）、高亮条 | 节点选中态 |
| `brand-deep` | 毛绿 | `#28414a` | — | 暗色模式侧边栏/面板底色 |
| `brand-dark` | 螺青 | `#364e36` | — | 暗色模式画布底色 |

### 语义色

| Token | Hex (Light) | Hex (Dark) | Role |
|---|---|---|---|
| `semantic-success` | `#6abd79` (钻色) | `#6abd79` | 节点运行成功、校验通过 |
| `semantic-warning` | `#e5a832` | `#f0b840` | 节点超时、配置缺失 |
| `semantic-error` | `#d64545` | `#ef6b6b` | 节点失败、连接断开 |
| `semantic-info` | `#3d8e86` (铜青) | `#77d2d1` | 运行中状态、信息提示 |
| `semantic-running` | `#3d8e86` | `#77d2d1` | 节点执行中脉冲动画色 |

### 中性色

| Token | Hex (Light) | Hex (Dark) | Role |
|---|---|---|---|
| `neutral-bg` | `#ffffff` | `#1a2a2a` | 页面主背景 |
| `neutral-surface` | `#f5f7f6` | `#223535` | 卡片/面板背景 |
| `neutral-surface-raised` | `#ffffff` | `#2a4040` | 浮层/弹窗/下拉菜单 |
| `neutral-border` | `#d8ddd9` | `#3a5050` | 默认边框 |
| `neutral-border-subtle` | `#e8ece9` | `#2e4242` | 次要分隔线 |
| `neutral-text-primary` | `#1a2e2e` | `#e0ebe6` | 主要文字 |
| `neutral-text-secondary` | `#5a7070` | `#8aada0` | 次要文字/说明 |
| `neutral-text-muted` | `#8a9e96` | `#5a7a70` | 占位符/禁用态文字 |
| `neutral-canvas` | `#eef1f0` | `#162222` | 画布背景（节点编辑器） |
| `neutral-canvas-dot` | `#d0d8d4` | `#2a4040` | 画布网格点 |

---

## 3. Typography Rules

**字体族：**
- 主字体：`"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace`
- 中文回退：`"LXGW WenKai Mono", "Noto Sans Mono CJK SC", monospace`

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
  bg: brand-primary (#3d8e86)
  text: #ffffff
  border: none
  rounded: 4px
  padding: 8px 16px
  font: body-medium
  hover → bg: brand-primary-hover (#206864)
  active → bg: #1a5a56, transform: translateY(1px)
  disabled → bg: #3d8e86 at 40% opacity, cursor: not-allowed

Secondary:
  bg: transparent
  text: brand-primary (#3d8e86)
  border: 1px solid neutral-border (#d8ddd9)
  rounded: 4px
  hover → bg: neutral-surface (#f5f7f6), border-color: brand-primary
  active → bg: neutral-border-subtle

Ghost:
  bg: transparent
  text: neutral-text-secondary
  border: none
  hover → bg: neutral-surface
  
Danger:
  bg: semantic-error
  text: #ffffff
  hover → brightness: 1.1
```

### 输入框 (Inputs)

```
Default:
  bg: neutral-bg
  border: 1px solid neutral-border
  rounded: 4px
  padding: 8px 12px
  font: body (14px monospace)
  placeholder-color: neutral-text-muted

Focus:
  border-color: brand-primary (#3d8e86)
  box-shadow: 0 0 0 2px rgba(61, 142, 134, 0.15)

Error:
  border-color: semantic-error
  box-shadow: 0 0 0 2px rgba(214, 69, 69, 0.1)
```

### 卡片 (Cards)

```
Default:
  bg: neutral-surface
  border: 1px solid neutral-border-subtle
  rounded: 6px
  padding: 16px
  
Hoverable (可点击的卡片):
  hover → border-color: neutral-border, box-shadow: shadow-sm
  
Active / Selected:
  border-color: brand-primary
  bg: rgba(61, 142, 134, 0.04)
```

### 工作流节点 (Workflow Nodes)

```
Base Node:
  bg: neutral-surface-raised
  border: 1.5px solid neutral-border
  rounded: 6px
  padding: 12px 16px
  min-width: 180px
  font-title: node-title
  
  连接端口 (Ports):
    size: 10px circle
    border: 2px solid neutral-border
    bg: neutral-bg
    connected → bg: brand-primary, border-color: brand-primary

状态驱动变色:
  idle → border-color: neutral-border
  running → border-color: semantic-running (#3d8e86)
            添加脉冲动画: box-shadow pulse with rgba(61, 142, 134, 0.3)
  success → border-color: semantic-success (#6abd79)
            左侧 3px accent bar: semantic-success
  error →   border-color: semantic-error (#d64545)
            左侧 3px accent bar: semantic-error
  warning → border-color: semantic-warning (#e5a832)
  selected → border-color: brand-surface (#77d2d1)
             box-shadow: 0 0 0 2px rgba(119, 210, 209, 0.25)

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
  border-radius: 4px 4px 4px 0
  padding: 12px 16px
  font: chat-message

AI Message:
  bg: neutral-surface
  border: 1px solid neutral-border-subtle
  border-radius: 4px 4px 0 4px
  padding: 12px 16px
  font: chat-message

Typing Indicator:
  三个圆点, 颜色 brand-muted (#9ab378), 波浪动画

Input Area:
  border-top: 1px solid neutral-border
  bg: neutral-bg
  textarea + send button (brand-primary)
```

### 数据表格 (Data Table)

```
Header:
  bg: neutral-surface
  font: caption, weight 600, uppercase
  text-color: neutral-text-secondary
  border-bottom: 1.5px solid neutral-border
  padding: 10px 12px

Row:
  bg: neutral-bg
  border-bottom: 1px solid neutral-border-subtle
  padding: 10px 12px
  font: body (monospace 天然对齐数据列)
  hover → bg: neutral-surface

Selected Row:
  bg: rgba(61, 142, 134, 0.06)
  border-left: 2px solid brand-primary
```

### 侧边栏 & 导航 (Sidebar / Navigation)

```
Sidebar:
  width: 240px (可折叠至 48px icon-only)
  bg: neutral-surface (light) / brand-deep #28414a (dark)
  border-right: 1px solid neutral-border

Nav Item:
  padding: 8px 12px
  rounded: 4px
  font: body-medium
  color: neutral-text-secondary
  hover → bg: neutral-surface-raised, color: neutral-text-primary
  active → bg: rgba(61, 142, 134, 0.1), color: brand-primary
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
- 主布局：sidebar (240px fixed) + main content (fluid) + optional right panel (320px)
- 画布占满可用空间，无内边距
- 配置面板/聊天面板以抽屉形式从右侧滑入
- 最小触控目标：36px × 36px
- 栅格基础：12 列，gutter 16px

---

## 6. Depth & Elevation

| Token | Value (Light) | Value (Dark) | Usage |
|---|---|---|---|
| `shadow-none` | none | none | 默认状态 |
| `shadow-xs` | `0 1px 2px rgba(26, 46, 46, 0.05)` | `0 1px 2px rgba(0,0,0,0.2)` | 微妙浮起，按钮悬停 |
| `shadow-sm` | `0 2px 4px rgba(26, 46, 46, 0.08)` | `0 2px 4px rgba(0,0,0,0.25)` | 卡片悬停、下拉菜单 |
| `shadow-md` | `0 4px 12px rgba(26, 46, 46, 0.1)` | `0 4px 12px rgba(0,0,0,0.3)` | 弹窗、浮层 |
| `shadow-lg` | `0 8px 24px rgba(26, 46, 46, 0.12)` | `0 8px 24px rgba(0,0,0,0.4)` | 模态框 |
| `shadow-focus` | `0 0 0 2px rgba(61,142,134,0.15)` | `0 0 0 2px rgba(119,210,209,0.2)` | 焦点环 |

**层级规则：**
- 画布 (z: 0) → 节点 (z: 1) → 选中节点 (z: 2) → 右侧面板 (z: 10) → 弹窗 (z: 100) → Toast (z: 1000)
- 暗色模式下用更深的背景 + 更强的阴影制造层次，而非依赖亮色高光

---

## 7. Do's and Don'ts

### Do's ✓

- **用色克制：** 绿色谱系只用于品牌标识、交互焦点和状态指示，大面积使用中性色
- **状态先行：** 节点的视觉状态（running/success/error）必须一目了然，颜色 + 动画双通道
- **等宽对齐：** 利用 monospace 字体的等宽特性，让数据、代码、JSON 自然对齐
- **边框明确：** 用 1px 细边框清晰划分区域，而非依赖阴影或颜色块
- **暗色模式独立设计：** 暗色模式使用墨绿色系底色（毛绿 #28414a / 螺青 #364e36），不是简单的黑白反转
- **动画克制：** 只在状态变化（节点运行、数据流动）时使用动画，持续时间 150-250ms

### Don'ts ✗

- **不要大面积使用饱和绿色：** 避免把品牌色铺满整个区域，会造成视觉疲劳
- **不要混用圆角尺寸：** 统一 4px（小元素）和 6px（卡片/节点），不超过两种
- **不要在深色背景上用低对比度绿色文字：** 确保文字对比度 ≥ 4.5:1 (WCAG AA)
- **不要给画布加边框或投影：** 画布是无限空间，不应有视觉容器感
- **不要在聊天消息里用花哨的气泡：** 保持方正克制，与工具美学一致
- **不要用 transition 超过 300ms：** 工具软件要响应迅速，拒绝拖沓动画

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
Primary Action:    #3d8e86 (铜青)
Primary Hover:     #206864 (石绿)
Success/Complete:  #6abd79 (钻色)
Secondary Accent:  #55bb8b (麦苗绿)
Soft Highlight:    #77d2d1 (浅松绿)
Muted/Tag:         #9ab378 (苍葭)
Dark Surface:      #28414a (毛绿)
Dark Canvas:       #364e36 (螺青)
Warning:           #e5a832
Error:             #d64545
```

### 推荐 Prompt

当你需要 AI 生成此风格的 UI 时，可以使用以下指令：

> 使用项目 DESIGN.md 中定义的设计系统。品牌色为绿色谱系（铜青 #3d8e86 为主色），等宽字体，小圆角 (4px)，适中信息密度。节点状态用颜色+动画双通道表达（running=铜青脉冲，success=钻色，error=红色）。暗色模式底色用墨绿（毛绿 #28414a），不是纯黑。

### 组件快速生成指令

- **节点：** "生成一个工作流节点组件，支持 idle/running/success/error 四种状态，参考 DESIGN.md 第 4 节节点规范"
- **聊天：** "生成 AI 聊天界面，用户消息用铜青浅底，AI 消息用中性浅灰底，等宽字体，参考 DESIGN.md 聊天规范"
- **表格：** "生成数据表格组件，monospace 字体，行悬停高亮，选中行左侧铜青色条"
- **表单：** "生成配置表单面板，输入框聚焦时显示铜青色焦点环，右侧抽屉式布局"
