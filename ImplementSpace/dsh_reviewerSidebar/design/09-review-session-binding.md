# Review ↔ Session 1:1 生命周期绑定（Review Session Binding）

> 目标：每条评审自诞生起就在 agent 会话区拥有一个**专属会话**，会话名 `[评审类型]评审标题`，
> 并用这个会话作为评审生命周期的锚点——评审删除/关闭 → 会话归档，评审重开 → 会话反归档。
> 涉及多领域的评审继续复用已有 Agent Teams 通道（design/08），本设计不破坏它。

## 1. 背景与现状

- 评审生命周期 8 态：`open / needs_review / accepted / implementing / verifying / resolved / rejected / duplicated`，终态 = `resolved/rejected/duplicated`，Reopen = 终态 → `open`（`src/host/lifecycle.ts`、`review-store.ts` `transitionReview`）。
- 现状会话绑定：**只在派发时**发生（`markAgentDispatched`，`accept/open → implementing`），`assignee` 记最后派发目标 sessionId；派发路径是「复用工作区最近会话 / 新建」，**不是 1:1**；评审创建时不建会话；会话生命周期与评审完全脱钩。
- Agent Teams（design/08）P1/P2/P3 已落地：成员选择 + 邮箱派发 + 任务板 + 状态回连，`assigneeMember` / `teamTaskId` 落账。

## 2. 平台会话控制面（已核实）

插件可用的 host 能力（cordis 结构注入，无包依赖）：

| 能力 | 位置 | 形状 |
| --- | --- | --- |
| 创建会话 | `sessionController.create` | `{ workspaceId?, cwd?, sessionId?, agentPreset? } → { sessionId }`（**无 title 入参**） |
| 重命名 | `sessionController.rename` | `{ sessionId, title } → { title, seq }` |
| 派发 | `sessionController.prompt` | `{ requestId, sessionId, mode, content }` |
| 归档 | `workspaceRegistry.archiveSession` | `(sessionId) → void`（registry 全局 archive 集） |
| 反归档 | `workspaceRegistry.unarchiveSession` | `(sessionId) → void`（幂等） |
| 删除会话 | **无公开 API** | 会话列表菜单只有「归档」，归档即从活动会话区移除（软删除，可恢复） |

> **关键约束**：平台没有「删除会话」的 Remote / registry 方法。因此本设计把「评审删除」与「评审关闭」**统一映射为归档**；
> 「评审重开」映射为反归档。这满足用户「会话随之消失/复现」的意图，且可恢复、不丢历史。

## 3. 数据模型

`ReviewRecord`（`src/protocol.ts`）新增：

```ts
/** 评审专属生命周期会话（1:1，创建评审时建立）；null = 未绑定（降级/历史评审）。 */
sessionId: string | null
```

- 与既有 `assignee`（最后派发目标）**语义分离**：`sessionId` 是评审的「家」，`assignee` 是「谁上次干活」。
  - 普通派发：目标是评审自己的 `sessionId`（不再复用/新建别的会话）。
  - Team 派发：目标是 teammate 会话（`assignee` 记 teammate），评审自己的 `sessionId` 仍是归档锚点。
- 历史评审（REV-0001..0003）读入时 `sessionId = null`，不回溯建会话；后续派发时若为 null 则回退旧逻辑。

## 4. 命名规则

```ts
export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  question: '讨论', suggestion: '建议', bug: '缺陷', design_issue: '设计',
  requirement_issue: '需求', implementation_issue: '实现', test_issue: '测试', exploration: '探索',
}
// 会话名 = `[${REVIEW_TYPE_LABELS[type]}]${titleText}`
// titleText = record.title  ??  comment 首行(截断 40 字) ?? reviewId
```

示例：`[建议]项目开发自动化工作流`。

## 5. 生命周期同步（核心）

| 评审事件 | 会话动作 | 实现钩子 |
| --- | --- | --- |
| 创建评审 | 建会话 + 命名（`[类型]标题`） | `ReviewStore.createReview` |
| 删除评审（open/rejected/duplicated） | 归档会话 | `ReviewStore.removeReview` |
| 关闭评审（迁入 resolved/rejected/duplicated） | 归档会话 | `ReviewStore.transitionReview`（`isTerminal(to)` 分支） |
| 重开评审（终态 → open） | 反归档会话 | `ReviewStore.transitionReview`（`isReopen({from,to})` 分支） |
| 标题/类型编辑 | 重命名会话 | `ReviewStore.editReview`（title/type 变更时） |

所有会话动作**尽力而为、永不阻断评审 CRUD**：无 `sessionController` / `workspaceRegistry` / workspace 未绑定时降级为 no-op，评审仍正常创建/流转，`sessionId` 留 null。

## 6. 降级与容错

- 无 `sessionController` → 不建会话、不命名，`sessionId = null`，派发回退旧行为（`delivered:false`）。
- 无 `workspaceRegistry` / 无 `archiveSession` → 归档/反归档 no-op。
- 建会话失败（无 workspace / controller-error）→ 评审照常创建，`sessionId = null`。
- 会话动作全部 `try/catch`，异常只写 stderr，不抛向路由。

## 7. 涉及文件

| 文件 | 改动 |
| --- | --- |
| `src/protocol.ts` | `ReviewRecord.sessionId`；`REVIEW_TYPE_LABELS` |
| `src/host/agent-dispatch.ts` | `SessionControllerLike` 加 `rename`；`AgentDispatcher` 增 `createNamedSession/renameSession/archiveSession/unarchiveSession` |
| `src/host/workspaces.ts` | `WorkspaceRegistryLike` 加 `archiveSession/unarchiveSession` |
| `src/host/review-store.ts` | `attachSessionLifecycle`；`createReview/removeReview/transitionReview/editReview` 挂钩；`reviewSessionId()`；普通派发优先用自身 session |
| `src/host/routes.ts` | 普通派发 `sessionId` 回退到评审自身会话 |
| `src/index.ts` | 用 dispatcher 装配 `SessionLifecycle` 并 attach 到 store |
| 测试 | 命名 / 创建即建会话 / 关闭归档 / 删除归档 / 重开反归档 / 降级 no-op |

## 8. 与 Agent Teams 的关系

- Team 派发走 mailbox（design/08），**不动**评审自身会话。
- 评审自身会话仍在创建时建立、关闭时归档，作为评审的「生命周期锚点」始终存在。
- 多领域评审：用户选成员 + 任务板模式（已实现），与本次 1:1 绑定正交。

## 9. 验收

1. 创建一条评审 → 会话区出现 `[类型]标题` 会话；
2. 评审关闭（resolved/rejected/duplicated）→ 该会话从活动会话区消失（进归档）；
3. 评审重开 → 会话回到活动区；
4. 评审删除 → 会话归档；
5. 编辑标题/类型 → 会话名同步；
6. 无 workspace / 无服务时评审 CRUD 不受影响。
