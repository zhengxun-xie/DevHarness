# 任务日志板块（Task Log Panel）

> M9 新增：点击 OKR 项目视图各级标题不再弹编辑窗/跳交付页，改为打开占下半屏的「任务日志板块」。板块汇聚该主体的系统日志与人为工作日志；人为日志的撰写窗口支持引用文档（移植 DevReviewer 的 Approach A）。

## 1. 动机

任务/O/KR 目前只有「当前状态」，没有「发生过什么」。Bitable record-history 只能看字段 diff，且藏在活动流里不成体系；团队真正需要的是围绕一条任务的时间线：谁在什么时候改了状态、谁写了什么进展、引用了哪份设计文档。

同时，原交互（任务标题 → 编辑弹窗、任务层标题 → 交付页跳转）把「查看」与「修改」耦合在同一处点击上，误触率高。本设计把「查看」升级为日志板块，「修改」退到面板头部按钮。

## 2. 交互映射

| 入口 | 原行为 | 新行为 |
| --- | --- | --- |
| OKR 视图 · O 标题 | 静态文本 | 打开日志板块（subject = O） |
| OKR 视图 · KR 标题 | 静态文本 | 打开日志板块（subject = KR） |
| OKR 视图 · 任务标题 | 跳转交付页（onOpenDelivery） | 打开日志板块（subject = 任务） |
| OKR 视图 · 子任务标题 | 编辑弹窗（onEditTask） | 打开日志板块（subject = 子任务） |
| 看板 TaskCard | 编辑弹窗 | **打开日志板块**（全插件统一） |
| 甘特图 · 任务条 | 编辑弹窗 | **打开日志板块** |
| 活动流 · 事件条目 | 编辑弹窗 | **打开日志板块**（天然联动：活动事件本身就是系统日志素材） |

全插件统一后，TaskEditDialog 的唯一入口是日志面板头部「编辑」按钮（新建流程的 creating 弹窗不变）。

**退出**（与任务看板详情面板一致的两种方式）：

- 面板右上角 ✕ 按钮；
- 再次点击同一条目的标题本身（toggle：`selectedSubject` 相同则置 null）。

**原入口去向**：编辑弹窗与交付页跳转不删除，收进日志面板头部按钮区（见 §4 头部），仅在 subject 为任务/子任务时显示「编辑」、任务级显示「交付」。

## 3. 布局（下半屏面板，dsh-taskboard 模式）

`.dtk-root` 已是 flex column（`.dtk-scroll` 为 `flex:1; overflow:auto`）。日志面板作为 `.dtk-scroll` 的**条件渲染兄弟节点**插在其后，滚动区自动让出高度：

```
.dtk-root (flex column, height:100%)
├─ header / tabbar / toolbar …
├─ .dtk-scroll        flex:1 1 auto; min-height:0; overflow:auto   ← 上半图表自动压缩
└─ .dtk-logpanel      flex:none; max-height:55%; min-height:180px  ← 条件渲染
   ├─ .dtk-logpanel-head     标题 + 元信息 + 编辑/交付按钮 + ✕
   └─ .dtk-logpanel-body     flex:1; min-height:0; overflow-y:auto  ← 时间线内滚
```

要点（全部来自 taskboard 已验证的模式）：

- 面板本体 `overflow:hidden`，滚动只发生在 body 内层，避免双层滚动条；
- `key={selectedSubject.id}` 重挂载面板，防止切主体时草稿/确认态泄漏；
- 主体从 state 中消失（被删或被过滤出当前视图）时 `useEffect` 自动清空 `selectedSubject`；
- 面板打开时 body 滚动到底部（时间线倒序展示，最新在上；打开后默认停在最新处，无需滚动）。

## 4. 面板内容

