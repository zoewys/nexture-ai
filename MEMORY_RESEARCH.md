# Agent 记忆系统：论文与成熟方案对比

## 综述

本文梳理了 2023-2025 年 Agent Memory 领域的主要论文和工业方案，按架构类型分类对比，帮助评估哪种方案最适合 Agent Studio 的场景。

---

## 一、学术论文（按影响力排序）

### 1. Generative Agents（Stanford, 2023）— 开创性工作

**论文**：[Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)
**作者**：Joon Sung Park 等（Stanford）
**发表**：UIST 2023

**核心架构**：

```
Memory Stream（记忆流）
    ↓
Retrieval（检索：recency × importance × relevance）
    ↓
Reflection（反思：从具体记忆归纳高阶洞察）
    ↓
Planning & Reacting（规划与行动）
```

**三大组件**：

| 组件 | 说明 |
|------|------|
| **Memory Stream** | 所有经历以自然语言存储，每条有时间戳 + 重要性评分 |
| **Retrieval** | 综合三个维度打分：recency（时间衰减）、importance（自评重要性 1-10）、relevance（与当前 query 的余弦相似度） |
| **Reflection** | 当累计重要性达到阈值时触发，LLM 对近期记忆做归纳，生成更抽象的 "反思记忆"，也存回 Memory Stream |

**亮点**：
- 反思是分层的——反思本身也是一条记忆，可以被后续反思再次引用
- Importance 评分由 LLM 自己打（"On a scale of 1-10, how important is this memory?"）
- 检索公式：`score = α·recency + β·importance + γ·relevance`

**对 Agent Studio 的适用性**：⭐⭐⭐
- Memory Stream 思路直接可用（transcript events → 记忆条目）
- Reflection 触发机制（累计重要性阈值）可以借鉴
- 但原始设计面向社交模拟，需要适配到软件开发场景

---

### 2. Reflexion（NeurIPS 2023）— 从失败中学习

