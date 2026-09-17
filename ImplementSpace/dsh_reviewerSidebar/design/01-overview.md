# 设计概述（Overview）

> Reviewer 插件（包名 `dsh-devbuddy-reviewer`）是 DevBuddy 的右侧栏插件，承载以 **Review 为驱动**的人机协作工作流。

## 1. 背景

现有 AI Coding 以 **Chat / Prompt / Code** 为核心，存在需求漂移、评审意见与代码缺乏关联、上下文丢失等问题（见 `CoreRequirements.md` 背景章节）。DevBuddy 的左栏主插件解决了工程文档的**组织与编辑**问题，Reviewer 插件则解决**评审如何驱动实施**的问题。

DevBuddy 的核心定位：

> **以工程文档为核心、以 Review 为驱动、以 AI Agent 为执行者、以 Git 为最终变更记录的 Agent Engineering Workspace。**

## 2. 目标

| 目标 | 说明 |
| --- | --- |
| Review Driven | 人的职责是对 Requirement / Design / Implementation 提出评审意见，而不是直接指挥改文件 |
| Inline Review | 在文档中选中一段文字即可发起评审，评审与原文位置精确关联 |
| 全生命周期管理 | Review 经历 OPEN → DISCUSSING → ACCEPTED → IMPLEMENTING → IMPLEMENTED → VERIFYING → RESOLVED，支持 REJECTED / DUPLICATED / NEEDS_REVIEW 分支 |
| Agent Context 装配 | Review 转化为 Agent Task 时，自动聚合文档、决策、代码、测试、Git 历史，而非只发一句评论 |
| Git 可追溯 | 评审记录是工程文档的一部分，随项目目录提交，最终变更由 Git 记录 |

## 3. 核心设计原则

以下原则贯穿全部设计文档，与 DES-003（Document Anchor & Review Thread Model）对齐：

1. **Review 绑定工程上下文，而非行号**。锚点采用「结构 + 文本 + 位置 + 指纹」四层模型（见 05），文档编辑后锚点可漂移校正，而不是行号一变即失效。
2. **Review Status 与 Anchor Status 分离**。Anchor Status（valid / moved / modified / outdated / orphaned）由解析器实时计算、不落盘；Review Status 只经状态机迁移（见 06）。文档变化**不会**自动改变 Review Status，只会产出 `needs_review` 候选提示，由人确认后才迁移。
3. **文档变化不自动删除或关闭 Review**。即使锚点失效（orphaned），Review 记录仍完整保留，等待人工处置。
4. **Agent 可执行 Review，但不可决定 Review**。Agent 可以参与讨论、执行任务、回连状态，但不能产生 Decision（accept / reject 等只能由人作出）。
5. **Review 的 Resolve 须可追溯验证证据**。`implemented → verifying → resolved` 链路要求附验证证据（commit、测试结果等），只允许人最终关闭。
6. **Document / Review / Agent / Code / Test 双向追踪**。通过 `related.documents / commits / agent_runs` 与 commit trailer（`DevBuddy-Review: REV-XXXX`）建立双向链接。

## 4. 与左栏主插件的关系

| 维度 | 左栏主插件 `dsh-devbuddy-left` | 右栏 Reviewer 插件 `dsh-devbuddy-reviewer` |
| --- | --- | --- |
| 位置 | dsh 左侧边栏 | dsh 右侧边栏（会话右栏的 panel 席位） |
| 职责 | 多项目管理、工作流节点文档编辑 | 评审的创建、浏览、流转、发送给 Agent |
| API 前缀 | `/api/devbuddy-left/*` | `/api/devbuddy/*`（左栏 protocol 中已预留） |
| 共享 | 项目注册表 `~/.dsh/devbuddy/registry.json`、项目目录与节点文件约定 | 同左 |
| bundle | `devbuddy-left` | `devbuddy-reviewer` |

两者是**独立 bundle、独立 API 前缀、共享磁盘数据**的协作关系，可在同一 web profile 共存。

## 5. 核心术语

| 术语 | 含义 |
| --- | --- |
| Review | 针对工程文档某一片段的结构化评审记录 |
| Target | Review 指向的文档与原文片段，锚点采用四层模型：structural（headingPath）+ textual（selectedText + prefix/suffix）+ positional（行范围）+ fingerprint（sha256） |
| Type | 评审类型：`question` / `suggestion` / `bug` / `design_issue` / `requirement_issue` / `implementation_issue` / `test_issue` / `exploration` |
| Severity | 严重级别：`info` / `minor` / `major` / `critical`，与 Type 正交 |
| Anchor Status | 锚点健康度：`valid` / `moved` / `modified` / `outdated` / `orphaned`，实时计算、不落盘 |
| Decision | 评审裁决（accept / reject / defer / duplicate / wont_fix），一等公民，仅人可产生 |
| Agent Context | Send to Agent 时装配的完整上下文包 |
| Project | 左栏注册的项目，Review 从属于项目 |

## 6. 非目标（Non-Goals）

- 不做代码静态检查 / Lint 式自动审查；
- 不做评论的 IM 式实时协同（多人在线光标等）；
- 不替代 dsh 原生会话右栏，仅作为其中一个 panel；
- M1 不实现 Git 操作自动化（仅读取历史用于 Context 装配）。

## 7. 里程碑

| 里程碑 | 内容 | 对应文档 |
| --- | --- | --- |
| M1 | 右侧栏挂载 + Review 列表 + Markdown 阅读 | 02 / 04 |
| M2 | Inline Review：选区发起、四层锚点、五态漂移校正（valid ~ orphaned） | 05 |
| M3 | Review 生命周期状态机（含 implemented / verifying / needs_review 与 Decision） | 06 |
| M4 | Send to Agent：Context 装配与任务下发 | 07 |
| M5 | 讨论线程、通知、与左栏编辑器联动打磨 | 03 |

## 8. 设计文档索引

| 文档 | 内容 |
| --- | --- |
| [02-architecture.md](./02-architecture.md) | 运行时拓扑、双面插件、模块划分、与左栏协作 |
| [03-data-model.md](./03-data-model.md) | Review 记录 schema、存储布局、ID 与索引 |
| [04-api-protocol.md](./04-api-protocol.md) | loopback HTTP 接口与线协议 |
| [05-inline-review.md](./05-inline-review.md) | 选区交互、锚点模型、漂移校正、编辑器联动 |
| [06-lifecycle.md](./06-lifecycle.md) | 状态机、权限、并发与通知 |
| [07-agent-integration.md](./07-agent-integration.md) | Agent Context 装配与任务下发 |
