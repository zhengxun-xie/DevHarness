/**
 * Browser-side loopback API client for the DevTask panel.
 *
 * Every call returns the complete next state, so the panel replaces its
 * snapshot wholesale instead of patching locally — the host registry stays
 * the single authority.
 */
import {
  DEVTASK_API_PREFIX,
  type ActivityFeed,
  type DevTaskState,
  type ErrorBody,
  type TaskPatch,
} from '../protocol.ts'

/**
 * 兜底超时：activity 聚合最坏约两分钟（限流退避重试），再多按挂死处理——
 * 超时抛错让界面进入错误态 + 重试，而不是永远转圈。
 */
const REQUEST_TIMEOUT_MS = 180_000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${DEVTASK_API_PREFIX}${path}`, {
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      ...init,
    })
    const text = await response.text()
    const payload: unknown = text === '' ? null : JSON.parse(text)
    if (!response.ok) {
      const message = (payload as ErrorBody | null)?.error ?? `HTTP ${response.status}`
      throw new Error(message)
    }
    return payload as T
  } catch (caught) {
    if (caught instanceof Error && caught.name === 'AbortError') {
      throw new Error('请求超时，请重试')
    }
    throw caught
  } finally {
    clearTimeout(timer)
  }
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export const api = {
  state: (): Promise<DevTaskState> => request<DevTaskState>('/state'),

  // Activity feed: record-history aggregation, host-cached 60s. `limit` caps
  // the returned events (default 100); `fresh` bypasses the host cache for a
  // manual refresh.
  activity: (limit = 100, fresh = false): Promise<ActivityFeed> =>
    request<ActivityFeed>(`/activity?limit=${limit}${fresh ? '&fresh=1' : ''}`),

  // The 新增视图 form collects the employee only; the host names the view
  // after it. `name` stays available for programmatic callers.
  createView: (employeeId: string, name?: string): Promise<DevTaskState> =>
    post<DevTaskState>('/views', name === undefined ? { employeeId } : { name, employeeId }),

  removeView: (id: string): Promise<DevTaskState> =>
    post<DevTaskState>('/views/remove', { id }),

  selectView: (id: string): Promise<DevTaskState> =>
    post<DevTaskState>('/views/select', { id }),

  createTask: (input: {
    viewId: string
    title: string
    description?: string
    status?: string
    priority?: string
    tags?: string[]
  }): Promise<DevTaskState> => post<DevTaskState>('/tasks', input),

  updateTask: (id: string, patch: TaskPatch): Promise<DevTaskState> =>
    post<DevTaskState>('/tasks/update', { id, patch }),

  removeTask: (id: string): Promise<DevTaskState> =>
    post<DevTaskState>('/tasks/remove', { id }),

  moveTask: (id: string, status: string): Promise<DevTaskState> =>
    post<DevTaskState>('/tasks/move', { id, status }),

  // Agent roster (registry-backed, no Bitable). New agents land at
  // `provisioning`; status is moved through the lifecycle via updateAgent.
  createAgent: (input: { name: string; description?: string }): Promise<DevTaskState> =>
    post<DevTaskState>('/agents', input),

  updateAgent: (id: string, patch: { name?: string; description?: string; status?: string }): Promise<DevTaskState> =>
    post<DevTaskState>('/agents/update', { id, patch }),

  removeAgent: (id: string): Promise<DevTaskState> =>
    post<DevTaskState>('/agents/remove', { id }),
}