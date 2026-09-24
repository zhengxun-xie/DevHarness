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
  AiDispatchRequest,
  AiDispatchResult,
  CreateDrawingResult,
  CreateProjectRequest,
  CreateProjectResult,
  DevBuddyState,
  DrawingView,
  NodeView,
  ProjectSummary,
  WorkspaceInfo,
  WriteDrawingRequest,
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
  createProject(input: CreateProjectRequest): Promise<CreateProjectResult> {
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
  /**
   * Fire-and-forget node write for page unload / tab close. The event
   * handler cannot await a promise, so the request is queued OUT OF BAND:
   * `navigator.sendBeacon` first (a JSON Blob keeps the content-type the
   * host's JSON parser expects), then a `keepalive` fetch as a fallback when
   * the beacon queue is full / unavailable. No result is observed — a sha
   * conflict or network miss simply leaves the draft on the mounted card.
   */
  writeNodeBeacon(projectId: string, nodeId: string, body: WriteNodeRequest): void {
    const payload = JSON.stringify({ ...body, projectId, nodeId })
    const url = `${DEVBUDDY_API_PREFIX}/node`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' })
        if (navigator.sendBeacon(url, blob)) return
      }
    } catch {
      // fall through to keepalive fetch
    }
    try {
      void fetch(url, {
        method: 'POST',
        cache: 'no-store',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: payload,
      }).catch(() => {})
    } catch {
      // Page is already tearing down — nothing more can be done.
    }
  },
  readDrawing(projectId: string, src: string): Promise<DrawingView> {
    const query = new URLSearchParams({ projectId, src })
    return request(`/drawing?${query.toString()}`)
  },
  writeDrawing(projectId: string, src: string, content: string): Promise<{ ok: true }> {
    const body: WriteDrawingRequest = { src, content }
    return post('/drawing', { ...body, projectId })
  },
  createDrawing(projectId: string): Promise<CreateDrawingResult> {
    return post('/drawing/create', { projectId })
  },
  aiDispatch(input: AiDispatchRequest): Promise<AiDispatchResult> {
    return post('/ai/dispatch', input)
  },
}
