# NextureAI

**本地多智能体工作流编排桌面应用**

NextureAI 是一款开源桌面应用，将 Claude CLI、Codex CLI 和自定义 API 等多种 AI 智能体编排为可视化的 DAG 工作流，在本地安全运行。

## 功能特性

### 多智能体编排

- 支持 Claude、Codex 和自定义 API 三种智能体类型
- 统一事件流，屏蔽不同供应商差异
- 每个智能体可独立配置模型、系统提示词和权限

### DAG 工作流设计器

- 基于画布的可视化工作流编辑器，支持顺序和并行执行
- 步骤间自动传递上下文（Handoff）
- 条件跳转规则：出错重试、跳过、跳转到指定步骤
- 交互式步骤：工作流运行中可暂停等待用户输入
- Git Worktree 隔离：代码类工作流在独立工作区运行，避免冲突

### 单轮对话模式

- 与单个智能体进行多轮对话
- 完整的对话历史记录和回放
- 支持文件附件

### 定时调度

- 内置 Cron 调度器，支持可视化构建表达式
- 定时任务自动运行，无需人工干预
- 运行状态历史追踪

### 智能体记忆系统

- 自动摘要历史对话（基于遗忘曲线模型）
- 运行后自动生成反思（Reflection）
- 将历史记忆注入到后续运行中，实现跨任务的上下文复用

### 自定义 API 供应商

- 添加任意兼容的 LLM 供应商（内置 DeepSeek、Kimi、MiMo、SiliconFlow 预设）
- 支持 Anthropic 和 OpenAI 兼容格式
- 自动发现可用模型、连接测试、密钥加密存储

### 飞书通知

- 工作流完成或出错时发送飞书卡片通知
- 支持桌面原生通知

### 其他

- API 调用日志：记录每次 API 调用的模型、Token、费用和耗时
- 深色/浅色主题切换
- 数据导入导出（工作流、智能体、运行记录）
- 自动更新

## 技术栈

- **框架**: Electron 28 + React 18 + TypeScript
- **构建**: Vite + electron-vite
- **画布**: @xyflow/react（DAG 可视化）
- **AI SDK**: Vercel AI SDK（统一 LLM 接口）
- **UI**: Radix UI + Lucide Icons
- **存储**: 本地 JSON 文件（用户数据目录）

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 10

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

### 构建

```bash
# macOS (Apple Silicon)
pnpm dist:mac

# Windows
pnpm dist:win
```

### 类型检查与测试

```bash
pnpm typecheck
pnpm test
```

## 下载安装

前往 [GitHub Releases](https://github.com/zoewys/nexture-ai/releases) 下载最新版本：

| 平台 | 安装包 |
|------|--------|
| macOS (Apple Silicon) | `NextureAI-<version>-arm64.dmg` |
| Windows 安装版 | `NextureAI.Setup.<version>.exe` |
| Windows 便携版 | `NextureAI-<version>-portable.exe` |

## 使用前提

NextureAI 通过调用本地 CLI 工具来运行智能体，使用前请确保已安装以下工具中的至少一个：

- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) — 用于 Claude 智能体
- [Codex CLI](https://github.com/openai/codex) — 用于 Codex 智能体

也可以通过应用内设置页面的「安装 CLI」功能一键安装。

自定义 API 模式无需安装 CLI，只需配置 API 密钥和端点即可使用。

## 项目结构

```
src/
├── main/              # Electron 主进程
│   ├── adapters/      # CLI 和 API 适配器
│   ├── memory/        # 记忆与反思系统
│   └── stores/        # 数据持久化
├── preload/           # 预加载脚本（安全 IPC 桥接）
├── renderer/          # React 渲染进程
│   └── src/
│       ├── canvas/    # DAG 画布编辑器
│       ├── components/# UI 组件
│       └── hooks/     # React Hooks
└── shared/            # 跨进程共享类型定义
```

## 发布流程

1. 修改 `package.json` 中的 `version`
2. 提交并创建对应的 git tag（如 `v0.1.13`）
3. 推送 tag 后 GitHub Actions 自动构建并发布 Release

详见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
