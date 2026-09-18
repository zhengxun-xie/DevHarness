/**
 * Agent Teams dispatch branch tests (design/08 §3.2 roster/mailbox paths,
 * §3.3 task-board mode, §3.5 status loop-back): roster resolution, mailbox
 * send, degradation reasons, the accepted-vs-queued distinction,
 * createTask+protocol, and board-status polling.
 *
 * The dispatcher is constructed with accessor callbacks (same DI style as
 * the sessionController path), so the team branch is covered entirely with
 * fake TeamServiceLike / AgentRegistryLike implementations — no platform
 * services are loaded.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AgentDispatcher,
  type AgentRegistryLike,
  type TeamAgentLike,
  type TeamMemberRow,
  type TeamServiceLike,
  type TeamTaskBoardRow,
} from './agent-dispatch.ts'

interface FakeTeamOptions {
  membersOfLead?: Array<{ name: string; status?: TeamMemberRow['status'] }>
  sendResult?: { messageId: string; status: 'accepted' | 'queued' }
  createResult?: { id: string; revision: number }
  /** Non-deleted board rows visible through remoteView (§3.5 loop-back). */
  board?: readonly TeamTaskBoardRow[]
  throwOnSend?: boolean
  throwOnCreate?: boolean
  throwOnView?: boolean
  leadIds?: string[]
}

/** Recorded createTask / sendMessage calls for assertions. */
interface FakeTeamSpy {
  created: Array<{ subject: string; description: string; writeScopes: readonly string[] }>
  sent: Array<{ caller: string; target: string; text: string }>
}

function fakeTeam(options: FakeTeamOptions = {}): TeamServiceLike & { spy: FakeTeamSpy } {
  const leadIds = options.leadIds ?? ['lead-1']
  const spy: FakeTeamSpy = { created: [], sent: [] }
  const team: TeamServiceLike & { spy: FakeTeamSpy } = {
    spy,
    tryMembership(agent: TeamAgentLike) {
      if (leadIds.includes(agent.id)) return { role: 'lead', name: 'lead' }
      if (agent.id.startsWith('teammate-')) return { role: 'teammate', name: agent.id }
      return undefined
    },
    listMembers(caller) {
      if (!leadIds.includes(caller.id)) return []
      const rows: TeamMemberRow[] = [
        { id: caller.id, name: 'lead', role: 'lead', status: 'running' },
      ]
      for (const [index, member] of (options.membersOfLead ?? []).entries()) {
        rows.push({
          id: `teammate-${index + 1}`,
          name: member.name,
          role: 'teammate',
          status: member.status ?? 'idle',
        })
      }
      return rows
    },
    async createTask(caller, request) {
      assert.equal(caller.id, 'lead-1', 'task creation must use the resolved Lead credential')
      if (options.throwOnCreate === true) throw new Error('board unavailable')
      spy.created.push({
        subject: request.subject,
        description: request.description,
        writeScopes: request.writeScopes ?? [],
      })
      return options.createResult ?? { id: 'task-9', revision: 1 }
    },
    remoteView(caller) {
      if (options.throwOnView === true) throw new Error('view unavailable')
      if (!leadIds.includes(caller.id)) return { members: [], tasks: [] }
      return { members: this.listMembers(caller), tasks: options.board ?? [] }
    },
    async sendMessage(caller, request) {
      assert.equal(caller.id, 'lead-1', 'sender credential must be the resolved Lead')
      if (options.throwOnSend === true) throw new Error('mailbox unavailable')
      spy.sent.push({
        caller: caller.id,
        target: request.target,
        text: request.content[0]?.text ?? '',
      })
      return options.sendResult ?? { messageId: 'team-message-1', status: 'accepted' }
    },
  }
  return team
}

function fakeRegistry(ids: readonly string[]): AgentRegistryLike {
  return { list: () => ids.map(id => ({ id })) }
}

function dispatcherFor(
  team: TeamServiceLike | null,
  registry: AgentRegistryLike | null,
): AgentDispatcher {
  return new AgentDispatcher(() => null, () => null, () => team, () => registry)
}

const SCOUT_AND_WRITER = [
  { name: 'doc-scout', status: 'idle' as const },
  { name: 'writer', status: 'running' as const },
]

