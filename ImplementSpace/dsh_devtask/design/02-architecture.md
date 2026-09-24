# 架构设计（Architecture）

## 1. 运行时拓扑

```
┌──────────────────────────────────────────── dsh 宿主进程 ───────────────────────────────────────────┐
│                                                                                                      │
│  ┌──────────────┐   cordis 插件加载   ┌─────────────────────┐                                         │
│  │ dsh web      │ ──────────────────▶ │ dsh-devtask (host)  │ lib/index.js                            │
│  │ server :3080 │                     │  apply(ctx)         │                                         │
│  └──────┬───────┘                     └─────────┬───────────┘                                         │
│         │                                       │ ctx.webServer.register(route)                      │
│         │ /api/devtask/*                        ▼                                                     │
│         │                            ┌─────────────────────┐        ┌──────────────────────────┐     │
│         │                            │ DevTaskStore        │ ─────▶ │ bitable-client           │     │
│         │                            │  - registry.json    │        │  execFile('lark-cli')    │     │
│         │                            │    (仅视图定义)      │        └────────────┬─────────────┘     │
│         │                            └─────────────────────┘                     │ HTTPS               │
│         │                                                                       ▼                     │
│         │                                                      飞书开放平台 Bitable OpenAPI               │
│         │                                                      「系统软件组OKR管理」多维表格              │
│         │                                                      state() 三表并行聚合：                     │
│         │                                                       🎯Objective ─┐                          │
│         │                                                       📈KR ────────┼─▶ O→KR→任务→子任务       │
│         │                                                       📋任务拆解 ──┘                          │
│         │                                                                                              │
│         │ 浏览器注入 (platform: web)                                                                   │
│         ▼                                                                                              │
│  ┌──────────────────────────────────────────────┐                                                    │
│  │ dsh-devtask (client) lib/client.js            │                                                    │
│  │  sidebar-entry → panel 中列 DOM 接管          │                                                    │
│  │  DevTaskPanel ─ api.fetch('/api/devtask/*')   │ ───────────────────────────────────────────────────┘
│  └──────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

DevTask 是**双面插件**：host 半（Node，`src/index.ts` → `src/host/*`）提供 loopback HTTP API；浏览器半（`src/client/*`）渲染面板。两侧通过 `src/protocol.ts` 共享线协议类型，浏览器 bundle 内联该模块。

## 2. 模块划分

### host 半

| 模块 | 职责 |
| --- | --- |
| `src/index.ts` | cordis 插件入口，`apply(ctx)` 注册路由，注册期打印挂载日志 |
| `src/host/store.ts` | `DevTaskStore` 门面：视图 CRUD（registry）+ 任务 CRUD（Bitable）+ `state()` 聚合 |
| `src/host/bitable-client.ts` | lark-cli 子进程封装：O/KR/任务三表列表（分页）、创建、更新、删除；字段映射与值解析 |
| `src/host/routes.ts` | `/api/devtask/*` 路由注册与错误映射 |
| `src/host/json-store.ts` | registry.json 的加锁读写（`readJson` / `withLockedJson`） |
| `src/host/dsh-home.ts` | `DSH_HOME` 解析（环境变量优先，回退 `~/.dsh`） |

### 浏览器半

| 模块 | 职责 |
| --- | --- |
| `src/client/index.tsx` | 客户端入口，装配面板与翻译 |
| `src/client/devtask-mount.tsx` | 面板挂载：左侧栏 family 行 + 中列 DOM 级接管 |
| `src/client/family/*` | 侧栏行与 panel 挂载的核心逻辑 |
| `src/client/DevTaskPanel.tsx` | 面板主体：header、tab 栏、工具栏、看板/项目视图分发 |
| `src/client/OkrProjectView.tsx` | OKR 项目视图：目标 → 拆解树（见 05） |
| `src/client/GanttView.tsx` | 甘特图视图：起止时间条 + 自适应刻度 + 今日线（见 §3.7） |
| `src/client/ActivityView.tsx` | 活动事件视图：记录历史聚合的时间线（见 §3.8） |
| `src/client/AgentView.tsx` | Agent 视图：registry 花名册的创建 / 状态流转 / 删除（见 §3.10） |
| `src/client/state-cache.ts` | DevTaskState 快照缓存：模块级变量 + localStorage 双写，秒开渲染（见 §3.11） |
| `src/client/TaskCard.tsx` | 看板任务卡片（memo，拖拽源） |
| `src/client/TaskEditDialog.tsx` | 任务新建/编辑对话框 |
| `src/client/ViewCreateForm.tsx` | 新增视图表单（员工下拉） |
| `src/client/locales.ts` | `devTaskLeft` 命名空间的中英字典 |
| `src/client/styles.ts` | 面板全部 CSS（注入为虚拟样式表） |

## 3. 关键设计决策

### 3.1 Bitable 客户端 = lark-cli 子进程

不直接调用飞书 HTTP API，而是 `execFile('lark-cli', ['base', '+record-list', ...])` 解析 JSON 输出。原因：

- 凭证由 lark-cli 统一管理（bot 身份），插件零密钥配置；
- 与 DevBuddy 家族其他飞书能力共用同一套认证体系；
- 失败时 stderr 尾部即用户可见错误信息，透传即可。

代价：每次 `state()` 是三个表各自的（或多次分页）子进程调用（并行执行），延迟在百毫秒级；`state()` 不做缓存，换取强一致。

### 3.2 五态 vs 三选项

表格「任务状态」只有 未开始/进行中/已完成 三个 select 选项。插件保留五态泳道，映射规则：

- 读：未开始→todo、进行中→running、已完成→done（backlog/failed 列恒为空）
- 写：backlog/todo→未开始、running→进行中、done→已完成、failed→未开始

即 **backlog/failed 两列的拖拽会静默落回未开始**——翻页/刷新后任务回到待开始列。这是插件态集合宽于数据源态集合的必然结果，设计上接受（ backlog/failed 作为本地临时暂存区使用）。

### 3.3 OKR 层级跨三张表、四层

OKR 层级不是单表字段能表达的，它通过 link 字段跨三张表组织：

```
🎯Objective（目标表）          「Objective（目标）」◀── 📈KR 表「Objective（目标）」link 字段
📈KR（关键结果表）             「KR（关键结果）」◀── 📋任务表「KR（关键结果）」link 字段
📋任务拆解（任务表）           「父记录 2」──▶ 表内自关联，任务 → 模块子任务
```

- store 层 `Promise.all` 并行拉三张表，`state()` 聚合成 `objectives / keyResults / tasks` 三份数组；
- 关联纯靠记录 ID 字符串匹配（`krId` / `objectiveId`），无外键保证，聚合与兜底规则见 05；
- 第 4 层（模块子任务）只做单层嵌套，不再递归——表格数据实测最深两级。

看板与 OKR 视图消费同一份聚合结果：看板拍平成带缩进的卡片列表，OKR 视图组装成四层树（见 05）。

### 3.4 过滤在图表之上

周期与归属过滤统一在 `DevTaskPanel` 的 `filteredTasks`（useMemo）完成，位于所有图表分发之前：

```
state.tasks ──归属过滤(activeView)──▶ activeTasks ──周期过滤(period)──▶ filteredTasks ──▶ board / okr / gantt
activeTasks ─────────────────────────────────────────────────────────────▶ activity（事件流不按截止周期过滤）
state.agents ───────────────────────────────────────────────────────────▶ agent（registry 本地数据，不经任务过滤链）
```

任何新图表直接消费 `filteredTasks` 即自动获得全部筛选能力。活动视图是例外：它按 record id 只做归属过滤（`activeTasks`）——事件是已发生的变更，无截止日期的任务同样会产生事件，按周期过滤会丢历史。Agent 视图同理不消费 `filteredTasks`：花名册是 registry 本地数据，与任务过滤链正交。

### 3.5 无截止日期任务的保留策略

周期筛选（含自定义区间）**不丢弃** `dueDate === null` 的任务：未排期任务是活跃工作项，不应因查看"本月"而消失。自定义区间只填一个端点时做单侧过滤。

### 3.6 tab 切换的即时性

切换视图 tab 是纯客户端操作：本地 `setState` 立即更新 `activeViewId` 并触发重渲染，`api.selectView` 后台静默持久化，返回后再次 setState 对齐。渲染路径上没有网络往返，切换零延迟。

### 3.7 甘特图：百分比定位 + 自适应刻度

甘特图不引第三方库（保持单一 client.js、无额外资产），纯 CSS 百分比定位：

- **时间条**：`left` / `width` 均为百分比，整图无横向滚动；条底色 = 状态色 22% 透明度，内部叠加进度填充（自身「任务进度」→ 子任务完成比例，与 OKR 视图推导规则一致）。
- **时间域**：取已排期任务起止并集 + 今天，两端按粒度留白，并设最小跨度防条过宽。
- **自适应刻度**：跨度 ≤ 60 天按日、≤ 400 天按周、更长按月；刻度标签控制在 ~10 个（月模式按真实月初定位，标签 1 月带年份）。
- **通高 overlay**：刻度线与「今天」参考线画在一层绝对定位 overlay 上（`left` 偏移避开左侧任务列，`pointer-events: none`），行内容 `z-index` 抬高于其上——一行 DOM 同时服务表头刻度与全部数据行。
- **未排期**：起止日期都缺失的任务不进时间域，排在时间轴下方的「未排期」区；只有一个日期时退化为当日单点条（最小宽度 3px）。
- **层级**：沿用任务表内父子——父任务行 + 缩进子任务行，与看板缩进语义一致；点击标题打开编辑弹窗。

### 3.8 活动事件视图：record-history 聚合 + host 缓存

活动流展示任务表的团队变更历史（新 → 旧）：谁、何时、把哪个任务的哪个字段从什么改成了什么。

- **数据源是 `record-history-list`，不是系统字段**。该表没有「更新时间/创建时间」自动字段（投影直接 NOT_FOUND），`record-list` 拿不到变更时间；每条记录的历史要从 `base +record-history-list --record-id` 逐条拉。
- **host 聚合，浏览器零加工**：`listRecentActivity()` 先 `listTasks()` 拿 record id 与标题，再分批并发（每批 4 条）拉历史，扁平化后按时间倒序取前 limit 条。单条失败跳过，不拖垮整体。
- **懒加载 + 三层缓存**：只有切到本视图才请求；数据流为 localStorage 快照（`activity-cache.ts`，挂载即渲染秒开，跨会话/跨 host 重启仍有效）→ host 内存 60s TTL → 云端 record-history 全量聚合（30–70s，仅前两层都未命中时发生）。第三层在后台跑，落地后原位替换并写回本地快照（按 id 合并，分页追加不缩水）；刷新失败保留本地内容，顶部挂可重试错误行；「刷新」按钮 `?fresh=1` 强制绕过后两层打云端。与 `state-cache.ts` 同范式（模块级变量 + localStorage 双写，惰性初始化）。
- **限流治理（99991400）**：飞书对 record-history 有频控，突发打满会限流，而 lark-cli 对 retryable 限流做长退避内部重试——子进程挂二十多分钟不退出，连 execFile 的 SIGTERM 都不理，上层 Promise 永不 settle，界面永远转圈（2026-09-24 实测复现）。三层治理：
  1. `runCli` 的 execFile timeout 到期改 **SIGKILL**（`killSignal`），回调必触发，挂死必变错误；
  2. 识别限流信封（`ok:false` + `subtype:rate_limit`/code 99991400）抛 `RateLimitError`，整批退避后重试（1s / 3s 两级），仍限流的记录本次放弃、部分数据照常返回；一条都没拉到且撞限流才抛错给界面（错误态 + 重试）；
  3. **inflight 去重**：dsh 双实例会同时挂两份面板、各点一次活动视图，`activityInflight` 把并发请求合并成一次真实拉取，burst 减半。
- **派生字段噪音过滤**：只有白名单字段（任务/任务状态/负责人/进展描述/任务进度/开始日期/预计完成日期/父记录/KR）的变更入流；formula「预计完成时段」、lookup「Objective（目标）」等派生字段的刷屏变更丢弃。update 事件过滤后剩 0 条 change 的整条跳过。
- **浏览器侧归属过滤**：events 带 `recordId`，与 `activeTasks` 的 id 集合求交——individual 视角只看其任务的事件，已删除/被过滤的任务标题渲染为死文本。不按显示周期过滤（见 §3.4）。
- **客户端兜底超时**：`api.ts` 的 request 带 180s AbortController 超时——host 最坏聚合约两分钟（限流退避），再多按挂死处理，超时抛「请求超时，请重试」进错误态，不允许无限转圈。
- **展示约定**：按本地日期分组（今天/昨天/M-d），组内倒序；**每个日期分组可折叠**（点组头切换，组头含 caret + 当天条数，折叠态存于组件本地 state，切走视图即重置）；多字段变更展开 diff 列表；任务标题可点即开编辑弹窗；「加载更多」以 +50 追加 limit（host 每次返回截取后的全量，追加即时生效）。

### 3.9 视图布局记忆：按视图 tab（localStorage）

每个视图 tab（view id）各自记住上次的布局——图表类型 + 显示周期 + 自定义起止。从「软件组」切到「王胡森」再切回，两边还是各自上次的样子，互不串扰；同一员工视角在新会话里也能恢复。默认布局**本周 + 项目**。

- **记忆单位是视图 tab，不是图表类型**：用户口中的「视图」是 header tab（视图名称：软件组 / 各员工），图表类型只是布局的一个维度。key 里存 view id（uuid，host registry 持久化，稳定）：
  - `devtask.viewLayout.v1.<viewId>` → `{ viewType, period, customStart, customEnd }`
- **写用读-改-写合并且只碰本视图的小 key**：dsh client 会以模块加载器与平台动态 chunk 两条路径各装载一份组件，两份实例 state 各自独立；单 key 整体覆写下，后落笔的实例会用自己没有的陈旧字段盖掉新值。每次写只碰本视图的小 key，天然收敛到最新语义。
- **写入时机在 setter**：切图表类型 / 切周期 / 改自定义起止，立即按当前 `activeView.id` 落盘——每个 tab 的 key 永远跟随它最后一次被看到的样子。
- **恢复时机在 activeView.id 变化**：`prevViewIdRef` 起步于首屏激活 id，之后 id 真的变了（点 tab / 新建视图 / 删视图后重指 / host state 首次落地）才换绑工具栏到新 tab 的布局。首屏渲染不走恢复路径（initialLayout 直接从快照的激活 tab 读）。
- **读取必须是每次组件挂载惰性求值**（useState initializer），不能是模块级常量：模块代码只在 chunk 加载时执行一次；SPA 软刷新只重挂组件不重跑模块代码，模块级常量会固化成陈旧值。
- 非法值/存储不可用（隐私模式、quota）一律回退默认布局。

### 3.10 Agent 视图：registry 自管花名册

Agent 花名册是面板里第一块**完整 CRUD 界面**，也是唯一不读 Bitable 的视图——与其余视图「读飞书 + 只读渲染」的气质刻意不同：

- **数据源是 registry.json 的 `agents` 数组**（与视图定义同文件、同锁），`DevTaskState.agents` 随 state 下发。重活（Bitable 三表）之外的轻操作：`createAgent/updateAgent/removeAgent` 是 registry-only 路径，不触发 `fetchState()` 的全量聚合之外的任何 Bitable 读。
- **五态枚举与 devReviewer 的 TeamMemberSummary 对齐**（`provisioning/running/idle/inactive/failed`），两个表面读起来同一套语义；新 agent 落 `provisioning`，之后由用户在卡片上的状态下拉手工流转。状态色板与任务五态不共用（自成一套）。
- **store 侧护栏**：名称必填且trim、花名册内唯一（`agent name already exists`）；patch 的 status 走 `isAgentStatus` 白名单校验；读取时 `sanitizeAgents` 清洗畸形行（旧文件/手改）而不是报错——registry 是给人看的 JSON，容忍部分损坏。
- **前端形态**：工具栏（计数 + 新建）→ 内联创建表单（名称 + 描述）→ 卡片网格（状态彩 pill、描述、创建日期、状态下拉、删除）。mutation 返回的权威 state 直接回写面板，与 `run()` 同一模式。
- **不接真实运行时**：状态只是花名册上的手工标记（见 01 非目标）。

### 3.11 state 快照缓存：秒开渲染

点击 DevTask（或从会话切回）会重挂面板，此前要阻塞在 `state()` 全量拉取（Bitable 三表 + registry，冷启动数秒）之后才渲染。`state-cache.ts` 把这份等待从「白屏」变成「先渲染上次、再静默替换」：

- **模块级变量优先，localStorage 兜底**：模块变量扛 SPA 软刷新（remount 不重跑模块代码），localStorage 扛整页 reload。`looksLikeState` 六数组校验，陈旧/损坏快照降级为 `null`，面板回落 loading 态。
- **写入走 applyState**：所有采纳权威 state 的路径（refresh、run、create/select view 返回、agent mutation）统一 `setState + saveCachedState`，缓存永远跟随面板实际展示内容。
- **刷新期有指示**：`refreshing` flag 在 header 操作区显示「刷新中…」，快照已在屏幕上时不弹 loading 遮断，后台 `api.state()` 落地后原位替换。
- **缓存是便利不是真相**：永远不参与权威决策，任何 mutation 的返回值都会覆盖它。

## 4. 数据流（一次拖拽的完整链路）

```
用户拖拽卡片到「进行中」列
  → TaskCard onDragStart: dataTransfer 写入 task.id
  → 目标列 onDrop: api.moveTask(id, 'running')
  → routes.ts → DevTaskStore.moveTask
  → bitable.updateTask(id, { status: 'running' })
  → lark-cli 子进程 → Bitable「任务状态」= "进行中"
  → store.state() 重新聚合（registry + Bitable 全量）
  → 返回 DevTaskState → 面板 setState 替换快照 → 重渲染
```

每次变更都会重读表格：读的是同一份权威数据，避免本地副本与表格漂移。

## 5. 挂载方式

- **侧栏行**：`sidebar-entry.ts` 注册左侧栏 family 行（与 DevBuddy、DevReviewer 并列），点击展开中列。
- **中列接管**：面板以 DOM 级 takeover 方式占据中列（`devtask-mount.tsx`），不是 iframe。
- **右侧栏开关**：`RightbarToggle.tsx` 经 `ISidebarRight` 控制会话右栏展开/收起。

## 6. 构建与产物

| 产物 | 内容 | 说明 |
| --- | --- | --- |
| `lib/index.js` | host 半 bundle | cordis 插件入口（`main`） |
| `lib/client.js` | 浏览器半 bundle | `platform: web`，经 `dsh` 客户端注入协议装载 |

构建：`pnpm build`（tsdown）。类型检查：`pnpm typecheck`。测试：`pnpm test`（vitest，host store 单测，Bitable 依赖以 `vi.mock` 隔离）。
