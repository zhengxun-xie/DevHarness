# Robot Studio 设计文档（整合版）

## Document-Driven Agent Engineering Workspace

**文档版本：** v1.0（整合版）
**文档状态：** Consolidated Draft
**定位：** Robot Studio 产品与系统设计总纲（Single Source of Truth）

---

## 文档说明

本文档由以下 9 份设计文档整合而成：去除重复内容、统一术语与状态机，并按「产品定义 → 总体架构 → 领域模型 → 子系统设计 → 前端 UX → 核心流程 → 非功能需求 → MVP 规划」的顺序重新组织。原始文档保留在仓库中作为细节参考；本整合版作为后续设计与实现的统一基准。

| 源文档 | 主要内容 | 整合至 |
|---|---|---|
| Robot Studio — Document-Driven Agent Engineering Workspace 初始需求与设计文档 | 产品定义、领域模型、MVP 规划 | 第一、三、四、九、十、十一、十二部分 |
| DES-003 Document Anchor & Review Thread Model | 文档锚点、评审线程 | 第四部分 |
| DES-004 Agent Context Builder | Agent 上下文构建 | 第五部分 |
| DES-005 Agent Execution & Harness Loop | Agent 受控执行 | 第六部分 |
| DES-006 Engineering Workflow & State Graph | 工程工作流状态图 | 第七部分 |
| DES-007 System Architecture & Module Boundary | 系统架构与模块边界 | 第二部分 |
| DES-008 Plugin & Provider SDK | 插件与 Provider 体系 | 第八部分 |
| DES-009 Workflow DSL & Execution Schema | 工作流 DSL 与运行时模型 | 第七部分 |
| DES-010 Workflow Designer & HITL UX | 工作流设计器与人机交互 | 第九部分 |

> 注：主文档曾规划 DES-001（Engineering Domain Model）与 DES-002（Review Data Model）作为独立文档，实际未单独成文，其内容由主文档第 30–46 章承担，已整合进本文档第三部分；DES-005～DES-010 的实际主题与主文档第 62 章的最初规划编号有所不同，以实际文档为准。

## 目录

- **第一部分 产品定义**（第 1–4 章）：背景、定位、理念、目标、角色、成功标准
- **第二部分 总体架构**（第 5–9 章）：架构定位、总体架构、原则、模块划分、关键边界、基础设施与技术栈
- **第三部分 工程领域模型**（第 10–13 章）：Engineering Object / Relation、各核心对象与生命周期
- **第四部分 文档与评审系统**（第 14–20 章）：Document Workspace、Version、Anchor、Review Thread、状态机
- **第五部分 Agent Context 系统**（第 21–26 章）：Context Graph、选择与排序、Budget、Bundle 与 Snapshot
- **第六部分 Agent 执行与 Harness**（第 27–32 章）：执行状态机、Plan、Tool Policy、Observe/Evaluate、Checkpoint、验证
- **第七部分 Workflow 系统**（第 33–42 章）：三层执行模型、DSL、节点与边、运行时、版本化、多 Agent
- **第八部分 插件与 Provider 体系**（第 43–48 章）：扩展模型、Provider 契约、Tool 安全、Capability Registry
- **第九部分 前端与 UX**（第 49–57 章）：信息架构、各 Workspace、Workflow Designer、HITL 交互
- **第十部分 核心流程与 Traceability**（第 58–60 章）：端到端数据流、核心闭环、自主模式
- **第十一部分 非功能需求与安全**（第 61 章）
- **第十二部分 MVP 规划与演进路线**（第 62–66 章）
- **附录**：源文档索引、对象与状态机速查表

---

# 第一部分 产品定义

# 1. 项目背景与问题

随着 AI Coding Agent 的发展，软件开发正在从传统的：

> 人编写需求 → 人设计 → 人编码 → 人测试

逐渐转向：

> 人定义意图 → Agent 设计/实现 → Agent 验证 → 人评审

但现有 AI Coding 工具通常以 **Chat / Prompt / Code** 为核心交互方式，存在以下问题：

1. 需求容易隐藏在 Chat History 中。
2. 设计决策无法形成长期、结构化的工程资产。
3. 人的评审意见与最终代码之间缺乏明确关联。
4. Agent 很难知道一个修改背后的完整上下文。
5. 多轮 AI Coding 容易产生需求漂移。
6. 项目完成后，很难回答：
   - 为什么这样设计？
   - 谁提出了这个修改？
   - 这个需求对应哪些代码？
   - 哪些测试证明它已经实现？
   - 当前实现是否仍符合最初需求？

Robot Studio 就是为解决这一问题而设计的。

# 2. 产品定位

Robot Studio 的核心定位：

> **一个以工程文档为核心、以 Review 为驱动、以 AI Agent 为执行者、以 Git 为最终变更记录的 Agent Engineering Workspace。**

面向机器人领域时进一步定位为：

> **Document-Driven Agent Engineering Platform for Robotics**

核心开发模型：

```text
Requirement
      ↓
Specification
      ↓
Design
      ↓
Review
      ↓
Decision
      ↓
Agent Task
      ↓
Implementation
      ↓
Test
      ↓
Verification
      ↓
Merge
```

同时形成反馈闭环：

```text
              ┌────────────────────┐
              │    Engineering     │
              │      Document      │
              └─────────┬──────────┘
                        ↓
                      Review
                        ↓
                    Decision
                        ↓
                       Agent
                        ↓
                 Code + Test
                        ↓
                    Verification
                        ↓
                      Review
                        │
                        └──────────────→ Document
```

## 2.1 Robot Studio 不是什么

Robot Studio 不应该被定义为：

> 一个更好的 Markdown 编辑器。

也不应该被定义为：

> 一个新的 AI Coding IDE。

而应该定义为：

> **一个以工程文档和评审为核心，将人类工程决策与 AI Agent 执行连接起来的 Software / Robot Engineering Workspace。**

核心数据流：

```text
Human Intent
     ↓
Engineering Document
     ↓
Human Review
     ↓
Engineering Decision
     ↓
AI Agent
     ↓
Code / Test
     ↓
Verification
     ↓
Engineering Evidence
     ↓
Human Review
```

最终目标是建立：

> **Human defines intent → Document captures intent → Review validates intent → Agent executes intent → Test verifies intent**

的完整工程闭环。

## 2.2 与 Spec-Driven Development 的关系

Robot Studio 不重新实现 Spec Kit / OpenSpec。

它们负责：

> 如何定义 Specification、Plan、Tasks。

Robot Studio 负责：

> **如何把 Specification、Review、Agent 和代码执行组织成一个可视化工程工作流。**

因此可以形成：

```text
Robot Studio
     │
     ├── Spec Kit
     ├── OpenSpec
     ├── Claude Code
     ├── Codex
     ├── OpenClaw
     └── GitLab
```

Robot Studio 不替代 Git，不替代 Coding Agent，也不替代 CI/Simulation；它负责把这些能力组织成一个**可审查、可执行、可验证、可追溯的工程闭环**。

# 3. 核心设计理念

## 3.1 Document First

文档是工程过程中的一等公民。

Chat 不作为项目长期事实的唯一来源。长期有效的信息必须进入工程文档，包括：

- Requirement
- Specification
- Architecture
- Design
- Constraint
- Decision
- Review
- Acceptance Criteria

## 3.2 Review Driven

人的主要职责不是直接告诉 Agent「修改这个文件」，而是：

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

## 3.3 Agent as Executor

Agent 不应该成为需求的最终决定者。Agent 的职责主要包括：

- 理解需求
- 分析设计
- 分析 Review
- 制定修改计划
- 修改代码
- 修改测试
- 更新文档
- 执行验证
- 汇报结果

最终工程决策仍由人负责。Agent 不拥有最终 Approval 权限。

## 3.4 Git as Source of Truth

代码、文档、Review、Decision 的最终变更必须具备可追踪性。

Git / GitLab 负责：Version、Commit、Diff、Branch、Merge Request、Review、History。

Robot Studio 不重新实现 Git，而是在 GitLab 之上建立更高层的工程工作流。

# 4. 产品目标、用户角色与成功标准

## 4.1 产品目标

**第一目标：** 建立完整闭环：

> **Requirement → Review → Agent → Code → Test → Verification**

**第二目标：** 让项目中的关键工程知识能够长期保存，而不是散落在 Chat、Issue、PR、Agent Context、个人笔记中。

**第三目标：** 建立 Requirement 与 Code 之间的 Traceability。最终可以回答：

```text
Requirement RQ-001
      ↓
Specification SPEC-001
      ↓
Design DES-003
      ↓
Review REV-012
      ↓
Agent Task TASK-021
      ↓
Commit abc123
      ↓
Test TEST-008
      ↓
Verification PASS
```

## 4.2 用户角色

### Developer

负责：编写 Requirement；编写 / 修改 Design；发起 Review；查看 Agent 修改；验证实现。

### Reviewer

负责：Review Requirement / Design / Code；提出问题与修改建议；Approve / Reject。

### Agent

负责：分析上下文；生成 Plan；执行 Task；修改代码与文档；运行测试；提交 Change Proposal。Agent 不拥有最终 Approval 权限。

## 4.3 核心成功标准

MVP 完成后，一个典型需求应该能够完整执行：

```text
用户创建 Requirement
        ↓
用户编写 Design
        ↓
Reviewer 对 Design 中某一段进行 Review
        ↓
Review 被接受
        ↓
点击 Send to Agent
        ↓
Agent 自动获取相关上下文
        ↓
Agent 生成 Plan
        ↓
用户批准 Plan
        ↓
Agent 修改代码
        ↓
Agent 修改 Test
        ↓
Agent 执行 Test
        ↓
Robot Studio 展示 Diff
        ↓
创建 GitLab MR
        ↓
Code Review
        ↓
Merge
        ↓
Requirement 标记为 Verified
```

如果这个流程能够稳定运行，Robot Studio 的核心价值就已经成立。

---

# 第二部分 总体架构

# 5. 架构定位与总体架构

## 5.1 架构定位

Robot Studio 不定位为单一 Coding Agent，而定位为 **Document-Driven Agent Engineering Platform for Robotics**，位于 Agent 与工程资产之间，承担**工程控制面（Engineering Control Plane）**：

```text
Engineering Knowledge
        ↓
Engineering Review
        ↓
Engineering Context
        ↓
Agent Workflow
        ↓
Harness Execution
        ↓
Verification
        ↓
Traceability
```

从分层视角看（详见第七部分 Workflow），Robot Studio 的核心架构自上而下为：

```text
┌─────────────────────────────────────────────────┐
│             Engineering Knowledge              │
│ Requirement / Specification / Design / ADR     │
└─────────────────────────┬───────────────────────┘
                          ↓
┌─────────────────────────────────────────────────┐
│             Engineering Governance             │
│ Review / Decision / Approval / Policy          │
└─────────────────────────┬───────────────────────┘
                          ↓
┌─────────────────────────────────────────────────┐
│              Context Engineering               │
│ Graph / Retrieval / Bundle / Snapshot          │
└─────────────────────────┬───────────────────────┘
                          ↓
┌─────────────────────────────────────────────────┐
│            Workflow Orchestration              │
│ State Graph / Events / Conditions / Parallel   │
└─────────────────────────┬───────────────────────┘
                          ↓
┌─────────────────────────────────────────────────┐
│                Agent Harness                   │
│ Plan / Tool / Observe / Evaluate / Retry        │
└─────────────────────────┬───────────────────────┘
                          ↓
┌─────────────────────────────────────────────────┐
│                   Agents                       │
│ Codex / Claude Code / OpenClaw / Hermes        │
└─────────────────────────┬───────────────────────┘
                          ↓
┌─────────────────────────────────────────────────┐
│             Engineering Proof                  │
│ Test / Simulation / Evidence / Verification    │
└─────────────────────────────────────────────────┘
```

## 5.2 总体架构

第一阶段采用 **Modular Monolith + Adapter Architecture**：

```text
┌──────────────────────────────────────────────────────────┐
│                     Robot Studio UI                      │
│ Document │ Review │ Task │ Agent │ Workflow │ Trace      │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTPS / WebSocket
┌──────────────────────────▼───────────────────────────────┐
│                         BFF / API                         │
├──────────────────────────────────────────────────────────┤
│ Project │ Document │ Review │ Task │ Workflow │ Agent API│
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│                   Robot Studio Core                      │
│                                                          │
│  Engineering Model       Workflow Engine                 │
│  Document Service        Context Engine                  │
│  Review Service          Agent Harness                   │
│  Task Service            Verification Engine             │
│  Traceability Service    Policy Engine                   │
└───────┬──────────┬──────────┬──────────┬────────────────┘
        │          │          │          │
        ▼          ▼          ▼          ▼
   Git Adapter  Agent Adapter Test Adapter Artifact/Store
        │          │          │
        ▼          ▼          ▼
   GitLab/GitHub Codex/Claude OpenClaw/CI/Sim
```

从控制面视角，Robot Studio 最终形成四个平面：

```text
Engineering Control Plane
        │
        ├── Knowledge Plane
        │     Document / Requirement / Design
        │
        ├── Governance Plane
        │     Review / Approval / Policy
        │
        ├── Execution Plane
        │     Workflow / Harness / Agent
        │
        └── Proof Plane
              Test / Evidence / Verification
```

外部系统（Git、Agent、CI、Simulation、ROS2、Robot Hardware）通过 Adapter 接入。

## 5.3 一次完整请求的数据流

用户在 Document 中创建 Review 后的端到端链路（第一阶段最重要的端到端路径）：

```text
User
  ↓
Web
  ↓
BFF
  ↓
ReviewService
  ↓
ReviewCreated
  ↓
User Accept
  ↓
TaskService
  ↓
TaskCreated
  ↓
WorkflowEngine
  ↓
ContextEngine
  ↓
ContextSnapshot
  ↓
AgentHarness
  ↓
AgentProvider
  ↓
Tool
  ↓
Change
  ↓
TestProvider
  ↓
VerificationEngine
  ↓
Evidence
  ↓
ReviewService.resolve()
```

# 6. 架构原则

## 6.1 Core 与 Provider 解耦

Robot Studio 核心模型不得直接依赖某个具体供应商。

禁止：

```text
ReviewService → GitLab API
AgentService  → Claude Code API
```

推荐：

```text
ReviewService → GitProvider
AgentService  → AgentProvider
```

具体实现：

```text
GitProvider
 ├── GitLabProvider
 ├── GitHubProvider
 └── LocalGitProvider

AgentProvider
 ├── CodexProvider
 ├── ClaudeCodeProvider
 ├── OpenClawProvider
 └── CustomAgentProvider
```

## 6.2 Engineering Object 是核心领域模型

所有系统对象都围绕 Engineering Object 构建（Requirement、Specification、Design、Decision、Review、Task、AgentRun、Change、Test、Verification），而不是围绕数据库表或页面设计。详见第三部分。

## 6.3 Workflow 负责控制流程，不负责业务数据

Workflow Engine 负责 State / Transition / Condition / Action / Event / Approval / Retry / Parallelism，但不直接拥有 Requirement、Document、Review 的业务语义。

例如：

```text
Workflow Engine
   ↓ invoke
ReviewService.accept()
```

而不是：

```text
Workflow Engine
   ↓ SQL
UPDATE review SET status='ACCEPTED'
```

## 6.4 模块依赖规则

必须避免循环依赖。推荐依赖方向：

```text
Domain
  ↑
Service
  ↑
Workflow / Harness
  ↑
API / Worker

Adapter → Service Interface
```

例如：

```text
Review Service
    ↓
Task Service
    ↓
Workflow Engine
    ↓
Agent Harness
    ↓
Agent Provider
```

而不能出现 `Agent Provider → Review Service` 的反向依赖。

## 6.5 Command / Query 分离

接口上区分 Command 与 Query：

```text
POST /reviews/:id/accept    ← Command，改变状态
GET  /reviews/:id           ← Query，读取状态
```

这有利于之后实现 Workflow / Event。

# 7. 模块划分与职责

第一阶段划分为 11 个核心模块：

| Module | 核心职责 |
|---|---|
| Engineering Model | 领域对象与关系 |
| Project Service | Project / Repository / Workspace |
| Document Service | Document / Version / Anchor |
| Review Service | Review / Thread / Decision |
| Task Service | Task / Assignment / Dependency |
| Context Engine | Context Retrieval / Ranking / Bundle |
| Workflow Engine | State Graph / Execution |
| Agent Harness | Agent Run / Tool / Loop / Retry |
| Verification Engine | Test / Evaluation / Evidence |
| Policy Engine | Permission / Approval / Risk |
| Traceability Service | 全链路关系与查询 |

基础设施：

```text
Git Adapter
Agent Adapter
Test Adapter
Artifact Store
Event Bus
Search / Index
```

## 7.1 Project Service

Project 是顶层隔离边界：

```yaml
project:
  id: PROJ-001
  name: Navi Robot

  repository:
    provider: gitlab
    project: robot/navi-control

  agent_policy: default
  workflow_policy: robotics-default
```

Project 决定：Repository、默认 Context Policy、Agent Provider、Workflow、权限、Verification Policy、Tool Policy。

## 7.2 Document Service

职责：Document、Document Version、Document AST、Anchor、Diff。核心接口：

```typescript
interface DocumentService {
  getDocument(id: string): Promise<Document>;
  getVersion(id: string): Promise<DocumentVersion>;
  createVersion(input: CreateVersionInput): Promise<DocumentVersion>;
  resolveAnchor(anchor: DocumentAnchor): Promise<AnchorResolution>;
  getDiff(from: string, to: string): Promise<DocumentDiff>;
}
```

Document Service 负责将 Git 中的 Markdown / AsciiDoc 等工程文档映射为 Robot Studio Document Object。

## 7.3 Review Service

职责：Review、Thread、Comment、Decision、Anchor。典型 API：

```text
createReview()
addComment()
replyComment()
makeDecision()
acceptReview()
rejectReview()
createTaskFromReview()
resolveReview()
```

Review Service 不直接运行 Agent。正确关系：

```text
ReviewService → TaskService → WorkflowEngine → AgentHarness
```

## 7.4 Task Service

Task 是进入 Agent 世界的桥梁：

```yaml
task:
  id: TASK-001
  title: Unify authority management

  source_reviews:
    - REV-001
    - REV-004

  status: READY

  scope:
    paths:
      - src/motion/**
      - test/motion/**
```

Task 应支持：多 Review 聚合、依赖 Task、优先级、Scope、Acceptance Criteria、Workflow、Agent Policy。

## 7.5 Context Engine

Context Engine 是 DES-004（第五部分）的实现模块：

```text
Task
  ↓
Graph Retrieval
  ↓
Semantic Retrieval
  ↓
Keyword Retrieval
  ↓
Ranking
  ↓
Compression
  ↓
Context Bundle
```

推荐拆成内部组件：ContextResolver、ContextRetriever、ContextRanker、ContextCompressor、ContextAssembler、ContextSnapshotter。接口：

```typescript
interface ContextEngine {
  build(input: ContextBuildRequest): Promise<ContextBundle>;
  snapshot(bundle: ContextBundle): Promise<ContextSnapshot>;
}
```

## 7.6 Workflow Engine

Workflow Engine 是 DES-006 / DES-009（第七部分）的执行器，负责：State Graph、Node、Edge、Condition、Event、Transition、Parallel Branch、Join、Retry、Timeout、Approval Gate。

## 7.7 Agent Harness

Agent Harness 实现 DES-005（第六部分），职责：Agent Session、Plan、Tool Call、Policy Check、Observation、Evaluation、Retry、Checkpoint、Recovery、Evidence。核心接口：

```typescript
interface AgentHarness {
  createRun(input: AgentRunInput): Promise<AgentRun>;
  plan(runId: string): Promise<AgentPlan>;
  execute(runId: string): Promise<AgentResult>;
  pause(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
}
```

## 7.8 Policy Engine

Policy Engine 是安全边界，职责：Permission、Risk、Approval、Scope、Budget、Environment。接口：

```typescript
interface PolicyEngine {
  evaluate(action: PolicyAction): Promise<PolicyDecision>;
}
```

例如：

```text
filesystem.read        → ALLOW
filesystem.write       → ALLOW within scope
git.push               → REQUIRE_APPROVAL
robot.motion.execute   → REQUIRE_HUMAN_APPROVAL
```

## 7.9 Verification Engine

负责将「Agent 声称完成」转换成工程证据：

```text
Build → Unit Test → Integration Test → Simulation → Scenario Test → Hardware Test
```

接口：

```typescript
interface VerificationEngine {
  verify(input: VerificationRequest): Promise<VerificationResult>;
}
```

Verification Engine 不依赖 Agent 的主观判断。

## 7.10 Test Adapter

统一封装：pytest、colcon test、ctest、ament test、GitLab CI、Docker、Simulation、Hardware Test Runner。接口：

```typescript
interface TestProvider {
  discover(scope: TestScope): Promise<TestCase[]>;
  run(input: TestRunInput): Promise<TestRunResult>;
  getResult(runId: string): Promise<TestRunResult>;
}
```

## 7.11 Traceability Service

完整链：

```text
Requirement → Specification → Design → Review → Task → Context
→ AgentRun → Change → Commit → MR → Test → Verification
```

