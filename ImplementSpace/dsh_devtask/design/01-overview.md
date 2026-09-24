# 设计概述（Overview）

> DevTask 插件（包名 `dsh-devtask`）是 DevBuddy 家族的左侧栏任务插件，以**飞书多维表格（Bitable）为唯一数据源**，承载团队任务的看板管理、OKR 目标拆解与按人/按周期的视图管理。

## 1. 背景

DevBuddy 家族已有三个插件：左栏主插件 `dsh-devbuddy-left`（工程文档）、右栏评审插件 `dsh-devreviewer`（评审驱动实施）。团队的实际任务数据此前分散在飞书「系统软件组OKR管理」多维表格中，DevBuddy 侧没有任何界面可以消费它。

DevTask 补上这一环：**不另建任务存储，直接把多维表格渲染为可操作的看板与 OKR 视图**。编辑、流转、指派全部回写原表，飞书侧与 DevBuddy 侧始终是同一份数据。

## 2. 目标

| 目标 | 说明 |
| --- | --- |
| Bitable 即数据源 | 任务的增删改查全部通过 lark-cli 读写「系统软件组OKR管理」多维表格（O/KR/任务三张表），仅视图（tab）定义留在本地 registry |
| 多视角视图 | 默认「软件组」团队视角；新增视图绑定一名员工，形成个人视角 |
| 状态泳道看板 | 五列泳道（待办池/待开始/进行中/已完成/失败），拖拽即流转，回写「任务状态」字段 |
| OKR 项目视图 | 以「目标(O) → 关键结果(KR) → 任务 → 模块子任务」四层层级展示当前任务状态与进度 |
| 周期筛选 | 全部/本周/本月/本季度/自定义起止日期，按任务截止日期过滤 |
| 图表类型切换 | 看板（Kanban）/ 项目（OKR 树）/ 甘特图（起止时间条）/ 活动（变更事件流）/ Agent 花名册，固定工具栏切换；默认「本周 + 项目」，每个视图 tab（软件组/各员工）各自记住自己的布局（图表类型 + 周期），切走再切回复原 |

## 3. 核心设计原则

1. **单一数据源，双向映射**。多维表格是任务的唯一权威存储；DevTask 只做字段映射（任务/任务状态/负责人/任务进度/KR 链接/父记录等），不做本地任务副本。删除本插件的 registry.json 不会丢任务。
2. **视图是本地概念，任务不是**。Bitable 没有「视图」，header tab 的视角定义（团队/个人、绑定员工、排序）持久化在 `$DSH_HOME/devtask/registry.json`；任务列表永远实时从表格读取。
3. **过滤规则在全图表间一致**。显示周期与归属视角的过滤发生在数据进入任何图表之前（`filteredTasks`），看板、OKR 视图、未来的甘特图共享同一份过滤结果。
4. **host 权威，浏览器无状态**。所有变更经 `/api/devtask/*` 落到 host，host 返回最新全量 state，浏览器用返回值替换本地快照；仅「切换 tab」为纯客户端即时操作（后台静默持久化）。
5. **状态集合在插件侧封顶**。插件有五态（backlog/todo/running/done/failed），表格仅有三选项（未开始/进行中/已完成）。读取时三选映射为 todo/running/done；写入时 backlog/failed 归入未开始——插件侧的状态集合不被表格收缩。

## 4. 与兄弟插件的关系

| 维度 | 左栏主插件 `dsh-devbuddy-left` | 右栏插件 `dsh-devreviewer` | 左栏 DevTask `dsh-devtask` |
| --- | --- | --- | --- |
| 位置 | dsh 左侧栏 | dsh 右侧栏 panel 席位 | dsh 左侧栏 family 行 + 中列 DOM 接管 |
| 职责 | 工程文档组织与编辑 | 评审创建/流转/下发 Agent | 团队任务看板与 OKR 拆解 |
| API 前缀 | `/api/devbuddy-left/*` | `/api/devreviewer/*` | `/api/devtask/*` |
| 数据存储 | 项目 registry + 项目目录节点文件 | 共享左栏 registry + review 记录 | 飞书 Bitable + 本地 devtask/registry.json（仅视图） |
| bundle | `devbuddy-left` | `devreviewer` | `devtask` |

三者是**独立 bundle、独立 API 前缀、可同一 web profile 共存**的协作关系。

