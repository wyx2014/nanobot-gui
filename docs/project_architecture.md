# TPCowork 架构

## 一、主系统：TPCowork Harness

### 1. Gateway Interface
- 输入渠道：
  - PC

### 2. Agent Run（临时 Agent 运行）
输入：
- 用户提问
- 当前聊天历史
- 系统提示词 - soul.md

核心组件：
- Working Memory（工作记忆）
- LLM Cowork Agent
- Reply

主流程：
1. 用户提问、当前聊天历史、系统提示词进入 Working Memory
2. Working Memory 将上下文提供给 LLM Cowork Agent
3. LLM Cowork Agent 生成结果
4. 经过“结束 Loop / 守护规则”后输出 Reply

---

## 二、Loop
组件：
- cronjob
- Hermes Agentic Tools
  - Terminal / Browser
  - delegate_task
  - cronjob
  - skill_manage / MCP
- Sub-Agent 1
- Sub-Agent 2

关系：
- cronjob 驱动 Hermes Agentic Tools
- Hermes Agentic Tools 可以调用多个 Sub-Agent
- Hermes Agentic Tools 对 LLM Cowork Agent 发起 Tool Calls
- LLM Cowork Agent 返回 Response 给 Hermes Agentic Tools

---

## 三、Working Memory

### 1. Procedural Memory（程序性记忆）
作用：
- 保存“如何行动”
- 保存“技能说明”

典型来源：
- SKILL.md

与系统关系：
- Procedural Memory 为 Working Memory 提供技能和行动规则

### 2. Semantic Memory（语义记忆）
作用：
- 保存持久事实
- 保存用户画像

检索方式：
- keyword top-k
- no embedding

与系统关系：
- Semantic Memory 为 Working Memory 提供语义知识
- Semantic Memory 可以被 Hermes Agent 提炼为事实

### 3. Episodic Memory（情景记忆）
作用：
- 保存时间事件
- 保存历史对话

存储：
- state.db
- SQLite + FTS5

与系统关系：
- Episodic Memory 通过 RAG + SQL 提供给 Working Memory
- Reply 会把新历史写回 Episodic Memory
- Working Memory 与 Episodic Memory 有连线，支持上下文回流

### 4. Hermes Agent（辅助模型）
作用：
- 提炼事实
- 辅助记忆整理
- 生成/更新 SKILL.md

整合规则：
- 仅在新增 N 次对话后再整合

主流程：
1. Episodic Memory 写入 state.db
2. 达到条件后触发整合
3. Hermes Agent 结合 Semantic Memory 提炼事实
4. 生成或更新 Procedural Memory / SKILL.md

---

## 四、LLM Ops

### 1. Trace
- 每次运行保留 1 条 Trace / 日志

### 2. Eval
- 使用 LLM-as-a-judge 对结果打分

### 3. Observe
- 追踪：
  - tokens
  - latency
  - errors

### 4. Diagnose
- 定位问题
- 分析为什么出错

### 5. Gate
分支：
- 评估通过
- 评估未通过

### 6. Release
发布修复内容：
- new prompt version
- model config
- tool change
- RAG param

反馈闭环：
1. Reply 进入 Trace
2. Trace -> Eval -> Observe -> Diagnose -> Gate
3. 如果评估未通过：
   - 修复问题
   - 重新运行
   - 重新 Trace
   - 重新评估
4. 如果评估通过：
   - 进入 Release
   - 产出改进后的 System Prompt + Config
   - 回流到主系统