import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DeliveryStore } from './store.ts'

const dirs: string[] = []
async function store(): Promise<DeliveryStore> {
  const dir = await mkdtemp(join(tmpdir(), 'devdelivery-store-'))
  dirs.push(dir)
  return new DeliveryStore(join(dir, 'registry.json'))
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

describe('DeliveryStore', () => {
  it('creates an isolated run with all seven ordered quality gates', async () => {
    const subject = await store()
    const state = await subject.createRun({ project: { id: 'p1', name: 'Project One' }, version: 'v1' })
    expect(state.activeRunId).toBe(state.runs[0]!.id)
    expect(state.runs[0]!.status).toBe('ready_for_validation')
    expect(state.runs[0]!.stages.map(stage => stage.kind)).toEqual([
      'ai_self_test', 'cicd', 'test', 'merge_request', 'artifact', 'deployment', 'acceptance',
    ])
  })

  it('derives validation / acceptance status and retains stage evidence', async () => {
    const subject = await store()
    let state = await subject.createRun({ project: { id: 'p1', name: 'Project One' } })
    const runId = state.activeRunId!
    state = await subject.updateStage({ runId, kind: 'ai_self_test', status: 'passed', summary: 'local test passed' })
    expect(state.runs[0]!.status).toBe('validating')
    state = await subject.addEvidence({ runId, kind: 'ai_self_test', title: 'test report', url: 'https://example.test/report' })
    expect(state.runs[0]!.stages[0]!.evidence).toMatchObject([{ title: 'test report', url: 'https://example.test/report' }])
    for (const kind of ['cicd', 'test', 'merge_request', 'artifact', 'deployment'] as const) {
      state = await subject.updateStage({ runId, kind, status: 'passed' })
    }
    expect(state.runs[0]!.status).toBe('ready_for_acceptance')
    state = await subject.updateStage({ runId, kind: 'acceptance', status: 'passed' })
    expect(state.runs[0]!.status).toBe('accepted')
  })

  it('reports failures and blockers as terminal non-deliverable states', async () => {
    const subject = await store()
    const created = await subject.createRun({ project: { id: 'p1', name: 'Project One' } })
    const runId = created.activeRunId!
    let state = await subject.updateStage({ runId, kind: 'cicd', status: 'failed' })
    expect(state.runs[0]!.status).toBe('rejected')
    state = await subject.updateStage({ runId, kind: 'deployment', status: 'blocked' })
    expect(state.runs[0]!.status).toBe('blocked')
  })
})