test('teamRoster reports unavailable when the team service is absent', () => {
  const result = dispatcherFor(null, fakeRegistry(['lead-1'])).teamRoster()
  assert.deepEqual(result, { available: false, leadSessionId: null, members: [] })
})

test('teamRoster reports unavailable when no live Lead exists', () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const result = dispatcherFor(team, fakeRegistry(['teammate-1'])).teamRoster()
  assert.equal(result.available, false)
  assert.deepEqual(result.members, [])
})

test('teamRoster returns the Lead session id and its members', () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const result = dispatcherFor(team, fakeRegistry(['lead-1', 'teammate-1'])).teamRoster()
  assert.equal(result.available, true)
  assert.equal(result.leadSessionId, 'lead-1')
  assert.equal(result.members.length, 3)
})

test('sendToTeam dry-run sends nothing', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeam({
    member: 'doc-scout',
    instruction: 'x',
    dryRun: true,
  })
  assert.equal(result.delivered, false)
  assert.equal(result.reason, 'dry-run')
})

test('sendToTeam without services degrades with typed reasons', async () => {
  const noTeam = await dispatcherFor(null, fakeRegistry(['lead-1'])).sendToTeam({ member: 'doc-scout', instruction: 'x' })
  assert.equal(noTeam.reason, 'no-agent-teams')

  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const noRegistry = await dispatcherFor(team, null).sendToTeam({ member: 'doc-scout', instruction: 'x' })
  assert.equal(noRegistry.reason, 'no-agent-registry')

  const noLead = await dispatcherFor(team, fakeRegistry(['teammate-1'])).sendToTeam({ member: 'doc-scout', instruction: 'x' })
  assert.equal(noLead.reason, 'no-lead')
})

test('sendToTeam rejects an unknown member name with a typed reason', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeam({
    member: 'nobody',
    instruction: 'x',
  })
  assert.equal(result.delivered, false)
  assert.equal(result.reason, 'unknown-member')
  assert.equal(result.sessionId, null)
})

test('sendToTeam delivers through the mailbox with the member session id', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeam({
    member: 'doc-scout',
    instruction: 'instruction text',
  })
  assert.equal(result.delivered, true)
  assert.equal(result.member, 'doc-scout')
  assert.equal(result.sessionId, 'teammate-1', 'assignee keeps the teammate session id')
  assert.equal(result.messageId, 'team-message-1')
  assert.equal(result.queued, false)
  assert.equal(result.reason, 'sent')
})

test('a queued mailbox message still counts as delivered, flagged queued', async () => {
  const team = fakeTeam({
    membersOfLead: [{ name: 'doc-scout', status: 'inactive' }],
    sendResult: { messageId: 'team-message-q', status: 'queued' },
  })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeam({
    member: 'doc-scout',
    instruction: 'x',
  })
  // Mailbox acceptance IS delivery: durable the moment it is accepted.
  assert.equal(result.delivered, true)
  assert.equal(result.queued, true)
})

test('a mailbox failure degrades to team-error, never throws past the dispatcher', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER, throwOnSend: true })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeam({
    member: 'doc-scout',
    instruction: 'x',
  })
  assert.equal(result.delivered, false)
  assert.equal(result.reason, 'team-error')
})

test('multi-lead hosts resolve the lead whose roster owns the member', async () => {
  const seen: string[] = []
  // lead-1 is the first live lead but owns NO teammates; lead-2 owns
  // doc-scout. The member-name match must route the credential to lead-2
  // rather than blindly picking the first live lead.
  const teamMulti: TeamServiceLike = {
    tryMembership(agent) {
      if (agent.id === 'lead-1' || agent.id === 'lead-2') {
        return { role: 'lead', name: 'lead' }
      }
      return undefined
    },
    listMembers(caller) {
      const leadRow = { id: caller.id, name: 'lead', role: 'lead' as const, status: 'running' as const }
      if (caller.id !== 'lead-2') return [leadRow]
      return [
        leadRow,
        { id: 'teammate-1', name: 'doc-scout', role: 'teammate' as const, status: 'idle' as const },
      ]
    },
    async createTask() {
      return { id: 'task-multi', revision: 1 }
    },
    remoteView(caller) {
      return { members: this.listMembers(caller), tasks: [] }
    },
    async sendMessage(caller, request) {
      seen.push(`${caller.id}:${request.target}`)
      return { messageId: 'team-message-multi', status: 'accepted' }
    },
  }
  const result = await dispatcherFor(teamMulti, fakeRegistry(['lead-1', 'lead-2'])).sendToTeam({
    member: 'doc-scout',
    instruction: 'x',
  })
  assert.equal(result.delivered, true)
  assert.equal(result.sessionId, 'teammate-1')
  assert.deepEqual(seen, ['lead-2:doc-scout'], 'credential must be the owning lead')
})

