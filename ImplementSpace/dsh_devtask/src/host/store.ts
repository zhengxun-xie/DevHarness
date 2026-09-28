/**
 * DevTask store: Bitable-backed views + task CRUD.
 *
 * Views (header tabs + active pointer) are still persisted in
 * $DSH_HOME/devtask/registry.json — Bitable has no concept of "view", so this
 * stays DevTask-local. Tasks, however, are read from and written to the
 * Bitable「📋OKR 任务拆解」table via lark-cli (see bitable-client.ts).
 *
 * The default 「软件组」 view is the TEAM perspective (all tasks); 新增视图
 * creates INDIVIDUAL perspectives, each bound to one employee (open_id). The
 * panel filters the global task list by the active view's scope/employeeId.
 */
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ActivityFeed,
  AgentRecord,
  CreateAgentRequest,
  CreateTaskLogRequest,
  CreateTaskRequest,
  CreateViewRequest,
  DevTaskRegistry,
  DevTaskState,
  RemoveTaskLogRequest,
  SelectViewRequest,
  TaskLogQuery,
  TaskLogResponse,
  TaskPatch,
  TaskRecord,
  TaskView,
  UpdateTaskLogRequest,
  ViewScope,
} from '../protocol.ts'
import {
  REGISTRY_VERSION,
  isAgentStatus,
  isLogSubjectKind,
  isTaskStatus,
} from '../protocol.ts'
import { readJson, withLockedJson } from './json-store.ts'
import { dshHome } from './dsh-home.ts'
import { TaskLogStore } from './log-store.ts'
import * as bitable from './bitable-client.ts'

/** The view name seeded on a fresh registry. */
export const DEFAULT_VIEW_NAME = '软件组'

/** Legacy name the seeded default view carried before it was shortened. */
export const LEGACY_VIEW_NAME = '系统软件组'

/** The seeded default view is the TEAM perspective. */
export const DEFAULT_VIEW_SCOPE: ViewScope = 'team'

function emptyRegistry(): DevTaskRegistry {
  return { version: REGISTRY_VERSION, views: [], activeViewId: null, agents: [] }
}

/** Drop malformed agent rows (older writers / hand edits) instead of failing. */
function sanitizeAgents(agents: unknown): AgentRecord[] {
  if (!Array.isArray(agents)) return []
  return agents.filter((agent): agent is AgentRecord => {
    const a = agent as Partial<AgentRecord> | null
    return a !== null && typeof a === 'object'
      && typeof a.id === 'string' && a.id !== ''
      && typeof a.name === 'string' && a.name !== ''
      && typeof a.description === 'string'
      && isAgentStatus(a.status)
      && typeof a.createdAt === 'string' && typeof a.updatedAt === 'string'
  })
}

/** Trim and cap a user-supplied name; returns '' when nothing usable remains. */
function cleanName(value: unknown, max = 120): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/** Host-side DevTask facade over the Bitable source + local view registry. */
export class DevTaskStore {
  private readonly registryPath: string
  private readonly logStore: TaskLogStore

  constructor(dshHomeDir: string = dshHome()) {
    this.registryPath = resolve(dshHomeDir, 'devtask', 'registry.json')
    this.logStore = new TaskLogStore(dshHomeDir)
  }

  private loadRegistry(): DevTaskRegistry {
    const registry = readJson<DevTaskRegistry>(this.registryPath, emptyRegistry())
    if (!Array.isArray(registry.views)) return emptyRegistry()
    // Pre-agents registry files carry no `agents` — migrate in place (read path).
    if (!Array.isArray(registry.agents)) return { ...registry, agents: [] }
    return registry
  }

