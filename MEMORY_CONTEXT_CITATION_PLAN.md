# Memory 引用式上下文注入方案评估

> 状态：评估中  
> 日期：2026-06-10  
> 关联能力：Agent Memory V1、Workflow Run、Single Run、MemoryReferences UI

## 背景

当前 Agent Studio 的 Memory V1 已经可以把 agent 记忆注入上下文，但现有方式更接近“经验拼接”：从 `MemoryStore` 取出若干条记忆，按强度和类别权重排序，然后拼到 prompt 前面。

这能让 agent 看到历史经验，但还没有做到 Codex 类似的“引用式记忆”：不仅把历史内容放进上下文，还说明这条记忆的来源、选择依据、适用边界，并让用户能追溯某次运行到底使用了哪些历史记忆。

## 现有方案

现有注入形态大致如下：

```text
# 你的积累经验

避免：不要在这个项目中使用 any 类型
偏好：用户喜欢短列表

请参考以上经验，但根据当前具体情况灵活应用。

# User request
...
```

现有能力：

- 按 agent 和 project/global scope 读取记忆
- 按 strength 与 categoryWeight 排序
- 在 token budget 内选择记忆
- 把记忆文本拼到 prompt 前面
- 记录 `injectedMemoryIds`，供 UI 运行后展示引用

主要不足：

- agent 只看到记忆内容，不知道来源
- agent 不知道为什么这条记忆被选中
- UI 主要依赖 `injectedMemoryIds` 事后查询当前 `MemoryStore`，历史 run 的引用可能因记忆删除或修改而失真
- 选择逻辑不理解当前任务语义，只按强度和类别权重排序
- 与 Codex 的记忆引用能力相比，缺少“依据”和“可追溯上下文”

## 建议方案：引用式 Memory Context

将 Memory 注入从“裸文本经验”升级为“引用式上下文块”。

目标注入形态：

```text
# Memory Context

以下是历史记忆引用，用来补充当前任务上下文。
如果记忆与当前用户请求、上游 handoff 或项目文件冲突，以当前任务为准。

- [memory:abc123] 避免 / project
  Content: 不要在这个项目中使用 any 类型。
  Source: workflow=xxx; step=开发 agent; signal=user-rerun
  Why included: project scope, high strength 0.91, matched current task keywords: TypeScript, lint

- [memory:def456] 偏好 / global
  Content: 用户偏好短列表，不要输出长篇解释。
  Source: workflow=yyy; signal=user-confirmed
  Why included: global preference, reinforced 3 times
```

核心变化：

- 每条注入记忆都带 `memory:<id>`
- prompt 中保留 category、scope、content、evidence、why included
- 注入逻辑增加当前任务相关性，而不是只看强度
- 每次 execution 保存当时的 memory reference snapshot
- UI 优先展示 execution 内保存的快照，而不是只查当前 `MemoryStore`
- 历史记忆明确不能覆盖当前用户请求、handoff 或项目文件事实

## 与现有方案对比

| 维度 | 现有方案 | 引用式方案 |
|---|---|---|
| 注入单位 | 经验文本 | 记忆引用对象 |
| agent 看到的内容 | 分类 + 内容 | id + 分类 + scope + 内容 + 来源 + 选择理由 |
| 选择逻辑 | strength × categoryWeight | strength + categoryWeight + task relevance |
| 历史追溯 | 只记录 memory id | 保存注入时的引用快照 |
| UI 展示 | 事后查当前 MemoryStore | 展示当时实际注入内容 |
| 记忆删除后的历史 run | 可能显示缺失或失真 | 仍保留当时引用快照 |
| 冲突处理 | 简短提示灵活应用 | 明确当前任务优先 |
| 接近 Codex 记忆引用程度 | 低 | 高 |

## 建议实现范围

推荐采用“引用快照版”，而不是只改 prompt 文案，也暂不做完整 Codex 复刻。

新增或调整的核心结构：

```ts
interface MemoryInjection {
  text: string
  injectedMemoryIds: string[]
  references: MemoryInjectionReference[]
}

interface MemoryInjectionReference {
  id: string
  category: MemoryCategory
  scope: MemoryScope
  content: string
  evidence: string
  strength: number
  score: number
  reason: string
}
```

Workflow execution 中保存：

```ts
memoryReferences?: MemoryInjectionReference[]
```

Single Run 状态中也保存本次注入的 references，用于 UI 展示。

## 不建议第一阶段做的事

- 不引入 embedding 或向量数据库
- 不要求 agent 在最终输出中显式引用 `[memory:id]`
- 不修改 handoff JSON schema
- 不改 `MemoryStore` 存储结构
- 不改 `ReflectionAgent` 的记忆生成逻辑

## 收益

- agent 获得的不只是历史经验，而是带来源和适用边界的上下文证据
- 用户可以评估“这次为什么注入了这些记忆”
- 历史 run 的记忆引用可复现，不会因为后续 memory 变化而失真
- 后续可以自然扩展到 memory review、禁用某条记忆、运行前预览等能力

## 风险与代价

- shared types 需要新增引用快照类型
- workflow execution 和 single run state 需要保存更多数据
- UI 的 `MemoryReferences` 需要从“查当前 memory”改为“优先展示快照”
- 测试需要覆盖 prompt 格式、引用快照、排序逻辑和兼容性
- prompt 变长，需要继续受 token budget 限制

## 结论

建议推进“引用式 Memory Context + 注入快照”方案。

这比现有方案更接近 Codex 的记忆引用能力：不是简单把历史经验塞进 prompt，而是把历史记忆作为可追溯、可解释、可审计的上下文证据交给 agent。