// ---------------------------------------------------------------------------
// Task-board mode (design/08 §3.3): createTask + completion protocol.
// ---------------------------------------------------------------------------

test('sendToTeamTask dry-run creates nothing and sends nothing', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeamTask({
    member: 'doc-scout',
    subject: '[REV-0001] title',
    instruction: 'x',
    reviewId: 'REV-0001',
    dryRun: true,
  })
  assert.equal(result.delivered, false)
  assert.equal(result.reason, 'dry-run')
  assert.equal(result.task, null)
  assert.equal(team.spy.created.length, 0)
  assert.equal(team.spy.sent.length, 0)
})

test('sendToTeamTask creates the board task and notifies with the completion protocol', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeamTask({
    member: 'doc-scout',
    subject: '[REV-0002] Fix the placeholder',
    instruction: 'instruction text',
    reviewId: 'REV-0002',
    writeScopes: ['ProjectInfo.md'],
  })
  assert.equal(result.delivered, true)
  assert.equal(result.reason, 'sent')
  assert.deepEqual(result.task, { id: 'task-9', revision: 1 })
  assert.equal(result.sessionId, 'teammate-1')
  // The board task carries the subject + full instruction + write scope.
  assert.equal(team.spy.created.length, 1)
  assert.equal(team.spy.created[0]?.subject, '[REV-0002] Fix the placeholder')
  assert.equal(team.spy.created[0]?.description, 'instruction text')
  assert.deepEqual(team.spy.created[0]?.writeScopes, ['ProjectInfo.md'])
  // The mailbox notification includes the instruction plus the protocol
  // naming the created task and the review to quote back.
  assert.equal(team.spy.sent.length, 1)
  const text = team.spy.sent[0]?.text ?? ''
  assert.match(text, /^instruction text\n\nTeam protocol:/)
  assert.match(text, /task-9/)
  assert.match(text, /REV-0002/)
})

test('sendToTeamTask degrades with typed reasons on the preconditions', async () => {
  const noTeam = await dispatcherFor(null, fakeRegistry(['lead-1'])).sendToTeamTask({
    member: 'doc-scout', subject: 's', instruction: 'x', reviewId: 'REV-0003',
  })
  assert.equal(noTeam.reason, 'no-agent-teams')

  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const noRegistry = await dispatcherFor(team, null).sendToTeamTask({
    member: 'doc-scout', subject: 's', instruction: 'x', reviewId: 'REV-0003',
  })
  assert.equal(noRegistry.reason, 'no-agent-registry')

  const noLead = await dispatcherFor(team, fakeRegistry(['teammate-1'])).sendToTeamTask({
    member: 'doc-scout', subject: 's', instruction: 'x', reviewId: 'REV-0003',
  })
  assert.equal(noLead.reason, 'no-lead')

  const unknown = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeamTask({
    member: 'nobody', subject: 's', instruction: 'x', reviewId: 'REV-0003',
  })
  assert.equal(unknown.reason, 'unknown-member')
  assert.equal(team.spy.created.length, 0, 'no task may be created for an unknown member')
})

test('a createTask failure degrades to team-error without notifying the member', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER, throwOnCreate: true })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeamTask({
    member: 'doc-scout',
    subject: 's',
    instruction: 'x',
    reviewId: 'REV-0004',
  })
  assert.equal(result.delivered, false)
  assert.equal(result.reason, 'team-error')
  assert.equal(result.task, null)
  assert.equal(team.spy.sent.length, 0)
})