```
┌──────────────────────────────────────────────────────────────┐
│ 📋 移动子系统ROS2 2.0.0主线版本发布   王胡森 · 进行中          │
│    ── 任务 · 更新于 09-11        [编辑] [交付]           ✕   │  ← head：subject 快照 + 动作按钮
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ✍️ 写日志…   [📅 引用文档]                    [发布]     │ │  ← composer（manual 日志入口）
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ● 09-28 14:02  王胡森（手动）                                 │
│ │  底盘模块联调完成，见 [📄 06-task-log §4](devtask-ref://…) │  ← manual：Markdown 渲染
│ │                                                              │
│ ● 09-27 10:15  系统                                           │
│ │  状态流转：待办 → 进行中（谢郑勋）                           │  ← system：插件操作自动记录
│ ● 09-26 18:40  系统                                           │
│ │  创建任务（谢郑勋）                                          │
└──────────────────────────────────────────────────────────────┘
```

- **head**：主体标题 + owner/状态快照；subjectKind 徽章（目标/关键结果/任务/子任务）；
  「编辑」仅任务/子任务（打开 TaskEditDialog），「交付」仅任务级（原 onOpenDelivery 跳转）；
- **composer**：默认收起为单行输入，聚焦展开为多行 Markdown 编辑器；详见 §7；
- **时间线**：`manual` 与 `system` 条目按时间倒序混排；manual 条目 Markdown 渲染（支持 devtask-ref 链接），system 条目纯文本摘要（操作人 + 字段 diff，含飞书侧直改）；manual 条目支持编辑/删除（作者本人），system 条目只读。

## 5. 日志数据模型

```ts
/** 日志主体层级——四层树的任意一层都可以挂日志。 */
type LogSubjectKind = 'objective' | 'kr' | 'task' | 'subtask'

interface AuthorRef {
  type: 'user' | 'system'
  id: string        // user: open_id（来自活动视图）；system: 'devtask'
  displayName: string
}

interface TaskLogEntry {
  id: string                 // TL-0001，自增分配
  subjectId: string          // Bitable record id（O/KR/任务/子任务通用）
  subjectKind: LogSubjectKind
  subjectTitle: string       // 写入时快照；主体被删后仍可显示
  kind: 'system' | 'manual'
  author: AuthorRef
  body: string               // Markdown；manual 可含 devtask-ref:// 链接
  createdAt: string          // ISO
  updatedAt: string | null
}
```

设计取舍：

- **subjectId 通用**：O/KR/任务/子任务统一用 Bitable record id 作外键，不为每层建独立日志表；
- **subjectTitle 快照冗余**：任务删除后（removeTask 后 state 里查无此 id）日志仍可归属展示「已删除：原标题」；
- **system/manual 同一模型**：时间线混排不需要两条渲染管线，只按 `kind` 分样式。system 条目中来自 record-history 的部分是**读取时物化**（不落盘，id 用 `<recordId>:<rev>`），仅删除等 record-history 覆盖不到的事件才持久化为本地 md；
- **manual 独立编辑/删除**：system 条目是事实记录，不开放修改。

## 6. 存储（本地 md 文件，DevReviewer 模式）

- 位置：`$DSH_HOME/devtask/logs/TL-0001-<slug>.md`，一条日志一个文件；
- 格式：YAML frontmatter 权威（schema/id/subject*/kind/author/createdAt/updatedAt）+ body 为人类可读 Markdown 投影；
- 写入：tmp + rename 原子写；编辑/删除携带 sha256 乐观锁；
- 与 registry.json（视图/花名册）平级，构成 DevTask 的第二块本地数据——先例是 agent 花名册「registry 自管本地数据」；
- **不写回 Bitable**：任务表没有日志字段，回写无处安放（01-overview §6 的约束仍成立，但「本地日志」不属回写，见 §10 文档修订）。

frontmatter 示例：

```yaml
schema: 1
id: TL-0001
subjectId: recAbCdEf
subjectKind: task
subjectTitle: 移动子系统ROS2 2.0.0主线版本发布
kind: manual
author:
  type: user
  id: ou_xxx
  displayName: 王胡森
createdAt: "2026-09-28T14:02:00.000Z"
updatedAt: null
---
底盘模块联调完成，详见 [📄 06-task-log §4](devtask-ref://devtask/design/06-task-log.md#L120-L150)
```

## 7. 系统日志：Bitable record-history 为主，本地只补盲区

