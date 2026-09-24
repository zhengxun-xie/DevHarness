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
  CreateTaskRequest,
  CreateViewRequest,
  DevTaskRegistry,
  DevTaskState,
  SelectViewRequest,
  TaskPatch,
  TaskRecord,
  TaskView,
  ViewScope,
} from '../protocol.ts'
import {
  REGISTRY_VERSION,
  isAgentStatus,
  isTaskStatus,
} from '../protocol.ts'
import { readJson, withLockedJson } from './json-store.ts'
import { dshHome } from './dsh-home.ts'
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

  constructor(dshHomeDir: string = dshHome()) {
    this.registryPath = resolve(dshHomeDir, 'devtask', 'registry.json')
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
   */
  async createTask(request: CreateTaskRequest): Promise<DevTaskState> {
    const title = cleanName(request.title)
    if (title === '') throw new Error('task title is required')
    const status = isTaskStatus(request.status) ? request.status : 'todo'

    // Resolve the view to get the employeeId for the 负责人 field.
    let employeeId: string | null = null
    const registry = this.normalize(this.loadRegistry())
    if (request.viewId !== '') {
      const view = registry.views.find(v => v.id === request.viewId)
      if (view === undefined) throw new Error('view not found')
      if (view.scope === 'individual' && view.employeeId !== null) {
        employeeId = view.employeeId
      }
    }

    await bitable.createTask({
      title,
      description: request.description,
      status,
      employeeId,
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

  /** Delete a task from Bitable. */
  async removeTask(request: { id: string }): Promise<DevTaskState> {
    await bitable.deleteTask(request.id)
    bitable.invalidateActivityCache()
    return this.state()
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