接口：

```typescript
interface TraceabilityService {
  related(objectId: string): Promise<EngineeringObject[]>;
  path(fromId: string, toId: string): Promise<EngineeringPath>;
  impact(objectId: string): Promise<ImpactAnalysis>;
}
```

## 7.12 Git Adapter

Git Adapter 对 Robot Studio 来说是外部系统边界：

```typescript
interface GitProvider {
  getFile(path: string, ref: string): Promise<FileContent>;
  getCommit(sha: string): Promise<Commit>;
  diff(from: string, to: string): Promise<Diff>;
  createBranch(input: BranchInput): Promise<Branch>;
  createCommit(input: CommitInput): Promise<Commit>;
  createMergeRequest(input: MergeRequestInput): Promise<MergeRequest>;
}
```

第一阶段建议优先实现 LocalGitProvider 与 GitLabProvider。

# 8. 关键架构边界

## 8.1 Agent Provider 与 Agent Harness 的边界

这是架构中的关键边界：

**Agent Provider 负责**：LLM / Agent Backend、Session、Tool Protocol、Streaming、Model Invocation。

**Agent Harness 负责**：Policy、Workflow、Budget、Retry、Checkpoint、Evidence、Verification、Approval。

因此：

```text
Agent Provider = 能不能运行 Agent
Agent Harness  = Agent 应该怎么运行
```

## 8.2 Workflow / Harness / Agent / Tool 的职责分层

这是整个 Robot Studio 的关键架构原则：

```text
Workflow  → 什么时候运行（Node ordering、Parallelism、Conditions、Human checkpoints、Sub-workflow、Business process）
Harness   → 怎么受控运行（Agent plan、Tool control、Risk policy、Execution loop、Retry、Budget、Observe、Evaluate、Checkpoint、Evidence）
Agent     → 怎么解决问题（Local reasoning、Plan proposal、Tool selection proposal、Local implementation decisions）
Tool      → 怎么执行动作
```

调用链：

```text
Workflow
   ↓
Agent Harness
   ↓
Agent Provider
   ↓
Tool
```

Agent 不是 Workflow——**Agent 只是 Workflow 中的一类执行节点**。

## 8.3 Review → Task → Workflow → Harness 的调用方向

```text
ReviewService
      ↓
TaskService
      ↓
WorkflowEngine
      ↓
AgentHarness
      ↓
AgentProvider
```

# 9. 数据层、基础设施与技术栈

## 9.1 数据层

主数据库采用 **PostgreSQL**，存储：

```text
Engineering Object
Relation
Project
Task
Review
Workflow
AgentRun
Evidence
Verification
Policy
```

文件内容不全部存数据库，而是保存在 Git Repository 与 Artifact Store 中；数据库只存引用与索引。

## 9.2 搜索层

搜索分两级：

- 第一阶段：PostgreSQL Full Text / trigram。
- 第二阶段：Vector Database / pgvector。

推荐第一阶段直接采用 **PostgreSQL + pgvector**，减少基础设施数量。

## 9.3 Event Model

核心对象变化应产生 Domain Event：

```text
ReviewAccepted、TaskCreated、ContextBuilt、PlanApproved、
AgentRunStarted、ToolExecuted、ChangeCreated、TestCompleted、
VerificationPassed、ReviewResolved
```

统一事件模型：

```typescript
interface DomainEvent {
  id: string;
  type: string;
  aggregateId: string;
  timestamp: string;
  actor: Actor;
  payload: Record<string, unknown>;
}
```

Event 用于支持 Workflow Trigger、Audit、Notification、Metrics 与 Future Plugin，避免 Service 之间直接长链调用（例如 `ReviewAccepted → TaskCreated → WorkflowStarted` 由事件驱动串联）。

## 9.4 API 层与 BFF

API 采用 **REST + WebSocket / SSE**：

- REST：CRUD、Command、Query。
- WebSocket / SSE：Agent Streaming、Workflow State、Test Progress、Review Updates。

前端不直接调用十几个 Core Service，而是经过 BFF：

```text
UI → BFF → Core Services
```

BFF 负责：Aggregation、Authorization Context、UI-specific DTO、Streaming。特别是 Agent 页面（Task + Context + Plan + Run + Changes + Tests + Evidence）应由 BFF 聚合成一个 View Model。

## 9.5 Worker Architecture

耗时任务不阻塞 API Server：

```text
API → Job Queue → Worker
```

Worker 负责：Context Build、Agent Run、Test、Simulation、Embedding、Git Index。MVP 可先使用 **Redis + BullMQ**，未来再迁移到更强的 Workflow Runtime。

## 9.6 运行时部署

MVP 推荐：

```text
                Browser
                   │
              Reverse Proxy
                   │
              Robot Studio
              Monolithic API
                   │
       ┌───────────┼───────────┐
       │           │           │
 PostgreSQL     Git       Agent Runtime
       │                       │
       │                Codex / Claude
       │
    pgvector
```

**不要一开始拆成大量微服务。** Robot Studio 当前最重要的是快速验证 Domain Model、Workflow、Agent Harness、Traceability，而不是服务治理。Modular Monolith 可以保持单进程、单部署、统一数据库事务、模块化代码边界；未来当某个模块需要扩展时再拆服务。

## 9.7 技术栈

### Backend

```text
TypeScript
NestJS / Fastify
PostgreSQL
pgvector
```

原因：Workflow / Agent 生态成熟；TypeScript 前后端统一；JSON / Schema 处理方便；API / Plugin 开发效率高。Python 可以作为 Agent / Research Worker。

### Frontend

```text
React
TypeScript
Vite
Monaco Editor      → Code / Markdown
React Flow         → Workflow Graph
```

---

# 第三部分 工程领域模型

# 10. Engineering Object 与 Relation

## 10.1 核心思想

Robot Studio 不把 Markdown、Git、Review、Agent、Code 看成几个独立功能，系统内部需要建立统一的工程领域模型：

```text
                    ┌──────────────┐
                    │   Project    │
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        ↓                  ↓                  ↓
   Engineering          Workflow          Execution
     Assets              Assets             Assets
        │                  │                  │
 Requirement            Review            AgentRun
 Specification          Decision          Change
 Design                 Task              Verification
 Test
 Code
```

所有对象最终都应该能够被统一查询和关联。

## 10.2 EngineeringObject

所有核心工程对象都继承或实现统一能力：

```typescript
interface EngineeringObject {
  id: string;
  type: EngineeringObjectType;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

对象类型：

```text
PROJECT
DOCUMENT
REQUIREMENT
SPECIFICATION
DESIGN
DECISION
REVIEW
TASK
AGENT_RUN
CHANGE
COMMIT
MERGE_REQUEST
TEST
VERIFICATION
```

核心原则：

> **所有重要工程资产都应该拥有稳定 ID。**

```text
RQ-001、SPEC-001、DES-001、ADR-001、REV-001、
TASK-001、RUN-001、CHG-001、TEST-001、VER-001
```

这样 Agent、Git、Document 和 UI 都可以使用统一引用。

## 10.3 EngineeringRelation

所有 Engineering Object 通过 Relation 连接：

```typescript
interface EngineeringRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  metadata?: Record<string, unknown>;
}
```

统一关系类型（合并各设计文档的命名）：

```text
SPECIFIED_BY / SPECIFIES       Requirement ↔ Specification
DESIGNED_BY / IMPLEMENTS       Specification ↔ Design
REVIEWED_BY / TARGETS          Object ↔ Review
DECIDED_BY                     Object ↔ Decision
IMPLEMENTED_BY                 Object ↔ Change / Task
TESTED_BY / TESTS              Object ↔ Test
VERIFIED_BY                    Object ↔ Verification
DERIVED_FROM                   派生关系
REFERENCES                     引用关系
GENERATED_BY                   生成来源
MODIFIED_BY                    修改来源
BLOCKS                         阻塞
DEPENDS_ON                     依赖
SUPERSEDES                     替代
RELATED_TO / SAME_MODULE       弱关联
```

形成：

```text
RQ-001
  │
  ├── SPECIFIED_BY → SPEC-001
  ├── DESIGNED_BY  → DES-001
  ├── REVIEWED_BY  → REV-001
  ├── IMPLEMENTED_BY → CHG-001
  └── VERIFIED_BY  → VER-001
```

# 11. 需求侧对象：Requirement / Specification / Design / ADR

## 11.1 Requirement

Requirement 描述**系统必须做什么**：

```yaml
id: RQ-001
title: Limb Control Authority
status: approved

description: |
  同一时刻一个 LimbController
  只能存在一个有效控制权持有者。

priority: high

acceptance_criteria:
  - id: AC-001
    description: |
      同一时刻只能存在一个 ACTIVE authority。
  - id: AC-002
    description: |
      Emergency Stop 必须拥有最高优先级。

relations:
  - SPEC-001
  - TEST-001
```

生命周期：

```text
DRAFT → IN_REVIEW → APPROVED → IMPLEMENTING → VERIFIED → DONE
DRAFT → CANCELLED
```

## 11.2 Specification

Specification 描述**系统具体应该如何满足 Requirement**：

```yaml
id: SPEC-001
requirement: RQ-001
title: Control Authority Specification

rules:
  - id: RULE-001
    description: |
      一个 LimbController 同一时刻
      只能存在一个 ACTIVE authority。
  - id: RULE-002
    description: |
      Emergency Stop 优先级最高。
  - id: RULE-003
    description: |
      所有 Authority Request 必须经过
      GlobalAuthorityManager。

status: approved
```

Specification 不直接描述 class / function / file / implementation，而主要描述：Rule、Constraint、Behavior、Interface Contract、Acceptance Criteria。

关系链：`Requirement → Specification → Design`。

## 11.3 Design

Design 描述**系统采用什么结构实现 Specification**：

```yaml
id: DES-001
title: Global Authority Manager

implements:
  - SPEC-001

components:
  - GlobalAuthorityManager
  - MotionManager
  - LimbController

interfaces:
  - request_authority()
  - release_authority()

constraints:
  - GlobalAuthorityManager
    是唯一 Authority Arbitration Component。
```

Design 可以关联：Requirement、Specification、Architecture、ADR、Review、Source Code。

生命周期：

```text
DRAFT → IN_REVIEW → APPROVED → IMPLEMENTED → VERIFIED
```

## 11.4 Decision / ADR

Decision 记录**为什么选择这个方案**：

```yaml
id: ADR-001
title: Use Global Authority Manager

context: |
  MotionManager 直接控制 LimbController
  会导致多个模块存在控制权冲突。

decision: |
  使用 GlobalAuthorityManager
  作为统一仲裁器。

alternatives:
  - MotionManager Arbitration
  - Distributed Arbitration

status: accepted
```

生命周期：

```text
PROPOSED → ACCEPTED → SUPERSEDED
PROPOSED → REJECTED
```

ADR 是系统防止 Agent 和人类反复问「为什么之前这样设计？」的重要机制。

# 12. 执行侧对象：Task / Agent Run / Agent Context / Change

## 12.1 Task

Task 是**可以由人或 Agent 执行的工作单元**：

```yaml
id: TASK-001
title: Implement GlobalAuthorityManager

source:
  - REV-001
  - DES-001

type: implementation

assignee:
  type: agent
  agent: claude-code

status: todo
```

Task 支持多 Review 聚合（`REV-001 + REV-003 + REV-005 → TASK-001`）、Scope（允许修改路径）、Acceptance Criteria 与 Agent Policy。

生命周期：

```text
TODO → PLANNING → READY → RUNNING → WAITING_REVIEW → DONE
```

异常状态：`BLOCKED`、`FAILED`、`CANCELLED`。

## 12.2 Agent Run

**Task 和 Agent Run 必须分离**，因为一个 Task 可以执行多次：

```text
TASK-001
  ├── RUN-001 FAILED
  ├── RUN-002 FAILED
  └── RUN-003 SUCCESS
```

Agent Run 概念模型：

```yaml
id: RUN-003
task: TASK-001

agent:
  provider: claude
  runtime: claude-code

context:
  documents:
    - RQ-001
    - SPEC-001
    - DES-001
  reviews:
    - REV-001
  code:
    repository: robot-control

status: running
```

Agent Run 的完整运行时模型（状态机、Execution Step、Tool、Observation、Evidence、Checkpoint、Policy、Metrics）在第六部分定义。生命周期概览：

```text
CREATED → PREPARING_CONTEXT → PLANNING → WAITING_APPROVAL
→ RUNNING → VERIFYING → COMPLETED
```

异常：`FAILED`、`CANCELLED`、`BLOCKED`。

## 12.3 Agent Context

Agent 不应该只收到一句「请根据 REV-001 修改代码」，而应该收到一个结构化 Context Bundle：

```text
Context Bundle
├── Primary Object（Review）
├── Requirements
├── Specifications
├── Design Documents
├── ADR
├── Related Reviews
├── Related Source Code
├── Related Tests
└── Git History
```

Context Builder 是独立模块，完整设计见第五部分。

## 12.4 Change

Agent 修改产生 **Change**，而不是直接 Commit。Change 是 Git Commit 之前的工程变更提案：

```yaml
id: CHG-001

source:
  task: TASK-001
  run: RUN-003

reason:
  review: REV-001

files:
  - src/global_authority_manager.cpp
  - src/motion_manager.cpp
  - test/authority_test.cpp

status: proposed
```

一次 Agent Run 可能产生多个 Change（文档、代码、测试分别成 Change）：

```text
RUN-003
   ├── CHG-001 → design.md
   ├── CHG-002 → motion_manager.cpp
   └── CHG-003 → authority_test.cpp
```

生命周期：

```text
PROPOSED → IN_REVIEW → APPROVED → COMMITTED → MERGED
PROPOSED → REJECTED
```

Change 必须记录 source（review / task / agent_run）、before revision、resulting revision、changed files，以实现 Review → Code Change 双向追踪。

# 13. 验证侧对象：Test / Verification 与 Traceability 模型

## 13.1 Test

Test 不只是 CI 输出，本身也是 Engineering Object：

```yaml
id: TEST-001
title: Authority Arbitration Test

validates:
  - RQ-001
  - SPEC-001

type: unit

location:
  test/control_authority_test.cpp
```

关系链：`Requirement → Specification → Test → Verification`。

## 13.2 Verification

Verification 表示某个 Requirement / Review / Change **是否已经被验证**：

```yaml
id: VER-001

target:
  - RQ-001
  - REV-001
  - CHG-001

evidence:
  build: PASS
  tests:
    - TEST-001: PASS
    - TEST-002: PASS

status: PASS
```

状态：`PENDING`、`RUNNING`、`PASS`、`FAIL`。

Verification 的独立性原则（Self Check vs Independent Verification）见第六部分第 32 章。

## 13.3 Traceability 模型与 Graph

系统提供 Traceability View。例如：

```text
RQ-003 Control Authority
      │
      ├── SPEC-002
      ├── DES-004
      ├── REV-012
      ├── TASK-018
      ├── COMMIT-a81f
      ├── MR-102
      └── TEST-031
```

完整主链：

```text
Requirement
  ↓
Specification
  ↓
Design
  ↓
Review
  ↓
Task
  ↓
Context
  ↓
AgentRun
  ↓
Change
  ↓
Commit
  ↓
MR
  ↓
Test
  ↓
Verification
```

Graph 不只是展示。用户点击任意节点可以：

```text
Open / Review / Trace Forward / Trace Backward / Send To Agent / Create Task
```

用户可以从任意节点向前或向后追踪，回答「这个代码变更为什么存在？」这类问题。

---

# 第四部分 文档与评审系统

# 14. Document Workspace 与编辑器

## 14.1 文档类型

第一阶段支持：

```text
Requirements
Specifications
Architecture
Design
ADR / Decision
Test Specification
Development Guide
```

## 14.2 文档格式

第一阶段优先使用 **Markdown**。原因：Git 原生支持、Agent 容易处理、人类可读、易于 Diff、易于迁移、易于 API 操作。

## 14.3 文档结构

推荐：

```text
docs/
├── requirements/
│   ├── capability.md
│   └── limb-control.md
├── specifications/
│   └── control-authority.md
├── design/
│   ├── architecture.md
│   └── state-machine.md
├── decisions/
│   ├── ADR-001.md
│   └── ADR-002.md
├── tests/
│   └── control-authority.md
└── reviews/
    ├── REV-001.md
    └── REV-002.md
```

实际存储可以使用 GitLab Wiki，也可以逐步演进到 Project Repository 中的 `/docs`。

## 14.4 Document Editor

系统提供 Markdown 文档编辑器，基本能力：

- Markdown 编辑 / Preview
- Heading Navigation
- Mermaid Diagram
- Search
- Document Link
- Version History
- Diff
- Save / Commit

推荐 IDE 式双栏模式：

```text
┌─────────────────────────────────────────┐
│ Editor              │ Preview           │
│                     │                   │
│ # Architecture      │ Architecture      │
│ ## Component        │ Component         │
│ Manager             │ Manager           │
└─────────────────────────────────────────┘
```

# 15. Document Version 与 Git 对齐

每一次 Document Commit 都形成一个新的 Version：

```text
DOC-001
  Version 1
  Version 2
  Version 3
  Version 4
```

Document：

```yaml
id: DOC-001
title: Limb Control Authority
current_version: 4

repository:
  provider: gitlab
  project: robot-control
  path: docs/design/limb-control.md
```

Version：

```yaml
id: DOC-001@4
document_id: DOC-001
version: 4
commit:
  sha: abc123
created_at: 2026-09-07T10:30:00Z
author: user
```

**Document Version 应尽可能与 Git Commit 对齐**（Version ↔ Commit SHA + branch），这样可以准确知道 Review 是基于哪个代码 / 文档版本提出的：

```yaml
document_version:
  id: DOC-001@12
git:
  commit: 9af23c
  branch: feature/authority
```

# 16. Document Anchor 模型

## 16.1 核心问题

> 用户在文档 Version A 中选择一段文字创建 Review，文档被修改为 Version B 后，Review 是否还能准确定位？

**Review 不绑定行号**——禁止只使用 `line: 24` 作为定位依据，因为行号在版本间会失效。

## 16.2 Semantic Text Anchor

Review 使用**语义文本锚点**。Anchor 至少包含：

```yaml
anchor:
  version: DOC-001@4

  start:
    offset: 1024
  end:
    offset: 1187

  selected_text: |
    MotionManager 可以通过 CapabilityManager
    获取 LimbController 的控制权。

  prefix: |
    ## Control Authority

  suffix: |
    Emergency Stop 优先级最高。

  hash:
    algorithm: sha256
    value: ...
```

Anchor 组成（五层信息）：

```text
1. Document Version
2. Selected Text
3. Text Offset
4. Surrounding Context（Prefix / Suffix）
5. Content Hash
```

结构：

```text
        Anchor
           │
    ┌──────┼──────┐
    ↓      ↓      ↓
Version  Selected  Context
          Text
    │      │      │
    └──────┼──────┘
           ↓
         Hash
           ↓
      Git Commit
```

各字段的作用：

- **Selected Text**：当文档修改时可通过全文搜索重新定位。
- **Prefix / Suffix**：同一文本可能在文档中出现多次，上下文可提高定位准确率。
- **Content Hash**：对 `prefix + selected_text + suffix` 计算 SHA256，用于判断 Review 原始上下文是否仍然完整存在。

## 16.3 TypeScript 模型

```typescript
interface DocumentAnchor {
  documentId: string;
  versionId: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix?: string;
  suffix?: string;
  hash: {
    algorithm: "sha256";
    value: string;
  };
}
```

## 16.4 Markdown AST

文档解析建议建立 **Document AST** 而不是完全依赖纯文本：

```markdown
# Control Authority

## Rules

MotionManager 必须通过
GlobalAuthorityManager 获取控制权。
```

解析为：

```text
Document
├── Heading: Control Authority
├── Heading: Rules
└── Paragraph: Text
```

Review 可以同时记录结构信息：

```yaml
anchor:
  heading_path:
    - Control Authority
    - Rules
  text: |
    MotionManager 必须通过
    GlobalAuthorityManager 获取控制权。
```

## 16.5 最终推荐的 Anchor 模型

综合考虑 Git、Markdown 和未来编辑器能力，Anchor 采用四类信息共同定位：

```yaml
anchor:
  document_version: DOC-001@12

  structural:
    heading_path:
      - Control Authority
      - Rules
    block_index: 3

  textual:
    selected_text: |
      MotionManager 必须通过
      GlobalAuthorityManager 获取控制权。
    prefix: |
      ## Rules
    suffix: |
      Emergency Stop 优先级最高。

  positional:
    start_offset: 1024
    end_offset: 1102

  fingerprint:
    algorithm: sha256
    value: ...
```

即 **Structural + Textual + Positional + Fingerprint** 共同用于定位。

# 17. Anchor Resolution

## 17.1 解析流程

当打开 Review 时，系统执行：

```text
Load Review → Load Original Version → Check Current Version
→ Anchor Resolver → Locate Text
```

系统需要独立的 **AnchorResolver** 组件：

```typescript
interface AnchorResolution {
  status:
    | "VALID"
    | "MOVED"
    | "MODIFIED"
    | "OUTDATED"
    | "ORPHANED";
  startOffset?: number;
  endOffset?: number;
  confidence: number;
}
```

## 17.2 解析算法（优先级）

第一阶段不需要复杂 AI，按以下优先级查找：

```text
Step 1  Exact Text + Context
   ↓ failure