test('a send failure after task creation reports team-error (orphan board task, documented)', async () => {
  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER, throwOnSend: true })
  const result = await dispatcherFor(team, fakeRegistry(['lead-1'])).sendToTeamTask({
    member: 'doc-scout',
    subject: 's',
    instruction: 'x',
    reviewId: 'REV-0005',
  })
  // Known limitation (§3.3): the created task stays on the board unowned
  // while the review remains undispatched; the dispatch itself is a failure.
  assert.equal(result.delivered, false)
  assert.equal(result.reason, 'team-error')
  assert.equal(result.task, null)
  assert.equal(team.spy.created.length, 1)
})

// ---------------------------------------------------------------------------
// Status loop-back (design/08 §3.5): teamTaskStatus board polling.
// ---------------------------------------------------------------------------

test('teamTaskStatus reads the current status from the Lead board', () => {
  const team = fakeTeam({
    membersOfLead: SCOUT_AND_WRITER,
    board: [
      { id: 'task-1', status: 'in_progress', subject: '[REV-0006] A', ownerName: 'doc-scout' },
      { id: 'task-2', status: 'completed', subject: '[REV-0007] B', ownerName: 'writer' },
    ],
  })
  const found = dispatcherFor(team, fakeRegistry(['lead-1'])).teamTaskStatus('task-2')
  assert.deepEqual(
    { available: found.available, status: found.status },
    { available: true, status: 'completed' },
  )
  assert.equal(found.task?.ownerName, 'writer')

  // Absent id on a reachable board is a definitive null, not unavailable.
  const absent = dispatcherFor(team, fakeRegistry(['lead-1'])).teamTaskStatus('task-none')
  assert.deepEqual(absent, { available: true, status: null, task: null })
})

test('teamTaskStatus degrades to unavailable on service / lead / read failures', () => {
  const noService = dispatcherFor(null, fakeRegistry(['lead-1'])).teamTaskStatus('task-1')
  assert.deepEqual(noService, { available: false, status: null, task: null })

  const team = fakeTeam({ membersOfLead: SCOUT_AND_WRITER })
  const noLead = dispatcherFor(team, fakeRegistry(['teammate-1'])).teamTaskStatus('task-1')
  assert.deepEqual(noLead, { available: false, status: null, task: null },
    'no live Lead means no board was read — unavailable, not absent')

  const viewFails = dispatcherFor(
    fakeTeam({ membersOfLead: SCOUT_AND_WRITER, throwOnView: true }),
    fakeRegistry(['lead-1']),
  ).teamTaskStatus('task-1')
  assert.deepEqual(viewFails, { available: false, status: null, task: null },
    'a board read failure must never break the poll')
})

test('teamTaskStatus scans every live Lead board (multi-lead hosts)', () => {
  // lead-1's board lacks the task; lead-2 owns it. The poll must iterate
  // rather than trusting the first live Lead.
  const teamMulti: TeamServiceLike = {
    tryMembership(agent) {
      if (agent.id === 'lead-1' || agent.id === 'lead-2') {
        return { role: 'lead', name: 'lead' }
      }
      return undefined
    },
    listMembers(caller) {
      const leadRow = { id: caller.id, name: 'lead', role: 'lead' as const, status: 'running' as const }
      if (caller.id !== 'lead-2') return [leadRow]
      return [
        leadRow,
        { id: 'teammate-1', name: 'doc-scout', role: 'teammate' as const, status: 'idle' as const },
      ]
    },
    async createTask() {
      return { id: 'task-multi', revision: 1 }
    },
    remoteView(caller) {
      if (caller.id === 'lead-2') {
        return {
          members: this.listMembers(caller),
          tasks: [{ id: 'task-multi', status: 'completed', ownerName: 'doc-scout' }],
        }
      }
      return { members: this.listMembers(caller), tasks: [] }
    },
    async sendMessage() {
      return { messageId: 'team-message-multi', status: 'accepted' }
    },
  }
  const result = dispatcherFor(teamMulti, fakeRegistry(['lead-1', 'lead-2'])).teamTaskStatus('task-multi')
  assert.equal(result.available, true)
  assert.equal(result.status, 'completed')
  assert.equal(result.task?.ownerName, 'doc-scout')
})