**单一来源原则**：插件写路径（createTask/updateTask/moveTask）写 Bitable 后必然出现在该记录的 record-history 里——若插件再本地记一条，同一动作时间线上会出现两条。因此：

- **create / update / move（含飞书侧直改）**：不写本地日志，读取时从 `+record-history-list` 按 subject 物化（操作人、字段 before → after 均由 Bitable 提供）；
- **removeTask**：record-history 查不到已删记录（删除是盲区），**唯一本地 system 写入点**——removeTask 成功后追加 `删除任务「<title>」`，靠 subjectTitle 快照展示；
- O/KR 主体同样可查 record-history：现有 `listRecordHistory` 去掉任务表硬编码，按 subjectKind 传 table id（O 表 `tblXtvkNiyPEvNef` / KR 表 `tbl4NfvZx6Txxtc7` / 任务表 `tblKMr0kmSVq7Ibn`）。

读取路径（打开面板时）：

1. 读本地 `logs/` 该 subject 的全部条目（manual + 删除事件）；
2. 单条拉该 subject 的 record-history（1 次 lark-cli 调用，15s 超时），映射为 system 条目；
3. 合并按时间倒序返回。

限流与降级：沿用现有 RateLimitError 治理；record-history 拉取失败时**返回本地条目 + 错误标记**（`historyError` 字段），面板时间线顶部提示「修改历史暂不可用，仅显示本地日志」，不整体失败。本地删除事件写入失败仅 stderr 告警，不阻塞删除任务本身（日志是旁路数据）。

## 8. 人为日志与文档引用（Approach A 移植）

### 8.1 引用格式

沿用 DevReviewer 的「自定义 scheme Markdown 内联链接」：

```
[📄 Title §Heading](devtask-ref://projectId/document.md#L10-L20)
```

- scheme 从 `devbuddy-ref://` 改为 **`devtask-ref://`**（producer-owned，两插件互不劫持）；
- `formatDocRef` / `parseDocRef` / `headingEndLine` 三个纯函数从 dsh_devReviewer `client/doc-ref.ts` 移植（≈100 行）。

### 8.2 文档数据源与跳转：复用 devreviewer API

DevTask 没有项目概念，不自建文档扫描，直接复用同源 loopback 的 devreviewer 端点：

| 用途 | 端点 |
| --- | --- |
| 文档目录（DocRefPicker 第一步） | `GET /api/devreviewer/docs?projectId=` → `DocFileEntry[]` |
| 文档标题列表（第二步） | `GET /api/devreviewer/document?projectId=&path=` → `DocumentResponse.headings` |
| 引用点击跳转 | `sidebarRight.openTab('devreviewer', { params: { projectId, document } })` → ReviewerPanel 已有 `{projectId, document}` 深链路由 |

代价：软依赖 devreviewer 插件启用。 Picker 加载失败时降级为「引用文档不可用」（composer 其余功能不受影响），不复制任何 host 代码。

### 8.3 composer 交互（照搬 ReviewComposer 验证过的细节）

- 「引用文档」按钮 `onMouseDown preventDefault` 防止 textarea 失焦；
- `cursorRef` 暂存光标位置，`requestAnimationFrame` 恢复焦点后在光标处插入链接文本；
- DocRefPicker 为内嵌两步面板（项目文档列表 → 标题列表，`max-height:240px` 内滚），不做弹窗；
- 日志渲染区容器 `onClickCapture` + `closest('a')` + scheme 前缀拦截 → `parseDocRef` → openTab 深链。

## 9. API 契约（遵循 04 的全量/错误体约定）

| 端点 | 说明 |
| --- | --- |
| `GET /api/devtask/logs?subjectId=&subjectKind=[&subjectTitle=]` | `{ entries: 本地条目[], history: record-history 物化 system 条目[], historyError? }`，各自时间倒序 |
| `POST /api/devtask/logs` | 创建 manual 日志（subjectId/subjectKind/subjectTitle/body/author），返回 `{ entries }`（该 subject 操作后的本地条目） |
| `POST /api/devtask/logs/update` | 编辑 manual（id/body/sha 乐观锁），system 拒绝 400，返回 `{ entries }` |
| `POST /api/devtask/logs/remove` | 删除 manual（id/sha），system 拒绝 400，返回 `{ entries }` |