Step 2  Exact Selected Text
   ↓ failure
Step 3  Prefix + Selected Text
   ↓ failure
Step 4  Suffix + Selected Text
   ↓ failure
Step 5  Fuzzy Match → Return confidence
```

confidence 与状态的映射示例：

```text
confidence >= 0.95  → VALID
0.80 ~ 0.95         → MOVED / MODIFIED
0.50 ~ 0.80         → NEEDS_REVIEW
< 0.50              → ORPHANED
```

> 具体阈值应通过实际数据验证，而不是作为固定产品规则。

## 17.3 Anchor 状态

| 状态 | 含义 |
|---|---|
| `VALID` | 当前文档中可以准确找到 Review 对应文本 |
| `MOVED` | 文本仍然存在，但位置发生变化 |
| `MODIFIED` | 原文本被修改，但可以找到高度相似的内容 |
| `OUTDATED` | 原始内容已经发生实质变化 |
| `ORPHANED` | 无法找到原始 Review 对应内容 |

## 17.4 Review Status 与 Anchor Status 分离

非常重要：

> **Review Status 和 Anchor Status 不能混为一谈。**

例如 `Review Status: OPEN + Anchor Status: MOVED` 表示 Review 还没有解决，只是对应的文字换了位置；`Review Status: OPEN + Anchor Status: OUTDATED` 表示文档内容已经发生变化，Reviewer 需要重新确认这个 Review 是否仍然成立。

# 18. Review Thread / Comment / Decision

## 18.1 Review 模型

Review 是整个系统的核心对象，不只是 Comment，表示**对某个 Engineering Object 提出的工程意见**：

```yaml
id: REV-001

target:
  object_type: DESIGN
  object_id: DES-001
  document: design/control-authority.md
  anchor:
    type: text
    start: 1024
    end: 1150

severity: major
type: design_issue

comment: |
  MotionManager 不应该直接参与
  Authority Arbitration。

proposal: |
  应增加 GlobalAuthorityManager
  作为唯一仲裁器。

status: open
author: user
```

Review 类型：

```text
QUESTION / SUGGESTION / BUG / DESIGN_ISSUE /
REQUIREMENT_ISSUE / IMPLEMENTATION_ISSUE /
TEST_ISSUE / SECURITY_ISSUE
```

严重等级：

```text
INFO / MINOR / MAJOR / CRITICAL
```

TypeScript 完整模型：

```typescript
interface Review {
  id: string;

  target: {
    objectId: string;
    documentId?: string;
    anchor?: DocumentAnchor;
  };

  type:
    | "QUESTION" | "SUGGESTION" | "BUG"
    | "DESIGN_ISSUE" | "REQUIREMENT_ISSUE"
    | "IMPLEMENTATION_ISSUE" | "TEST_ISSUE";

  severity: "INFO" | "MINOR" | "MAJOR" | "CRITICAL";

  status:
    | "OPEN" | "DISCUSSING" | "NEEDS_REVIEW"
    | "ACCEPTED" | "IMPLEMENTING" | "IMPLEMENTED"
    | "VERIFYING" | "RESOLVED" | "REJECTED"
    | "DUPLICATED";

  threadId: string;
  relations: EngineeringRelation[];
}
```

## 18.2 Review Thread 与 Comment

一个 Review 可以包含一个 Thread：

```text
REV-001
   ├── Comment #1
   ├── Comment #2
   ├── Comment #3
   └── Decision
```

```typescript
interface ReviewThread {
  id: string;
  reviewId: string;
  status: "OPEN" | "RESOLVED";
  comments: Comment[];
  decision?: ReviewDecision;
}

interface Comment {
  id: string;
  threadId: string;
  author: {
    type: "USER" | "AGENT";
    id: string;
    agentRunId?: string;
  };
  content: string;
  replyTo?: string;
  createdAt: string;
}
```

Agent 也可以参与 Thread（author.type = agent，带 provider 与 run_id），例如：

```text
Agent:
根据 REV-001，我建议将 GlobalAuthorityManager 放在
MotionManager 和 LimbController 之间。
该方案不会破坏现有接口。
```

但：**Agent Comment 不具有自动 Approval 权限。**

## 18.3 Review Decision

Thread 最终需要形成 Decision：

```yaml
decision:
  type: ACCEPT
  summary: |
    增加 GlobalAuthorityManager
    作为统一 Authority Arbitration Component。
  decided_by:
    type: user
  decided_at: ...
```

Decision 类型：

```text
ACCEPT / REJECT / DEFER / DUPLICATE / WONT_FIX
```

# 19. Review 状态机与文档变更联动

## 19.1 完整生命周期

```text
OPEN
  ↓
DISCUSSING
  ↓
ACCEPTED
  ↓
IMPLEMENTING
  ↓
IMPLEMENTED
  ↓
VERIFYING
  ↓
RESOLVED
```

允许的旁路：

```text
OPEN → REJECTED
OPEN → DUPLICATED
VERIFYING → FAILED → IMPLEMENTING
VERIFYING → OPEN
```

核心原则：

> **Review Resolve 不代表 Agent 已经修改代码。**

必须经过 `Review → Implementation → Verification → Resolved`。

## 19.2 Review 本身不能因文档修改而自动 Resolve

例如 Review 说「应该使用 GlobalAuthorityManager」，Agent 修改文档后：

```text
Updated: GlobalAuthorityManager 负责统一控制权仲裁。
```

此时 `Review = IMPLEMENTED`，但还不能 `RESOLVED`——必须经过验证。

## 19.3 文档变更 → Anchor Resolution → Review 状态变化

当文档发生修改（`Document V1 → Review REV-001 → Document V2`），系统自动执行 Anchor Resolution：

| Anchor 状态 | Review 状态变化 |
|---|---|
| `VALID` | 不变 |
| `MOVED` | 不变，Anchor Status = MOVED |
| `MODIFIED` | Review Status = NEEDS_REVIEW |
| `OUTDATED` / `ORPHANED` | Review Status = NEEDS_REVIEW |

## 19.4 NEEDS_REVIEW 状态

`NEEDS_REVIEW` 表示：**Review 对应的工程上下文已经发生变化，需要人重新判断。**

例如：

```text
Reviewer: "应该使用 GlobalAuthorityManager"
Agent:   "我认为新的架构已经不需要这个组件。"
```

此时不能自动关闭 Review，必须重新进入 Human Review。

## 19.5 Agent 修改文档后的批量处理

Agent 修改文档时（`Document V10 → Agent → Document V11`），系统自动：

```text
Load all Open Reviews → Resolve Anchors → Classify → Update Review
```

例如：

```text
REV-001 → IMPLEMENTED
REV-002 → STILL_VALID
REV-003 → NEEDS_REVIEW
```

**文档变化不能自动删除 Review。**

# 20. Review 驱动的工程链路与核心原则

## 20.1 Review → Task

当 Review 被 Accept 后创建 Task；一个 Task 可以来自多个 Review：

```text
REV-001 ─┐
REV-003 ─┼──→ TASK-001
REV-005 ─┘
```

## 20.2 Review → Agent（Send to Agent）

用户可以直接点击 **Send to Agent**，系统执行：

```text
Review → Collect Context → Build Context Bundle
→ Create Agent Task → Agent Plan
```

Review Context 至少包含：

```text
Review
├── Target Document
├── Original Document Version
├── Current Document Version
├── Selected Text
├── Review Thread
├── Related Requirement / Specification / Design / ADR
├── Related Source Code
└── Related Tests
```

## 20.3 Review 与 Git Commit / MR 的关联

一个 Commit 可以关联多个 Review，一个 Review 也可能关联多个 Commit：

```text
commit abc123
implements:
  - REV-001
  - REV-003
```

Review 最终可以关联 GitLab MR：

```text
REV-001 → TASK-001 → RUN-003 → CHG-001 → Commit abc123 → MR !102
```

因此可以从 Document Review 直接跳转到 Agent Run、Code Diff、Git Commit、GitLab MR——**文档 Review 与代码 Review 必须能够相互跳转**。

## 20.4 Review Traceability Chain

Review 页面应提供：

```text
REV-001
  Requirement   RQ-001
  Specification SPEC-001
  Design        DES-001
  Decision      ADR-001
  Task          TASK-001
  Agent Run     RUN-003
  Change        CHG-001
  Commit        abc123
  MR            !102
  Test          TEST-001
  Verification  VER-001
```

## 20.5 Human-in-the-loop 边界

以下动作默认需要 Human Approval：

```text
Accept Requirement
Approve Design
Accept Review
Approve Agent Plan
Approve Change
Resolve Critical Review
Merge
```

Agent 默认不能：自动批准自己的设计、自动 Resolve Critical Review、自动 Merge。

## 20.6 Agent Autonomous Mode

未来支持三种模式：

```text
Manual           Agent 每个关键步骤等待用户
Semi-Autonomous  Plan → 人批准；Implementation / Test → 自动；Merge → 人批准
Autonomous       Review → Agent → Code → Test
```

Autonomous Mode 必须受到项目策略和权限控制。

## 20.7 核心原则总结

1. **Review 绑定的是工程上下文，而不是行号。**
2. **Review Status 与 Anchor Status 分离。**
3. **文档变化不能自动删除 Review。**
4. **Agent 可以执行 Review，但不能自动决定 Review。**
5. **Review Resolve 必须能够追溯到 Verification Evidence。**
6. **Document、Review、Agent、Code、Test 必须可以双向追踪。**

## 20.8 MVP 技术实现建议

第一阶段：`Frontend → Monaco Editor → Markdown AST → Anchor Resolver → Review Service`。文档解析建立 Document AST，而不是完全依赖纯文本。

---

---

# 第五部分 Agent Context 系统

# 21. 设计原则与 Context Graph

## 21.1 背景

Robot Studio 中，一条 Review 往往只是一个局部意见，例如：

> MotionManager 不应该直接获取 LimbController 的控制权，应该统一通过 GlobalAuthorityManager。

Agent 真正执行任务时，还需要知道相关 Requirement、Specification、Design、ADR、代码、测试、Git 历史及其他 Review。因此**不能把 Review 文本直接作为 Prompt**，而应通过 Context Builder 自动构建结构化上下文。

核心链路：

```text
Review
  ↓
Context Graph
  ↓
Candidate Context
  ↓
Relevance Ranking
  ↓
Context Selection
  ↓
Context Compression
  ↓
Agent Context Bundle
  ↓
Agent
```

DES-004（本部分）解决五个问题：

1. Agent 应该看什么？
2. Agent 不应该看什么？
3. 如何自动找到相关内容？
4. Context 太大怎么办？
5. Agent 最终使用了哪些信息，如何追溯？

## 21.2 Context First 原则

Agent 不应该自行无边界搜索整个 Repository。Robot Studio 应先构建经过策略约束的 Context：

```text
Bad:
Review → Agent → Agent 自己搜索整个 repo

Recommended:
Review → Context Builder → Relevant Context → Agent
```

这样可以降低 Token 消耗、搜索成本、无关上下文、错误上下文与幻觉。

## 21.3 Context 是工程对象

Context 必须可以被：查看、审计、快照、复现、评价、追踪。

## 21.4 Context Graph

Robot Studio 基于 Engineering Object / Engineering Relation 构建 Context Graph：

```text
REQ-001
   │
   ▼
SPEC-003
   │
   ▼
DES-005
   │
   ├──────────────┐
   ▼              ▼
REV-001         ADR-007
   │
   ▼
TASK-001
   │
   ▼
RUN-003
   │
   ├──► motion_manager.cpp
   ├──► authority_manager.cpp
   └──► authority_test.cpp
```

Context Builder 的任务是从整个工程图中找到与当前 Task 最相关的子图。

## 21.5 Context Source

| Source | 示例 | 优先级 |
|---|---|---:|
| Review | REV-001 | P0 |
| Target Document | design.md | P0 |
| Selected Text | Review Anchor | P0 |
| Requirement | REQ-001 | P0 |
| Specification | SPEC-003 | P0 |
| Design | DES-005 | P0 |
| ADR | ADR-007 | P1 |
| Related Review | REV-003 | P1 |
| Source Code | authority_manager.cpp | P0 |
| Tests | authority_test.cpp | P0 |
| Git History | commits | P1 |
| Merge Request | !102 | P1 |
| README / General Docs | README.md | P2 |

# 22. Context Object 与分级选择

## 22.1 ContextItem

```typescript
interface ContextItem {
  id: string;

  type:
    | "REVIEW" | "DOCUMENT" | "REQUIREMENT" | "SPECIFICATION"
    | "DESIGN" | "ADR" | "CODE" | "TEST"
    | "COMMIT" | "MERGE_REQUEST" | "REVIEW_THREAD";

  source: {
    provider: string;
    uri: string;
  };

  content: string;
  relevance: number;
  reason: string;
  metadata?: Record<string, any>;
}
```

其中 `relevance` 与 `reason` 是关键字段——**系统应能解释「为什么这个对象被放进 Context」**。示例：

```yaml
id: authority_manager.cpp
relevance: 0.94
reason:
  - referenced by REV-001
  - implements GlobalAuthorityManager
  - modified by related commit abc123
```

## 22.2 分级上下文

```text
P0 — 必须上下文
P1 — 强相关上下文
P2 — 辅助上下文
P3 — 可搜索上下文
```

- **P0**：Agent 必须看到——Review、Review Thread、Target Design、Anchor、关联 Requirement / Specification、直接相关代码、直接相关测试。
- **P1**：强相关——ADR、相关 Design / Review、最近 Commit、相关 MR。
- **P2**：辅助理解——README、模块文档、API 文档、历史设计。
- **P3**：默认不进入 Context，只提供 Search Index，必要时通过 Tool 查询。

# 23. Ranking 与三路 Retrieval

## 23.1 评分模型

```text
Score =
    RelationScore
  + SemanticScore
  + RecencyScore
  + ReferenceScore
  + StructuralScore
```

初始关系权重（heuristic，需通过实际任务评估校准）：

| Relation | Score |
|---|---:|
| REVIEW_TARGETS | 1.00 |
| IMPLEMENTS | 0.95 |
| SPECIFIES | 0.95 |
| TESTS | 0.90 |
| DERIVED_FROM | 0.85 |
| REFERENCES | 0.75 |
| MODIFIED_BY | 0.70 |
| RELATED_TO | 0.50 |
| SAME_MODULE | 0.30 |

## 23.2 三路 Retrieval

```text
                ┌── Graph Retrieval
                │
Review ─────────┼── Semantic Retrieval
                │
                └── Keyword Retrieval
                         ↓
                  Candidate Set
                         ↓
                    Ranking
```

- **Graph Retrieval**：沿 Engineering Relation 查找直接相关对象。
- **Semantic Retrieval**：使用 Embedding / Vector Search 找到语义相关文档、代码和测试。
- **Keyword Retrieval**：特别适合代码实体和 API，例如 `GlobalAuthorityManager`、`authority`、`LimbController`。

## 23.3 Graph Traversal 深度约束

Context Graph 扩展必须有深度约束：

```text
Review
  ↓ depth 1
Design / Code / Test
  ↓ depth 2
Requirement / ADR / Commit
  ↓ depth 3
Related Review / MR
```

默认不要从一个 Review 无限制遍历到整个项目图。

# 24. Token Budget 与 Context Compression

## 24.1 Context Budget

Context Builder 必须支持 Token Budget（示意值，应按具体 Agent / Model 动态配置）：

```yaml
context_budget:
  total: 100000
  review: 3000
  requirements: 8000
  design: 15000
  code: 40000
  tests: 15000
  history: 5000
  reserve: 14000
```

## 24.2 Context Compression

Context 超预算时：

```text
Raw Context
  ↓
Deduplication
  ↓
Chunking
  ↓
Summarization
  ↓
Priority Selection
```

压缩必须保留来源引用，避免「摘要失去证据来源」。

## 24.3 代码 Context

代码上下文不能只按文件选择，应优先按 **Symbol / Function / Call Graph** 选择：

```text
File → Symbol → Function → Call Graph
```

例如：

```text
Review
  ↓
GlobalAuthorityManager::acquire()
  ↓
LimbController::requestControl()
  ↓
MotionManager::execute()
```

最终向 Agent 提供 Relevant Code Slice，而不是整个 Repository。

## 24.4 测试 Context

Agent 必须同时看到与变更相关的：Unit Test、Integration Test、Scenario Test、Hardware Test（如适用）。

## 24.5 Git History Context

Git History 用于解释「为什么当前代码是这样」。推荐优先包含：

- 最近修改相关文件的 Commit
- 与 Review / Task 关联的 Commit
- 相关 MR
- 文件的重要历史变更

# 25. Context Bundle / Snapshot / Policy

## 25.1 Context Bundle

最终交给 Agent 的不是文件集合，而是结构化 Bundle：

```yaml
context_bundle:
  task:
    id: TASK-001
    title: Unify authority management

  review:
    id: REV-001
    type: DESIGN_ISSUE
    severity: MAJOR

  target:
    document: DES-005
    anchor: ...

  requirements:
    - REQ-001
  specifications:
    - SPEC-003
  designs:
    - DES-005
  decisions:
    - ADR-007

  code:
    - authority_manager.cpp
    - limb_controller.cpp
    - motion_manager.cpp

  tests:
    - authority_test.cpp

  history:
    commits:
      - abc123
      - def456

  related_reviews:
    - REV-003
```

## 25.2 Context 与 Prompt 分离

不要设计成 `Context Builder → Giant Prompt → LLM`，推荐：

```text
Context Bundle
  ↓
Agent Runtime
  ↓
System Prompt + Task Prompt + Context + Tools + Policies
  ↓
LLM
```

**Context 是 Agent Runtime 的一等公民。**

## 25.3 Agent Runtime 接口

```typescript
interface AgentRuntime {
  createRun(task: Task, context: ContextBundle): Promise<AgentRun>;
  plan(run: AgentRun): Promise<AgentPlan>;
  execute(run: AgentRun): Promise<AgentResult>;
  verify(run: AgentRun): Promise<VerificationResult>;
}
```

Robot Studio 通过 Adapter 接入 Claude Code、Codex、OpenClaw、Hermes、Dify Agent 或自研 Agent。

## 25.4 Context Snapshot

Agent Run 启动时创建**不可变的 Context Snapshot**：

```yaml
context_snapshot:
  created_at: 2026-09-07T10:30:00
  documents:
    DES-005: version 12
    REQ-001: version 4
  code:
    repository_commit: abc123
  reviews:
    REV-001: version 3
```

这样可以准确回答：**Agent 当时到底看到了什么。**

## 25.5 Context Policy

不同 Task 使用不同策略。

Design Review：

```yaml
policy:
  include:
    - requirement
    - specification
    - design
    - adr
    - review
  code: optional
```

Bug Fix：

```yaml
policy:
  include:
    - review
    - code
    - tests
    - recent_commits
  design: optional
```

Feature Implementation：

```yaml
policy:
  include:
    - requirement
    - specification
    - design
    - code
    - tests
    - adr
```

Context Policy Schema：

```typescript
interface ContextPolicy {
  maxTokens: number;
  include: ContextSourceType[];
  exclude?: ContextSourceType[];
  maxDepth: number;

  ranking: {
    relationWeight: number;
    semanticWeight: number;
    recencyWeight: number;
  };

  compression: {
    enabled: boolean;
    strategy: string;
  };
}
```

# 26. Evidence、Determinism 与 MVP 分阶段

## 26.1 Evidence

Agent 执行过程中必须产生 Evidence：

```yaml
evidence:
  - type: CODE_REFERENCE
    file: motion_manager.cpp
    symbol: MotionManager::execute

  - type: TEST_RESULT
    test: authority_test
    result: PASS

  - type: DESIGN_REFERENCE
    document: DES-005
    section: Control Authority
```

Evidence 让系统从「Agent 说完成」升级为「Agent 提供可验证证据」。

## 26.2 Determinism

对于相同的 `Task + Repository Commit + Document Version + Context Policy`，Context Builder 应尽量输出一致结果，以支持：Debug、Replay、Evaluation、Agent Benchmark、Regression Test。

## 26.3 Context UI 建议

Agent Context 页面展示分级上下文与 Token 用量，点击 Context Item 可查看来源、相关关系、relevance 与 reason（详见第九部分）。

## 26.4 MVP 分阶段

**必须（MVP）：**

- Document / Review / Requirement / Design Context
- Source Code / Test / Git Commit Context
- Relation-based Retrieval
- Keyword Search
- Token Budget
- Context Bundle
- Context Snapshot

**第二阶段：**

- Embedding Retrieval
- Code Symbol Retrieval
- Call Graph
- Context Compression
- Relevance Ranking

**第三阶段：**

- Context Optimization
- Agent Context Evaluation
- Context Replay
- Context Benchmark
- Multi-Agent Context Sharing

## 26.5 核心结论

DES-004 的核心不是「做一个 RAG」，而是建立一个工程原则：

> **Agent 的 Context 必须成为工程对象，并且可以被查看、审计、复现和追踪。**

Robot Studio 的核心对象因此逐渐从 Prompt 转向：

```text
Task → Context → Agent Run → Evidence → Verification
```

---

# 第六部分 Agent 执行与 Harness

# 27. Harness 定义与执行状态机

## 27.1 核心问题

第五部分解决「Agent 应该看到什么」。本部分进一步解决：

> Agent 获取 Context 后，如何在受控环境中执行任务，并且让执行过程可暂停、可检查、可重试、可恢复、可验证、可追溯？

Robot Studio 不应将 Agent 当作拥有全部控制权的程序，而应通过 Harness 管理其运行。

核心原则：

> **Agent 不直接拥有工程状态机的控制权，Harness 才拥有。**

Agent 负责决定「下一步怎么做」，Harness 负责判断「是否允许这么做」。

核心链路：

```text
Task
  ↓
