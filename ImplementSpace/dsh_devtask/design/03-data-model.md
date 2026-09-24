# 数据模型（Data Model）

## 1. 两套存储

| 数据 | 存储位置 | 生命周期 |
| --- | --- | --- |
| 视图定义（tab） | `$DSH_HOME/devtask/registry.json` | 持久，随插件本地管理 |
| OKR 层级与任务 | 飞书多维表格「系统软件组OKR管理」的**三张表** | 权威源，实时读写 |
| 员工名册 | 三张表「负责人」字段的并集动态提取 | 不落盘，每次读取去重 |

**没有本地任务副本**。`registry.json` 只存 `DevTaskRegistry`（见 §4）；删除它仅丢视图 tab，OKR 与任务全部在飞书侧。

## 2. Bitable 结构：三张表撑起 OKR 层级

数据源 app_token `CoFgbBbduamIMwsu8CccyU50nnf`，共 5 张表，DevTask 消费前 3 张：

```
🎯Objective（目标）  tblXtvkNiyPEvNef    3 条   ← O 层
   └─ 📈KR（关键结果） tbl4NfvZx6Txxtc7  19 条   ← KR 层，「Objective（目标）」link 指回 O 表
        └─ 📋OKR 任务拆解 tblKMr0kmSVq7Ibn 91 条 ← 任务层，「KR（关键结果）」link 指向 KR 表
             └─ 「父记录 2」link（表内自链接）      ← 模块子任务层（任务 → 底盘/定位/导航模块）
```

另两张（💡OKR管理方法介绍、数据表）与任务无关，不读取。

### 2.1 📋OKR 任务拆解（tblKMr0kmSVq7Ibn）

| 多维表格字段 | 类型 | → TaskRecord | 说明 |
| --- | --- | --- | --- |
| `任务` | text | `title` | 空标题行读取时跳过 |
| `任务状态` | select | `status` | 见 §3 状态映射 |
| `负责人` | user | `employeeId` | open_id + name，汇入名册 |
| `进展描述` | text | `description` | |
| `任务进度` | number | `progress` | 0–1；少数记录有值 |
| `开始日期` | datetime | `startDate` | 甘特图时间条起点；与预计完成日期都为空 ⇔ 未排期 |
| `预计完成日期` | datetime | `dueDate` | 甘特图时间条终点；周期筛选依据 |
| `父记录 2` | link(自表) | `parentId` | 任务 → 模块子任务（表内层） |
| `KR（关键结果）` | link(→KR 表) | `krId` | **任务 → KR 的跨表父子**，OKR 层级的关键 |

写入方向只开放：`任务`、`任务状态`、`进展描述`、`负责人`。

### 2.2 📈KR（关键结果）（tbl4NfvZx6Txxtc7）

| 字段 | 类型 | → OkrKeyResultRecord | 说明 |
| --- | --- | --- | --- |
| `KR（关键结果）` | text | `title` | 如 "O1KR1: 移动子系统ROS2发布…" |
| `Objective（目标）` | link(→O 表) | `objectiveId` | 指回 🎯 表 |
| `负责人` | user | `ownerIds` | 常为多人 |
| `KR任务进度` | text | `progress` | "59.0%" → 59，见 §2.4 |

### 2.3 🎯Objective（目标）（tblXtvkNiyPEvNef）

| 字段 | 类型 | → OkrObjectiveRecord | 说明 |
| --- | --- | --- | --- |
| `Objective（目标）` | text | `title` | 如 "O1: 中间件版本开发迭代和持续支持" |
| `负责人` | user | `ownerIds` | 常为多人 |
| `目标周期` | select | `period` | 如 "2026 H2" |

### 2.4 值解析容错

- `datetime`：lark-cli 可能返回毫秒时间戳或 ISO 字符串，`asDate()` 两者都规范化。
- `link`：取第一个关联记录的 `id`。
- `user`：任务表取第一人（`asUser`），O/KR 表取全部（`asUsers`）。
- 进度文本：`asPercent("59.0%") → 59`；纯数字 ≤1 视为比例，>1 视为百分数。

## 3. 状态映射

```
未开始  ──▶  todo      (读)
进行中  ──▶  running
已完成  ──▶  done
backlog ──▶  未开始    (写，回退)
todo    ──▶  未开始
running ──▶  进行中
done    ──▶  已完成
failed  ──▶  未开始    (写，回退)
```

`backlog` / `failed` 无表格对应项，拖入后刷新会回到 `todo`——本地暂存语义。

## 4. registry.json 结构

```json
{
  "version": 1,
  "activeViewId": "<uuid>",
  "agents": [
    {
      "id": "<uuid>",
      "name": "Alpha",
      "description": "检索与资料整理",
      "status": "provisioning",
      "createdAt": "2026-09-24T…",
      "updatedAt": "2026-09-24T…"
    }
  ],
  "views": [
    {
      "id": "<uuid>",
      "name": "软件组",
      "scope": "team",
      "employeeId": null,
      "order": 0,
      "createdAt": "2026-09-23T…"
    }
  ]
}
```