- `entries` 与 `history` 拆开返回：物化条目只在打开面板（GET）时拉一次，写操作不重拉——面板端把 `entries` 整体替换、`history` 保持会话内不变，前端合并倒序渲染；
- `subjectTitle`（GET 可选）：物化条目的标题快照，client 从自己的 state 里带过来；已删除主体传空即可（本地条目自带快照）；
- 端点注册进现有 `devtaskRoutes` 精确路由表，沿用信任围栏与 400/500 分流（正则补 `sha mismatch` / `cannot be modified`）；
- `subjectKind` 决定 record-history 查哪张表（§7）；
- 复用 devreviewer 的 `/docs` `/document` 只发生在 client 侧（fetch 同源），devtask host 不加代理。

## 10. 状态与生命周期

```
DevTaskPanel
├─ selectedSubject: { kind, id, title } | null   ← 唯一状态源（openLogSubject(id) toggle）
├─ TaskLogPanel(subject, onEdit, onDelivery, onClose)   ← key={subject.id} 重挂载
│   ├─ entries + composer 草稿均为面板内部状态（卸载即弃）
│   └─ 日志 CRUD 经 client/api.ts 走 §9 端点
└─ useTabInfo 切走时不卸载（tab 保活），切回仍在
```

- O/KR 层 `ObjectiveNodeRow` / `KrNodeRow` 的静态标题 span 改为 button（保留 `stopPropagation`，不触发行折叠）；
- 打开面板不清上半屏筛选；面板打开时上半屏仍可交互（换主体即换面板内容）。

## 11. 边界情况

| 情况 | 表现 |
| --- | --- |
| 主体被删除（日志仍在） | 面板不可再从树上进入；已打开的面板标题显示 `subjectTitle` 快照 + 「已删除」徽章；record-history 查不到该记录，时间线只剩本地条目（含删除事件） |
| 主体被过滤出当前视图 | `useEffect` 自动关闭面板（selectedSubject 失效） |
| record-history 限流 / 拉取失败 | `historyError` 非空，时间线顶部提示「修改历史暂不可用」，本地日志正常展示 |
| devreviewer 未启用 / docs 请求失败 | DocRefPicker 显示「引用文档不可用」，composer 主体功能可用 |
| 引用链接指向已删除文档 | 点击后 devreviewer 面板显示文档不存在态（其自身空态） |
| 日志 body 为空 | 发布按钮禁用 |
| 多端并发编辑 | sha256 乐观锁冲突返回 400，前端提示刷新 |
| 本地删除事件写失败 | stderr 告警，任务删除不回滚（§7） |

## 12. 既有文档修订

| 文档 | 修订 |
| --- | --- |
| 01-overview §6 非目标 | 「不做任务评论…回写也无处安放」→ 限定为「不写回 Bitable」；本地任务日志（06）除外。新增里程碑 M9 |
| 02-architecture | 活动流「任务标题可点即开编辑弹窗」→ 打开日志板块；文件清单补 TaskLogPanel/LogComposer/DocRefPicker/doc-ref |
| 05-okr-project-view §5 交互表 | 任务/子任务标题点击 → 打开任务日志板块；O/KR 行点击 → 打开任务日志板块 |

## 13. 里程碑拆分

1. **M9a 数据层**：TaskLogEntry 模型 + logs md 存储读写（原子写/sha 锁）+ removeTask 删除事件挂钩 + `listRecordHistory` 三表参数化 + 4 个 API 端点（GET 含 record-history 物化合并）；
2. **M9b 面板骨架**：下半屏面板 + selectedSubject 状态 + 全插件入口改造（OKR 四层标题 / 看板 / 甘特 / 活动流）+ ✕/toggle 退出 + 头部编辑/交付按钮；
3. **M9c composer**：手动日志撰写/编辑/删除 + Markdown 渲染时间线；
4. **M9d 文档引用**：doc-ref 纯函数移植 + DocRefPicker + 光标插入 + 点击深链跳转。