Context
  ↓
Plan
  ↓
Approval
  ↓
Execute
  ↓
Observe
  ↓
Evaluate
  ↓
Retry / Continue / Escalate
  ↓
Verify
  ↓
Evidence
  ↓
Resolve
```

## 27.2 Harness 定义

Agent Harness 是 Robot Studio 的运行时控制层，负责：

- 管理 Agent Run 状态
- 管理执行 Step
- 管理 Tool 权限
- 处理 Approval
- 管理 Budget
- 采集 Observation
- 运行 Evaluation
- 控制 Retry / Escalation
- 创建 Checkpoint
- 采集 Evidence
- 推动 Verification

## 27.3 Execution State Machine

```text
CREATED
   ↓
CONTEXT_READY
   ↓
PLANNING
   ↓
PLAN_REVIEW
   ↓
APPROVED
   ↓
EXECUTING
   ↓
OBSERVING
   ↓
EVALUATING
   │
   ├── CONTINUE → EXECUTING
   ├── RETRY    → EXECUTING
   ├── ESCALATE → HUMAN_REVIEW
   ├── FAILED
   └── SUCCESS
         ↓
      VERIFYING
         ↓
      COMPLETED
```

```typescript
type AgentRunStatus =
  | "CREATED" | "CONTEXT_READY" | "PLANNING" | "PLAN_REVIEW"
  | "APPROVED" | "EXECUTING" | "OBSERVING" | "EVALUATING"
  | "RETRYING" | "HUMAN_REVIEW" | "VERIFYING"
  | "COMPLETED" | "FAILED" | "CANCELLED";
```

**状态只能由 Harness 根据 State Transition Policy 修改，不能让 LLM 直接写状态。**

## 27.4 Execution Step

一个 Agent Run 由多个 Execution Step 构成：

```typescript
interface ExecutionStep {
  id: string;
  runId: string;

  type:
    | "PLAN" | "TOOL_CALL" | "CODE_CHANGE" | "TEST"
    | "OBSERVATION" | "EVALUATION" | "APPROVAL" | "VERIFICATION";

  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

  input?: any;
  output?: any;
  createdAt: string;
  completedAt?: string;
}
```

# 28. Plan First 与审批模式

## 28.1 Plan First

Agent 默认先生成结构化 Plan，不应一开始无审计地修改代码：

```text
TASK-001

Plan:
1. Inspect GlobalAuthorityManager
2. Identify direct authority acquisition in MotionManager
3. Redirect request through GlobalAuthorityManager
4. Update related tests
5. Run authority test suite
6. Verify behavior
```

## 28.2 Plan Approval 三种模式

```text
MANUAL             Plan 必须人工批准
SEMI_AUTONOMOUS    根据风险与 Policy 自动决定是否需要批准
AUTONOMOUS         Policy 允许的情况下自动继续
```

即使是 Autonomous，也不能让 Agent 自己授予自己审批权限。

# 29. Risk Policy 与 Tool Policy

## 29.1 动作风险级别

```text
LOW / MEDIUM / HIGH / CRITICAL
```

| Action | Risk |
|---|---:|
| Read file | LOW |
| Search repository | LOW |
| Run unit test | LOW |
| Modify documentation | LOW |
| Modify source code | MEDIUM |
| Modify build config | HIGH |
| Deployment config | HIGH |
| Flash robot | CRITICAL |
| Execute robot motion | CRITICAL |

## 29.2 Tool Policy

Agent 不能无限制调用 Tool：

```yaml
tool_policy:
  allowed:
    - filesystem.read
    - filesystem.search
    - git.diff
    - git.status
    - test.run

  require_approval:
    - filesystem.write
    - git.commit

  forbidden:
    - robot.motion
    - robot.flash
```

执行路径：

```text
Tool
  ↓
Policy Check
  ↓
Allowed?
  ├── YES → Execute
  ├── APPROVAL → Human
  └── DENY
```

## 29.3 Tool Execution Object

```typescript
interface ToolExecution {
  id: string;
  tool: string;
  arguments: Record<string, any>;

  policyDecision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

  result?: any;
  exitCode?: number;
  durationMs?: number;
}
```

工具执行记录必须支持审计与重放分析。

## 29.4 Agent Decision

Agent 每轮输出结构化 Decision，Harness 再决定是否执行：

```typescript
interface AgentDecision {
  action: "TOOL_CALL" | "ASK_HUMAN" | "FINISH" | "ABORT";
  reasoning?: string;
  toolCall?: {
    tool: string;
    arguments: Record<string, any>;
  };
  expectedOutcome?: string;
}
```

> `reasoning` 只用于工程说明和决策摘要，不要求系统保存模型内部不可见的思维过程。

# 30. Observe / Evaluate / Retry

## 30.1 Observe

Agent 不能只相信 Tool 的自然语言输出。Harness 必须采集可验证 Observation：

```text
Execute → Observe → Evaluate
```

例如测试执行：

```text
Run test → exit code = 1 → capture stdout/stderr
→ parse test result → Evaluate
```

Observation 模型：

```typescript
interface Observation {
  id: string;
  stepId: string;

  source: "TOOL" | "TEST" | "BUILD" | "GIT" | "RUNTIME";

  status: "PASS" | "FAIL" | "UNKNOWN";
  summary: string;
  rawReference?: string;
}
```

## 30.2 Evaluate

Evaluation 决定 Loop 下一步：

```text
Observation → Evaluator → SUCCESS / CONTINUE / RETRY / ESCALATE / FAIL
```

Evaluator 可以由规则、测试框架、静态分析、策略引擎或专用评估器组成。**模型判断只能作为输入之一，不能单独凌驾于硬约束之上。**

## 30.3 Retry Policy

```yaml
retry_policy:
  max_attempts: 3

  retryable:
    - BUILD_FAILURE
    - UNIT_TEST_FAILURE
    - LINT_FAILURE

  non_retryable:
    - PERMISSION_DENIED
    - SECURITY_POLICY
    - HARDWARE_SAFETY_STOP

  escalation_after: 2
```

完整逻辑：

```text
Failure
  ↓
Is Retryable?
  ├── No → Human Review / Failed
  └── Yes
      ↓
Attempts < Max?
  ├── No → Human Review
  └── Yes → Retry
```

## 30.4 Loop 控制原则

不要设计成 `LLM: while not done: ...`，而应由 Harness 控制：

```text
Harness:
  while policy.allows:
      observation
      agent_decision
      policy_check
      execute
      evaluate
```

因此：

> **Loop 是 Harness 的，不是 Prompt 的。**

# 31. Checkpoint / Recovery / Idempotency

## 31.1 Checkpoint

Agent Run 应支持 Checkpoint：

```text
CP-001 Context Ready
CP-002 Plan Approved
CP-003 Code Changes Created
CP-004 Build Passed
CP-005 Tests Passed
```

Checkpoint 用于恢复、审计与长任务编排。

## 31.2 Recovery

Agent / Harness 崩溃后：

```text
Load Checkpoint → Restore Context → Restore Execution State → Continue
```

Recovery 不应重复执行已经完成且不可幂等的副作用操作。

## 31.3 Idempotency

Tool 定义应声明副作用级别：

```typescript
interface ToolDefinition {
  idempotent: boolean;
  sideEffect: "NONE" | "LOCAL" | "REPOSITORY" | "REMOTE" | "HARDWARE";
}
```

以下动作需要特殊保护：git commit、push、deploy、robot flash、robot motion。

## 31.4 Human Escalation

以下情况建议进入 `HUMAN_REVIEW`：

- 权限不足
- 测试结果矛盾
- 需求冲突
- Design / ADR 冲突
- 风险过高
- Retry 达到上限
- Hardware Tool 请求
- Policy 冲突

# 32. Budget / Scope / Change Boundary / Verification / 机器人安全

## 32.1 Budget Control

```yaml
budget:
  max_tokens: 150000
  max_tool_calls: 80
  max_runtime_minutes: 30
  max_retries: 3
  max_cost_usd: 5
