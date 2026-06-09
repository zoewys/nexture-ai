# Agent Studio 概念层级划分：Workflow vs Agent vs Memory vs Skill

## 问题背景

当 Agent Studio 同时拥有 Workflow Template、Agent Definition、Memory System 和 Skill Library 时，用户可能困惑：这些概念是否重叠？某条知识应该存在哪里？

---

## 概念职责划分

```
┌─────────────────────────────────────────────────────────┐
│  Workflow Template                                       │
│  职责：编排（WHO + ORDER + 交接格式）                      │
│  用户配置：选哪些 agent、什么顺序、并行还是串行             │
│  不包含：具体怎么做                                       │
├─────────────────────────────────────────────────────────┤
│  Agent Definition (System Prompt)                        │
│  职责：身份（你是谁、你的原则）                             │
│  内容：角色定位、通用行为准则、输出风格                      │
│  不包含：具体任务方法、项目知识                             │
├─────────────────────────────────────────────────────────┤
│  Memory System                                          │
│  职责：经验（做过什么、学到什么）                           │
│  内容：从历史 run 中自动积累的碎片经验                      │
│  特点：自动产生、自动衰减、不需要用户管理                    │
├─────────────────────────────────────────────────────────┤
│  Skill Library（未来 V2/V3）                             │
│  职责：技能（怎么做某类具体任务）                           │
│  内容：验证过的策略 + 输出模板                             │
│  特点：用户可见可编辑、需要足够数据才能产生                  │
└─────────────────────────────────────────────────────────┘
```

---

## 类比

| 概念 | 公司类比 | 回答什么问题 |
|------|---------|------------|
| Workflow Template | SOP 流程图 | "这个项目经过哪些部门、什么顺序" |
| Agent Definition | 岗位 JD | "这个岗位是什么角色、什么级别" |
| Memory | 员工的工作日志和积累的经验 | "做过什么、踩过什么坑" |
| Skill | 员工的专业技能证书 | "具体怎么干、用什么方法论" |

---

## Prompt 注入优先级

```
最终 prompt = 
  [System Prompt]        ← Agent Definition（身份层，始终存在）
  +
  [Memory Context]       ← Memory 系统注入（经验层，自动选择）
  +
  [Skill Reference]      ← Skill 注入（方法层，V2/V3 再做）
  +
  [Workflow Context]     ← buildPrompt() 的交接物和用户需求（任务层）
  +
  [Handoff Requirement]  ← 输出格式约束
```

---

## 设计原则

1. **Workflow template 只管编排和交接**，不包含 "怎么做" 的指导
2. **Skill 只管单个 agent 在单步内的方法论**，不跨 step
3. **Memory 是自动的**，用户不需要主动管理
4. **Agent Definition 是静态身份**，变化频率最低

---

## Workflow 和 Skill 的边界

**不冲突的场景**：
- Workflow: "PM 做完给开发，开发做完给测试"（流程编排）
- Skill: "PM 做安全分析时具体怎么做"（执行方法）

**需要警惕的退化场景**：
- 如果 workflow 只有 1 个 step → 退化为单 agent 任务 → 和 skill 重叠
- 如果 skill 太复杂包含多步骤 → 开始像 mini workflow → 概念混乱

---

## 实现时序

| 阶段 | 实现内容 | 概念关系 |
|------|---------|---------|
| 已完成 | Workflow Template + Agent Definition | 编排 + 身份 |
| V1 (当前) | Memory System | 自动积累经验 |
| V2 (未来) | Memory → Skill 演化 | 碎片经验归纳为方法论 |
| V3 (未来) | Skill Library 完整版 | 可管理的技能系统 |
