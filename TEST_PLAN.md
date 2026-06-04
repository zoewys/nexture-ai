# 测试工作流：构建 Todo List Web 应用

## 1. 启动 app

```bash
cd ~/wsy/agent-studio
pnpm dev
```

## 2. 创建测试项目目录

```bash
mkdir -p ~/test-todo-app
```

## 3. 创建 3 个 Agent

点击左侧导航的 **Agents**，逐个创建：

### Agent 1 — 产品经理

| 字段 | 值 |
|------|-----|
| Name | 产品经理 |
| Role | product |
| CLI | claude |
| Model | sonnet |
| Permission Mode | Bypass |
| System Prompt | 见下方 |

```
你是一名资深产品经理。你的职责是定义清晰的产品规格文档。

工作流程：
1. 分析用户需求，拆解为具体的功能点和交互流程
2. 输出文件 SPEC.md，包含：
   - 产品概述和用户故事
   - 功能点列表（增删改查）
   - 页面布局和交互描述
   - API 端点定义（路径、方法、参数、响应格式）
   - 数据模型
   - 验收标准
3. 完成后输出 handoff JSON

注意：使用 Write 工具写入 SPEC.md。不要写代码，只写规格。
```

### Agent 2 — 高级开发者

| 字段 | 值 |
|------|-----|
| Name | 高级开发者 |
| Role | dev |
| CLI | claude |
| Model | sonnet |
| Permission Mode | Bypass |
| System Prompt | 见下方 |

```
你是一名全栈开发者。你的职责是根据规格文档构建完整的 Web 应用。

工作流程：
1. 仔细阅读 SPEC.md 中的功能点和 API 定义
2. 构建一个完整的 Todo List Web 应用，包含：

后端部分（server.mjs）：
- 用 Node.js 原生 http 模块，零依赖
- 实现 SPEC.md 中定义的所有 API 端点（增删改查）
- 数据用 JSON 文件持久化
- 正确设置 Content-Type 和 CORS 响应头
- 同时托管静态文件（index.html, app.js）

前端部分（public/index.html + public/app.js）：
- 干净的 UI：顶部添加输入框、中间任务列表
- 每条任务显示标题、是否完成、创建时间
- 每条任务支持「编辑」「标记完成 / 未完成」「删除」
- 用原生 DOM 操作，零前端框架
- 通过 fetch 调用后端 API

3. 完成后启动 server 并用 curl 验证所有端点
4. 完成后输出 handoff JSON
```

### Agent 3 — 测试工程师

| 字段 | 值 |
|------|-----|
| Name | 测试工程师 |
| Role | test |
| CLI | claude |
| Model | sonnet |
| Permission Mode | Bypass |
| System Prompt | 见下方 |

```
你是一名测试工程师。你的职责是为上游交付的代码编写和运行测试。

工作流程：
1. 先阅读 SPEC.md 理解所有端点的预期行为
2. 阅读 server.mjs 理解实现
3. 编写测试文件 test.mjs，用 Node.js 原生 assert 模块
4. 测试流程：
   - 启动 server.mjs 作为子进程
   - 用 http 模块发请求，验证每个 API 端点
   - 覆盖 CRUD 全流程、边界条件、错误处理（无效 JSON、缺少字段、不存在的 ID）
   - 验证静态文件服务正常（index.html 和 app.js 可访问）
5. 运行测试，确认全部通过
6. 完成后输出 handoff JSON
```

## 4. 创建工作流模板

在 **Workflow** 面板中：

1. Name 填 `需求→开发→测试`
2. 点 **+ Step** 三次，依次选择：产品经理 → 高级开发者 → 测试工程师
3. 点 **Save Workflow**

## 5. 启动工作流

- Project Directory：选择 `~/test-todo-app`
- Initial Prompt 填入：

```
我需要一个完整的 Todo List Web 应用，具体要求：

核心功能：
- 用户可以添加任务（标题、可选描述）
- 任务列表展示所有任务
- 每条任务可以编辑标题
- 每条任务可以标记为「已完成 / 未完成」
- 每条任务可以删除

技术要求：
- 后端用 Node.js 原生 http 模块，零第三方依赖，文件名为 server.mjs
- 前端是单个 HTML 页面 + 原生 JavaScript，放在 public/ 目录下
- server 同时提供 API 和托管静态文件
- 数据用 JSON 文件持久化，服务重启数据不丢失
- 用 node server.mjs 一键启动，默认监听 3000 端口
- 浏览器打开 http://localhost:3000 就能用

API 设计：
- POST   /api/todos        — 创建任务
- GET    /api/todos        — 列出所有任务
- PUT    /api/todos/:id    — 更新任务（标题或完成状态）
- DELETE /api/todos/:id    — 删除任务
- 任务数据模型：{ id, title, description, completed, createdAt }
```

- 点 **Start Workflow**

## 验证

跑完后的 `~/test-todo-app/` 目录结构：

```
public/
  index.html    — 前端页面
  app.js        — 前端交互逻辑
server.mjs      — 后端 API + 静态文件服务
test.mjs        — 测试文件
SPEC.md         — 产品规格文档
```

使用方式：

```bash
cd ~/test-todo-app
node server.mjs
# 浏览器打开 http://localhost:3000
# 可以添加任务、编辑、标记完成、删除
```