  /**
   * Seed the default view when the registry has none, repair an activeViewId
   * that points at a removed view, and upgrade pre-scope rows.
   */
  private normalize(registry: DevTaskRegistry): DevTaskRegistry {
    // Agents: drop malformed rows, then migrate a missing array to [].
    const agents = sanitizeAgents(registry.agents)
    if (registry.views.length === 0) {
      const seeded: TaskView = {
        id: randomUUID(),
        name: DEFAULT_VIEW_NAME,
        scope: DEFAULT_VIEW_SCOPE,
        employeeId: null,
        order: 0,
        createdAt: new Date().toISOString(),
      }
      return { ...registry, views: [seeded], activeViewId: seeded.id, agents }
    }
    const migrated = registry.views.map(view => {
      const scope = (view as { scope?: unknown }).scope
      const named = view.name === LEGACY_VIEW_NAME ? { ...view, name: DEFAULT_VIEW_NAME } : view
      if (scope === 'team' || scope === 'individual') return named
      return { ...named, scope: 'team' as ViewScope, employeeId: null }
    })
    const sorted = [...migrated].sort((a, b) => a.order - b.order)
    const active = sorted.find(view => view.id === registry.activeViewId) ?? sorted[0]!
    return { ...registry, views: sorted, activeViewId: active.id, agents }
  }

  /**
   * Build the full DevTaskState: merge registry views with Bitable tasks and
   * the OKR hierarchy (Objective + KR tables). Called by state() and every
   * mutation's return path.
   */
  private async fetchState(): Promise<DevTaskState> {
    const normalized = await withLockedJson(this.registryPath, emptyRegistry(), current => this.normalize(current))
    // 三张表并行拉取：O / KR / 任务；任一张失败都会让 state() 抛错（路由层转 500）
    const [taskRes, objectiveRes, krRes] = await Promise.all([
      bitable.listTasks(),
      bitable.listObjectives(),
      bitable.listKeyResults(),
    ])
    // 员工名册 = 三表负责人并集（任务 + KR + O 的 open_id → name 解析）
    const employeeMap = new Map<string, { id: string; name: string }>()
    for (const e of [...taskRes.employees, ...objectiveRes.employees, ...krRes.employees]) {
      if (!employeeMap.has(e.id)) employeeMap.set(e.id, e)
    }
    return {
      views: normalized.views,
      tasks: taskRes.tasks as unknown as TaskRecord[],
      objectives: objectiveRes.objectives,
      keyResults: krRes.keyResults,
      activeViewId: normalized.activeViewId,
      employees: [...employeeMap.values()],
      agents: normalized.agents,
    }
  }

  /**
   * Fetch the full state: views from registry + tasks/employees from Bitable.
   * Bitable failures are surfaced as thrown errors so the route layer maps
   * them to a 500; the panel shows the message inline.
   */
  async state(): Promise<DevTaskState> {
    return this.fetchState()
  }

  /**
   * Aggregate 任务拆解 record history into a newest-first activity feed
   * (capped at `limit`). Backed by Bitable record-history-list; a 60s host
   * cache absorbs repeated view switches, mutations invalidate it. `force`
   * bypasses the cache for a manual refresh.
   */
  async activity(limit = 100, force = false): Promise<ActivityFeed> {
    return { events: await bitable.listRecentActivity(limit, force) }
  }

  /**
   * Create a view bound to an employee. The employeeId is now any string
   * (an open_id from Bitable); the name defaults to the employee's Bitable
   * name when the roster already has them, or the raw id otherwise.
   */
  async createView(request: CreateViewRequest): Promise<DevTaskState> {
    const employeeId = request.employeeId
    const requested = request.name === undefined ? undefined : cleanName(request.name)
    if (requested !== undefined && requested === '') throw new Error('view name is required')

    // Look up the employee name from Bitable so the tab shows a real name.
    let employeeName = employeeId
    try {
      const { employees } = await bitable.listTasks()
      const found = employees.find(e => e.id === employeeId)
      if (found !== undefined) employeeName = found.name
    } catch {
      // Bitable read failure during view creation is non-fatal — fall back to id.
    }
    const name = requested ?? employeeName

    await withLockedJson(this.registryPath, emptyRegistry(), current => {
      const base = this.normalize(current)
      const view: TaskView = {
        id: randomUUID(),
        name,
        scope: 'individual',
        employeeId,
        order: base.views.length,
        createdAt: new Date().toISOString(),
      }
      return { ...base, views: [...base.views, view], activeViewId: view.id }
    })
    return this.fetchState()
  }

