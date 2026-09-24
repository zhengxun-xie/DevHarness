import { DEVDELIVERY_API_PREFIX, type DeliveryProjectRef, type DeliveryStageKind, type DeliveryStageStatus, type DeliveryState, type ErrorBody } from '../protocol.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DEVDELIVERY_API_PREFIX}${path}`, { headers: { 'content-type': 'application/json' }, ...init })
  const payload: unknown = await response.json()
  if (!response.ok) throw new Error((payload as ErrorBody).error ?? `HTTP ${response.status}`)
  return payload as T
}
function post<T>(path: string, body: unknown): Promise<T> { return request(path, { method: 'POST', body: JSON.stringify(body) }) }

export const api = {
  state: (projectId?: string): Promise<DeliveryState> => request(`/state${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  createRun: (input: { project: DeliveryProjectRef; version?: string; branch?: string; commitSha?: string }): Promise<DeliveryState> => post('/runs', input),
  selectRun: (id: string): Promise<DeliveryState> => post('/runs/select', { id }),
  updateStage: (input: { runId: string; kind: DeliveryStageKind; status: DeliveryStageStatus; summary?: string }): Promise<DeliveryState> => post('/stages', input),
  addEvidence: (input: { runId: string; kind: DeliveryStageKind; title: string; url?: string; note?: string }): Promise<DeliveryState> => post('/evidence', input),
}