- 首次装载 seed 默认「软件组」团队视角视图。
- `normalize()`：修复 activeViewId 指向已删视图、旧版无 scope 行升级、按 `order` 排序。
- `agents` 为旧 registry 缺省字段：读路径 `Array.isArray` 兜底迁移为 `[]`；`sanitizeAgents()` 丢弃畸形行（缺字段 / 状态非法）而不是失败——registry 是允许手改的 JSON，容忍局部损坏。
- 删除视图时 `order` 重排；最后一个视图不可删。

## 5. 线协议类型（protocol.ts）

### TaskStatus / TaskPriority

```ts
TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed']  // 即泳道列序
TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3']                        // 表格无此字段，默认 p2，UI 不展示
```

### TaskView

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 稳定随机 id |
| `name` | string | tab 显示名；个人视图默认取员工名 |
| `scope` | `'team' \| 'individual'` | team = 全员；individual = 绑定一人 |
| `employeeId` | string \| null | individual 必填（open_id）；team 为 null（有意义，非缺数据） |
| `order` | number | tab 排序（升序） |
| `createdAt` | string | ISO |

### TaskRecord

| 字段 | 类型 | 来源 |
| --- | --- | --- |
| `id` | string | Bitable record id（`rec…`） |
| `employeeId` | string \| null | 负责人 |
| `title` | string | 任务 |
| `description` | string | 进展描述 |
| `status` | TaskStatus | 任务状态（映射后） |
| `priority` | TaskPriority | 恒 p2（占位） |
| `parentId` | string \| null | 父记录 2（**表内**：任务 → 模块子任务） |
| `krId` | string \| null | KR（关键结果）link（**跨表**：任务 → 📈KR 表记录）；未关联为 null |
| `startDate` | string \| null | 开始日期（ISO）；甘特图时间条起点 |
| `dueDate` | string \| null | 预计完成日期（ISO）；甘特图时间条终点 |
| `progress` | number \| null | 任务进度（0–1） |
| `tags` | string[] | 表格无对应字段，内存占位 |
| `updatedAt` / `createdAt` | string | 读取时刻（表格无此字段） |

### OkrObjectiveRecord / OkrKeyResultRecord

```ts
OkrObjectiveRecord = { id, title, ownerIds: string[], period: string }
OkrKeyResultRecord = { id, title, objectiveId: string | null, ownerIds: string[], progress: number | null }
```

`progress` 为 0–100 百分数（表格 `KR任务进度` 为 "59.0%" 文本）。

### AgentRecord

```ts
AGENT_STATUSES = ['provisioning', 'running', 'idle', 'inactive', 'failed']  // 五态，与 devReviewer TeamMemberSummary 对齐
AgentRecord = {
  id: string          // 稳定随机 id（uuid）
  name: string        // 花名册内唯一（store 强制）
  description: string // 职责 / 备注，可空串
  status: AgentStatus
  createdAt: string   // ISO
  updatedAt: string   // ISO
}
```

Agent 是 **registry 自管的本地数据**（不是 Bitable 概念）：新建落 `provisioning`，状态由用户在界面上手工流转；名称唯一性、状态白名单（`isAgentStatus`）都在 store 侧强制，读取侧清洗畸形行。

### DevTaskState

```ts
{
  views: TaskView[]
  agents: AgentRecord[]              // registry 花名册，随 state 下发
  tasks: TaskRecord[]
  objectives: OkrObjectiveRecord[]   // 🎯 表全量
  keyResults: OkrKeyResultRecord[]   // 📈 表全量
  activeViewId: string | null
  employees: OkrEmployee[]           // 三表负责人并集，open_id → name
}
```

**tasks / objectives / keyResults 都是全量**，过滤只在浏览器侧按视图归属 + 显示周期进行。这保证看板与项目视图消费同一来源，且 tab 切换不来回请求。`agents` 同为全量，但不参与任务过滤链（见 02 §3.4）。

## 6. 层级模型

```
O（🎯 表 record）
 └─ KR（📈 表 record，objectiveId → O）
     └─ 任务（📋 表 record，krId → KR）
         └─ 模块子任务（📋 表 record，parentId → 任务）
```

组件侧约定（OkrProjectView.buildTree）：

- `krId === null` 的任务、或 krId 指向不存在/不可见 KR 的任务 → 归入「未关联 KR 的任务」末尾区；
- `objectiveId === null` 的 KR → 归入「未关联目标的 KR」末尾区；
- 可见性：KR 含 ≥1 条可见任务才成树；O 含 ≥1 条可见 KR 才渲染。O/KR 骨架与任务列表解耦——周期/归属过滤只影响任务计数与推导进度，不掀翻整棵树的形状。

## 7. 视图与过滤的叠加顺序

```
state.tasks
  │ 归属过滤：team → 全部；individual → employeeId === view.employeeId
  ▼
activeTasks
  │ 周期过滤：按 dueDate（无日期者保留）；custom 用起止端点，单侧可缺
  ▼
filteredTasks ──▶ 看板 / OKR 树 / 甘特图（各图表只消费这一份）
```

归属与周期过滤都在浏览器侧完成，无额外请求。
