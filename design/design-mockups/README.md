# Agent Studio UI 设计稿

本目录包含 Agent Studio 三个设计方向的第一阶段高保真静态原型，每个方向 6 个关键页面，共 18 个可直接在浏览器中打开的 HTML 文件。

## 文件结构

```
docs/design-mockups/
├── 01-moyuan/        # 墨垣 — 科技感 × 中国风暗纹
├── 02-niyuan/        # 霓渊 — 赛博朋克 / 霓虹深渊
├── 03-xirang/        # 息壤 — 有机科技 / 会呼吸的工具
```

## 每个方向包含的 6 个页面

| 文件名 | 页面 |
|--------|------|
| `01-shell.html` | App Shell + ModeRail + 空工作区 |
| `02-canvas.html` | Templates 画布编辑器（DAG、并行组、MiniMap、属性面板） |
| `03-run-detail.html` | Workflow 运行详情（Step Chips、Transcript、Artifacts） |
| `04-single-run.html` | Single Run 单次运行（可折叠配置面板） |
| `05-agent-editor.html` | Agents 编辑（Agent 列表 + 表单 + Memory Panel） |
| `06-settings.html` | Settings — API Providers 配置 |

## 如何预览

直接用浏览器打开任意 `.html` 文件即可，无需构建工具。所有文件均为自包含：

- React 18（CDN）
- Tailwind CSS（CDN）
- 内联 SVG 图标
- 自定义 CSS 动画与纹理

建议使用桌面端浏览器并以足够宽的窗口打开（≥1280px），因为设计稿针对桌面应用布局。

## 三版设计气质

### 墨垣（Ink & Silicon）

- 色彩：墨玉黑 `#0B0C10`、古铜金 `#C9A96E`、青玉 `#6B8F71`
- 视觉：山水暗纹、印章元素、水墨渐变连线
- 字体：Noto Serif SC + Inter + JetBrains Mono
- 关键词：克制、温润、沉淀感、东方智识

### 霓渊（Neon Abyss）

- 色彩：深渊黑 `#0A0A0F`、霓虹粉 `#FF006E`、氚蓝 `#00F0FF`
- 视觉：扫描线、CRT 网格、霓虹发光、锐角切边、HUD 风格
- 字体：Orbitron + Inter + JetBrains Mono
- 关键词：高能、叛逆、数字地下、黑客美学

### 息壤（Breathing Earth）

- 色彩：暖石灰 `#F5F2ED`、苔藓绿 `#5B8C5A`、赭石 `#8B6F47`、陶土橙 `#D4956B`
- 视觉：大圆角、柔和阴影、有机渐变、呼吸动画、纸纹质感
- 字体：Newsreader + Inter + JetBrains Mono
- 关键词：温润、自然、会呼吸、长期陪伴

## 交互模拟

虽然是静态 HTML，但已实现以下关键交互：

- 模式导航切换（App Shell）
- 节点选中、属性面板联动（Canvas）
- 配置面板展开/折叠（Single Run）
- Tab 切换（File Preview、Settings）
- 列表项选中态
- Provider API Key 显示/隐藏
- 记忆分类筛选

## 评估维度对应

| 维度 | 本稿体现 |
|------|---------|
| 气质契合 | 每个方向独立完整的 color token、字体、纹理、动效 |
| 信息层级 | 三栏/双栏布局、Step Chips、Transcript 颜色编码、Artifacts 卡片 |
| 交互细腻度 | Hover/选中/过渡动画、发光与呼吸效果 |
| 工程可行性 | React + Tailwind + 自定义 CSS，均可在 Electron 中落地 |

## 下一步建议

1. 三方对比评审，选定最终方向
2. 补齐第二阶段页面：Run List、New Run Drawer、Schedule Drawer、空状态、全局覆盖层、其他设置页
3. 将选定方向的 token 整理为正式 design system
