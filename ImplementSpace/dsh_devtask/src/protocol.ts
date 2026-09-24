/**
 * DevTask wire protocol: the JSON shapes exchanged between the browser panel
 * and the host half over loopback HTTP (`/api/devtask/*`). Both halves import
 * this module; the browser bundle inlines it.
 *
 * The prefix is distinct from the sibling plugins (`/api/devbuddy-left/*`,
 * `/api/devreviewer/*`) so all three can coexist in one web profile. The
 * task registry is DevTask's own store ($DSH_HOME/devtask/registry.json):
 * DevTask tasks are team work items, a different concept from the DevBuddy
 * project registry and from Reviewer review records.
 *
 * Endpoints (initial version):
 *   GET  /api/devtask/state                     -> DevTaskState
 *   GET  /api/devtask/activity                  ?limit=100 -> ActivityFeed
 *   POST /api/devtask/views                     { name, employeeId } -> DevTaskState
 *   POST /api/devtask/views/remove              { id }               -> DevTaskState
 *   POST /api/devtask/views/select               { id }              -> DevTaskState
 *   POST /api/devtask/tasks                     { viewId, title, ... } -> DevTaskState
 *   POST /api/devtask/tasks/update              { id, patch }        -> DevTaskState
 *   POST /api/devtask/tasks/remove              { id }               -> DevTaskState
 *   POST /api/devtask/tasks/move                { id, status }       -> DevTaskState
 *   POST /api/devtask/agents                    { name, description? } -> DevTaskState
 *   POST /api/devtask/agents/update             { id, patch }        -> DevTaskState
 *   POST /api/devtask/agents/remove             { id }               -> DevTaskState
 */

export const DEVTASK_API_PREFIX = '/api/devtask'

/** On-disk registry schema version. */
export const REGISTRY_VERSION = 1

/**
 * The task status columns, mirroring the task-board family's board so the two
 * surfaces read the same way. Order is the left-to-right column order.
 *
 * The Bitable source only has 3 select options (未开始/进行中/已完成); they map
 * to todo/running/done. backlog and failed have no Bitable equivalent — tasks
 * moved there are written back as 未开始, so those columns reset on refresh.
 */
export const TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

/** One board column / lifecycle state. */
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Priority ranking (p0 most urgent → p3 least). The Bitable source has no
 * priority field, so all tasks default to p2. The value is kept in the data
 * model for future use but is NOT rendered in the UI yet.
 */
export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const

/** Task priority. */
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/**
 * Agent roster lifecycle states, aligned with the sibling Reviewer plugin's
 * TeamMemberSummary (design/08 §3.2) so the two surfaces read the same way.
 * A newly created agent starts at `provisioning`; order here is the UI order.
 */
export const AGENT_STATUSES = ['provisioning', 'running', 'idle', 'inactive', 'failed'] as const

/** One agent lifecycle state. */
export type AgentStatus = (typeof AGENT_STATUSES)[number]

/**
 * One locally-managed agent on the roster (registry.json, NOT Bitable).
 * Agents are created/renamed/retired from the panel's agent view; the roster
 * is the single list the view renders, one card per agent.
 */
export interface AgentRecord {
  /** Stable random id (uuid). */
  id: string
  /** Display name; unique across the roster (enforced by the store). */
  name: string
  /** Free-form role/notes line shown under the name. */
  description: string
  status: AgentStatus
  createdAt: string
  updatedAt: string
}

/** One employee appearing in the OKR system (any table's 负责人 field). */
export interface OkrEmployee {
  /** Feishu open_id (Bitable user field id). */
  id: string
  /** Display name resolved from the Bitable user field (fallback to id). */
  name: string
}

/**
 * One row of the 🎯Objective（目标）table — the top of the OKR hierarchy.
 * Lives in its own Bitable table and reaches tasks through the KR table.
 */
export interface OkrObjectiveRecord {
  /** Bitable record id. */
  id: string
  /** Objective title, e.g. "O1: 中间件版本开发迭代和持续支持". */
  title: string
  /** 负责人 open_ids (multi-owner common); empty when unassigned. */
  ownerIds: string[]
  /** 目标周期 free-form label, e.g. "2026 H2"; empty when unset. */
  period: string
}