  /** Remove a view; the last remaining view cannot be removed. */
  async removeView(request: { id: string }): Promise<DevTaskState> {
    await withLockedJson(this.registryPath, emptyRegistry(), current => {
      const base = this.normalize(current)
      if (base.views.length <= 1) throw new Error('the last view cannot be removed')
      const views = base.views
        .filter(view => view.id !== request.id)
        .map((view, index) => ({ ...view, order: index }))
      if (views.length === base.views.length) throw new Error('view not found')
      return {
        ...base,
        views,
        activeViewId: base.activeViewId === request.id ? views[0]!.id : base.activeViewId,
      }
    })
    return this.fetchState()
  }

  /** Make a view the active tab. */
  async selectView(request: SelectViewRequest): Promise<DevTaskState> {
    await withLockedJson(this.registryPath, emptyRegistry(), current => {
      const base = this.normalize(current)
      if (!base.views.some(view => view.id === request.id)) throw new Error('view not found')
      return { ...base, activeViewId: request.id }
    })
    return this.fetchState()
  }

  /**
   * Create a task in Bitable. When the active view is an INDIVIDUAL perspective,
   * its bound employee becomes the task's「负责人」; on the team view the task
   * is created unassigned (the user can assign it later via the edit dialog).
   *
   * 子任务模式（request.parentId 非空，项目视图「＋ 添加子任务」）：拉取
   * 父任务，继承其 KR 归属（子任务必须与父任务同 KR，否则掉进「未关联 KR
   * 的任务」孤儿区）；负责人取显式 employeeId，否则继承父任务负责人，
   * 再否则视角绑定员工。父任务无 KR 时不写 KR 链接（子任务随父进孤儿区，
   * 与父任务同一处展示，不分离）。顶层模式行为不变。
   */
  async createTask(request: CreateTaskRequest): Promise<DevTaskState> {
    const title = cleanName(request.title)
    if (title === '') throw new Error('task title is required')
    const status = isTaskStatus(request.status) ? request.status : 'todo'

    // Resolve the view to get the employeeId for the 负责人 field.
    let viewEmployeeId: string | null = null
    const registry = this.normalize(this.loadRegistry())
    if (request.viewId !== '') {
      const view = registry.views.find(v => v.id === request.viewId)
      if (view === undefined) throw new Error('view not found')
      if (view.scope === 'individual' && view.employeeId !== null) {
        viewEmployeeId = view.employeeId
      }
    }

    // 子任务模式：先取父任务（快照在并发更新下仍以创建时点为准），继承
    // KR 归属与负责人。父任务读取失败即 400——半途继承（写了父链接但没
    // KR）会造出孤儿子任务，宁可整体失败让用户重试。
    let parentId: string | null = null
    let krId: string | null = null
    let parentEmployeeId: string | null = null
    if (request.parentId !== undefined && request.parentId !== null && request.parentId !== '') {
      parentId = request.parentId
      const { tasks } = await bitable.listTasks()
      const parent = tasks.find(t => t.id === parentId)
      if (parent === undefined) throw new Error('parent task not found')
      krId = parent.krId
      parentEmployeeId = parent.employeeId
    }
    // 负责人优先级：显式 employeeId（'' = 明确不指派）> 父任务负责人 > 视角绑定员工。
    const employeeId = request.employeeId !== undefined
      ? (request.employeeId === '' ? null : request.employeeId)
      : (parentEmployeeId ?? viewEmployeeId)

    // 任务进度：客户端 0–100 百分比 → Bitable 0–1 量纲（表内存量即 0.59 形态）。
    const progress = request.progress === undefined || !Number.isFinite(request.progress)
      ? undefined
      : Math.min(100, Math.max(0, request.progress)) / 100

    await bitable.createTask({
      title,
      description: request.description,
      status,
      employeeId,
      parentId,
      krId,
      startDate: request.startDate,
      dueDate: request.dueDate,
      progress,
    })
    bitable.invalidateActivityCache()

    return this.state()
  }

