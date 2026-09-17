# DevBuddy 设计目标

DevBuddy 是一个用于项目开发自动化工作流的软件，目前以一组基于 **dsh**（deepseek harness）的插件形式实现。

> **DevBuddy 是一个以工程文档为核心、以 Review 为驱动、以 AI Agent 为执行者、以 Git 为最终变更记录的 Agent Engineering Workspace。**

插件包含两个部分：

- 左侧栏的 **DevBuddy 主插件**；
- 右侧栏的 **Reviewer 插件**。

## 背景

现有 AI Coding 工具通常以 **Chat / Prompt / Code** 为核心交互方式，这种方式存在几个问题：

1. 需求容易隐藏在 Chat History 中；
2. 设计决策无法形成长期、结构化的工程资产；
3. 人的评审意见与最终代码之间缺乏明确关联；
4. Agent 很难知道一个修改背后的完整上下文；
5. 多轮 AI Coding 容易产生需求漂移；
6. 项目完成后，很难回答：
   - 为什么这样设计？
   - 谁提出了这个修改？
   - 这个需求对应哪些代码？
   - 哪些测试证明它已经实现？
   - 当前实现是否仍符合最初需求？

DevBuddy 希望解决这一问题。

## DevBuddy 左侧栏主插件

插件安装后，会在 dsh 左侧边栏新增一个 **DevBuddy** 标签页（类似任务看板插件）。

### 多项目管理

软件具备多项目管理功能：

- 每个项目通过一个 header 标签页来管理；
- 可以通过「新建项目」按钮创建新的标签页。

### 工作流区域

标签页内容从上到下分布多个区域，每个区域相当于工作流的一个节点。

**第一部分：项目属性**

指定项目的名称、工作目录、项目信息等，信息保存在 `ProjectInfo.md` 文件中。

**第二部分：项目设计目标**

阐述项目整体的意图、初步的设计思路等，保存在 `CoreRequirements.md` 文件中。

**第三部分：项目Workflow**

定义和控制目标实现需要遵守的流程和标准等，

```text
                 Robot Studio
                      │
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
   Project Policy   Task Contract   Workflow
        │             │             │
   Constitution    Requirements    Explore
   Standards       Constraints     Research
   Architecture    Acceptance      Design
   Principles      Non-goals       Implement
        │             │             │
        └─────────────┼─────────────┘
                      ↓
                 Enforcement
                      │
             Permission / Hook
             Validator / Gate
                      ↓
                 Verification
```

**第四部分：项目实施**

项目的完整实施会伴随一系列探索和实践过程，项目实施在 `ImplementSpace/` 文件夹内进行。当有新的提案要进行探索实施时，在 `ImplementSpace/` 下创建 `Implement_01/`、`exploration_newProposal/` 文件夹开始工作。

### Document Editor

系统提供 Markdown 文档编辑器，基本能力：

- Markdown 编辑
- Markdown Preview
- Heading Navigation
- Mermaid Diagram
- Search
- Document Link

## Reviewer 插件

### Review Driven

人的主要职责不是直接告诉 Agent：

> “修改这个文件。”

而是：

> **对 Requirement / Design / Implementation 提出评审意见。**

例如：

```text
Reviewer:

MotionManager 不应该直接获得 LimbController
的硬件控制权。

应该通过统一的 Authority Manager 进行仲裁。

Severity: Major
```

Review 可以进一步转化为 Agent Task。

---

### Inline Review

这是系统最核心的功能之一。

用户可以直接选择文档中的某一段文字，然后发起 Review。

例如：

```text
MotionManager 可以通过 CapabilityManager
获取 LimbController 的控制权。
```

用户选择该文本：

```text
┌──────────────────────────────┐
│ 💬 Add Review                │
├──────────────────────────────┤
│ Severity: Major              │
│                              │
│ MotionManager 不应该直接     │
│ 参与控制权仲裁。             │
│                              │
│ 建议增加 GlobalAuthority     │
│ Manager。                    │
│                              │
│ [Submit Review]              │
└──────────────────────────────┘
```

长期有效的信息必须进入工程文档，包括：

- Requirement
- Specification
- Architecture
- Design
- Constraint
- Decision
- Review
- Acceptance Criteria

Review 必须记录：

```yaml
review_id: REV-001
document: limb-control.md

target:
  section: control-authority
  line_start: 24
  line_end: 26

severity: major

comment: |
  MotionManager 不应该直接参与控制权仲裁。

proposal: |
  增加 GlobalAuthorityManager。

status: open

author: reviewer
```

---

### Review 生命周期

Review 状态：

```text
OPEN
  ↓
DISCUSSING
  ↓
ACCEPTED
  ↓
IMPLEMENTING
  ↓
VERIFIED
  ↓
RESOLVED
```

也允许：

```text
OPEN
  ↓
REJECTED
```

或者：

```text
OPEN
  ↓
DUPLICATED
```

### Review 与 Agent 的连接

Review 是 Agent 获取修改任务的重要入口。

用户可以点击：

> **Send to Agent**

系统自动构造 Agent Context：

```text
Review
+
Target Document
+
Related Documents
+
Related Decisions
+
Related Code
+
Related Tests
+
Git History
```

形成：

```text
Agent Context
```
