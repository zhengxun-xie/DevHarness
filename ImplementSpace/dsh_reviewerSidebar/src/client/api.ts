/**
 * Browser half of the DevBuddy Reviewer loopback API. Same-origin fetch
 * against the exact routes the host half registered at /api/devbuddy/*.
 *
 * Mirrors dsh-devbuddy-left's api.ts: no-store JSON, ids ride the query
 * string (GET) or body (POST), non-2xx rejects with the server's error text.
 */
import { DEVBUDDY_API_PREFIX } from '../protocol.ts'
import type {
  ActivateRequest,
  AppendRequest,
  AppendResponse,
  CreateReviewRequest,
  CreateReviewResponse,
  DocumentResponse,
  EditReviewRequest,
  EditReviewResponse,
  EditThreadEntryRequest,
  EditThreadEntryResponse,
  GetReviewResponse,
  ListReviewsResponse,
  ProjectsResponse,
  ReanchorRequest,
  ReanchorResponse,
  RemoveRequest,
  SendToAgentRequest,
  SendToAgentResponse,
  TransitionRequest,
  TransitionResponse,
  AgentContextPayload,
} from '../protocol.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DEVBUDDY_API_PREFIX}${path}`, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `devbuddy reviewer request failed: ${response.status}`)
  return body
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload ?? {}) })
}

export interface ListReviewsQuery {
  projectId: string
  status?: string
  severity?: string
  document?: string
  author?: string
  tag?: string
}

export const api = {
  listProjects(): Promise<ProjectsResponse> {
    return request('/projects')
  },
  activateProject(id: string): Promise<{ projectId: string }> {
    return post('/project/activate', { id } satisfies ActivateRequest)
  },
  listReviews(query: ListReviewsQuery): Promise<ListReviewsResponse> {
    const params = new URLSearchParams({ projectId: query.projectId })
    if (query.status) params.set('status', query.status)
    if (query.severity) params.set('severity', query.severity)
    if (query.document) params.set('document', query.document)
    if (query.author) params.set('author', query.author)
    if (query.tag) params.set('tag', query.tag)
    return request(`/reviews?${params.toString()}`)
  },
  createReview(input: CreateReviewRequest): Promise<CreateReviewResponse> {
    return post('/reviews', input)
  },
  getReview(projectId: string, reviewId: string): Promise<GetReviewResponse> {
    const params = new URLSearchParams({ projectId, reviewId })
    return request(`/review?${params.toString()}`)
  },
  appendReview(input: AppendRequest): Promise<AppendResponse> {
    return post('/review/append', input)
  },
  editReview(input: EditReviewRequest): Promise<EditReviewResponse> {
    return post('/review/edit', input)
  },
  editThreadEntry(input: EditThreadEntryRequest): Promise<EditThreadEntryResponse> {
    return post('/review/thread/edit', input)
  },
  transitionReview(input: TransitionRequest): Promise<TransitionResponse> {
    return post('/review/transition', input)
  },
  reanchorReview(input: ReanchorRequest): Promise<ReanchorResponse> {
    return post('/review/reanchor', input)
  },
  removeReview(input: RemoveRequest): Promise<{ removed: true }> {
    return post('/review/remove', input)
  },
  getDocument(projectId: string, path: string): Promise<DocumentResponse> {
    const params = new URLSearchParams({ projectId, path })
    return request(`/document?${params.toString()}`)
  },
  agentContext(projectId: string, reviewId: string): Promise<AgentContextPayload> {
    const params = new URLSearchParams({ projectId, reviewId })
    return request(`/agent/context?${params.toString()}`)
  },
  sendToAgent(input: SendToAgentRequest): Promise<SendToAgentResponse & { fallback?: string }> {
    return post('/agent/send', input)
  },
}