  /** Apply a partial update to a task in Bitable. */
  async updateTask(request: { id: string; patch: TaskPatch }): Promise<DevTaskState> {
    const patch = request.patch
    const bitablePatch: { title?: string; description?: string; status?: string; employeeId?: string | null } = {}
    if (patch.title !== undefined) bitablePatch.title = cleanName(patch.title) || undefined
    if (patch.description !== undefined) bitablePatch.description = patch.description
    if (patch.status !== undefined && isTaskStatus(patch.status)) bitablePatch.status = patch.status
    await bitable.updateTask(request.id, bitablePatch)
    bitable.invalidateActivityCache()
    return this.state()
  }

  /** Move a task to another board column (updates 任务状态 in Bitable). */
  async moveTask(request: { id: string; status: string }): Promise<DevTaskState> {
    if (!isTaskStatus(request.status)) throw new Error('unknown status')
    await bitable.updateTask(request.id, { status: request.status })
    bitable.invalidateActivityCache()
    return this.state()
  }

  /**
   * Delete a task from Bitable.
   *
   * 06 §7 单一来源原则：删除是 record-history 的盲区（已删记录查不到），
   * 因此 removeTask 是**唯一**本地 system 日志写入点——先抓标题/层级快照，
   * 删除成功后落一条本地日志。日志是旁路数据：写入失败仅 stderr 告警，
   * 绝不阻塞任务删除本身。
   */
  async removeTask(request: { id: string }): Promise<DevTaskState> {
    let snapshot: { title: string; kind: 'task' | 'subtask' } | null = null
    try {
      const { tasks } = await bitable.listTasks()
      const target = tasks.find(t => t.id === request.id)
      if (target !== undefined) {
        snapshot = { title: target.title, kind: target.parentId === null ? 'task' : 'subtask' }
      }
    } catch {
      // 快照失败不拦删除——subjectTitle 缺失只影响日志展示
    }

    await bitable.deleteTask(request.id)
    bitable.invalidateActivityCache()

    if (snapshot !== null) {
      try {
        this.logStore.create({
          subjectId: request.id,
          subjectKind: snapshot.kind,
          subjectTitle: snapshot.title,
          kind: 'system',
          author: { type: 'system', id: 'devtask', displayName: '系统' },
          body: `删除${snapshot.kind === 'subtask' ? '子任务' : '任务'}「${snapshot.title}」`,
        })
      } catch (error) {
        console.error('[devtask] 删除事件日志写入失败:', error)
      }
    }
    return this.state()
  }

  // -------------------------------------------------------------------------
  // Task logs（06：本地 md 存储 + record-history 物化合并）。
  // -------------------------------------------------------------------------

  /**
   * Read one subject's log timeline: persisted local entries plus the
   * record-history materialised system entries. The history fetch failing is
   * NOT fatal — the response carries `historyError` and the timeline simply
   * shows the local part with a banner.
   */
  async taskLogs(query: TaskLogQuery): Promise<TaskLogResponse> {
    if (!isLogSubjectKind(query.subjectKind)) throw new Error('unknown subject kind')
    const entries = this.logStore.list(query.subjectId)
    // Two-phase loading (06 §7): localOnly skips the lark-cli record-history
    // fetch so the client can render local entries instantly; a second
    // request without this flag pulls history in the background.
    if (query.localOnly === true) return { entries, history: [] }
    const { entries: history, error } = await bitable.listSubjectHistory(
      query.subjectId,
      query.subjectKind,
      query.subjectTitle ?? '',
    )
    return { entries, history, ...(error === undefined ? {} : { historyError: error }) }
  }

  /** Create a manual log entry; returns the subject's persisted entries. */
  async createTaskLog(request: CreateTaskLogRequest): Promise<TaskLogResponse> {
    if (!isLogSubjectKind(request.subjectKind)) throw new Error('unknown subject kind')
    // Host forces `manual`: system entries are host-generated only, the
    // client never gets to forge one.
    this.logStore.create({ ...request, kind: 'manual' })
    return { entries: this.logStore.list(request.subjectId), history: [] }
  }

