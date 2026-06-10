---
name: writing-plans
description: 当你拥有一份架构 Specs 或清晰的多步骤任务时使用，用于在动手写代码前制定极端详细、步骤化的执行拆解计划。
trigger: 遇到完整的规格说明书 (Spec) 或在进行 brainstorming 后，用户要求编写具体实现计划时。
do-not-trigger: 在没有明确架构或需求还没搞清楚的情况下（此时应先用 brainstorming）。
user-invocable: true
tags:
  - tdd
  - planning
  - execution
  - 任务拆解
---

# 编写执行计划 (Writing Plans)

当系统架构和功能规范（Spec）确定后，第一件事应当是写出一份无懈可击的**详细实现计划**。
假设最终执行这段代码的工程师“完全不了解当前项目的背景并且品味极其可疑”。这意味着你需要把每一个细节，如：他需要碰哪个文件、哪段代码、看哪些测试文档、如何去测试全盘托出。

**整个计划就是按口粮（bite-sized）分配的任务列表。**

**核心原则：**
遵守 DRY（不要重复自己），YAGNI（不需要的坚决不写），并在任何时候倡导 TDD（测试驱动开发） 和高频度的 Commit（提交）。

**计划书的存储：**
将计划保存至：`docs/plans/YYYY-MM-DD-<feature-name>.md`

## 范围检查 (Scope Check)
如果 Spec 涵盖了多个互相独立的子系统（Subsystems），强烈建议将计划分成**多份独立的计划文档**——一个系统一份计划，每份计划独立输出具备可测试功能的软件。

## 文件结构规划
在列任务前，先把即将建立或修改的文件映射清楚。
- 保证切分单元具备清晰的边界和接口。每个文件应有单一清晰的责任（Single Responsibility）。
- “一起变更的文件应该呆在一起”。按责任而不是架构分层来进行文件切分。
- 如果现有代码库中有巨大的“反模式”文件，可以顺便在计划中加一项来剥离该臃肿的文件结构。

## Bite-Sized 任务粒度 (极其细碎的步骤)
**计划里的每一个 Step 都应该是一个单次动作（能在 2-5 分钟内完成的代码量）：**
- “编写导致失败的测试用例” - step 1
- “运行它，看它输出错误”（跑挂它） - step 2
- “实现能让它通过的极简代码” - step 3
- “运行所有测试并确保全绿” - step 4
- “Git Commit 提交变更” - step 5

## 计划文档必须的标头格式 (Header)

\`\`\`markdown
# [Feature Name] 实现计划 (Implementation Plan)

**Goal (目标):** [一句话总结，我们在构建什么？]

**Architecture (架构):** [2-3句话总结整体思路]

**Tech Stack (技术栈):** [关键库、技术点]

---
\`\`\`

## 任务执行结构范例 (Task Structure)

\`\`\`markdown
### Task 1: [某某组件名称]

**涉及文件：**
- Create: \`exact/path/to/file.ts\`
- Modify: \`exact/path/to/existing.ts:123-145\`
- Test: \`tests/exact/path/to/test.ts\`

- [ ] **Step 1: 编写能让系统报错的失败测试 (Failing Test)**
[提供确切的测试代码片段]

- [ ] **Step 2: 运行测试并验证它挂掉**
运行指令: \`npm run test -- test_name\`
预期输出: FAIL (找不到定义)

- [ ] **Step 3: 写一个最小化能跑通该测试的对应实现**
[提供确切的实现代码片段]

- [ ] **Step 4: 运行测试并验证通过**
预期输出: PASS

- [ ] **Step 5: Commit 该特定能力**
命令: \`git add xxx && git commit -m "feat: add specific feature"\`
\`\`\`

## 致 AI (你)：
- 必须使用绝对精准的文件路径。
- 在计划中直接提供极高完整度的代码，而不是一句“加个校验”。
- 给出**准确的执行指令**，带上预期的输出结果。
- 在编写完上述 `docs/plans/...md` 文档后，应向人类提供交互选项，询问目前是按照该单子挨个向下自行执行，或是利用子代理框架 (Subagent) 派转其它 Agent 清理任务。不要直接开始狂改代码，直到用户授权。
