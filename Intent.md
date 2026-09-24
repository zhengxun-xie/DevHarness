# DevHarness 项目规划

软件研发项目与AI Coding工作流解决方案



## 企业软件研发项目AI coding的组成单元

在企业软件研发项目中AI coding通常是嵌入到公司业务流程和多团队协作的开发模式，因此AI Coding模块通常需要配合其他的多个企业的组件，主要包括：

- 需求提出阶段，负责把散落在项目管理软件、工单系统与沟通工具中的原始诉求归一化为结构化需求，明确目标、范围、验收标准与优先级，作为后续所有环节的输入；
- 功能规划阶段，需求的实现者通过编写功能规划(Intent.md)承担需求提出者和AI agent之间的信使，开发者需要与AI交互多次迭代澄清，将抽象需求注入现实实现中；
- Agent Harness 与 workflow 组件，负责智能体的编排与调度，把需求拆解为任务序列，管理上下文装配、工具调用、状态流转与失败重试，是 AI Coding 运行的执行骨架；
- AI 推理大模型组件，提供代码理解、生成、重构与推理的核心能力，其选型、版本与调用策略决定了产出质量的上下限，也直接决定了成本与响应时延；
- 项目资产与知识库，沉淀源码、目录约定、接口契约、设计文档与历史变更，为模型提供可检索、可校验的工程上下文，使生成的改动贴合既有工程方言而非通用范式；
- AI Coding设计构建阶段，在工作区中完成探索、设计、编码、构建与调试，将功能规划、项目约束、工程资产与任务合同转化为可验证的实现；
- 产物交付与验证组件，负责对 AI 产出的变更执行构建、测试、静态扫描、评审与合入，把关质量与合规，并把结果回写至需求与知识库。

上述六类组件的职责边界与沿“需求归一—任务编排—模型推理—验证合入—知识回写”主线的协作关系，详见配套示意图：

![[AI-Coding-模块：六大组件与协作关系.excalidraw]]



DevHarness 是一组用于企业软件项目开发自动化工作流的AI Harness软件，目前是一组基于 **dsh**（deepseek harness）的插件形式实现。

- 左侧栏的 **DevTask插件**, 主要对应图中“研发入口”流程，目标是使得需求开发者清晰的知道需求和工作内容；
- 左侧栏的 **DevBuddy 插件**， 主要对应图中的“Intent” 和 “AI Coding Workflow”，目标是应用AI 编程工作流完成软件开发生命周期（AI SDLC）；
- 右侧栏的 **DevReviewer 插件**， 主要对应图中的“Agent Harness”流程， 目标是创建一个以review为驱动的AI harness框架；
- 右侧栏的 **DevDelivery 插件，**主要对于图中的“Delivery”流程，目标是将AI编程的产物与最终生产环境进行闭环验证和质量保证
- 左侧栏的 **Devknowledge插件**，主要对于图中的“Project Context”流程， 目标创建一个企业知识库资产，具备可进化和有Debug能力的agent本体



## **DevBuddy插件**

> **DevBuddy 是一个以工程文档为核心、以 Review 为驱动、以 AI Agent 为执行者、以 Git 为最终变更记录的 Agent Engineering Workspace。**

### 背景

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

### DevBuddy 左侧栏主插件

插件安装后，会在 dsh 左侧边栏新增一个 **DevBuddy** 标签页（类似任务看板插件）。

### 多项目管理

软件具备多项目管理功能：

- 每个项目通过一个 header 标签页来管理；
- 可以通过「新建项目」按钮创建新的标签页。

### 工作流区域

标签页内容从上到下分布多个区域，每个区域相当于工作流的一个节点。

**第一部分：项目属性**

指定项目的名称、项目信息、工作目录、git地址等信息，信息保存在 `ProjectInfo.md` 文件中。

**第二部分：项目规划**

阐述项目整体的意图、初步的设计思路等，保存在 `Intent.md` 文件中。

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



## DevTask插件

### 企业项目入口与协作系统

常见的企业项目和协作系统包括：

1. OKR系统，通常按年和季度去规划较为长期的项目事项规划，可以是个飞书多维表格；
2. 需求管理系统，通常从外部客户通过产品经理将需求形成文档登记到需求管理系统，可以是飞书项目需求池；
3. 项目管理系统，通常是内部团队推动的产品或技术方案更新，可以是飞书项目，jira，禅道等；
4. 缺陷管理系统，通常是从测试团队，外部/内部客户反馈的产品缺陷和功能建议，可以是飞书测试管理系统；

通常企业通过上述的系统将原始需求通过平台系统进行汇总和分法到研发团队或个人；



### 研发需求管理系统

外部需求通过不同路径分放到所承担研发团队或个人进入研发的规划实施阶段；

研发团队需要有个工作台和看板系统，从团队和个人视角来对承担工作任务进行计划与管理；

- 团队视角主要是各项目整体状态，工作分配系统，项目素材和产物查看系统，工作负载和质量看板等；
- 个人视角主要是所承担的任务状态更新，个人agent管理，项目素材和产物管理，子任务指派，工作负载等；

工作台也是人类和Agent的团队协作平台，agent team可以负责特定任务的自动化进行，如任务分配，设计，验收等  
自动生成各种报告，团队/个人/agent的 日报/周报/月报等

### 工作流与agent harnes



### AI Coding work space



### DevDelivery插件

### 项目交付与验证

项目需求经过AI coding开发自测后， 需要进行交付和验证阶段  
主要包含：CICD · 测试 · MR · 制品 · 部署 · 验收等功能



&nbsp;