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
  type CreateTaskLogRequest,
  type DevTaskState,
  type ErrorBody,
  type LogSubjectKind,
  type RemoveTaskLogRequest,
  type TaskLogResponse,
  type TaskPatch,
  type UpdateTaskLogRequest,
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

  // 子任务：parentId 指定父任务时 host 会解析父记录并继承 KR 归属；
  // employeeId '' = 明确不指派（undefined = 继承 父任务负责人→视角员工）；
  // startDate/dueDate 为 yyyy-mm-dd；progress 为 0–100 百分比。
  createTask: (input: {
    viewId: string
    title: string
    description?: string
    status?: string
    priority?: string
    tags?: string[]
    parentId?: string
    employeeId?: string
    startDate?: string
    dueDate?: string
    progress?: number
  }): Promise<DevTaskState> => post<DevTaskState>('/tasks', input),

  updateTask: (id: string, patch: TaskPatch): Promise<DevTaskState> =>
    post<DevTaskState>('/tasks/update', { id, patch }),

  removeTask: (id: string): Promise<DevTaskState> =>
    post<DevTaskState>('/tasks/remove', { id }),

  moveTask: (id: string, status: string): Promise<DevTaskState> =>
    post<DevTaskState>('/tasks/move', { id, status }),

  // Task logs: `subjectTitle` is a client-side snapshot used to label
  // materialised record-history entries; empty means "subject already
  // deleted" and is simply omitted. GET pulls local + materialised entries
  // once; the three writes return refreshed local entries only (history is
  // session-stable on the panel side).
  taskLogs: (subjectId: string, subjectKind: LogSubjectKind, subjectTitle?: string, localOnly = false): Promise<TaskLogResponse> => {
    const params = new URLSearchParams({ subjectId, subjectKind })
    if (subjectTitle !== undefined && subjectTitle !== '') params.set('subjectTitle', subjectTitle)
    if (localOnly) params.set('localOnly', '1')
    return request<TaskLogResponse>(`/logs?${params.toString()}`)
  },

  createTaskLog: (input: CreateTaskLogRequest): Promise<TaskLogResponse> =>
    post<TaskLogResponse>('/logs', input),

  updateTaskLog: (input: UpdateTaskLogRequest): Promise<TaskLogResponse> =>
    post<TaskLogResponse>('/logs/update', input),

  removeTaskLog: (input: RemoveTaskLogRequest): Promise<TaskLogResponse> =>
    post<TaskLogResponse>('/logs/remove', input),

  // Agent roster (registry-backed, no Bitable). New agents land at
  // `provisioning`; status is moved through the lifecycle via updateAgent.
  createAgent: (input: { name: string; description?: string }): Promise<DevTaskState> =>
    post<DevTaskState>('/agents', input),

  updateAgent: (id: string, patch: { name?: string; description?: string; status?: string }): Promise<DevTaskState> =>
    post<DevTaskState>('/agents/update', { id, patch }),

  removeAgent: (id: string): Promise<DevTaskState> =>
    post<DevTaskState>('/agents/remove', { id }),
}