  /**
   * Edit one manual entry (sha256 optimistic lock). System entries are fact
   * records and are rejected outright.
   */
  async updateTaskLog(request: UpdateTaskLogRequest): Promise<TaskLogResponse> {
    const existing = this.logStore.find(request.id)
    if (existing === null) throw new Error(`log not found: ${request.id}`)
    if (existing.kind === 'system') throw new Error('system log cannot be modified')
    const updated = this.logStore.update(request.id, request.body, request.sha)
    return { entries: this.logStore.list(updated.subjectId), history: [] }
  }

  /** Remove one manual entry (sha256 optimistic lock); system rejected. */
  async removeTaskLog(request: RemoveTaskLogRequest): Promise<TaskLogResponse> {
    const existing = this.logStore.find(request.id)
    if (existing === null) throw new Error(`log not found: ${request.id}`)
    if (existing.kind === 'system') throw new Error('system log cannot be modified')
    const removed = this.logStore.remove(request.id, request.sha)
    return { entries: this.logStore.list(removed.subjectId), history: [] }
  }

  // -------------------------------------------------------------------------
  // Agent roster (registry-only; no Bitable involvement).
  // -------------------------------------------------------------------------

  /**
   * Create an agent on the local roster. New agents start at `provisioning`
   * (创建中); the panel moves them through the lifecycle from there.
   */
  async createAgent(request: CreateAgentRequest): Promise<DevTaskState> {
    const name = cleanName(request.name)
    if (name === '') throw new Error('agent name is required')
    const now = new Date().toISOString()
    const agent: AgentRecord = {
      id: randomUUID(),
      name,
      description: typeof request.description === 'string' ? request.description.trim().slice(0, 500) : '',
      status: 'provisioning',
      createdAt: now,
      updatedAt: now,
    }
    await withLockedJson(this.registryPath, emptyRegistry(), current => {
      const base = this.normalize(current)
      if (base.agents.some(a => a.name === name)) throw new Error('agent name already exists')
      return { ...base, agents: [...base.agents, agent] }
    })
    return this.fetchState()
  }

  /** Rename / re-describe / re-status one agent. */
  async updateAgent(request: { id: string; patch: { name?: string; description?: string; status?: string } }): Promise<DevTaskState> {
    const patch = request.patch
    const name = patch.name === undefined ? undefined : cleanName(patch.name)
    if (patch.name !== undefined && name === '') throw new Error('agent name must not be empty')
    let status: AgentRecord['status'] | undefined
    if (patch.status !== undefined) {
      if (!isAgentStatus(patch.status)) throw new Error('unknown agent status')
      status = patch.status
    }
    await withLockedJson(this.registryPath, emptyRegistry(), current => {
      const base = this.normalize(current)
      const agent = base.agents.find(a => a.id === request.id)
      if (agent === undefined) throw new Error('agent not found')
      if (name !== undefined && name !== agent.name && base.agents.some(a => a.name === name)) {
        throw new Error('agent name already exists')
      }
      const next: AgentRecord = {
        ...agent,
        ...(name !== undefined ? { name } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim().slice(0, 500) } : {}),
        ...(status !== undefined ? { status } : {}),
        updatedAt: new Date().toISOString(),
      }
      return { ...base, agents: base.agents.map(a => (a.id === request.id ? next : a)) }
    })
    return this.fetchState()
  }

  /** Remove one agent from the roster. */
  async removeAgent(request: { id: string }): Promise<DevTaskState> {
    await withLockedJson(this.registryPath, emptyRegistry(), current => {
      const base = this.normalize(current)
      const next = base.agents.filter(a => a.id !== request.id)
      if (next.length === base.agents.length) throw new Error('agent not found')
      return { ...base, agents: next }
    })
    return this.fetchState()
  }
}
