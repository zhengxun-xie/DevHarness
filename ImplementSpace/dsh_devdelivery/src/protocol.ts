/** Shared DevDelivery host/client protocol. */
export const DEVDELIVERY_API_PREFIX = '/api/devdelivery'

/** The required gates in their execution order. */
export const DELIVERY_STAGE_KINDS = [
  'ai_self_test', 'cicd', 'test', 'merge_request', 'artifact', 'deployment', 'acceptance',
] as const
export type DeliveryStageKind = (typeof DELIVERY_STAGE_KINDS)[number]

export const DELIVERY_STAGE_STATUSES = [
  'not_started', 'running', 'passed', 'failed', 'blocked', 'skipped',
] as const
export type DeliveryStageStatus = (typeof DELIVERY_STAGE_STATUSES)[number]

export const DELIVERY_RUN_STATUSES = [
  'draft', 'ready_for_validation', 'validating', 'ready_for_acceptance', 'accepted', 'rejected', 'blocked',
] as const
export type DeliveryRunStatus = (typeof DELIVERY_RUN_STATUSES)[number]

export interface DeliveryProjectRef {
  /** Stable cross-plugin identity; e.g. DevBuddy project id or DevTask objective id. */
  id: string
  name: string
  path?: string
  workspaceId?: string
}

export interface DeliveryEvidence {
  id: string
  title: string
  /** URLs are optional in Phase 1: manual text evidence is valid. */
  url?: string
  note?: string
  createdAt: string
}

export interface DeliveryStage {
  kind: DeliveryStageKind
  status: DeliveryStageStatus
  summary: string
  evidence: DeliveryEvidence[]
  updatedAt: string
}

export interface DeliveryRun {
  id: string
  project: DeliveryProjectRef
  version: string
  branch: string
  commitSha: string
  status: DeliveryRunStatus
  stages: DeliveryStage[]
  createdAt: string
  updatedAt: string
}

export interface DeliveryState {
  runs: DeliveryRun[]
  activeRunId: string | null
}

export interface ErrorBody { error: string }

export function isDeliveryStageKind(value: unknown): value is DeliveryStageKind {
  return typeof value === 'string' && (DELIVERY_STAGE_KINDS as readonly string[]).includes(value)
}

export function isDeliveryStageStatus(value: unknown): value is DeliveryStageStatus {
  return typeof value === 'string' && (DELIVERY_STAGE_STATUSES as readonly string[]).includes(value)
}