**论文**：[Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
**作者**：Noah Shinn 等（Princeton）
**发表**：NeurIPS 2023

**核心机制**：

```
Agent 执行任务
    ↓
获得反馈信号（成功/失败/分数）
    ↓
Self-Reflection：生成语言化的经验总结
    "我失败了因为没有先检查文件是否存在"
    ↓
存入 Episodic Memory Buffer
    ↓
下次执行时注入 prompt
```

**关键设计**：

| 特性 | 说明 |
|------|------|
| **Verbal Reinforcement** | 把 binary/scalar 反馈转化为自然语言反思 |
| **Episodic Memory** | 存储过去的尝试轨迹 + 反思总结 |
| **Sliding Window** | 只保留最近 N 条反思，避免无限增长 |
| **触发条件** | 只在失败时反思（成功不反思） |

**实验结果**：
- HumanEval（代码生成）：从 80.1% → 91.0%（+11%）
- ALFWorld（决策）：从 75% → 97%
- 关键发现：2-3 次反思后性能趋于饱和

**对 Agent Studio 的适用性**：⭐⭐⭐⭐
- 最贴近 Agent Studio 的场景——agent 跑完一步，有明确的成功/失败信号
- 实现简单（只需在失败后多调一次 LLM）
- Sliding Window 解决了记忆膨胀问题
- 但只从失败学习，错过了正面经验的积累

---

### 3. CoALA（TMLR 2024）— 认知架构框架

**论文**：[Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)
**作者**：Theodore Sumers 等（Princeton）
**发表**：TMLR 2024

**记忆分类框架**：

| 记忆类型 | 对应物 | 更新频率 | 容量 |
|---------|--------|---------|------|
| **Working Memory** | LLM 上下文窗口 | 每次推理 | 有限（context length） |
| **Episodic Memory** | 过去经历的记录 | 每次行动后 | 外部存储，无限 |
| **Semantic Memory** | 通用知识/规则 | 缓慢更新 | 模型权重 + 外部知识库 |
| **Procedural Memory** | 技能/行为模式 | 学习后固化 | 代码/prompt 模板 |

**核心贡献**：不是具体实现，而是一个**分类框架**——帮你决定 "这条知识该存在哪"。

**对 Agent Studio 的适用性**：⭐⭐⭐
- 提供了清晰的设计语言来分类不同类型的记忆
- Working Memory = 当前 run 的 prompt context
- Episodic = 过去 run 的 transcript 记录
- Semantic = 积累的规则（我们的 "整合后的规则"）
- Procedural = agent 的 system prompt（角色行为模式）

---

### 4. MemGPT / Letta（2023-2024）— 虚拟上下文管理

**论文**：[MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)
**作者**：Charles Packer 等（UC Berkeley）

**核心思路**：把 LLM 的有限上下文窗口当作 "RAM"，把外部存储当作 "磁盘"，让 LLM 自己管理 page in/out：

```
┌─────────────────────────────────┐
│  Main Context (Working Memory)  │  ← LLM 能直接看到的
│  - System prompt                │
│  - Core memory (关键事实)        │
│  - Recent messages              │
└─────────────────────────────────┘
         ↑↓ (LLM 自己决定 page in/out)
┌─────────────────────────────────┐
│  Archival Memory (长期)          │  ← 向量数据库
│  Recall Memory (对话历史)        │  ← 搜索索引
└─────────────────────────────────┘
```

**三层记忆**：

| 层 | 说明 | 操作 |
|----|------|------|
| **Core Memory** | 少量关键事实，始终在 context 中 | LLM 可读可写 |
| **Archival Memory** | 大量知识，向量检索 | LLM 搜索读取，主动存入 |
| **Recall Memory** | 完整对话历史 | LLM 按时间/关键词检索 |

**关键创新**：LLM **自己决定** 什么时候存记忆、什么时候检索记忆——通过 function calling（`archival_memory_insert`, `archival_memory_search`, `core_memory_append`, `core_memory_replace`）。

**对 Agent Studio 的适用性**：⭐⭐
- 概念优雅但实现重（需要向量数据库 + 大量 function calling）
- Agent Studio 的 agent 是外部 CLI 进程，无法让它自己管理内存
- 更适合自建 agent loop 的场景（如 LangGraph），不适合 CLI 包装器

---

### 5. Voyager（2023）— 技能库进化

**论文**：[Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291)
**作者**：Guanzhi Wang 等（NVIDIA）

**记忆模型**：不是存 "经验"，而是存 **"技能"**——验证过的可执行代码：

```
Agent 尝试新任务
    ↓
生成技能代码（JS 函数）
    ↓
执行验证（成功？）
    ↓ 成功
存入 Skill Library（代码 + 描述 embedding）
    ↓
未来遇到类似任务 → 检索相关技能 → 复用/组合
```

**对 Agent Studio 的适用性**：⭐⭐⭐⭐
- 思路非常适合 Agent Studio：agent 每次输出成功的 handoff 就是一个 "技能"
- 可以积累 "成功的 prompt 模式" 和 "有效的工作方法"
- 只存成功的，天然避免垃圾积累
- 检索靠 embedding 相似度，简单有效

---

### 6. MemoryBank（2024）— 遗忘曲线

**论文**：[MemoryBank: Enhancing Large Language Models with Long-Term Memory](https://arxiv.org/abs/2305.10250)
**更新**：2024 版加入了 Ebbinghaus 遗忘曲线

**核心创新**：给记忆加上**遗忘机制**——模拟人类的艾宾浩斯遗忘曲线：

```
记忆强度 = 初始强度 × e^(-t/稳定性因子)
```

- 被反复检索的记忆 → 稳定性因子增大 → 衰减变慢（越用越记得牢）
- 长期不被检索的记忆 → 自然衰减 → 最终低于阈值被归档/删除

**对 Agent Studio 的适用性**：⭐⭐⭐
- 解决了 "记忆无限增长" 和 "过时记忆污染" 的问题
- 实现简单（每条记忆加一个 strength 字段 + 衰减公式）
- 与 "睡眠整合" 互补——整合时可以顺便清理低 strength 的记忆

---

### 7. RAISE（2024）— 自进化 Agent

**论文**：[RAISE: Remember-AND-Integrate-Self-Evolving Agent](https://arxiv.org/abs/2405.02747)

**核心循环**：

```
Remember → Integrate → Self-Evolve
  记住经验  → 整合到知识库 → 更新自身行为策略
```

**对 Agent Studio 的适用性**：⭐⭐⭐
- "Self-Evolve" 部分直接对应 "agent 越用越强"
- 但论文侧重对话场景，需要适配到工作流编排

---

## 二、工业实现方案

### 1. Claude Code Memory System

| 特性 | 实现 |
|------|------|
| 存储 | Markdown 文件（`~/.claude/projects/<hash>/memory/`） |
| 分类 | user / feedback / project / reference |
| 检索 | 索引文件 MEMORY.md 始终加载，LLM 自己判断相关性 |
| 学习触发 | 对话中隐式/显式信号 |
| 遗忘 | 手动删除，无自动衰减 |
| 需要向量库 | ❌ |

### 2. AutoGen Teachable Agent（Microsoft）

| 特性 | 实现 |
|------|------|
| 存储 | ChromaDB 向量数据库 |
| 分类 | facts / preferences / instructions |
| 检索 | Embedding 相似度搜索 |
| 学习触发 | 对话中自动提取 "可教内容" |
| 遗忘 | 无 |
| 需要向量库 | ✅ |

### 3. CrewAI Memory

| 特性 | 实现 |
|------|------|
| 存储 | 内存 + 可选 persistent storage |
| 分类 | short-term / long-term / entity memory |
| 检索 | 简单 key-value lookup |
| 学习触发 | 每次 task 完成后自动存储 |
| 遗忘 | 无 |
| 需要向量库 | 可选 |

### 4. LangGraph Memory（Checkpointer + Store）

| 特性 | 实现 |
|------|------|
| 存储 | 可插拔后端（SQLite / PostgreSQL / Redis） |
| 分类 | thread-level state / cross-thread store |
| 检索 | Key-based 或 semantic search |
| 学习触发 | 每个节点执行后自动 checkpoint |
| 遗忘 | TTL 配置 |
| 需要向量库 | 可选 |

---

## 三、方案横向对比

### 按复杂度和效果

```
效果
 ↑
 │         MemGPT ●
 │                    ● Stanford Generative Agents
 │      Voyager ●          ● RAISE
 │                  ● Reflexion
 │
 │   AutoGen ●    ● MemoryBank
 │
 │  CrewAI ●
 │                    ● Claude Code Memory
 │
 └─────────────────────────────────────→ 实现复杂度
```

### 按维度对比

| 方案 | 学习来源 | 存储方式 | 检索方式 | 遗忘机制 | 需要外部依赖 | 实现工作量 |
|------|---------|---------|---------|---------|------------|-----------|
| **Reflexion** | 失败反馈 | 文本列表 | 全量注入（sliding window） | 窗口淘汰 | ❌ | 2-3 天 |
| **Stanford GA** | 所有经历 | 带时间戳的流 | recency×importance×relevance | importance 衰减 | 向量库 | 5-7 天 |
| **Voyager** | 成功的技能 | 代码 + embedding | 相似度检索 | 无（只存成功的） | 向量库 | 3-5 天 |
| **MemGPT** | LLM 自主决定 | 三层分级 | LLM function calling | 无自动遗忘 | 向量库 | 10+ 天 |
| **MemoryBank** | 所有交互 | 带 strength 的条目 | 相似度 + strength | 艾宾浩斯曲线 | 向量库 | 5-7 天 |
| **Claude Code** | 对话信号 | Markdown 文件 | LLM 自判断 | 手动 | ❌ | 3-5 天 |
| **AutoGen** | 对话中提取 | 向量库 | Embedding search | 无 | ChromaDB | 3-5 天 |

---

## 四、对 Agent Studio 的推荐组合

基于 Agent Studio 的特点（Electron 桌面应用、CLI 进程编排、有明确的成功/失败信号），我推荐组合以下方案的优点：

### 推荐架构：Reflexion + MemoryBank + Voyager 思路的混合

```
┌──────────────────────────────────────────────────────────┐
│  Agent Memory System for Agent Studio                     │
│                                                          │
│  学习来源（Reflexion 思路）：                                │
│  - 用户确认 handoff → 正面经验（类 Voyager 的 "成功技能"）    │
│  - 用户重跑 → 触发反思（类 Reflexion 的 "失败后反思"）        │
│  - 每次 run 完成 → 轻量总结                                │
│                                                          │
│  存储方式（Claude Code 思路）：                              │
│  - JSON 文件，无需向量数据库                                 │
│  - 两层：global rules + project-specific rules            │
│  - 每条记忆有 confidence + strength 字段                   │
│                                                          │
│  检索方式（Stanford GA 简化版）：                             │
│  - 不用 embedding，用 category + recency + confidence 排序  │
│  - token 预算内注入 top-K 条                               │
│                                                          │
│  遗忘机制（MemoryBank 思路）：                               │
│  - strength 随时间衰减                                     │
│  - 被实际注入并在成功 run 中使用 → strength 增强             │
│  - 低于阈值 → 睡眠整合时清理                                │
│                                                          │
│  整合机制（Stanford GA Reflection 简化版）：                  │
│  - 定期（启动时/手动触发）对碎片经验做归纳                     │
│  - 合并相似、消除矛盾、提炼规则                              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 为什么这样组合？

| 选择 | 理由 |
|------|------|
| 取 Reflexion 的触发机制 | Agent Studio 有明确的成功/失败信号（confirm/rerun），最适合信号驱动学习 |
| 取 Voyager 的 "只存成功" 思路 | 避免垃圾记忆积累，正面经验比负面更有指导价值 |
| 取 Claude Code 的存储方式 | JSON 文件 + 无外部依赖，与现有 AgentStore 模式一致 |
| 取 MemoryBank 的遗忘曲线 | 解决记忆膨胀和过时记忆问题，数学公式简单 |
| 不取 MemGPT 的方案 | 需要向量库 + LLM 自主管理，Agent Studio 的 agent 是外部 CLI 进程，无法实现 |
| 不取 Stanford GA 的完整检索 | 不需要 embedding 相似度（记忆量不大时 category 过滤足够） |

---

## 五、参考文献

### 核心论文
- [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442) (Stanford, 2023)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) (NeurIPS 2023)
- [Cognitive Architectures for Language Agents (CoALA)](https://arxiv.org/abs/2309.02427) (TMLR 2024)
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) (UC Berkeley, 2023)
- [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) (NVIDIA, 2023)
- [RAISE: Remember-AND-Integrate-Self-Evolving Agent](https://arxiv.org/abs/2405.02747) (2024)

### 综述论文
- [A Survey on the Memory Mechanism of Large Language Model based Agents](https://arxiv.org/abs/2404.13501) (2024)
- [Long-Term Memory for AI Agents: A Survey](https://arxiv.org/abs/2504.01847) (Apr 2025)
- [A Survey on Memory in Large Language Model Agents](https://arxiv.org/abs/2404.12494) (Apr 2024)
- [MemLLM: A Survey of Long-Term Memory for Large Language Models](https://arxiv.org/abs/2501.00841) (Jan 2025)

### 工业实现
- [AutoGen Teachable Agent](https://github.com/microsoft/autogen) (Microsoft)
- [CrewAI Memory](https://docs.crewai.com/concepts/memory) (CrewAI)
- [LangGraph Persistence](https://langchain-ai.github.io/langgraph/concepts/persistence/) (LangChain)
- [Letta (原 MemGPT)](https://github.com/letta-ai/letta) (UC Berkeley → 创业公司)