## 5. 核心术语

| 术语 | 含义 |
| --- | --- |
| Bitable | 飞书多维表格，DevTask 的任务数据源（app `CoFgbBbduamIMwsu8CccyU50nnf`，含 🎯Objective / 📈KR / 📋任务拆解 三张表，link 字段跨表关联） |
| 目标（O） | 🎯Objective 表中的一行，OKR 层级第 1 层；含标题、负责人、目标周期字段 |
| 关键结果（KR） | 📈KR 表中的一行，经「Objective（目标）」link 挂到目标下；含标题、负责人、KR任务进度（自报进度）字段 |
| OKR 节点 | 项目视图中的目标行，即 🎯Objective 表记录 |
| 任务拆解 | 📋任务拆解表中的一行，经「KR（关键结果）」link 挂到 KR 下；模块子任务由表内「父记录 2」自关联 |
| 视图（View） | header tab 的视角定义：`team`（全员）或 `individual`（绑定一名员工） |
| 泳道 | 看板的一列，对应一个任务状态（五态） |
| 五态 | backlog / todo / running / done / failed |
| 显示周期 | 任务过滤器：全部/本周/本月/本季度/自定义（按截止日期） |
| 图表类型 | 展示格式：看板 / 项目（OKR 树）/ 甘特图 / 活动 / Agent |
| 活动事件 | Bitable 记录历史（record-history-list）聚合出的一条变更：操作人、时间、字段 before → after |
| Agent | registry 自管的本地 agent 花名册条目（名称/描述/五态），与 Reviewer 的 TeamMemberSummary 语义对齐；不接真实运行时 |

## 6. 非目标（Non-Goals）

- 不做飞书 OAuth / 多账号：统一以 lark-cli 管理的 bot 身份访问，凭证问题由 lark-cli 负责（`lark-cli auth status`）。
- 不做任务评论、附件、@提醒等 IM 化能力（表格没有这些字段，回写也无处安放）。
- 不做甘特图的拖拽改期/依赖连线：甘特图是只读时间条（表格的起止日期暂不回写，编辑走任务弹窗的标题/状态/描述）。
- 活动视图不做实时推送/增量订阅：靠 60s host 缓存 + 手动刷新（`fresh=1`），数据源是拉取式的 record-history-list，无 webhook 通道。
- Agent 视图不接真实 agent 运行时：花名册与状态是 registry 里的本地数据，状态流转（provisioning/running/idle/inactive/failed）由用户在界面上手工标记，插件不启动/监控任何进程。
- 不做本地任务缓存层作为数据源：state() 始终 Bitable 实时读；「秒开」用的 DevTaskState 快照（state-cache）只是渲染便利，陈旧即被刷新结果替换，永远不是权威。

## 7. 里程碑

| 里程碑 | 内容 | 对应文档 |
| --- | --- | --- |
| M1 | 左侧栏挂载 + 看板视图 + Bitable 读写 | 02 / 03 / 04 |
| M2 | 多视角视图（团队/个人）+ 员工名册动态提取 | 03 |
| M3 | 任务层级（父记录）在看板中的嵌套展示 | 03 |
| M4 | 周期筛选（含自定义起止）+ 图表类型工具栏 | 02 |
| M5 | OKR 项目视图（目标 → 拆解树 + 进度） | [05-okr-project-view.md](./05-okr-project-view.md) |
| M6 | 甘特图（起止时间条 + 自适应刻度 + 今日线） | 02 |
| M7 | 活动事件视图（record-history 聚合 + 60s 缓存时间线） | 02 / 04 |
| M8 | Agent 视图（registry 自管花名册 CRUD）+ 视图 tab 布局记忆 + state 快照秒开 | 02 / 03 / 04 |

## 8. 设计文档索引

| 文档 | 内容 |
| --- | --- |
| [02-architecture.md](./02-architecture.md) | 运行时拓扑、双面插件、模块划分、数据流 |
| [03-data-model.md](./03-data-model.md) | 协议数据模型、Bitable 字段映射、registry 结构 |
| [04-api-protocol.md](./04-api-protocol.md) | `/api/devtask/*` 端点契约 |
| [05-okr-project-view.md](./05-okr-project-view.md) | OKR 项目视图：层级组装、进度推导、交互 |
