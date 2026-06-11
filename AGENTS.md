# AGENTS.md

项目开发规则，所有 AI 编码助手必须遵守。

## 强制规则

### Icons

所有 icon **必须**使用 `lucide-react` 图标库（`import { IconName } from 'lucide-react'`）。
禁止使用 HTML 实体（如 `&#9776;`）、Unicode 字符、emoji、纯文本字母、或内联 SVG 作为 icon 替代。
适用范围：工具栏、按钮、菜单、徽章、状态指示器，以及任何需要显示图标的 UI 元素。
