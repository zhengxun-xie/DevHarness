import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DELIVERY_STAGE_KINDS,
  type DeliveryEvidence,
  type DeliveryProjectRef,
  type DeliveryRun,
  type DeliveryStage,
  type DeliveryStageKind,
  type DeliveryStageStatus,
  type DeliveryState,
  isDeliveryStageKind,
  isDeliveryStageStatus,
} from '../protocol.ts'

const REGISTRY_PATH = join(process.env.HOME ?? '.', '.dsh', 'devdelivery', 'registry.json')

function now(): string { return new Date().toISOString() }

function defaultStages(at: string): DeliveryStage[] {
  return DELIVERY_STAGE_KINDS.map(kind => ({ kind, status: 'not_started', summary: '', evidence: [], updatedAt: at }))
}

function deriveRunStatus(stages: DeliveryStage[]): DeliveryRun['status'] {
  if (stages.some(stage => stage.status === 'blocked')) return 'blocked'
  if (stages.some(stage => stage.status === 'failed')) return 'rejected'
  const required = stages.filter(stage => stage.status !== 'skipped')
  if (required.every(stage => stage.status === 'passed')) return 'accepted'
  if (stages.some(stage => stage.kind === 'acceptance' && stage.status === 'not_started')) {
    return stages.every(stage => stage.kind === 'acceptance' || stage.status === 'passed' || stage.status === 'skipped')
      ? 'ready_for_acceptance' : 'validating'
  }
  if (stages.some(stage => stage.status === 'running' || stage.status === 'passed')) return 'validating'
  return 'ready_for_validation'
}

function sanitizeProject(value: DeliveryProjectRef): DeliveryProjectRef {
  if (value.id.trim() === '' || value.name.trim() === '') throw new Error('project id and name are required')
  return {
    id: value.id.trim(), name: value.name.trim(),
    ...(value.path?.trim() ? { path: value.path.trim() } : {}),
    ...(value.workspaceId?.trim() ? { workspaceId: value.workspaceId.trim() } : {}),
  }
}

/** JSON-file store. Phase 1 is deliberately local/manual and credential-free. */
export class DeliveryStore {
  constructor(private readonly path = REGISTRY_PATH) {}

  private async read(): Promise<DeliveryState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as DeliveryState).runs)) {
        return parsed as DeliveryState
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return { runs: [], activeRunId: null }
  }

  private async save(state: DeliveryState): Promise<DeliveryState> {
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temp, this.path)
    return state
  }

  async state(projectId?: string): Promise<DeliveryState> {
    const state = await this.read()
    if (!projectId) return state
    const runs = state.runs.filter(run => run.project.id === projectId)
    return { runs, activeRunId: runs.some(run => run.id === state.activeRunId) ? state.activeRunId : runs[0]?.id ?? null }
  }

  async createRun(input: { project: DeliveryProjectRef; version?: string; branch?: string; commitSha?: string }): Promise<DeliveryState> {
    const state = await this.read()
    const createdAt = now()
    const run: DeliveryRun = {
      id: randomUUID(), project: sanitizeProject(input.project),
      version: input.version?.trim() || `delivery-${state.runs.filter(item => item.project.id === input.project.id).length + 1}`,
      branch: input.branch?.trim() ?? '', commitSha: input.commitSha?.trim() ?? '',
      status: 'ready_for_validation', stages: defaultStages(createdAt), createdAt, updatedAt: createdAt,
    }
    return this.save({ runs: [run, ...state.runs], activeRunId: run.id })
  }

  async selectRun(id: string): Promise<DeliveryState> {
    const state = await this.read()
    if (!state.runs.some(run => run.id === id)) throw new Error('delivery run not found')
    return this.save({ ...state, activeRunId: id })
  }

  async updateStage(input: { runId: string; kind: DeliveryStageKind; status: DeliveryStageStatus; summary?: string }): Promise<DeliveryState> {
    if (!isDeliveryStageKind(input.kind) || !isDeliveryStageStatus(input.status)) throw new Error('invalid delivery stage')
    const state = await this.read()
    const timestamp = now()
    let found = false
    const runs = state.runs.map(run => {
      if (run.id !== input.runId) return run
      found = true
      const stages = run.stages.map(stage => stage.kind !== input.kind ? stage : {
        ...stage, status: input.status, summary: input.summary?.trim() ?? stage.summary, updatedAt: timestamp,
      })
      return { ...run, stages, status: deriveRunStatus(stages), updatedAt: timestamp }
    })
    if (!found) throw new Error('delivery run not found')
    return this.save({ ...state, runs })
  }

  async addEvidence(input: { runId: string; kind: DeliveryStageKind; title: string; url?: string; note?: string }): Promise<DeliveryState> {
    if (!isDeliveryStageKind(input.kind) || input.title.trim() === '') throw new Error('stage and evidence title are required')
    const state = await this.read()
    const timestamp = now()
    let found = false
    const evidence: DeliveryEvidence = { id: randomUUID(), title: input.title.trim(), ...(input.url?.trim() ? { url: input.url.trim() } : {}), ...(input.note?.trim() ? { note: input.note.trim() } : {}), createdAt: timestamp }
    const runs = state.runs.map(run => {
      if (run.id !== input.runId) return run
      found = true
      return {
        ...run,
        stages: run.stages.map(stage => stage.kind === input.kind ? { ...stage, evidence: [...stage.evidence, evidence], updatedAt: timestamp } : stage),
        updatedAt: timestamp,
      }
    })
    if (!found) throw new Error('delivery run not found')
    return this.save({ ...state, runs })
  }
}