```

控制维度至少包括：Token Budget、Tool Call Budget、Time Budget、Retry Budget、Cost Budget。

## 32.2 Scope Control

Task 必须定义允许修改的路径范围，越界修改直接由 Policy 拒绝：

```yaml
allowed_paths:
  - src/motion/**
  - test/motion/**
```

## 32.3 Change Boundary

Agent 执行前创建 Working Tree Snapshot：

```text
Before → Agent Changes → After → Diff
```

Change 必须记录：source Run / Task / Review、before revision、resulting revision / working tree、changed files。

## 32.4 Evidence Model

```typescript
interface Evidence {
  id: string;

  type:
    | "DOCUMENT_REFERENCE" | "CODE_REFERENCE" | "TEST_RESULT"
    | "COMMIT" | "MERGE_REQUEST" | "BUILD_RESULT" | "RUNTIME_RESULT";

  source: {
    uri: string;
    location?: string;
  };

  description: string;
  agentRunId: string;
}
```

## 32.5 Verification：Self Check vs Independent Verification

**Verification 不等于 Agent 说「完成」。**

```text
Agent Test
  ↓
SELF_CHECK = PASS
  ↓
Harness Verification
  ↓
INDEPENDENT_VERIFY = PASS
```

对于重要 Review，只有**独立验证**通过后才能推动 `RESOLVED`。

Verification Policy：

```yaml
verification_policy:
  required:
    - build

  tests:
    - unit
    - integration

  independence:
    required: true

  critical_review:
    manual_approval: true
```

## 32.6 Agent Run 完整模型

```typescript
interface AgentRun {
  id: string;
  taskId: string;
  contextSnapshotId: string;
  status: AgentRunStatus;

  plan?: AgentPlan;
  steps: ExecutionStep[];
  toolExecutions: ToolExecution[];
  observations: Observation[];
  changes: string[];
  evidence: string[];
  checkpoints: string[];
  policy: HarnessPolicy;

  metrics: {
    tokens: number;
    toolCalls: number;
    durationMs: number;
    retries: number;
    cost?: number;
  };
}
```

## 32.7 Harness Policy

```typescript
interface HarnessPolicy {
  approval: ApprovalPolicy;
  tool: ToolPolicy;
  retry: RetryPolicy;
  verification: VerificationPolicy;
  budget: BudgetPolicy;
  scope: ScopePolicy;
  safety: SafetyPolicy;
}
```

Policy 应按项目 / 工作区 / Workflow / Task 级别覆盖。

## 32.8 Robot 特有扩展

机器人项目需要将 Verification 扩展到 Simulation 与 Hardware：

```text
Code Change
  ↓
Build
  ↓
Unit Test
  ↓
Simulation
  ↓
Scenario Test
  ↓
Hardware Test
```

默认策略应尽量 **Simulation First**。Hardware Tool 默认应为 `REQUIRE_APPROVAL`，涉及真实运动、刷写或危险动作时应进一步增加安全互锁。

## 32.9 本部分 MVP 范围

必须包含：

- Agent Run State Machine
- Execution Step
- Plan / Approval
- Tool Policy / Risk Policy
- Observe / Evaluate
- Retry Policy
- Checkpoint / Recovery
- Budget Control / Scope Control
- Evidence / Verification
- Robot Simulation / Hardware Safety Hook

## 32.10 核心结论

DES-005 的本质是建立一个「受控 Agent Runtime」：

```text
Agent   = Decide / Execute
Harness = Control / Observe / Evaluate / Govern
```

最终形成：

```text
Task → Context → Plan → Policy → Execution Loop → Evidence → Verification
```

这为 Workflow Orchestration（第七部分）提供运行时基础。

---

# 第七部分 Workflow 系统

# 33. 三层执行模型与 Workflow DSL 顶层模型

## 33.1 为什么需要 Workflow 层

Engineering Object（第三部分）、Document Anchor / Review Thread（第四部分）、Agent Context（第五部分）、Agent Harness（第六部分）已经形成完整链路，但如果没有 Workflow 层，系统仍然缺少一个统一机制来描述：

- 哪个对象先执行？
- 哪些步骤必须顺序执行？哪些可以并行？
- 哪些步骤需要 Human Approval？
- 哪些步骤失败后重试？
- 多 Agent 如何协作？
- 什么条件可以推动状态迁移？

Workflow 层把 Requirement → Review → Task → Context → Agent → Verification 等工程对象编排成可执行 Workflow。它不是简单的「流程图 UI」，而是**工程状态的可执行声明**：

```text
Engineering Objects
        ↓
Workflow Definition
        ↓
State Graph
        ↓
Harness Runtime
        ↓
Agent / Human / Tool
        ↓
Evidence
        ↓
Verification
```

核心原则：

> **Workflow 定义工程过程，Harness 执行单个 Agent Loop，Agent 负责局部决策。**

## 33.2 三层执行模型

```text
Layer 1 — Workflow
WHAT / WHEN / CONDITION

Layer 2 — Harness
HOW TO CONTROL EXECUTION

Layer 3 — Agent
HOW TO SOLVE THE LOCAL TASK
```

例如：

```text
Workflow:  Design Review → Implementation → Verification
Harness:   Plan → Approval → Tool → Observe → Evaluate → Retry
Agent:     Decide which code change to make
```

## 33.3 Workflow 的三条核心原则

### 原则 1：Workflow 是声明，不是 UI

Workflow 的真实数据是独立于前端画布的 DSL，UI 只是 DSL 的一种编辑器：

> **不能把 React Flow / Vue Flow 的内部 JSON 直接作为 Workflow 的长期存储格式。**

### 原则 2：Definition 与 Execution 分离

```text
Workflow Definition
  ├── Version 1
  ├── Version 2
  └── Version 3

Workflow Run
  ├── Run using Version 2
  └── Run using Version 3
```

Workflow 修改后，历史 Run 仍然必须能够还原当时使用的 Workflow Version。

### 原则 3：State 由 Engine 管理

Node 不可以自行决定整个 Workflow 的状态：

```text
Node → Result / Event → Workflow Engine → State
```

这与第六部分「Agent ≠ Harness」保持一致。

## 33.4 Workflow Definition 顶层模型

```typescript
interface WorkflowDefinition {
  id: string;
  version: number;
  name: string;
  description?: string;

  inputs?: WorkflowInput[];
  outputs?: WorkflowOutput[];

  nodes: WorkflowNode[];
  edges: WorkflowEdge[];

  policies?: WorkflowPolicy;
  metadata?: Record<string, any>;
}
```

示例：

```yaml
id: WF-ROBOT-FEATURE
version: 3
name: Robot Feature Implementation

inputs:
  - name: task_id
    type: string

nodes:
  - id: review
    type: review.check
  - id: context
    type: context.build
  - id: agent
    type: agent.execute
  - id: test
    type: test.run
  - id: verify
    type: verification.run

edges:
  - from: review
    to: context
  - from: context
    to: agent
  - from: agent
    to: test
  - from: test
    to: verify
```

# 34. 节点与边

## 34.1 Workflow Node

```typescript
interface WorkflowNode {
  id: string;
  type: string;
  name?: string;

  config?: Record<string, any>;
  inputs?: NodePort[];
  outputs?: NodePort[];

  retry?: RetryPolicy;
  timeout?: number;
  condition?: Expression;

  metadata?: Record<string, any>;
}
```

## 34.2 Node Type 分类

MVP 支持的基础类型：

| Node Type | 作用 |
|---|---|
| `start` | Workflow 起点 |
| `end` | Workflow 终点 |
| `condition` | 条件判断 |
| `parallel` | 并行执行 |
| `join` | 汇聚 |
| `loop` | 循环 |
| `human.approval` | 人工审批 |
| `agent.execute` | Agent Harness |
| `tool.execute` | Tool 调用 |
| `context.build` | 构建 Agent Context |
| `document.update` | 更新文档 |
| `review.create` | 创建 Review |
| `review.resolve` | Resolve Review |
| `test.run` | 执行测试 |
| `simulation.run` | 执行仿真 |
| `verification.run` | 验证 |
| `git.change` | Git 操作 |
| `subworkflow.execute` | 执行子 Workflow |

语义上可归为四组（与第九部分 Node Palette 对应）：

- **Control**：Start / End / Condition / Switch / Parallel / Join / Loop
- **Engineering**：Document / Review / Task / Context / Agent / Tool / Test / Simulation / Verification
- **Governance**：Human Approval / Policy Check / Escalation
- **Integration**：Webhook / Git / CI / ROS2

后续允许 Plugin 注册新的 Node Type（见第八部分）。

## 34.3 Start / End

MVP 推荐一个 Workflow 只有一个 Start，但允许多个 End，以支持：

```text
SUCCESS / FAILED / CANCELLED / ESCALATED
```

## 34.4 Edge

Edge 不只是视觉连线，而是有执行语义：

```typescript
interface WorkflowEdge {
  id: string;
  from: string;
  to: string;

  condition?: Expression;
  priority?: number;
  label?: string;
}
```

普通流程与条件分支：

```text
A ─────→ B

         ┌→ B
A → Condition
         └→ C
```

Edge 的语义标签（与第九部分 Edge Editor 对应）：

```text
PASS / FAIL / TRUE / FALSE / TIMEOUT / APPROVAL / RETRY / CANCEL
```

## 34.5 Condition Expression

MVP 不建议直接允许执行任意 JavaScript，建议使用**受限表达式语言**：

```text
result.status == "PASS"
run.retry_count < 3
review.severity == "CRITICAL"
test.coverage >= 0.8
```

```typescript
interface Expression {
  language: "expr";
  value: string;
}
```

后续可扩展 CEL / JSONata / JMESPath，但 Workflow DSL 不应绑定具体实现。**Guard 不应由 LLM 自由决定**——使用结构化数据、规则引擎与测试结果。

# 35. 控制流：Parallel / Join / Loop / Human Approval

## 35.1 Parallel

```text
          ┌→ Test A ─┐
Context ──┼→ Test B ─┼→ Join
          └→ Lint ───┘
```

```yaml
- id: validation
  type: parallel
  branches:
    - test_unit
    - test_integration
    - lint
```

运行时必须保存每个 branch 的独立状态。

## 35.2 Join

Join 用于等待并行分支，支持三种策略：

```text
ALL / ANY / QUORUM
```

```yaml
- id: join_validation
  type: join
  strategy: ALL
```

## 35.3 Loop

**Workflow Loop 与 Agent Loop 必须区分**：

```text
Workflow Loop → 控制多个 Node 的业务流程
Agent Loop    → 控制 Agent 的 Observe / Act / Evaluate
```

例如：

```text
Build → Test → Pass? ── Yes → Verify
              │
              No
              ↓
          Agent Fix → Build（循环）
```

```yaml
- id: fix_loop
  type: loop
  max_iterations: 3
```

Loop Policy——任何 Loop 都必须有边界，绝不允许默认无限循环：

```typescript
interface LoopPolicy {
  maxIterations: number;
  timeoutMs?: number;
  stopCondition?: Expression;
}
```

## 35.4 Human Approval

Human Approval 是**正式 Workflow Node**，而不是前端弹窗：

```yaml
- id: approve_plan
  type: human.approval
  config:
    role: project_owner
    timeout: 86400
```

状态：

```text
PENDING / APPROVED / REJECTED / EXPIRED / CANCELLED
```

这样 Approval 本身具有完整审计记录。

Approval Policy 可通过 Workflow Policy 决定，Workflow 不需要把所有审批逻辑硬编码到 Node：

```yaml
approval:
  mode: policy
  rules:
    - action: source.modify
      risk: high
      require: human
```

Human 是 Workflow 中的正式 Node，不是异常情况。适合的审批点：

```text
Requirement Acceptance / Design Approval / Plan Approval /
Critical Change / Hardware Action / Merge / Verification Override
```

# 36. Agent 节点、Context 节点与 Subworkflow

## 36.1 Agent Node

Agent Node 是第六部分 Harness 的入口：

```yaml
- id: implement
  type: agent.execute
  config:
    provider: codex
    harness_policy: software-dev
    task_ref: ${input.task_id}
```

**Agent Node 不直接实现 Harness Loop**，内部：

```text
agent.execute
  ↓
Agent Harness
  ↓
Plan → Approval → Execute → Observe → Evaluate
```

Agent Node Input：

```typescript
interface AgentNodeInput {
  taskRef?: string;
  contextRef?: string;

  provider?: string;
  model?: string;

  harnessPolicy?: string;
  allowedTools?: string[];
}
```

这样 Workflow 可以控制：用哪个 Agent、用哪个模型、使用什么 Context、允许什么工具、使用什么 Policy。

## 36.2 Context Node

Agent Context 应单独成为 Node：

```yaml
- id: build_context
  type: context.build
  config:
    policy: feature-implementation
```

输出 `ContextBundle` 与 `ContextSnapshot`。这样一个 Workflow 可以给多个 Agent 使用相同 Context。

## 36.3 Subworkflow

Workflow 必须支持嵌套：

```yaml
- id: verify
  type: subworkflow.execute
  config:
    workflow_id: WF-VERIFICATION
    version: 2
```

例如：

```text
Robot Feature Workflow
  ├── Requirement Workflow
  ├── Design Workflow
  ├── Implementation Workflow
  └── Verification Workflow
```

子 Workflow 有独立输入、输出和版本。由此可建立 **Workflow Library**：

```text
Common Workflows
├── Code Review
├── Feature Implementation
├── Bug Fix
├── Documentation Update
├── ROS Package Build
├── Simulation Verification
└── Release Validation
```

团队不需要重复实现。

# 37. Workflow 运行时：Run / NodeRun / Event / ExecutionContext / Artifact

## 37.1 Workflow Run

Workflow Definition 执行以后形成 Workflow Run：

```typescript
interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;

  status: WorkflowRunStatus;

  inputs: Record<string, any>;
  outputs?: Record<string, any>;

  nodeRuns: NodeRun[];

  startedAt: string;
  completedAt?: string;
}

type WorkflowRunStatus =
  | "CREATED" | "RUNNING" | "PAUSED" | "WAITING_APPROVAL"
  | "FAILED" | "CANCELLED" | "COMPLETED";
```

## 37.2 NodeRun

Definition 中的 Node 在 Runtime 中对应 NodeRun：

```typescript
interface NodeRun {
  id: string;
  runId: string;
  nodeId: string;

  status: NodeRunStatus;

  input?: Record<string, any>;
  output?: Record<string, any>;

  attempts: number;
  startedAt?: string;
  completedAt?: string;
  error?: ExecutionError;
}
```

## 37.3 Event Model

Workflow Engine 不应只保存最终状态，还应记录事件：

```text
WorkflowCreated / NodeStarted / ToolCalled / ToolCompleted /
ApprovalRequested / ApprovalGranted / NodeFailed / NodeRetried /
NodeCompleted / WorkflowPaused / WorkflowResumed / WorkflowCompleted
```

```typescript
interface WorkflowEvent {
  id: string;
  runId: string;
  type: string;
  timestamp: string;
  actor: EventActor;
  payload: Record<string, any>;
}
```

**Event Sourcing 倾向**：MVP 不要求完整 Event Sourcing，但设计应保留事件日志——`Current State + Immutable Event Log`，支持 Debug、Replay、Audit、Metrics、Timeline。

## 37.4 状态迁移与 Guard

状态迁移必须具有明确的 Trigger 和 Guard：

```typescript
interface Transition {
  from: string;
  to: string;

  trigger: "EVENT" | "RESULT" | "HUMAN_ACTION" | "TIMEOUT";
  guard?: Expression;
  actions?: Action[];
}
```

例如：

```yaml
- from: TEST
  to: IMPLEMENT
  trigger: RESULT
  guard: test.failed && retry.count < 3
```

Guard 示例：

```text
review.accepted
plan.approved
build.passed
coverage >= 80
simulation.passed
risk.level < CRITICAL
```

Workflow 通过 Event 驱动状态变化，例如：

```text
REVIEW_ACCEPTED / PLAN_APPROVED / AGENT_COMPLETED / TEST_PASSED /
TEST_FAILED / VERIFICATION_PASSED / HUMAN_APPROVED / TIMEOUT
```

```typescript
interface WorkflowEvent {
  id: string;
  type: string;
  workflowRunId: string;
  source: {
    type: "USER" | "AGENT" | "TOOL" | "TEST" | "SYSTEM";
    id?: string;
  };
  payload: Record<string, any>;
  timestamp: string;
}
```

## 37.5 ExecutionContext 与变量引用

```typescript
interface ExecutionContext {
  workflowRunId: string;
  variables: Record<string, any>;
  nodeOutputs: Record<string, any>;
  artifacts: ArtifactRef[];
  evidence: EvidenceRef[];
}
```

引用语法示例：

```text
${nodes.build.output.commit_sha}
${nodes.test.output.status}
${workflow.inputs.task_id}
```

## 37.6 Artifact

Node 输出可能不是 JSON，而是文件（build.log、coverage.xml、patch.diff、simulation-result.json、screenshot.png），统一为：

```typescript
interface ArtifactRef {
  id: string;
  name: string;
  uri: string;
  type?: string;
  checksum?: string;
}
```

## 37.7 Workflow 与对象的关系

Workflow 中产生的主要 Artifact：

```text
Requirement / Design / Review / Task / Context Snapshot / Agent Run /
Plan / Change / Commit / Test Result / Evidence / Verification / MR
```

Workflow 不复制这些对象，而是**通过引用进行编排**。

# 38. 可靠性：Retry / Timeout / Compensation / Pause / Resume / Cancel / Replay

## 38.1 Retry 与 Timeout

Node 自带 Retry Policy：

```yaml
retry:
  max_attempts: 3
  strategy: exponential
  retry_on:
    - TRANSIENT_ERROR
    - TEST_FAILURE
```

必须注意 **Workflow Retry 与 Agent Retry 是两级机制**：

```text
Workflow Retry → 重新运行整个 Node
Agent Retry    → Agent Harness 内部继续修复
```

失败处理分层：

```text
Agent Step Failure
  ↓
Harness Retry
  ↓
仍失败
  ↓
Node Failure
  ↓
Workflow Retry / Human Review / Abort
```

例如测试失败 2 次属于 Harness 层重试；连续失败达到 Workflow Policy 上限后，再推动 Workflow 层升级。

所有可执行 Node 都应支持 Timeout：

```yaml
timeout:
  seconds: 1800
```

超时后进入 `TIMEOUT → Retry / Escalate / Fail`。

## 38.2 Compensation

对于具有外部副作用的 Node，应定义 Compensation（例如 Deploy 失败 → Rollback）：

```typescript
interface CompensationAction {
  nodeType: string;
  config: Record<string, any>;
}
```

MVP 可只支持：Git reset、Artifact cleanup、Deployment rollback。

> 机器人场景需要特别谨慎：硬件动作不应依赖普通的自动 Compensation，而应使用专门的安全控制系统。

## 38.3 Pause / Resume

Workflow 可以在任意安全边界暂停。暂停时必须保存：

```text
Workflow State / Node State / Execution Context /
Pending Approval / Artifacts / Event Offset
```

## 38.4 Cancellation

取消不是简单 kill process：

```text
CANCEL_REQUESTED
  ↓
Stop Scheduling
  ↓
Cancel Running Node
  ↓
Compensation
  ↓
CANCELLED
```

对有副作用的 Node 必须调用 Compensation。

## 38.5 Deterministic Replay

对于非外部副作用的 Workflow，尽量支持 Replay：

```text
Workflow Version + Input + Execution Event + Node Output
→ 重建 Workflow Timeline
```

这对 Agent Debug 和 Regression 非常重要。

# 39. 版本化与验证

## 39.1 Workflow Versioning

Workflow 不能直接覆盖运行版本：

```text
WF-001
  ├── v1
  ├── v2
  └── v3
```

一个 Run 必须永久绑定 `workflow_id + workflow_version`，这样历史 Run 可以重放与审计。

## 39.2 Draft / Published 状态

```text
DRAFT → VALIDATED → PUBLISHED → DEPRECATED
```

只有 Published Version 可以用于 Production Run。

## 39.3 Workflow Validation

发布之前必须做静态检查：

```text
Schema Validation
Graph Validation
Reference Validation
Policy Validation
Security Validation
```

例如检查：

```text
Start 是否存在？
是否存在孤立 Node？
Edge 是否指向不存在 Node？
Loop 是否有上限？
Tool 是否已注册？
Provider 是否存在？
Approval 是否满足策略？
```

## 39.4 Capability Registry 与 Node Schema Registry

DES-008 的 Plugin SDK 向 Workflow Engine 注册 Node Type、Tool、Provider、Agent Runtime、Expression Function。例如：

```text
agent.execute      → CodexProvider
simulation.run     → GazeboPlugin
ros2.call_service  → ROS2Plugin
```

Workflow DSL 不需要知道具体实现。

Node Schema Registry：

```typescript
interface NodeTypeDefinition {
  type: string;
  version: string;

  inputs: PortSchema[];
  outputs: PortSchema[];
  configSchema: JSONSchema;

  executor: string;
}
```

前端 Workflow Designer 可以通过 Registry 动态生成 Node 配置表单。这意味着：

> **Plugin 安装一个新的 Node 后，Workflow Designer 不需要重新发版才能显示它。**

## 39.5 Workflow UI 与 Runtime 解耦

前端只负责：编辑、校验、可视化、提交、发布、监控。
Engine 负责：解释、调度、执行、状态、重试、恢复。

UI 可以有额外的 Layout Metadata，但这些信息不应影响 Workflow Semantic Model：

```yaml
ui:
  layout:
    start:
      x: 120
      y: 100
```

推荐分离存储（`workflow.yaml` 与 `workflow.ui.yaml`），或同文件内 `workflow:` 与 `ui:` 分区。

# 40. 多 Agent 协作与 Workflow/Harness/Agent 边界

## 40.1 Parallel / Multi-Agent

Workflow 支持并行分支：

```text
                 ┌→ Agent A → Test A ─┐
Task ────────────┼→ Agent B → Review ─┼→ JOIN → Verify
                 └→ Agent C → Sim ───┘
```

适用于：多方案实现、独立代码分析、测试与静态分析并行、文档与代码并行更新、Reviewer Agent 与 Implementer Agent 分工。

DSL 天然支持多 Agent，最后由一个 Aggregator Node 汇总结果。

## 40.2 Agent Role

建议 Agent 通过 **Role** 参与 Workflow，而不是直接绑定某个具体产品：

```text
RESEARCHER / DESIGNER / IMPLEMENTER / TESTER /
REVIEWER / VERIFIER / RELEASE_MANAGER
```

```yaml
agent_role:
  id: IMPLEMENTER
  capabilities:
    - code.edit
    - test.run
```

实际执行时，再将 Role 映射到 Codex、Claude Code、OpenClaw、Hermes 或其他 Runtime。未来可以按 Role 映射不同模型（Architect → reasoning model、Implementation → coding model、Reviewer → review model），但 Workflow 不应强绑定模型。

## 40.3 多 Agent 协作原则

多 Agent 不应共享不可控的 Workspace：

```text
Workflow
  ↓
Task A → Workspace A
Task B → Workspace B
Task C → Workspace C
  ↓
Artifacts
  ↓
Review / Merge
```

对于代码修改，可使用独立 Git Worktree / Branch。

## 40.4 Workflow / Harness / Agent 边界（职责表）

### Workflow 负责

```text
Node ordering / Parallelism / Conditions / Human checkpoints /
Sub-workflow / Business process
```

### Harness 负责

```text
Agent plan / Tool control / Risk policy / Execution loop /
Retry / Budget / Observe / Evaluate / Checkpoint / Evidence
```

### Agent 负责

```text
Local reasoning / Plan proposal / Tool selection proposal /
Local implementation decisions
```

## 40.5 Policy 与 Workflow 的关系

两者必须区分：

```text
Workflow = 流程应该怎么走
Policy   = 某个动作是否允许
```

例如：

```text
Workflow: IMPLEMENT → HARDWARE_TEST
Policy:   HARDWARE_TEST requires human approval
```

因此 **Workflow 不能绕过 Harness Policy**。

## 40.6 Workflow Policy

```typescript
interface WorkflowPolicy {
  approval?: ApprovalPolicy;
  security?: SecurityPolicy;
  timeout?: TimeoutPolicy;
  retry?: RetryPolicy;
  budget?: BudgetPolicy;
  executionMode?: "MANUAL" | "SEMI_AUTONOMOUS" | "AUTONOMOUS";
}
```

# 41. Workflow 评估、可观测性与完整示例

## 41.1 Workflow Observability

UI 不仅要展示 Workflow 图，还应该展示实时状态：

```text
┌─────────────────────────────────────────────┐
│ Robot Feature Workflow                      │
├─────────────────────────────────────────────┤
│ ✓ Review                                    │
│ ✓ Context                                   │
│ ✓ Plan                                      │
│ ✓ Approval                                  │
│ ● Implementation   [Agent Run #17]          │
│ ○ Unit Test                                 │
│ ○ Simulation                                │
│ ○ Verification                              │
│ ○ Merge                                     │
└─────────────────────────────────────────────┘
```

节点点击后查看对应 Agent Run、Evidence、Change 和日志。

## 41.2 Workflow Evaluation

Workflow 本身也应该被评价，指标包括：

```text
Task Success Rate / Average Retry Count / Workflow Duration /
Human Intervention Rate / Verification Pass Rate / Agent Cost /
Context Efficiency / Failure Hotspots
```

这使 Robot Studio 可以持续优化 Workflow，而不是只优化模型 Prompt。

## 41.3 Workflow Benchmark

长期建立标准任务集，比较对象不只是模型，而包括：

```text
Context Policy / Harness Policy / Workflow Definition /
Agent Role / Verification Strategy
```

```text
Task Dataset → Workflow v1 → Execution → Metrics → Workflow v2 → Compare
```

## 41.4 完整 Workflow 示例（WF-001 Feature Implementation）

```yaml
id: WF-001
version: 1
name: Feature Implementation

inputs:
  - name: task_id
    type: string

nodes:
  - id: start
    type: start

  - id: context
    type: context.build
    config:
      policy: feature-implementation

  - id: plan
    type: agent.execute
    config:
      mode: plan

  - id: approval
    type: human.approval

  - id: implement
    type: agent.execute
    config:
      mode: execute
      provider: codex

  - id: test
    type: test.run
    config:
      command: colcon test

  - id: check
    type: condition
    config:
      expression: "${nodes.test.output.status} == 'PASS'"

  - id: verify
    type: verification.run

  - id: resolve
    type: review.resolve

  - id: end
    type: end

edges:
  - from: start
    to: context
  - from: context
    to: plan
  - from: plan
    to: approval
  - from: approval
    to: implement
  - from: implement
    to: test
  - from: test
    to: check
  - from: check
    to: verify
    condition: "${nodes.test.output.status} == 'PASS'"
  - from: check
    to: implement
    condition: "${nodes.test.output.status} != 'PASS'"
  - from: verify
    to: resolve
  - from: resolve
    to: end
```

## 41.5 Robot Feature Workflow 示例（含 Role）

```yaml
workflow:
  id: ROBOT-FEATURE-IMPLEMENTATION
  version: 1

  inputs:
    - requirement
    - review

  nodes:
    - id: review
      type: HUMAN_REVIEW
    - id: context
      type: CONTEXT_BUILD
    - id: plan
      type: AGENT_PLAN
      role: DESIGNER
    - id: plan_approval
      type: HUMAN_REVIEW
    - id: implementation
      type: AGENT_TASK
      role: IMPLEMENTER
    - id: unit_test
      type: TEST
    - id: simulation
      type: SIMULATION
    - id: verification
      type: VERIFICATION
      role: VERIFIER
    - id: merge
      type: HUMAN_REVIEW
```

流程：

```text
Review → Context → Plan → Human Approval → Implementation
→ Unit Test → Simulation → Verification → Merge
```

## 41.6 Execution Timeline（来自 Workflow Event）

```text
15:02 Workflow Started
15:02 Context Ready
15:03 Agent Planning
15:04 Approval Granted
15:05 Agent Executing
15:08 Build Passed
15:09 Unit Test Failed
15:10 Agent Retry
15:13 Unit Test Passed
15:15 Verification Passed
15:15 Review Resolved
```

# 42. Workflow Runtime 架构与接口

## 42.1 Runtime Architecture

```text
                    Workflow Engine
┌─────────────────────────────────────────────┐
│ Definition Parser                           │
│ State Graph                                 │
│ Event Bus                                   │
│ Condition / Guard Engine                    │
│ Scheduler                                   │
│ Run State Store                             │
└────────────────────┬────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      Harness      Human       Tool
          │
          ▼
        Agent
          │
          ▼
    Evidence / Artifact
          │
          ▼
     Verification
```

## 42.2 WorkflowEngine 接口

```typescript
interface WorkflowEngine {
  createRun(
    workflowId: string,
    version: number,
    inputs: Record<string, any>
  ): Promise<WorkflowRun>;

  dispatch(runId: string, event: WorkflowEvent): Promise<void>;

  pause(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;

  getState(runId: string): Promise<WorkflowRun>;
}
```

## 42.3 Workflow as Code / Workflow as Data

推荐双层模式：

```text
Canonical Workflow Definition
          ↓
      YAML / JSON
          ↓
   Workflow Runtime
          ↑
    Visual Editor
```

即：**UI 是 Workflow 的可视化编辑器，DSL / YAML 是可版本控制、可评审、可自动生成的工程源文件。** 这样可以满足 Document-Driven Engineering 的核心理念。

## 42.4 Workflow Context 分发

Workflow 具有全局 Context，但不同 Node 可以得到不同子 Context：

```text
Workflow Context
  ↓
Node Context Policy
  ↓
Node Context
  ↓
Agent / Test / Tool
```

例如 Feature Workflow：

```text
Review Node        → Document + Review Context
Implementation Node → Code + Design + Test Context
Verification Node  → Change + Test + Requirement Context
```

## 42.5 核心运行时对象汇总

到本部分为止，核心运行时对象已经比较完整：

```text
WorkflowDefinition / WorkflowVersion / WorkflowRun / WorkflowNode /
NodeRun / WorkflowEvent / ExecutionContext / Artifact /
AgentRun / ContextSnapshot / Evidence / Verification
```

## 42.6 本部分 MVP 范围

### MUST（MVP）

- Workflow DSL
- Node / Edge
- Start / End
- Condition
- Agent Node / Tool Node / Context Node
- Human Approval
- Test Node / Verification Node
- Retry / Timeout
- Workflow Version / Workflow Validation
- Workflow Run / Node Run
- Event Timeline
- Pause / Resume
- 与 Harness 集成
- Traceability

### SHOULD（第二阶段）

- Parallel / Join
- Loop
- Subworkflow
- Artifact
- Compensation
- Multi-Agent
- Worktree Isolation
- Workflow Visual Editor（完整版）
- Workflow Replay

### LATER（第三阶段）

- Visual Workflow Marketplace
- Dynamic Workflow Optimization
- Learned Workflow Policy
- Autonomous Workflow Generation
- Workflow Benchmark
- Workflow-to-Code Compilation
- Workflow Optimization / Auto Policy Tuning / Cost Optimization
- Multi-robot Fleet Workflow / Long-running / Distributed Workflow

---

# 第八部分 插件与 Provider 体系

# 43. 扩展模型与 Plugin 生命周期

## 43.1 背景

第二部分的模块边界定义了 Robot Studio Core，但平台不应该把 GitLab、Codex、Claude Code、OpenClaw、Dify、ROS2、CI、Simulation 等能力全部硬编码在核心系统中。因此需要建立统一的：

- Plugin SDK
- Provider SDK
- Tool SDK
- Workflow Node SDK
- Agent Runtime Adapter
- Event / Hook Model

核心目标：

> **Robot Studio Core 负责工程模型、治理、Workflow、Harness 与 Traceability；外部系统通过标准 Provider / Plugin Contract 接入。**

## 43.2 核心架构

```text
                    Robot Studio Core
┌──────────────────────────────────────────────────┐
│ Engineering Model                                │
│ Document / Review / Task / Context / Trace       │
│ Workflow Engine / Harness / Policy               │
└──────────────────────┬───────────────────────────┘
                       │ SDK Contract
          ┌────────────┼────────────┐
          │            │            │
      Provider       Tool        Workflow Node
          │            │            │
 ┌────────┼──────┐     │     ┌─────┼─────────┐
 │        │      │     │     │     │         │
GitLab  Agent   CI   Shell  ROS2  Sim      Test
Codex   Claude
OpenClaw
Dify
```

## 43.3 Extension Types

Robot Studio 将扩展划分为五类：

| 类型 | 职责 |
|---|---|
| Provider | 接入外部系统或服务 |
| Tool | 提供可被 Agent / Workflow 调用的动作 |
| Workflow Node | 提供 Workflow 中的业务节点 |
| Agent Runtime | 接入 Coding Agent / Agent Engine |
| UI Extension | 扩展 Web UI / Panel / Tab |

一个 Plugin 可以同时包含多种扩展。例如：

```text
GitLab Plugin
 ├── Git Provider
 ├── MR Tool
 ├── Commit Tool
 ├── Repository Browser
 └── GitLab UI Extension
```

## 43.4 Plugin 生命周期

```text
Discover → Install → Enable → Initialize → Register
→ Running → Disable → Uninstall
```

Plugin 必须声明：

```yaml
id: robotstudio.gitlab
name: GitLab Integration
version: 1.0.0
apiVersion: v1
permissions:
  - repository.read
  - repository.write
  - merge_request.read
  - merge_request.write
```

## 43.5 Plugin Manifest

```yaml
apiVersion: robotstudio.dev/v1
kind: Plugin
metadata:
  id: robotstudio.gitlab
  name: GitLab Integration
  version: 1.0.0

spec:
  providers:
    - git
    - review

  tools:
    - gitlab.search_code
    - gitlab.create_mr

  workflowNodes:
    - gitlab.create_mr

  ui:
    panels:
      - merge-request

  permissions:
    - repository.read
    - merge_request.read
    - merge_request.write
```

# 44. Provider 契约

## 44.1 Provider 基础模型

Provider 表示一个外部系统的能力入口：

```typescript
interface Provider {
  id: string;
  type: string;
  version: string;

  initialize(context: ProviderContext): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;
}
```

Provider 不直接暴露所有底层 API，而是通过标准能力接口暴露功能。

## 44.2 Git Provider

```typescript
interface GitProvider extends Provider {
  getRepository(id: string): Promise<Repository>;
  getFile(ref: FileRef): Promise<FileContent>;
  getCommit(ref: CommitRef): Promise<Commit>;
  getDiff(ref: DiffRef): Promise<Diff>;
  createCommit(input: CommitInput): Promise<Commit>;
  createMergeRequest(input: MergeRequestInput): Promise<MergeRequest>;
}
```

这样核心系统无需关心 GitLab / GitHub / Gitea / Bitbucket 之间的 API 差异。

## 44.3 Agent Runtime Provider

Agent Runtime 是特别重要的一类 Provider：

```typescript
interface AgentRuntimeProvider extends Provider {
  createSession(input: AgentSessionInput): Promise<AgentSession>;
  run(input: AgentExecutionInput): Promise<AgentExecutionResult>;
  interrupt(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
}
```

可接入：Codex、Claude Code、OpenClaw、Hermes、Dify、自研 Agent。

**Agent Adapter 原则**：Robot Studio 不应该把某个 Agent 的 Prompt、命令行参数和目录结构直接散落在业务代码中：

```text
AgentRuntimeProvider
        ↓
Normalized Agent API
        ↓
Harness
```

例如无论底层是 CLI 还是 API，核心只看到：

```text
createSession / sendInstruction / observe / interrupt / resume / collectResult
```

Adapter 层统一支持两类 Agent：

- **Interactive Agent**（Claude Code、Codex）：Session、Streaming、Tool execution、Interactive approval。
- **Service Agent**（Dify、Custom API Agent）：Request、Response、Workflow API。

Agent Adapter 屏蔽两者差异。

## 44.4 ROS2 Provider

由于 Robot Studio 面向机器人，ROS2 应作为正式 Provider：

```typescript
interface ROS2Provider extends Provider {
  listNodes(): Promise<ROSNode[]>;
  listTopics(): Promise<ROSTopic[]>;
  listServices(): Promise<ROSService[]>;

  callService(input: ServiceCall): Promise<ServiceResult>;
  publish(input: PublishRequest): Promise<void>;

  getNodeInfo(node: string): Promise<ROSNodeInfo>;
}
```

**ROS2 集成原则**：Robot Studio 不把 ROS2 直接嵌入核心领域层，采用 `Robot Studio Core → Robot Provider → ROS2 Adapter`。ROS2 Adapter 可以运行 ros2 CLI、ROS2 Python、ROS2 C++、DDS API，这样 Core 仍然保持与机器人中间件解耦。

ROS2 Tool 可注册：

```text
ros2.topic.echo / ros2.topic.publish / ros2.service.call /
ros2.node.info / ros2.lifecycle.transition / ros2.param.get / ros2.param.set
```

但高风险 Tool 仍然必须经过 Harness Policy。例如 `ros2.service.call` 本身不一定是危险动作，具体风险由 `service + arguments + environment` 共同决定。

## 44.5 Simulation Provider

统一 Simulation API：

```typescript
interface SimulationProvider extends Provider {
  createScenario(input: ScenarioInput): Promise<Scenario>;
  start(scenarioId: string): Promise<Run>;
  stop(runId: string): Promise<void>;
  getState(runId: string): Promise<SimulationState>;
  collectArtifacts(runId: string): Promise<Artifact[]>;
}
```

可接：Gazebo、Isaac Sim、Webots、MuJoCo、自研仿真环境。

## 44.6 Test Provider 与 CI Provider

```typescript
interface TestProvider extends Provider {
  discover(scope: TestScope): Promise<TestCase[]>;
  run(input: TestRunInput): Promise<TestRun>;
  getResult(runId: string): Promise<TestResult>;
}
```

测试结果必须转换成 Robot Studio 的标准 Evidence。

CI Provider 负责 Pipeline、Job、Artifact、Status、Log：

```typescript
interface CIProvider extends Provider {
  triggerPipeline(input: PipelineInput): Promise<PipelineRun>;
  getPipeline(id: string): Promise<PipelineRun>;
  getJobLog(id: string): Promise<string>;
  getArtifacts(id: string): Promise<Artifact[]>;
}
```

# 45. Tool 模型与安全

## 45.1 Tool 模型

Tool 是实际产生动作的最小执行单位：

```typescript
interface Tool<TInput = unknown, TOutput = unknown> {
  id: string;
  version: string;

  inputSchema: JSONSchema;
  outputSchema: JSONSchema;

  risk: RiskLevel;
  sideEffect: SideEffectLevel;

  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}
```

## 45.2 Tool Policy：插件无权绕过 Policy Engine

Tool 必须通过 Harness Policy：

```text
Agent Decision
      ↓
Tool Request
      ↓
Policy Engine
   ┌──┼─────┐
Allow     Approval    Deny
  │          │          │
Execute    Human       Reject
```

**Plugin 无权绕过 Policy Engine——这是插件体系的重要安全边界。**

Harness 是所有 Tool 的统一安全入口：

```text
Plugin Tool
  ↓
Tool Registry
  ↓
Harness Policy
  ↓
Execution
  ↓
Observation
  ↓
Evidence
```

Plugin Tool 不允许：绕过 Harness 直接执行、自行修改 Workflow State、自行写入 Verification Result。

## 45.3 Tool Risk Declaration

```yaml
id: robot.motion.execute
risk: CRITICAL
sideEffect: HARDWARE
requiresApproval: true
idempotent: false
```

典型副作用等级：

```text
NONE / LOCAL / REPOSITORY / REMOTE / HARDWARE
```

## 45.4 Workflow Node SDK

Workflow Node 是一个可编排的业务步骤：

```typescript
interface WorkflowNode {
  id: string;
  version: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;

  execute(
    input: WorkflowInput,
    context: WorkflowContext
  ): Promise<WorkflowOutput>;
}
```

例如：LoadContext、AgentPlan、HumanApproval、AgentExecute、RunTests、Evaluate、CreateMR、WaitForReview、Merge。

**Agent 不是 Workflow Node**——应明确区分：

```text
Workflow Node → 调用 Agent Runtime → Agent Harness → Agent
```

即：**Agent 是执行器；Workflow Node 是流程中的控制点。**

## 45.5 Event / Hook Model

插件不应该只能被主动调用，也需要事件驱动。统一 Event Bus：

```text
DocumentUpdated / ReviewCreated / ReviewAccepted / TaskCreated /
AgentRunStarted / ToolExecuted / TestCompleted /
VerificationPassed / MergeRequestCreated
```

```typescript
interface Event {
  id: string;
  type: string;
  timestamp: string;
  source: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}
```

Plugin 可以订阅 Hook：

```text
beforeTaskCreate / beforeAgentRun / beforeToolExecute /
afterToolExecute / beforeVerification / afterVerification
```

但 Hook 不能绕开安全策略。

## 45.6 UI Extension

Robot Studio 支持 Plugin UI Extension，可扩展：

```text
Document Page / Review Page / Task Page / Agent Page / Repository Page
```

例如 GitLab Plugin：MR Tab、Commit Panel、Pipeline Panel；Agent Plugin：Agent Session、Agent Config、Execution Timeline。

UI Extension 原则：**UI Plugin 不应该直接访问数据库**：

```text
UI Extension → Plugin API → Robot Studio API
```

避免插件把核心领域模型绑死到前端实现。

# 46. Capability Registry 与集成点

## 46.1 Capability Discovery

Robot Studio 启动时发现所有 Plugin 能力：

```text
Plugin Registry
  ↓
Capability Registry
  ↓
Workflow Designer / Agent Tool Selector / Context Builder
```

例如：

```yaml
capability:
  id: gitlab.create_merge_request
  type: TOOL
  provider: robotstudio.gitlab
  risk: MEDIUM
```

```typescript
interface CapabilityDescriptor {
  id: string;
  type: "PROVIDER" | "TOOL" | "NODE" | "AGENT";
  providerId: string;
  version: string;

  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;

  risk?: RiskLevel;
  permissions?: string[];
}
```

这会成为 Workflow Designer 的基础。

## 46.2 Plugin 与 Workflow Designer

Workflow Designer 不硬编码 Node 列表，而是：

```text
Capability Registry → Workflow Node Catalog → Drag & Drop
```

## 46.3 Plugin 与 Context Builder

Context Builder 同样通过 Capability Registry 查找数据源：

```text
Git Provider       → Code / Commit / MR
ROS2 Provider      → Node / Topic / Service / Parameter
Simulation Provider → Scenario / Run / Artifact
```

这样 Context Engine 可以逐步扩展，而无需修改核心算法。

## 46.4 Plugin 与工程对象 / Traceability

Plugin 产生的外部对象必须映射到 Engineering Object：

```text
GitLab MR      → MERGE_REQUEST
CI Pipeline    → TEST_RUN
Agent Session  → AGENT_RUN
ROS Run        → 对应 Engineering Object
```

这样 Traceability 无需为每种外部系统写独立逻辑。

External Object Adapter：

```typescript
interface ExternalObjectAdapter<T> {
  toEngineeringObject(input: T): EngineeringObject;
  getExternalUri(object: EngineeringObject): string;
  sync(object: EngineeringObject): Promise<void>;
}
```

外部事件也必须能进入 Traceability：

```text
GitLab MR merged → MR Event → Engineering Event
→ Traceability Update → Task / Review / Verification
```

# 47. 版本兼容、Secret、Permission 与 Sandbox

## 47.1 Version Compatibility

Plugin 与 Core 之间必须有 API Version：

```yaml
apiVersion: robotstudio.dev/v1
```

兼容策略：

```text
Major → 不保证兼容
Minor → 向后兼容
Patch → Bug Fix
```

Plugin Manifest 中声明：

```yaml
requires:
  robotstudio:
    minVersion: 0.5.0
    maxVersion: <1.0.0
```

## 47.2 Secret Management

Plugin 不允许直接保存 API Key、Access Token、SSH Private Key、Password，而使用 Secret Reference：

```yaml
credentialRef: secret://gitlab/robotstudio
```

Secret 实际存储由 Core Secret Manager 管理。

## 47.3 Permission Model

推荐四层：

```text
Plugin Permission
  ↓
Provider Permission
  ↓
Tool Permission
  ↓
Resource Scope
```

例如：

```text
GitLab Plugin
  ↓
repository.write
  ↓
gitlab.create_commit
  ↓
project=robot-control
```

## 47.4 Multi-Tenant / Project Scope

即使第一版是单用户本地部署，也建议保留 Project Scope：

```text
Organization
  └── Project
      ├── Repository
      ├── Agent
      ├── Plugin
      ├── Workflow
      └── Policy
```

这样未来可以支持团队协作。

## 47.5 Plugin Sandbox 与 Remote Plugin

高风险 Plugin 应运行在隔离环境，推荐分级：

```text
Trusted Plugin → Sandboxed Plugin → Remote Plugin
```

MVP 可以先采用 Trusted Plugin，但 SDK 必须预留 Sandbox Contract。

未来可允许 `Robot Studio → Plugin RPC → Remote Service`，例如企业内部的 Simulation Service、Hardware Lab Service、CI Farm、Model Gateway 都可以作为 Remote Provider。

## 47.6 SDK 包与开发体验

推荐目录：

```text
plugin/
├── manifest.yaml
├── package.json
├── src/
│   ├── provider.ts
│   ├── tools/
│   ├── workflow-nodes/
│   ├── hooks/
│   └── ui/
├── schemas/
└── tests/
```

SDK 核心包建议拆分（MVP 阶段可暂时合并为单一 SDK）：

```text
@robotstudio/sdk
@robotstudio/plugin-sdk
@robotstudio/workflow-sdk
@robotstudio/agent-sdk
@robotstudio/tool-sdk
@robotstudio/ui-sdk
```

理想开发体验：

```bash
robotstudio plugin create gitlab
robotstudio plugin dev
robotstudio plugin test
robotstudio plugin build
robotstudio plugin install ./dist
```

开发者只需要实现 Contract，而不需要理解 Core 内部实现。

## 47.7 官方示例

**GitLab Plugin：**

```text
Provider:        gitlab
Tools:           gitlab.search_code / gitlab.get_file /
                 gitlab.create_commit / gitlab.create_mr
Workflow Nodes:  gitlab.create_mr / gitlab.wait_pipeline
UI:              RepositoryPanel / MergeRequestPanel
```

**Codex Plugin：**

```text
Provider:        codex.agent
Agent Runtime:   codex.runtime
Tools:           codex.start_session / codex.interrupt / codex.resume
UI:              AgentConsole
```

Robot Studio Core 无需知道 Codex 的内部协议。

**ROS2 Plugin：**

```text
Provider:        ros2
Tools:           ros2.topic.echo / ros2.service.call /
                 ros2.param.get / ros2.param.set
Workflow Nodes:  ros2.wait_for_topic / ros2.call_service /
                 ros2.lifecycle_transition
UI:              NodeGraph / TopicInspector / ServiceInspector
```

# 48. 错误模型、可观测性与 MVP 插件集合

## 48.1 Observability

每一个 Plugin / Provider / Tool 都必须记录：

```text
Invocation ID / Correlation ID / Duration / Status / Error /
Provider / Tool / User / Agent
```

```typescript
interface InvocationRecord {
  id: string;
  correlationId?: string;
  providerId: string;
  capabilityId: string;
  actor: Actor;
  status: "SUCCESS" | "FAILED" | "DENIED";
  durationMs: number;
  error?: string;
}
```

## 48.2 Error Model

Plugin 错误不能直接把底层异常暴露给 Workflow，统一为：

```typescript
interface ProviderError {
  code: string;
  message: string;
  retryable: boolean;
  category:
    | "AUTH" | "NETWORK" | "RATE_LIMIT" | "VALIDATION"
    | "NOT_FOUND" | "CONFLICT" | "INTERNAL";
}
```

Harness 可以据此决定是否 Retry。

## 48.3 Retry Contract

Provider 可以声明：

```typescript
interface RetryHint {
  retryable: boolean;
  backoffMs?: number;
  maxAttempts?: number;
}
```

但最终 Retry 仍由 Harness Policy 决定：

> **Provider 提供建议，Harness 拥有最终决策权。**

## 48.4 MVP 插件集合

第一阶段只实现：

```text
1. GitLab Plugin
2. Local Git Plugin
3. Codex Agent Plugin
4. Claude Code Agent Plugin
5. Shell / Filesystem Tool Plugin
6. Test / CI Plugin
7. ROS2 Plugin
```

OpenClaw / Dify / Simulation 可以作为第二阶段接入。

## 48.5 实现方式

MVP 不建议一开始做复杂的动态进程级插件系统：

```text
Modular Monolith → Plugin Registry → In-process Plugins
```

需要隔离时再增加 Remote Plugin RPC。这样可以显著降低第一版复杂度。

## 48.6 核心边界总结

```text
Core
  ├── Engineering Model
  ├── Workflow Engine
  ├── Harness
  ├── Policy
  ├── Context Engine
  └── Traceability

Plugin SDK
  ├── Provider
  ├── Tool
  ├── Workflow Node
  ├── Agent Runtime
  ├── Event / Hook
  └── UI Extension

External Systems
  ├── GitLab
  ├── Codex / Claude Code / OpenClaw / Dify
  ├── ROS2
  ├── CI
  └── Simulation
```

## 48.7 最重要的五条设计原则

1. **Core 不绑定具体厂商**：`Core → Contract，Plugin → Vendor`。
2. **所有动作进入 Harness**：`Tool → Harness → Policy → Execute`。
3. **外部对象统一映射 Engineering Object**：MR / Pipeline / Agent Run / ROS Run → Engineering Object。
4. **Workflow 只依赖 Capability**：`Workflow → Capability ID → Provider`，Workflow 不关心底层实现。
5. **插件提供能力，不掌握治理权**：插件不能自行 Approve / Resolve / Verify / Merge，除非被 Core Policy 显式授权。

---

# 第九部分 前端与 UX

# 49. 信息架构与 Project Overview

## 49.1 产品信息架构

Robot Studio 主导航（最终版）：

```text
Robot Studio
├── Overview
├── Requirements
├── Documents
├── Reviews
├── Tasks
├── Workflows
├── Runs
├── Agents
├── Tests
├── Simulations
└── Traceability
```

其中：

- **Documents**：工程知识中心
- **Reviews**：问题与决策中心
- **Tasks**：待执行工程任务
- **Workflows**：工程流程模板
- **Runs**：实际执行记录
- **Traceability**：工程证据链

> 主文档早期版本（Project / Overview / Documents / Reviews / Tasks / Agent / Changes / Traceability / Workflow / Git）演进为本结构；核心 Workspace 划分为 Project Workspace 下的 Overview / Documents / Reviews / Tasks / Agents / Workflows / Tests / Traceability 八个模块。

## 49.2 UX 总体原则

### Workflow 是工程对象

Workflow 不只是画布上的图，而是可版本化、可审计、可执行的 Engineering Object：

```text
Workflow
 ├── Definition / Version / Policy
 ├── Execution
 ├── Evidence
 └── Traceability
```

### Design Time 与 Runtime 分离

```text
Design Time                     Runtime
Workflow Designer               Workflow Instance
  ↓                               ↓
Workflow Definition             Node Instance
  ↓                               ↓
Workflow Version                Execution / Evidence
```

运行中的 Workflow 不直接修改原始 Workflow Definition；如需修改流程，应创建新的 Workflow Version。

### 文档优先

Workflow 并不是需求的唯一入口。用户可以从 `Document → Review → Task → Workflow` 进入，也可以从 `Workflow → Task → Review / Evidence` 进入。两条路径最终必须进入同一 Traceability Graph。

## 49.3 Project Overview Dashboard

Overview 是项目当前工程状态的 Dashboard：

```text
┌─────────────────────────────────────────────┐
│ Robot Control Project                       │
├─────────────────────────────────────────────┤
│ Requirements                                │
│  12 Total / 8 Verified / 2 Implementing / 2 Draft
│                                             │
│ Reviews                                     │
│  🔴 2 Critical / 🟠 5 Major                 │
│                                             │
│ Agent                                       │
│  RUN-021 Running                            │
│                                             │
│ Changes                                     │
│  CHG-012 Waiting Review                     │
│                                             │
│ Verification                                │
│  ✓ Build  ✓ Unit Test                       │
└─────────────────────────────────────────────┘
```

# 50. Document Workspace 与 Review Workspace

## 50.1 Document Workspace

主界面三栏：

```text
┌──────────────┬──────────────────────────────┬──────────────┐
│ Documents    │ Document                     │ Context      │
│              │                              │              │
│ Requirements │ # Control Authority          │ Reviews      │
│ Design       │                              │              │
│ Reviews      │ 同一时刻只能存在一个有效      │ REV-001      │
│              │ Authority。                  │ Related      │
│              │                              │ RQ-001       │
│              │                              │ SPEC-001     │
│              │                              │ [Agent]      │
└──────────────┴──────────────────────────────┴──────────────┘
```

核心 UI 原则：

```text
Left   = Navigation
Center = Primary Engineering Object
Right  = Context / Relations / Agent
```

重点能力：Edit、Diff、Inline Review、Version、Anchor、Relation。

## 50.2 Inline Review

这是系统最核心的功能之一。用户选择文档中的某一段文字，直接发起 Review：

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

Document Editor 中的 Inline Review 展示：

```text
┌───────────────────────────────────────────────┐
│ # Control Authority                           │
│                                               │
│ MotionManager 可以通过 CapabilityManager      │
│ 获取 LimbController 的控制权。                │
│                 ┌─────────────────────────┐   │
│                 │ REV-001                 │   │
│                 │ 🔴 Major                │   │
│                 │ MotionManager 不应该    │   │
│                 │ 参与 Authority          │   │
│                 │ Arbitration。           │   │
│                 │ 2 replies               │   │
│                 └─────────────────────────┘   │
│                                               │
│ Emergency Stop 优先级最高。                   │
└───────────────────────────────────────────────┘
```

## 50.3 Review Thread UI

点击 Review 后：

```text
┌───────────────────────────────────────────────┐
│ REV-001                         ● OPEN        │
├───────────────────────────────────────────────┤
│ Target                                       │
│ design/control-authority.md                  │
│ "MotionManager 可以通过 CapabilityManager..." │
│ ──────────────────────────────────────────── │
│ Zhang                                        │
│ MotionManager 不应该参与仲裁。               │
│                                               │
│ Li                                            │
│ 同意，增加 GlobalAuthorityManager。           │
│                                               │
│ 🤖 Agent                                     │
│ 已分析当前架构，可以执行该修改。             │
│                                               │
│ Decision                                     │
│ ✓ Accepted                                   │
│                                               │
│ [Create Task] [Send to Agent]                │
└───────────────────────────────────────────────┘
```

## 50.4 Outdated Review UI

当 Anchor 失效：

```text
┌───────────────────────────────────────────────┐
│ ⚠ REV-001 needs review                       │
├───────────────────────────────────────────────┤
│ Original text:                               │
│ MotionManager 可以通过 CapabilityManager     │
│ 获取 LimbController 的控制权。               │
│                                               │
│ Current document:                            │
│ MotionManager 已经通过                       │
│ GlobalAuthorityManager 获取控制权。          │
│                                               │
│ Reason: Text changed                         │
│                                               │
│ [Still Relevant] [No Longer Relevant]        │
└───────────────────────────────────────────────┘
```

## 50.5 Diff + Review 一体化

Document Diff 中必须显示 Review：

```diff
- MotionManager 可以直接获得控制权。
+ MotionManager 必须通过
+ GlobalAuthorityManager 获取控制权。
```

旁边显示：

```text
REV-001
✓ Implemented
```

这样 Reviewer 可以直接判断 Agent 是否正确实现了 Review。

## 50.6 Review Inbox

Review 不只散落在文档中，需要独立 Review Workspace：

```text
┌───────────────────────────────────────────────┐
│ Reviews                                       │
├───────────────────────────────────────────────┤
│ 🔴 REV-001  Authority Design                  │
│ 🟠 REV-002  Missing Failure State             │
│ 🟡 REV-003  Naming Suggestion                 │
│                                               │
│ Filter: [Open] [Major] [Design] [Assigned to me]
└───────────────────────────────────────────────┘
```

点击 Review 后的展开链：

```text
Review → Target Document → Discussion → Related Objects
→ Agent History → Implementation Status
```

## 50.7 Document + Workflow 双向导航

在 Document 页面：

```text
DES-005
  └── REV-001
       └── TASK-001
            └── Workflow WF-012
```

点击 Workflow 后进入 `WF-012 → RUN-024`；反过来在 Workflow 中，Task / Review / Design 都可以直接打开。

## 50.8 Inline Review 集成（右键入口）

Document Editor 选中文本 → 右键 `[Add Review]` → Review Panel：

```text
REV-001
Design Issue / Major

MotionManager currently calls
LimbController directly.

[Accept] [Create Task] [Start Workflow]
```

其中 **Start Workflow** 可以直接使用预设 Workflow Template。

# 51. Agent Workspace 与 Agent Transcript

## 51.1 Agent Workspace

Agent Workspace 采用类似 IDE 的布局：

```text
┌────────────────────────────────────────────────────┐
│ Task / Run / Status                                │
├──────────────┬───────────────────┬─────────────────┤
│ Context      │ Agent Conversation │ Execution       │
│              │                   │                 │
│ Requirements │ Plan              │ Tool Calls      │
│ Design       │ Messages          │ Changes         │
│ Code         │                   │ Tests           │
│ Tests        │                   │ Evidence        │
└──────────────┴───────────────────┴─────────────────┘
```

用户应该能够看到 Agent 正在做什么，而不是只看到聊天窗口。

简版任务面板：

```text
┌──────────────────────────────────────────────┐
│ Agent Task: TASK-001                         │
├──────────────────────────────────────────────┤
│ Context                                      │
│ ✓ RQ-001  ✓ SPEC-001  ✓ DES-001  ✓ REV-001  │
│                                              │
│ Plan                                         │
│ ✓ Analyze  ○ Modify Design                   │
│ ○ Implement  ○ Test                          │
│                                              │
│ Activity                                     │
│ 14:21 Reading motion_manager.cpp             │
│ 14:22 Analyzing authority ownership          │
│                                              │
│ [Stop]                                       │
└──────────────────────────────────────────────┘
```

**Agent Activity 应该保存，而不是仅作为临时 Terminal 输出。**

## 51.2 Agent Transcript 分层

Agent Transcript 建议分层展示，而不是简单显示原始聊天消息：

```text
[DECISION]
Inspect MotionManager authority path

[TOOL]
grep "requestControl" src/motion

[OBSERVATION]
3 references found

[EVALUATION]
Direct call confirmed

[DECISION]
Modify authority path
```

分层为：`Decision / Tool Call / Observation / Evaluation / Evidence`——这样更适合工程审计。

## 51.3 Context Preview

Agent 节点必须提供 Context Preview：

```text
Context
────────────────────────────
P0
 ✓ REV-001
 ✓ DES-005
 ✓ REQ-012
 ✓ authority_manager.cpp
 ✓ authority_test.cpp

P1
 ✓ ADR-003
 ✓ abc123

Total: 42,810 tokens
```

用户可以点击具体 Context Item 查看：来源、Relationship、Relevance Score、被选中的原因、当前 Version、Snapshot 信息。

## 51.4 Agent Context 页面

```text
┌─────────────────────────────────────────────┐
│ Agent Context                                │
├─────────────────────────────────────────────┤
│ Task: TASK-001                               │
│ Context: 68,420 / 100,000 tokens             │
├─────────────────────────────────────────────┤
│ P0                                        ▼ │
│ ✓ REV-001 / DES-005 / REQ-001               │
│ ✓ authority_manager.cpp                     │
│ ✓ authority_test.cpp                        │
│                                              │
│ P1                                        ▼ │
│ ✓ ADR-007 / abc123                          │
└─────────────────────────────────────────────┘
```

# 52. Workflow Designer：布局、Palette、Inspector

## 52.1 总体布局

推荐三栏 + 顶部运行栏：

```text
┌──────────────────────────────────────────────────────────────┐
│ Workflow: Implement Limb Authority   v12   [Run] [Review]   │
├───────────────┬───────────────────────────────┬──────────────┤
│ Node Palette  │         Workflow Canvas        │ Inspector   │
│               │                               │             │
│ Trigger       │  ● Review                    │ Node config │
│ Agent         │       ↓                       │             │
│ Tool          │  ● Context                   │ Parameters  │
│ Approval      │       ↓                       │ Policy      │
│ Test          │  ● Agent                     │ Inputs      │
│ Simulation    │       ↓                       │ Outputs     │
│ Condition     │  ● Test                      │             │
│ Parallel      │      ↙   ↘                    │             │
│ Loop          │   PASS   FAIL                 │             │
│ Verify        │                               │             │
└───────────────┴───────────────────────────────┴──────────────┘
│ Run / Version / Validation / Diff / Logs / Evidence           │
└──────────────────────────────────────────────────────────────┘
```

## 52.2 Node Palette

MVP 提供以下节点（后续允许 Plugin 注册新的 Node Type）：

- **Control**：Start、End、Condition、Switch、Parallel、Join、Loop
- **Engineering**：Document、Review、Task、Context、Agent、Tool、Test、Simulation、Verification
- **Governance**：Human Approval、Policy Check、Escalation
- **Integration**：Webhook、Git、CI、ROS2

## 52.3 节点最小模型

```typescript
interface WorkflowNodeDefinition {
  id: string;
  type: WorkflowNodeType;
  name: string;

  position: { x: number; y: number };

  inputs: PortDefinition[];
  outputs: PortDefinition[];

  config: Record<string, any>;
  policy?: PolicyReference;
}
```

UI 中的 Node ID、输入输出 Port、配置结构都必须对应第七部分的 Runtime Schema。

## 52.4 Edge Editor

Edge 不只是视觉连线，而是有执行语义（PASS / FAIL / TRUE / FALSE / TIMEOUT / APPROVAL / RETRY / CANCEL）：

```text
              ┌── PASS ───→ Verify
Test ─────────┤
              └── FAIL ───→ Agent Fix
```

```typescript
interface WorkflowEdgeDefinition {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;

  condition?: ConditionExpression;
}
```

## 52.5 Node Inspector

选中节点以后，右侧 Inspector 显示：

```text
Agent: Implement Authority
────────────────────────────
Provider       Codex
Model          gpt-5.6
Harness Policy Standard

Context
  ✓ Review  ✓ Design  ✓ Requirement
  ✓ Source Code  ✓ Tests

Scope
  src/motion/**
  test/motion/**

Approval
  Plan: Required
  Change: Required

Budget
  Token: 100k
  Tool Calls: 60
  Retry: 3
```

设计原则：

> **复杂配置放 Inspector，不把画布变成配置表单。**

## 52.6 Port 类型检查

Node Port 应支持 Schema：

```typescript
interface PortDefinition {
  name: string;
  type: string;
  required: boolean;
  schema?: Record<string, any>;
}
```

例如 `Context Node output: ContextBundle` ↔ `Agent Node input: ContextBundle`，连接时可由 Designer 自动校验类型兼容性。

# 53. Context Preview、Agent Plan 与 Approval UX

## 53.1 Agent Plan Panel

Agent 节点执行前显示：

```text
Agent Plan
────────────────────────────
1. Inspect authority manager
2. Update MotionManager
3. Update tests
4. Run test suite
5. Verify result

Risk: MEDIUM
Files: 4
Estimated calls: 28

[Approve] [Reject] [Modify]
```

对于高风险任务，**Plan Approval 必须是 Workflow 的显式节点**，而不是散落在 Agent UI 中。

## 53.2 Human Approval Node

Human Approval 是独立节点：

```text
Agent Plan
    ↓
Human Approval
    ↓
Approved?
  ├── Yes → Execute
  └── No  → Revise Plan
```

Node 配置：

```yaml
approval:
  mode: manual
  approvers:
    - role: TECH_LEAD
  timeout: 24h
  on_timeout: ESCALATE
```

## 53.3 Approval Request UX

运行时显示：

```text
┌──────────────────────────────────────────┐
│ Approval Required                        │
├──────────────────────────────────────────┤
│ Task: Unify Limb Authority               │
│ Risk: HIGH                               │
│                                          │
│ Agent Plan                               │
│ 1. Modify MotionManager                  │
│ 2. Change authority API                  │
│ 3. Update tests                          │
│                                          │
│ Files: 6  Tests: 4                       │
│                                          │
│ [Open Context] [View Diff]               │
│ [Approve] [Reject] [Request Changes]     │
└──────────────────────────────────────────┘
```

## 53.4 Approval 类型

Approval 不只针对 Agent Plan，至少支持：

```text
PLAN_APPROVAL / CHANGE_APPROVAL / MERGE_APPROVAL /
HARDWARE_APPROVAL / RELEASE_APPROVAL
```

**Human Approval 本身也是一个 Evidence Source。**

# 54. Runtime Monitor 与 Checkpoint Explorer

## 54.1 Runtime Monitor

Workflow 运行后切换到 Runtime View：

```text
┌───────────────────────────────────────────────────────┐
│ RUN-024   Running   18m                               │
├───────────────────────────────────────────────────────┤
│ Review ✓ → Context ✓ → Agent ● → Test ○ → Verify ○  │
│                       │                               │
│                       └─ Step 12                      │
├───────────────────────────────────────────────────────┤
│ Logs │ Tool Calls │ Changes │ Tests │ Evidence        │
└───────────────────────────────────────────────────────┘
```

节点颜色 / 状态只表达状态，不承担复杂逻辑。

## 54.2 Node Runtime Detail

点击 Agent Node：

```text
RUN-024 / Agent Node
────────────────────────────
Status: EXECUTING

Plan: Approved
Steps: 7 / 12
Tool calls: 24
Tokens: 37,821
Retries: 1

Current:
Editing motion_manager.cpp

[Open Agent Transcript] [Open Context] [Open Diff]
```

## 54.3 Workflow Control Bar

Runtime 顶部：

```text
[Pause] [Resume] [Cancel]
[Retry Failed Step] [Restart From Checkpoint]
```

其中 Retry / Restart 必须由 Engine 执行，不由前端直接操纵 Agent。

## 54.4 Checkpoint Explorer

```text
RUN-024

✓ CP-001 Context Ready
✓ CP-002 Plan Approved
✓ CP-003 Code Changed
✓ CP-004 Build Passed
→ CP-005 Test Failed
```

操作：`[Resume] [Restart From Here] [Inspect Context]`

# 55. Diff Workspace、Test View 与 Human Feedback

## 55.1 Diff Workspace

Agent 修改以后必须有统一 Diff Workspace：

```text
Changes
────────────────────────────
M motion_manager.cpp
M authority_manager.cpp
M authority_test.cpp

[Review All]
```

支持：文件 Diff、Inline Comment、Approve Change、Reject Change、Request Revision。

Change Proposal 卡片示例：

```text
┌────────────────────────────────────────────┐
│ Change Proposal CHG-001                    │
├────────────────────────────────────────────┤
│ Source                                     │
│ REV-001 / TASK-001 / RUN-003               │
│                                            │
│ Files                                      │
│ ● global_authority_manager.cpp             │
│ ● motion_manager.cpp                       │
│ ● authority_test.cpp                       │
│                                            │
│ Test                                       │
│ ✓ Build  ✓ Unit Test                       │
│                                            │
│              [Reject] [Approve]            │
└────────────────────────────────────────────┘
```

用户点击文件可查看 Before / After 对比。

## 55.2 Diff 与 Review 一体化

```diff
- controller.acquire();
+ authority.request(controller);
```

旁边显示：

```text
REV-001
This change addresses direct authority acquisition.

✓ Related Review
✓ Related Task
```

从而把 Code Review 与 Document Review 统一到 Traceability Graph。

## 55.3 Test View

Test Node 执行状态：

```text
Authority Test
────────────────────────────
Build       ✓ PASS
Unit        ✓ PASS
Integration ✗ FAIL

Failure:
expected authority owner = MotionManager
actual owner = GlobalAuthorityManager

[Open Logs]
[Send Failure to Agent]
```

**Send Failure to Agent 不应简单发一段文字，而应创建新的 Observation / Context Update。**

## 55.4 Human Feedback → Workflow

人工不是只能 Approval，还需要：

```text
COMMENT / REQUEST_CHANGES / APPROVE / REJECT /
CHOOSE_OPTION / PROVIDE_PARAMETER /
PAUSE / RESUME / CANCEL
```

例如用户说「请保留现有 API，不要修改上层调用接口」，应进入 Workflow Context，而不是只作为聊天消息存在。

## 55.5 Escalation UX

当 Agent 无法继续：

```text
┌───────────────────────────────────────┐
│ Agent Escalation                      │
├───────────────────────────────────────┤
│ Retry attempts exhausted: 3           │
│                                       │
│ Cause                                 │
│ Integration test still fails.         │
│                                       │
│ Agent suggestion                      │
│ A. Change interface                   │
│ B. Update test expectation            │
│                                       │
│ Evidence                              │
│ 3 failed runs                         │
│                                       │
│ [Choose A] [Choose B] [Abort]         │
└───────────────────────────────────────┘
```

## 55.6 Workflow Template

Workflow 区分为 Template 与 Instance：

**Bug Fix：**

```text
Review → Context → Agent → Test → Verify
```

**Feature Development：**

```text
Requirement → Design → Review → Context → Agent
→ Test → Simulation → Verification
```

**Hardware Change：**

```text
Design → Agent → Simulation → Human Approval
→ Hardware Test → Verification
```

## 55.7 Workflow Versioning UX

```text
WF-012
 v10
 v11
 v12 ← current
```

版本之间支持 Diff：

```text
v11 → v12

+ Human Approval
+ Simulation Test
- Direct Hardware Test
```

运行实例必须绑定一个不可变的 Workflow Version。

## 55.8 Workflow Validation UX

点击 Save / Validate 时执行静态检查：

```text
✓ Start node exists
✓ End node exists
✓ No unreachable nodes
✓ No invalid connections
✓ Input/output types match
✓ Required config complete
✓ Policy valid
✓ Approval requirements valid
⚠ Retry loop has no max attempts
```

**Workflow 只有 Validation Passed 才能发布为可执行版本。**

# 56. Traceability View、权限模型与 Safe Default

## 56.1 Traceability View

图形化 Traceability（节点均可点击打开对应对象）：

```text
REQ-012
   ↓
DES-005
   ↓
REV-001
   ↓
TASK-001
   ↓
WF-012
   ↓
RUN-024
   ↓
CHG-005
   ↓
Commit abc789
   ↓
Test-091
   ↓
VER-032
```

Workflow Workspace 同样使用图形化 State Graph，支持 Node / Edge / Condition / Parallel / Join / Retry / Approval / Subworkflow。

## 56.2 Workflow + Git

Workflow Release 前可以要求：

```text
Git Status        ✓ Clean
Branch            feature/authority
Workflow Version  v12
Commit            abc789
```

Workflow Instance 应保存 Repository Snapshot：

```yaml
repository_snapshot:
  provider: gitlab
  project: robot-control
  branch: feature/authority
  commit: abc789
```

## 56.3 Permission Model

UI 不应自己判断权限，而应调用 Policy / Authorization Service。

角色示例：

```text
VIEWER / ENGINEER / REVIEWER / TECH_LEAD /
PROJECT_ADMIN / ROBOT_OPERATOR
```

操作权限包括：

```text
DOCUMENT_EDIT / REVIEW_DECIDE / WORKFLOW_EDIT / WORKFLOW_PUBLISH /
AGENT_EXECUTE / CHANGE_APPROVE / MERGE / HARDWARE_EXECUTE / RELEASE
```

## 56.4 Safe Default

所有高风险操作默认关闭：

```text
Hardware Motion / Robot Flash / Production Deploy /
Release / Merge to protected branch
```

必须由 **Policy + Human Approval 双重控制**。

# 57. 前端技术架构、AI 辅助与 UX 闭环

## 57.1 前端技术架构

前端采用：

```text
React + TypeScript + Workflow Canvas Library（React Flow）
+ Monaco Editor + Markdown AST Editor
```

后端链路：

```text
BFF → Workflow Service → Workflow Engine → Agent Harness
```

WebSocket / SSE 用于 Runtime Event：

```text
WorkflowEvent / AgentEvent / ToolEvent / TestEvent /
ApprovalEvent / EvidenceEvent
```

## 57.2 Runtime Event Model

```typescript
interface WorkflowEvent {
  id: string;
  runId: string;
  nodeId?: string;

  type:
    | "RUN_STARTED" | "NODE_STARTED" | "NODE_COMPLETED"
    | "NODE_FAILED" | "TOOL_CALLED" | "APPROVAL_REQUIRED"
    | "APPROVAL_DECIDED" | "TEST_COMPLETED" | "EVIDENCE_CREATED"
    | "RUN_PAUSED" | "RUN_COMPLETED";

  timestamp: string;
  payload: Record<string, any>;
}
```

**前端只消费事件，不自行推导 Runtime State。**

## 57.3 Design-time State 与 Runtime State

严格区分：

```text
Workflow Definition
      └── immutable Version
              ↓
        Workflow Instance
              ↓
          Node State
```

不能出现 Runtime 修改 Definition；如需修改流程，应创建新的 Workflow Version。

## 57.4 AI 辅助 Workflow Designer

后续可以支持用户用自然语言描述（如「创建一个代码 Review → Agent 修复 → 单测 → 仿真 → 人工确认的流程」），AI 生成 Workflow Draft：

```text
Start → Review → Context → Agent → Test → Simulation
→ Human Approval → Verification
```

但 AI 生成后仍必须经过：

```text
Validate → Human Review → Publish
```

**不能让 AI 直接修改生产 Workflow。**

## 57.5 Workflow Explainability

用户选中一个 Workflow 节点，可以点击「Why this node?」：

```text
Why Agent Node?

Triggered by:
TASK-001

Required because:
REV-001 requires implementation change.

Context sources:
REQ-012 / DES-005 / ADR-003

Policy:
ENGINEERING_STANDARD_V2
```

这会让 Workflow 从「画出来的流程」升级为「可解释的工程流程」。

## 57.6 MVP 范围（前端）

**MVP 必须：**

- Workflow Canvas、Node Palette、Node Inspector、Edge Editor
- Workflow Validation、Workflow Version
- Run / Pause / Resume / Cancel
- Agent Node、Tool Node、Test Node、Human Approval Node
- Context Preview、Diff View、Evidence View、Traceability View

**V1：**

- AI Workflow Generation
- Subworkflow
- Visual Debugger
- Advanced Loop Editor
- Simulation Integration
- ROS2 Integration
- Plugin UI Extension
- Multi-Agent View

## 57.7 核心 UX 闭环

最终用户操作应该非常接近：

```text
Document
   ↓
Select Text
   ↓
Create Review
   ↓
Accept Review
   ↓
Create Task
   ↓
Start Workflow
   ↓
Context Preview
   ↓
Agent Plan
   ↓
Human Approval
   ↓
Agent Execute
   ↓
Test / Simulation
   ↓
Review Diff
   ↓
Verification
   ↓
Resolve Review
```

整个过程不需要用户在多个完全独立的工具之间来回切换。

## 57.8 最终 UX 核心：Engineering Work Item

Robot Studio 不应该模仿传统 IDE，也不应该只是模仿 n8n / Node-RED。它的中心对象应该是 **Engineering Work Item**。

用户看到的不是孤立的 Document / Workflow / Agent / Git / Test，而是一条完整的工程链：

```text
WHY
  ↓
WHAT
  ↓
HOW
  ↓
EXECUTE
  ↓
PROVE
```

对应：

```text
Requirement / Review
        ↓
Design / Task
        ↓
Workflow / Agent
        ↓
Harness / Tools
        ↓
Test / Evidence / Verification
```

---

# 第十部分 核心流程与 Traceability

# 58. 端到端数据流与核心闭环

## 58.1 MVP 核心闭环（权威版本）

MVP 必须只验证一个核心假设：

> **人是否愿意通过 Review 驱动 Agent 修改工程资产。**

MVP 核心闭环：

```text
Markdown Document
      ↓
Inline Review
      ↓
Review Discussion
      ↓
Create Agent Task
      ↓
Agent Context
      ↓
Agent Plan
      ↓
Human Approval
      ↓
Agent Execute
      ↓
Git Diff
      ↓
Test
      ↓
Resolve Review
```

第一阶段最小可运行链路（DES-007 版本）：

```text
Markdown Document
        ↓
Inline Review
        ↓
Accept
        ↓
Task
        ↓
Context Builder
        ↓
Codex / Claude Code
        ↓
Git Diff
        ↓
Test
        ↓
Verification
        ↓
Resolve Review
```

如果这一条链跑通，Robot Studio 的核心价值就已经能够验证。

## 58.2 Document → Review → Agent 完整闭环

MVP 核心流程（步骤视角）：

```text
┌──────────────┐
│   Document   │
└──────┬───────┘
       ↓
┌──────────────┐
│ Select Text  │
└──────┬───────┘
       ↓
┌──────────────┐
│ Create Review│
└──────┬───────┘
       ↓
┌──────────────┐
│   Discuss    │
└──────┬───────┘
       ↓
┌──────────────┐
│   Accepted   │
└──────┬───────┘
       ↓
┌──────────────┐
│ Create Task  │
└──────┬───────┘
       ↓
┌──────────────┐
│ Agent Plan   │
└──────┬───────┘
       ↓
   Human Approve
       ↓
┌──────────────┐
│ Agent Execute│
└──────┬───────┘
       ↓
┌──────────────┐
│Change Proposal│
└──────┬───────┘
       ↓
┌──────────────┐
│ Verification │
└──────┬───────┘
       ↓
┌──────────────┐
│Resolve Review│
└──────────────┘
```

## 58.3 最终完整链（含 Document / Code 双分支）

```text
                  Human
                    │
                    ↓
              Engineering Doc
                    │
                    ↓
               Inline Review
                    │
                    ↓
               Review Thread
                    │
                    ↓
                Decision
                    │
                    ↓
               Agent Task
                    │
                    ↓
               Agent Context
                    │
                    ↓
                Agent Plan
                    │
                    ↓
              Human Approval
                    │
                    ↓
               Agent Execute
                    │
           ┌────────┴────────┐
           ↓                 ↓
        Document            Code
        Change              Change
           │                 │
           └────────┬────────┘
                    ↓
                  Test
                    ↓
              Verification
                    ↓
                Review
                    ↓
                 Resolve
```

这条链是 Robot Studio Document-Driven Agent Engineering Workspace 的核心工作流。

## 58.4 Code Review 与聚合展示

代码仍然使用 GitLab Merge Request 进行 Review。Robot Studio 聚合展示：

```text
Document Review
       ↓
Change Proposal
       ↓
Git Commit
       ↓
Merge Request
       ↓
Code Review
```

文档 Review 与代码 Review 必须能够相互跳转。

# 59. Traceability 主链

所有子系统的执行结果最终汇入同一条 Traceability 主链（工程审计主线）：

```text
Requirement
  ↓
Specification
  ↓
Design
  ↓
Review
  ↓
Task
  ↓
Context Snapshot
  ↓
Workflow Run
  ↓
Agent Run
  ↓
Change
  ↓
Commit / MR
  ↓
Test
  ↓
Evidence
  ↓
Verification
```

Workflow Run 本身是 Traceability Graph 的一个重要节点。整个体系可以概括为：

> **Document 定义知识，Review 定义治理，Context 定义 Agent 所见，Workflow 定义工程过程，Harness 定义 Agent 如何被控制，Verification 定义结果是否可信。**

即：

```text
WHY → WHAT → CONTEXT → WORKFLOW → AGENT LOOP → CHANGE → PROOF
```

这套模型可以承载后续的 Multi-Agent、VLA / Robot Tool、Simulation、CI/CD、OTA 和多机器人工程流程，而不需要改变最底层的工程对象模型。

# 60. Agent 自主模式

系统支持三种执行模式（与第四部分 HITL 边界、第六部分 Plan Approval、第七部分 Workflow Policy 一致）：

```text
Manual            Agent 每个关键步骤等待用户
Semi-Autonomous   Plan → 人批准；Implementation / Test → 自动；Merge → 人批准
Autonomous        Review → Agent → Code → Test
```

约束：

- 即使是 Autonomous，也不能让 Agent 自己授予自己审批权限。
- Autonomous Mode 必须受到项目策略和权限控制。
- 所有高风险操作（Hardware Motion、Robot Flash、Production Deploy、Release、Merge to protected branch）默认关闭，必须由 Policy + Human Approval 双重控制。

---

# 第十一部分 非功能需求与安全

# 61. 关键非功能需求与安全

## 61.1 五条关键非功能需求

### 61.1.1 可追踪

所有工程变更应该能够追溯：

```text
Who / When / Why / What / Based On / Verified By
```

### 61.1.2 Git Friendly

所有核心工程资产必须可以使用 Git 管理。

### 61.1.3 Agent Friendly

所有工程信息应该能够以结构化 Context 提供给 Agent。

### 61.1.4 Human Controllable

Agent 的重要行为必须允许：

```text
Preview / Approve / Reject / Rollback
```

### 61.1.5 可扩展

Agent、Git Provider、CI Provider、Document Provider 均应支持插件化（见第八部分）。

## 61.2 安全边界

系统至少存在三层安全边界：

```text
UI Permission
      ↓
Policy Engine
      ↓
Tool / Runtime Sandbox
```

尤其 Agent Tool 的 Read / Write / Execute / Network / Git / Robot / Hardware 权限必须分别控制。

## 61.3 Agent 执行 Sandbox

Agent 执行环境推荐 Container / Workspace Sandbox：

```text
/workspace/repo
```

只允许 Agent 修改 `/workspace/repo`。需要访问 Robot Hardware 时，通过显式 Tool Gateway。

禁止 Agent 直接访问：

```text
/dev
/sys
真实机器人控制接口
```

除非 Policy 明确授权。

## 61.4 Observability

所有核心对象应具有：

```text
created_at / updated_at / created_by / source / trace_id
```

Agent Run 额外需要：

```text
tokens / cost / duration / tool_calls / retry_count
```

系统级指标：

```text
Workflow latency / Agent success rate / Verification failure rate /
Context token usage / Task cycle time
```

## 61.5 Audit Log

Audit 与普通业务 Event 区分。例如：

```text
USER_APPROVED_PLAN
AGENT_CALLED_TOOL
POLICY_DENIED_TOOL
USER_APPROVED_HARDWARE_ACTION
VERIFICATION_FAILED
REVIEW_RESOLVED
```

**Audit Log 不允许 Agent 修改。**

---

# 第十二部分 MVP 规划与演进路线

# 62. MVP 核心假设与范围

## 62.1 第一阶段不追求完整 Agent IDE

第一阶段只实现核心闭环（见第 58 章），按功能域划分：

### Document

- Markdown Editor / Preview
- Document Tree
- Git History
- Diff

### Review

- Inline Comment
- Review List
- Severity / Status
- Resolve / Reply / @User

### Agent

- Select Agent
- Create Task
- Context Preview
- Plan / Approve / Execute / Result

### Git

- Branch / Commit / Diff / MR

### Verification

- Build / Test / Result

## 62.2 功能优先级

### P0（必须实现）

```text
Project / Document Tree / Markdown Editor / Markdown Preview /
Inline Review / Review Discussion / Review Status /
Task / Agent Context / Agent Plan / Agent Execution /
Git Diff / Test Result
```

### P1（后续实现）

```text
Requirement Object / Specification Object / Design Object /
Traceability Graph / GitLab MR / CI Integration
```

### P2（后续）

```text
Multi-Agent / Custom Workflow / Visual Workflow Editor /
Architecture Graph / Robot Capability Graph / ROS2 Graph /
Simulation Integration
```

# 63. 各子系统 MVP 范围汇总

| 子系统 | MVP 必须 | 第二阶段 | 第三阶段 |
|---|---|---|---|
| Context（第五部分） | Document / Review / Requirement / Design / Code / Test / Git Commit Context；Relation-based Retrieval；Keyword Search；Token Budget；Context Bundle / Snapshot | Embedding Retrieval；Code Symbol Retrieval；Call Graph；Compression；Relevance Ranking | Context Optimization / Evaluation / Replay / Benchmark / Multi-Agent Context Sharing |
| Harness（第六部分） | Agent Run State Machine；Execution Step；Plan / Approval；Tool / Risk Policy；Observe / Evaluate；Retry；Checkpoint / Recovery；Budget / Scope；Evidence / Verification；Robot Safety Hook | — | — |
| Workflow（第七部分） | DSL；Node / Edge；Start / End；Condition；Agent / Tool / Context Node；Human Approval；Test / Verification Node；Retry / Timeout；Version / Validation；Run / NodeRun；Event Timeline；Pause / Resume；Harness 集成；Traceability | Parallel / Join；Loop；Subworkflow；Artifact；Compensation；Multi-Agent；Worktree Isolation；Visual Editor；Replay | Workflow Marketplace；Dynamic Optimization；Learned Policy；Autonomous Generation；Benchmark；Workflow-to-Code；Fleet / Distributed Workflow |
| Plugin（第八部分） | GitLab、Local Git、Codex、Claude Code、Shell / Filesystem、Test / CI、ROS2 七个插件；In-process Plugin | OpenClaw / Dify / Simulation；Remote Plugin RPC | Plugin Marketplace；Sandbox 隔离 |
| 前端（第九部分） | Workflow Canvas / Palette / Inspector / Edge Editor；Validation / Version；Run / Pause / Resume / Cancel；Agent / Tool / Test / Approval Node；Context Preview；Diff / Evidence / Traceability View | AI Workflow Generation；Subworkflow；Visual Debugger；Simulation / ROS2 Integration；Plugin UI Extension；Multi-Agent View | — |

# 64. 用户故事与验收标准

## 64.1 MVP 用户故事

### US-001：创建文档

```text
As a Developer
I want to create a design document
So that the system design can become
a persistent engineering asset.
```

### US-002：文档评审

```text
As a Reviewer
I want to select text inside a document
and create a review
So that my engineering feedback
is associated with the exact context.
```

### US-003：Review 驱动 Agent

```text
As a Developer
I want to send an accepted review to an Agent
So that the Agent can analyze the relevant
engineering context and implement changes.
```

### US-004：Agent Plan

```text
As a Developer
I want to review the Agent's implementation plan
Before allowing the Agent to modify code.
```

### US-005：Change Review

```text
As a Reviewer
I want to inspect the changes generated by the Agent
So that I can decide whether
the implementation is acceptable.
```

### US-006：Verification

```text
As a Developer
I want to see whether the implementation
has passed relevant tests
Before resolving the review.
```

## 64.2 MVP 验收标准（13 步最小场景）

```text
1.  创建 Design Document
2.  在 Document 中选择一段文字
3.  创建 Review
4.  Reviewer Accept Review
5.  Create Task
6.  Agent 自动获得：Document / Selected Text / Review / Related Source Code
7.  Agent 生成 Plan
8.  User Approve Plan
9.  Agent 修改代码
10. 系统展示 Git Diff
11. Agent 执行 Test
12. Test PASS
13. User Resolve Review
```

**如果以上 13 步可以完整运行，则 MVP 核心目标达成。**

# 65. 仓库结构、实现顺序与明确不做

## 65.1 第一阶段代码仓库结构

```text
robot-studio/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
│
├── packages/
│   ├── domain/
│   ├── project/
│   ├── document/
│   ├── review/
│   ├── task/
│   ├── context/
│   ├── workflow/
│   ├── harness/
│   ├── verification/
│   ├── policy/
│   └── traceability/
│
├── adapters/
│   ├── git/
│   ├── agent/
│   ├── test/
│   └── robot/
│
├── infra/
│   ├── db/
│   ├── queue/
│   └── storage/
│
└── docs/
```

## 65.2 第一阶段实现顺序

推荐顺序：

```text
1.  Domain Model
2.  Project / Repository
3.  Document / Version / Anchor
4.  Review / Thread
5.  Task
6.  Git Adapter
7.  Context Engine MVP
8.  Agent Adapter
9.  Agent Harness MVP
10. Test / Verification
11. Traceability
12. Workflow Graph
13. UI Polish
```

> **不要一开始先做漂亮的 Workflow Designer。** 先证明 Document → Review → Agent → Verification 的工程闭环，再扩展平台能力。

## 65.3 第一阶段明确不做

以下能力暂不实现：

- 自己实现 Git Server / 完整代码托管
- 自己实现 CI/CD
- 自己实现完整 Issue Tracker / 复杂项目管理
- 自己实现 LLM Provider
- 自己实现完整 Agent Runtime
- 自己实现 Wiki 存储
- Multi-Agent Complex Planning
- Advanced Vector RAG
- Distributed Workflow Runtime
- Full Hardware Orchestration
- OTA Automation
- Large Scale Plugin Marketplace
- Complex RBAC

优先复用：

```text
GitLab + 现有 Coding Agent + 现有 CI/CD
```

# 66. 三阶段演进路线与后续设计任务

## 66.1 架构演进路线

### Phase 1（MVP）

```text
Modular Monolith
Single Project
GitLab
Single Agent
Basic Workflow
```

### Phase 2

```text
Multiple Agent Providers
Multiple Git Providers
Vector Context
Simulation
Workflow Designer（完整版）
```

### Phase 3

```text
Multi-Agent
Robot Capability Graph
Hardware Orchestration
OTA
Organization-level Governance
```

## 66.2 产品阶段目标

### 第二阶段（在 MVP 基础上增加）

```text
Requirement Management / Architecture Graph / Traceability Graph /
ADR / Design Review Workflow / Agent Workflow / Multi-Agent /
Automated Verification
```

重点形成 Requirement / Design / Review / Agent / Code / Test 之间的双向关联。

### 第三阶段：Robot Engineering

针对机器人软件开发增加：

```text
Robot Capability / ROS2 Node / Topic / Service / Action / Message /
Hardware / Device / Component / State Machine / Behavior Tree /
Simulation / Real Robot
```

例如：

```text
Capability → ROS2 Interface → Node → State Machine → Implementation
→ Simulation Test → Real Robot Test
```

最终形成 Robot Studio 自己的 **Robot Engineering Knowledge Graph**。

## 66.3 后续设计任务

产品层面的核心设计（本整合版覆盖的内容）已经比较完整，下一阶段建议进入：

## DES-011 — Engineering Object Storage & Traceability Graph

重点定义：

- PostgreSQL 数据模型
- Engineering Object 表设计
- Revision / Version
- Relation / Edge
- Review / Task / Run
- Workflow Version
- Evidence
- Traceability Graph
- Event Store
- Audit Log
- Git Commit / MR 映射
- 数据一致性与事务边界

这一步之后，就可以从「产品设计」真正进入 Robot Studio 的 **Backend Data Model + API Design** 阶段。

---

# 附录

# 附录 A：源设计文档索引

| 文档 | 标题 | 状态 | 在本整合版中的位置 |
|---|---|---|---|
| 主文档 | Robot Studio — Document-Driven Agent Engineering Workspace 初始需求与设计文档（v0.1） | Draft | 第一、三、四、九、十、十一、十二部分 |
| DES-003 | Document Anchor & Review Thread Model（v0.1） | Draft | 第四部分 |
| DES-004 | Agent Context Builder（Draft） | Draft | 第五部分 |
| DES-005 | Agent Execution & Harness Loop（Draft） | Draft | 第六部分 |
| DES-006 | Engineering Workflow & State Graph（Draft） | Draft | 第七部分 |
| DES-007 | Robot Studio System Architecture & Module Boundary（Draft） | Draft | 第二部分 |
| DES-008 | Plugin & Provider SDK（Draft） | Draft | 第八部分 |
| DES-009 | Robot Studio Workflow DSL & Execution Schema（Draft） | Draft | 第七部分 |
| DES-010 | Robot Studio Workflow Designer & Human-in-the-Loop UX（Draft） | Draft | 第九部分 |

源文档间的设计依赖链：

```text
Engineering Object Model（主文档）
        ↓
Document Anchor & Review（DES-003）
        ↓
Context Builder（DES-004）
        ↓
Agent Harness（DES-005）
        ↓
Workflow & State Graph（DES-006）
        ↓
System Architecture（DES-007）
        ↓
Plugin & Provider SDK（DES-008）
        ↓
Workflow DSL / Runtime（DES-009）
        ↓
Workflow Designer & HITL UX（DES-010）
        ↓
DES-011（待设计：Storage & Traceability Graph）
```

# 附录 B：对象与状态机速查表

## B.1 Engineering Object 类型与 ID 前缀

| 类型 | ID 前缀 | 生命周期定义位置 |
|---|---|---|
| Requirement | RQ- | 第 11.1 节 |
| Specification | SPEC- | 第 11.2 节 |
| Design | DES- | 第 11.3 节 |
| Decision / ADR | ADR- | 第 11.4 节 |
| Review | REV- | 第 18–19 章 |
| Task | TASK- | 第 12.1 节 |
| Agent Run | RUN- | 第 12.2 节 / 第 27 章 |
| Change | CHG- | 第 12.4 节 |
| Test | TEST- | 第 13.1 节 |
| Verification | VER- | 第 13.2 节 |
| Document Version | DOC-x@n | 第 15 章 |

## B.2 核心状态机速查

| 对象 | 状态流 |
|---|---|
| Requirement | DRAFT → IN_REVIEW → APPROVED → IMPLEMENTING → VERIFIED → DONE（或 CANCELLED） |
| Design | DRAFT → IN_REVIEW → APPROVED → IMPLEMENTED → VERIFIED |
| Decision / ADR | PROPOSED → ACCEPTED → SUPERSEDED（或 REJECTED） |
| Review | OPEN → DISCUSSING → ACCEPTED → IMPLEMENTING → IMPLEMENTED → VERIFYING → RESOLVED；旁路：REJECTED / DUPLICATED / NEEDS_REVIEW；VERIFYING → FAILED → IMPLEMENTING |
| Anchor | VALID / MOVED / MODIFIED / OUTDATED / ORPHANED（与 Review Status 分离） |
| Task | TODO → PLANNING → READY → RUNNING → WAITING_REVIEW → DONE；异常：BLOCKED / FAILED / CANCELLED |
| Agent Run | CREATED → CONTEXT_READY → PLANNING → PLAN_REVIEW → APPROVED → EXECUTING → OBSERVING → EVALUATING → VERIFYING → COMPLETED；异常：RETRYING / HUMAN_REVIEW / FAILED / CANCELLED |
| Change | PROPOSED → IN_REVIEW → APPROVED → COMMITTED → MERGED（或 REJECTED） |
| Verification | PENDING → RUNNING → PASS / FAIL |
| Workflow Run | CREATED → RUNNING →（PAUSED / WAITING_APPROVAL）→ COMPLETED / FAILED / CANCELLED |
| Human Approval 节点 | PENDING → APPROVED / REJECTED / EXPIRED / CANCELLED |
| Workflow Definition | DRAFT → VALIDATED → PUBLISHED → DEPRECATED |
| Thread | OPEN / RESOLVED |

## B.3 关键决策/原则一览

1. Review 绑定工程上下文而非行号；Anchor = Structural + Textual + Positional + Fingerprint。
2. Review Status 与 Anchor Status 分离；文档变化不能自动删除 / 自动 Resolve Review。
3. Agent Context 是工程对象（Bundle + Snapshot + Policy + Budget）。
4. Loop 是 Harness 的，不是 Prompt 的；状态只能由 Harness 修改。
5. Workflow 是声明（DSL），UI 只是编辑器；Definition 与 Run 分离，Run 绑定不可变 Version。
6. Workflow / Harness / Agent / Tool 四层职责分离：Workflow 决定何时、Harness 决定怎么受控、Agent 决定怎么解决、Tool 决定怎么执行。
7. Verification 不等于 Agent 说完成——重要 Review 需要独立验证。
8. Core 不绑定厂商；所有外部能力经 Provider / Plugin 接入；所有动作经 Harness Policy。
9. 外部对象统一映射 Engineering Object，汇入同一条 Traceability 链。
10. 高风险操作（硬件、刷写、发布、合并）默认关闭，Policy + Human Approval 双重控制。
11. 第一阶段 Modular Monolith，先证明 Document → Review → Agent → Verification 闭环，再扩展平台能力。
12. 机器人场景 Simulation First；Hardware Tool 默认 REQUIRE_APPROVAL。

---

**（全文完）**





