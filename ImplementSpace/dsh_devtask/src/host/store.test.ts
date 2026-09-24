/**
 * DevTaskStore tests: view management against a temp registry, with the
 * Bitable layer mocked so no real lark-cli calls are made.
 *
 * Task CRUD tests are covered by the Bitable integration — here we verify
 * the view lifecycle (seed, create, remove, select) and the guard rails
 * (last-view protection, view-not-found) that the store enforces locally.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock bitable-client so tests run without lark-cli / network.
vi.mock('./bitable-client.ts', () => {
  const tasks: unknown[] = []
  const employees = [
    { id: 'ou_aaa', name: '张三' },
    { id: 'ou_bbb', name: '李四' },
  ]
  const objectives = [{ id: 'recO1', title: 'O1: 测试目标', ownerIds: ['ou_ccc'], period: '2026 H2' }]
  const keyResults = [{ id: 'recK1', title: 'O1KR1: 测试关键结果', objectiveId: 'recO1', ownerIds: ['ou_ddd'], progress: 50 }]
  return {
    listTasks: vi.fn(async () => ({ tasks: [...tasks], employees: [...employees] })),
    listObjectives: vi.fn(async () => ({ objectives: [...objectives], employees: [{ id: 'ou_ccc', name: '王五' }] })),
    listKeyResults: vi.fn(async () => ({ keyResults: [...keyResults], employees: [{ id: 'ou_ddd', name: '赵六' }] })),
    createTask: vi.fn(async (input: { title: string }) => {
      const rec = { id: `rec_${tasks.length + 1}`, title: input.title, status: 'todo', employeeId: null, priority: 'medium', tags: [], description: '', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }
      tasks.push(rec)
      return rec.id
    }),
    updateTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    listRecentActivity: vi.fn(async () => []),
    invalidateActivityCache: vi.fn(),
  }
})

// Import AFTER mock is set up.
const { DevTaskStore, DEFAULT_VIEW_NAME, LEGACY_VIEW_NAME } = await import('./store.ts')
const bitable = await import('./bitable-client.ts')

let home: string
let store: InstanceType<typeof DevTaskStore>

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'devtask-test-'))
  store = new DevTaskStore(home)
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('DevTaskStore.state', () => {
  it('seeds the 软件组 default view on a fresh registry', async () => {
    const state = await store.state()
    expect(state.views).toHaveLength(1)
    expect(state.views[0]!.name).toBe(DEFAULT_VIEW_NAME)
    expect(DEFAULT_VIEW_NAME).toBe('软件组')
    expect(state.activeViewId).toBe(state.views[0]!.id)
    // Employees = union of 任务/KR/O three-table 负责人 (mocked).
    expect(state.employees.map(e => e.name)).toEqual(['张三', '李四', '王五', '赵六'])
  })

  it('aggregates the OKR hierarchy from the Objective and KR tables', async () => {
    const state = await store.state()
    expect(state.objectives).toHaveLength(1)
    expect(state.objectives[0]!.title).toBe('O1: 测试目标')
    expect(state.keyResults).toHaveLength(1)
    expect(state.keyResults[0]!.objectiveId).toBe('recO1')
    expect(state.keyResults[0]!.progress).toBe(50)
  })

  it('seeds the default view as the TEAM perspective, owning no employee', async () => {
    const view = (await store.state()).views[0]!
    expect(view.scope).toBe('team')
    expect(view.employeeId).toBeNull()
  })

  it('upgrades a pre-scope registry row to the team perspective', async () => {
    const registry = { version: 1, views: [{ id: 'v1', name: LEGACY_VIEW_NAME, employeeId: 'ou_x', order: 0, createdAt: 'x' }], activeViewId: 'v1' }
    mkdirSync(join(home, 'devtask'), { recursive: true })
    writeFileSync(join(home, 'devtask', 'registry.json'), JSON.stringify(registry))
    const view = (await store.state()).views[0]!
    expect(view.scope).toBe('team')
    expect(view.employeeId).toBeNull()
    expect(view.name).toBe('软件组')
  })

  it('reports a stable default view across repeated reads', async () => {
    const first = (await store.state()).views[0]!.id
    expect((await store.state()).views[0]!.id).toBe(first)
  })
})

describe('views', () => {
  it('creates a view assigned to the chosen employee and activates it', async () => {
    const state = await store.createView({ name: '前端组', employeeId: 'ou_bbb' })
    expect(state.views).toHaveLength(2)
    const created = state.views.find(v => v.name === '前端组')!
    expect(created.employeeId).toBe('ou_bbb')
    expect(created.scope).toBe('individual')
    expect(state.activeViewId).toBe(created.id)
  })

  it('names the view after the employee when no name is supplied', async () => {
    const state = await store.createView({ employeeId: 'ou_bbb' })
    const created = state.views.find(v => v.employeeId === 'ou_bbb')!
    expect(created.name).toBe('李四')
  })

  it('rejects an explicitly blank name', async () => {
    await expect(store.createView({ name: '   ', employeeId: 'ou_aaa' })).rejects.toThrow(/name is required/)
  })

  it('selects an existing view and rejects an unknown one', async () => {
    const first = (await store.state()).views[0]!.id
    const second = (await store.createView({ name: '二组', employeeId: 'ou_bbb' })).views[1]!.id
    expect((await store.selectView({ id: first })).activeViewId).toBe(first)
    expect((await store.selectView({ id: second })).activeViewId).toBe(second)
    await expect(store.selectView({ id: 'nope' })).rejects.toThrow(/not found/)
  })

  it('removes a view, but never the last one', async () => {
    const first = (await store.state()).views[0]!.id
    const withSecond = await store.createView({ name: '二组', employeeId: 'ou_bbb' })
    const second = withSecond.views[1]!.id

    const after = await store.removeView({ id: second })
    expect(after.views.map(v => v.id)).toEqual([first])
    expect(after.activeViewId).toBe(first)

    await expect(store.removeView({ id: first })).rejects.toThrow(/last view/)
  })
})

describe('persistence', () => {
  it('survives a fresh store instance over the same home', async () => {
    await store.createView({ name: '持久化组', employeeId: 'ou_bbb' })

    const reopened = new DevTaskStore(home)
    const state = await reopened.state()
    expect(state.views.map(v => v.name)).toContain('持久化组')
  })
})

describe('activity', () => {
  it('passes limit/force through and returns the aggregated feed', async () => {
    vi.mocked(bitable.listRecentActivity).mockResolvedValue([
      { id: 'rec1:2', recordId: 'rec1', taskTitle: '旧事件', operator: '张三', at: '2026-09-23T10:00:00.000Z', type: 'update', changes: [{ field: '任务状态', before: '未开始', after: '进行中' }] },
      { id: 'rec1:1', recordId: 'rec1', taskTitle: '旧事件', operator: '张三', at: '2026-09-23T09:00:00.000Z', type: 'create', changes: [] },
    ])
    const feed = await store.activity(5, true)
    expect(feed.events.map(e => e.id)).toEqual(['rec1:2', 'rec1:1'])
    expect(bitable.listRecentActivity).toHaveBeenCalledWith(5, true)
  })
})

describe('agents', () => {
  it('creates an agent at provisioning and persists across store instances', async () => {
    const state = await store.createAgent({ name: 'Alpha', description: '检索' })
    expect(state.agents).toHaveLength(1)
    const alpha = state.agents[0]!
    expect(alpha.name).toBe('Alpha')
    expect(alpha.description).toBe('检索')
    expect(alpha.status).toBe('provisioning')

    const reopened = new DevTaskStore(home)
    expect((await reopened.state()).agents.map(a => a.name)).toEqual(['Alpha'])
  })

  it('rejects a blank name and a duplicate name', async () => {
    await store.createAgent({ name: 'Alpha' })
    await expect(store.createAgent({ name: '   ' })).rejects.toThrow(/name is required/)
    await expect(store.createAgent({ name: 'Alpha' })).rejects.toThrow(/already exists/)
  })

  it('moves status through the lifecycle, validates it, and removes agents', async () => {
    const id = (await store.createAgent({ name: 'Beta' })).agents[0]!.id
    const moved = await store.updateAgent({ id, patch: { status: 'running' } })
    expect(moved.agents[0]!.status).toBe('running')
    await expect(store.updateAgent({ id, patch: { status: 'bogus' } })).rejects.toThrow(/unknown agent status/)

    const removed = await store.removeAgent({ id })
    expect(removed.agents).toHaveLength(0)
    await expect(store.removeAgent({ id })).rejects.toThrow(/agent not found/)
  })

  it('drops malformed registry rows instead of failing', async () => {
    const registry = {
      version: 1,
      views: [{ id: 'v1', name: '软件组', scope: 'team', employeeId: null, order: 0, createdAt: 'x' }],
      activeViewId: 'v1',
      agents: [
        { id: 'a1', name: '缺字段' },
        'junk',
        { id: 'a2', name: '坏状态', description: 'd', status: 'nope', createdAt: 'c', updatedAt: 'u' },
      ],
    }
    mkdirSync(join(home, 'devtask'), { recursive: true })
    writeFileSync(join(home, 'devtask', 'registry.json'), JSON.stringify(registry))
    expect((await store.state()).agents).toEqual([])
  })
})