/**
 * One row of the 📈KR（关键结果）table — the middle of the OKR hierarchy.
 * Links upward to an Objective; tasks link to it via the task table's
 * 「KR（关键结果）」link field.
 */
export interface OkrKeyResultRecord {
  /** Bitable record id. */
  id: string
  /** KR title, e.g. "O1KR1: 移动子系统ROS2发布…". */
  title: string
  /** Objective record id this KR links to; null when unlinked. */
  objectiveId: string | null
  /** 负责人 open_ids. */
  ownerIds: string[]
  /** 进度 percent 0–100 parsed from KR任务进度 text ("59.0%" → 59); null when unset/unparsable. */
  progress: number | null
}

/**
 * Employee identifiers come from the Bitable「负责人」(user) field — they are
 * open_id strings (e.g. `ou_xxx`). The roster is dynamic, pulled from the task
 * records at read time, so there is no static constant table anymore.
 */
export type EmployeeId = string

/** Whether a string is a known task status. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

/** Whether a string is a known task priority. */
export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value)
}

/** Whether a string is a known agent status. */
export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && (AGENT_STATUSES as readonly string[]).includes(value)
}

/**
 * What a view looks at. The seeded 「软件组」 view is the TEAM perspective
 * (everyone's work, tied to no single employee); 新增视图 creates further
 * views, each an INDIVIDUAL perspective bound to exactly one employee.
 */
export type ViewScope = 'team' | 'individual'

/**
 * One board view — the unit a header tab renders. The default 「软件组」
 * view is the team perspective (seeded on first load, `employeeId: null`);
 * 新增视图 creates individual-perspective views, each assigned to one
 * employee.
 */
export interface TaskView {
  /** Stable random id. */
  id: string
  /** User-supplied view name shown on the tab and in the create dialog. */
  name: string
  /**
   * The perspective this view renders. `'team'` is the default view and
   * carries no employee; `'individual'` requires {@link employeeId}.
   */
  scope: ViewScope
  /**
   * The employee an `'individual'` view belongs to; `null` on the team view.
   * A `null` here is meaningful, not missing data: it is what distinguishes
   * the team board from 员工A's board.
   */
  employeeId: EmployeeId | null
  /** Header tab ordering, ascending. */
  order: number
  createdAt: string
}

/** One task card. */
export interface TaskRecord {
  /** Bitable record id (recXXXX). */
  id: string
  /**
   * The employee this task belongs to (from the Bitable「负责人」field, an
   * open_id like `ou_xxx`). `null` means unassigned. The panel filters tasks
   * by the active view's bound employee instead of by a view-owned task list.
   */
  employeeId: EmployeeId | null
  title: string
  description: string
  status: TaskStatus
  /** Priority p0–p3; defaults to p2 (Bitable has no priority field). Not shown in UI yet. */
  priority: TaskPriority
  /**
   * Parent task record id (Bitable「父记录 2」); null for top-level tasks.
   * This is the intra-table task → module-subtask level (e.g. 主线版本发布 →
   * 底盘/定位/导航模块). The OKR hierarchy lives one level up, in `krId`.
   */
  parentId: string | null
  /**
   * KR record id this task breaks down from (Bitable「KR（关键结果）」link in
   * the task table, pointing at the 📈KR table); null when the task is not
   * attached to any KR. Together with the Objective link inside the KR table
   * this forms the full O → KR → task → subtask hierarchy.
   */
  krId: string | null
  /** Start date (ISO) from Bitable「开始日期」; null when unscheduled. */
  startDate: string | null
  /** Due date (ISO) from Bitable「预计完成日期」; null when unscheduled. */
  dueDate: string | null
  /** Completion percent 0–1 from Bitable「任务进度」; null when unset. Rendered in the OKR project view. */
  progress: number | null
  /** Free-form labels rendered as card badges. */
  tags: string[]
  /** ISO timestamp of the last mutation. */
  updatedAt: string
  createdAt: string
}

/**
 * The persisted registry at $DSH_HOME/devtask/registry.json. Views, the active
 * view pointer and the local agent roster live here — tasks are read from /
 * written to the Bitable source, so they are not stored in the registry.
 */
