/**
 * Browser half of the DevBuddy loopback API. Same-origin fetch against the
 * exact routes the host half registered at /api/devbuddy-left/*. No framework
 * runtime needed — this module inlines entirely into the plugin bundle.
 *
 * Ids ride the body (POST) or query string (GET) because the host's exact
 * web-route table keys on literal pathnames.
 */
import { DEVBUDDY_API_PREFIX } from '../protocol.ts'
import type {
  DevBuddyState,
  NodeView,
  ProjectSummary,
  WorkspaceInfo,
  WriteNodeRequest,
  WriteNodeResult,
} from '../protocol.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DEVBUDDY_API_PREFIX}${path}`, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `devbuddy request failed: ${response.status}`)
  return body
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload ?? {}) })
}

export const api = {
  state(): Promise<DevBuddyState> {
    return request('/state')
  },
  createProject(input: { name: string; path: string }): Promise<ProjectSummary> {
    return post('/projects', input)
  },
  removeProject(id: string): Promise<DevBuddyState> {
    return post('/project/remove', { id })
  },
  openProject(id: string): Promise<DevBuddyState> {
    return post('/project/open', { id })
  },
  listWorkspaces(): Promise<WorkspaceInfo[]> {
    return request('/workspaces')
  },
  bindProject(id: string, workspaceId: string | null): Promise<DevBuddyState> {
    return post('/project/bind', { id, workspaceId })
  },
  readNode(projectId: string, nodeId: string): Promise<NodeView> {
    const query = new URLSearchParams({ projectId, nodeId })
    return request(`/node?${query.toString()}`)
  },
  writeNode(projectId: string, nodeId: string, body: WriteNodeRequest): Promise<WriteNodeResult> {
    return post('/node', { ...body, projectId, nodeId })
  },
}