export interface DevTaskRegistry {
  version: number
  views: TaskView[]
  activeViewId: string | null
  /** Local agent roster (agent view); [] until the first agent is created. */
  agents: AgentRecord[]
}

/** Full state returned by GET /state and echoed by every mutation. */
export interface DevTaskState {
  views: TaskView[]
  tasks: TaskRecord[]
  /** OKR 目标 rows (🎯Objective 表), top level of the project-view tree. */
  objectives: OkrObjectiveRecord[]
  /** OKR 关键结果 rows (📈KR 表), middle level; tasks link to them via `TaskRecord.krId`. */
  keyResults: OkrKeyResultRecord[]
  activeViewId: string | null
  /**
   * The employee roster the create-view dialog's dropdown offers. Union of
   * 负责人 fields across the Objective / KR / 任务 table, resolved by the host
   * so the placeholder table has exactly one source of truth.
   */
  employees: OkrEmployee[]
  /** Local agent roster backing the agent view. */
  agents: AgentRecord[]
}

/** POST /agents body. The new agent starts at `provisioning`. */
export interface CreateAgentRequest {
  name: string
  description?: string
}

/** The mutable subset of an agent; absent fields stay untouched. */
export interface AgentPatch {
  name?: string
  description?: string
  status?: string
}

/** POST /agents/update body. */
export interface UpdateAgentRequest {
  id: string
  patch: AgentPatch
}

/** POST /agents/remove body. */
export interface RemoveAgentRequest {
  id: string
}

/** POST /views body. */
export interface CreateViewRequest {
  /**
   * View name. Optional: the 新增视图 form asks for the employee only, and the
   * host then names the view after that employee; an explicit name still wins.
   */
  name?: string
  employeeId: string
}

/** POST /views/remove body. */
export interface RemoveViewRequest {
  id: string
}

/** POST /views/select body. */
export interface SelectViewRequest {
  id: string
}

/**
 * POST /tasks body. The `viewId` is kept so the host can resolve the bound
 * employee when the task is created from an individual-perspective view —
 * that employee becomes the Bitable「负责人」. `tags` are accepted but not
 * written to Bitable (no matching field); they stay in-memory only.
 */
export interface CreateTaskRequest {
  viewId: string
  title: string
  description?: string
  status?: string
  priority?: string
  tags?: string[]
}

/** The mutable subset of a task; absent fields stay untouched. */
export interface TaskPatch {
  title?: string
  description?: string
  status?: string
  priority?: string
  tags?: string[]
}

/** POST /tasks/update body. */
export interface UpdateTaskRequest {
  id: string
  patch: TaskPatch
}

/** POST /tasks/remove body. */
export interface RemoveTaskRequest {
  id: string
}

/** POST /tasks/move body (drag-and-drop between columns). */
export interface MoveTaskRequest {
  id: string
  status: string
}

/**
 * One field-level change inside an activity event, from the Bitable record
 * history (before → after). Values are rendered as-is by the host (user fields
 * already arrive as display names); timestamps are normalised to ISO.
 */
export interface ActivityFieldChange {
  /** 多维表格字段名, e.g. 任务状态. */
  field: string
  before: string
  after: string
}

/**
 * One activity event: a create/update on a 任务拆解 record, aggregated from
 * `+record-history-list`. Deleted records keep no id to query, so deletes do
 * not surface here — the feed covers living records only.
 */
export interface ActivityEvent {
  /** Stable id: `<recordId>:<rev>`. */
  id: string
  /** 任务拆解 record id the event belongs to. */
  recordId: string
  /** 任务 title at read time (resolved from the task table). */
  taskTitle: string
  /** Operator display name (Bitable user field name). */
  operator: string
  /** Event time (ISO). */
  at: string
  type: 'create' | 'update'
  /** Field-level diffs for `update`; empty for `create`. */
  changes: ActivityFieldChange[]
}

/** GET /activity response: newest-first, capped at `limit` events. */
export interface ActivityFeed {
  events: ActivityEvent[]
}

/** Generic error body. */
export interface ErrorBody {
  error: string
}