/**
 * Thin structural adapter over the platform session-controller Remote service
 * (design/07 §4), plus the Agent Teams dispatch branch (design/08 §3.2).
 * The service packages are not installed dependencies, so — exactly like
 * workspaces.ts does for workspaceRegistry — we declare the minimal wire
 * shapes and let cordis resolve them via the 'sessionController' /
 * 'agentTeams' / 'agents' tokens.
 *
 * Dispatch resolution:
 *   explicit sessionId      -> prompt that session
 *   linked workspace        -> reuse its last known session, else create one
 *   named team member       -> durable Team mailbox message (design/08)
 *   no workspace / no API   -> delivered:false (the UI copies the context or
 *                              asks the user to bind the workspace in the left bar)
 *
 * Failure anywhere never throws past the route: the caller gets the assembled
 * context with delivered:false and can fall back to copy/prefill.
 */
import { randomUUID } from 'node:crypto'
import {
  loadRegistry,
  requireProject,
  resolveWorkspace,
} from './projects.ts'
import type { WorkspaceInfo } from '../protocol.ts'
import type { WorkspaceRegistryLike } from './workspaces.ts'

export interface SessionControllerLike {
  create(req: {
    workspaceId?: string
    cwd?: string
    sessionId?: string
    agentPreset?: string
  }): Promise<{ sessionId?: string; id?: string } | void>
  prompt(
    req: {
      requestId: string
      sessionId: string
      mode: 'queue' | 'steer'
      content: Array<{
        type: 'text'
        text: string
      }>
      clientTimeZone?: string
    },
    // Mandatory on the platform service: its first statement is
    // `signal.throwIfAborted()`. The Remote direct-call path forwards this
    // second arg verbatim, so omitting it throws a TypeError before admission.
    signal: AbortSignal,
  ): Promise<{ accepted?: boolean } | void>
}

export interface DispatchResult {
  delivered: boolean
  sessionId: string | null
  /**
   * The prompt request id (user/message source rpcId) for a delivered run.
   * Used to correlate the agent's streamed reply back into the review thread.
   */
  requestId: string | null
  reason:
    | 'sent'
    | 'dry-run'
    | 'no-workspace'
    | 'no-session-controller'
    | 'controller-error'
}

// ---------------------------------------------------------------------------
// Agent Teams dispatch (design/08 §2-§3): minimal wire shapes only, resolved
// through the cordis 'agentTeams' / 'agents' tokens exactly like the
// sessionController above. A teammate is a continuable subagent child session
// whose TeamMemberView.id IS a session id, so team bookkeeping reuses the
// existing assignee/agentRuns fields. Delivery goes through the Team mailbox
// (durable queue + wake/cold-resume); never prompt the teammate session
// directly — that bypasses queue semantics (design/08 §4 anti-pattern).
// ---------------------------------------------------------------------------

/** Minimal shape of one live platform Agent — an opaque caller credential. */
export interface TeamAgentLike {
  readonly id: string
}

/**
 * Minimal wire shape of the platform agent registry (cordis token 'agents').
 * Agent ids are session ids; list() is all the team branch needs to discover
 * live Team Leads.
 */
export interface AgentRegistryLike {
  list(): readonly TeamAgentLike[]
}

/** Roster row projected from the platform TeamMemberView. */
export interface TeamMemberRow {
  readonly id: string
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'
  readonly description?: string
  readonly model?: string
}

/** Task-board row projected from the platform TeamTaskView (§3.5 loop-back). */
export interface TeamTaskBoardRow {
  readonly id: string
  readonly status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  readonly subject?: string
  readonly ownerName?: string
}

/** Minimal wire shape of the experimental Agent Teams service. */
export interface TeamServiceLike {
  /** Resolve an exact live Agent's Team membership; undefined when not a member. */
  tryMembership(agent: TeamAgentLike): { role: 'lead' | 'teammate'; name: string } | undefined
  /** Roster visible to one live Team member (caller must be that member). */
  listMembers(caller: TeamAgentLike): readonly TeamMemberRow[]
  /** Queue one durable peer message, then attempt immediate delivery. */
  sendMessage(
    caller: TeamAgentLike,
    request: {
      target: string
      content: Array<{ type: 'text'; text: string }>
      signal: AbortSignal
    },
  ): Promise<{ messageId: string; status: 'accepted' | 'queued' }>
  /** Create one unowned pending task on the Team Lead's shared board. */
  createTask(
    caller: TeamAgentLike,
    request: {
      subject: string
      description: string
      blockedBy?: readonly string[]
      writeScopes?: readonly string[]
    },
  ): Promise<{ id: string; revision: number }>
  /**
   * Read the current roster and non-deleted task board (the Remote `view`
   * projection). Used by the §3.5 status loop-back: the reviewer plugin
   * polls the shared board instead of subscribing to team events.
   */
  remoteView(caller: TeamAgentLike): {
    members: readonly TeamMemberRow[]
    tasks: readonly TeamTaskBoardRow[]
  }
}

export interface TeamDispatchResult {
  delivered: boolean
  /** Target teammate name (model-facing), null on failure paths. */
  member: string | null
  /** The teammate's underlying session id — feeds assignee/agentRuns. */
  sessionId: string | null
  /** Durable mailbox message id when queued. */
  messageId: string | null
  /** true when the mailbox retained the message (member not live right now). */
  queued: boolean
  reason:
    | 'sent'
    | 'dry-run'
    | 'no-agent-teams'
    | 'no-agent-registry'
    | 'no-lead'
    | 'unknown-member'
    | 'team-error'
}

/** Roster snapshot for the client member picker; available:false degrades. */
export interface TeamRosterResult {
  available: boolean
  /** The resolved Lead's session id (diagnostics), null when unavailable. */
  leadSessionId: string | null
  members: readonly TeamMemberRow[]
}

/** Board task created by a task-mode team dispatch (design/08 §3.3). */
export interface TeamTaskInfo {
  readonly id: string
  readonly revision: number
}

/** Task-mode team dispatch outcome (design/08 §3.3): mailbox + board task. */
export interface TeamTaskDispatchResult extends TeamDispatchResult {
  /** The created board task; null on every non-delivered path. */
  task: TeamTaskInfo | null
}

/** Board-task status poll result for the §3.5 loop-back. */
export interface TeamTaskStatusResult {
  /** false when the team service / registry / live Lead is unavailable. */
  available: boolean
  /** Current status; null when the task id is not on any visible board. */
  status: TeamTaskBoardRow['status'] | null
  /** The matching row (subject/ownerName for display), null when absent. */
  task: TeamTaskBoardRow | null
}

/** Resolve the project's linked workspace (explicit id, then realpath auto). */
export function resolveProjectWorkspace(
  projectId: string,
  workspaces: readonly WorkspaceInfo[],
): { id: string } | null {
  const registry = loadRegistry()
  const project = requireProject(registry, projectId)
  return resolveWorkspace(project, workspaces)
}

/** Pick the most recent known session id of a workspace, if any. */
function existingSessionId(registry: WorkspaceRegistryLike, workspaceId: string): string | null {
  try {
    const workspace = registry.list().find(item => item.id === workspaceId)
    if (workspace === undefined) return null
    const ids = workspace.sessionIds
    return ids.length > 0 ? ids[ids.length - 1] : null
  } catch {
    return null
  }
}

export class AgentDispatcher {
  /**
   * Accessor callbacks (not captured values): cordis inject callbacks may
   * resolve after the effect that registers routes, so every dispatch reads
   * the current service bindings.
   *
   * Explicit field assignments instead of parameter properties — node's
   * strip-only loader (used by `pnpm test`) rejects parameter properties.
   */
  private readonly getController: () => SessionControllerLike | null
  private readonly getWorkspaceRegistry: () => WorkspaceRegistryLike | null
  private readonly getTeam: () => TeamServiceLike | null
  private readonly getAgentRegistry: () => AgentRegistryLike | null

  constructor(
    getController: () => SessionControllerLike | null,
    getWorkspaceRegistry: () => WorkspaceRegistryLike | null,
    getTeam: () => TeamServiceLike | null = () => null,
    getAgentRegistry: () => AgentRegistryLike | null = () => null,
  ) {
    this.getController = getController
    this.getWorkspaceRegistry = getWorkspaceRegistry
    this.getTeam = getTeam
    this.getAgentRegistry = getAgentRegistry
  }

  private get controller(): SessionControllerLike | null {
    return this.getController()
  }

  private get team(): TeamServiceLike | null {
    return this.getTeam()
  }

  private get agentRegistry(): AgentRegistryLike | null {
    return this.getAgentRegistry()
  }

  /**
   * Resolve the live Team Lead whose roster contains `member` (first live
   * lead when member is null). Single-team deployments are the P1 norm; the
   * member-name match keeps multi-team hosts deterministic.
   */
  private resolveLead(member: string | null): { lead: TeamAgentLike; members: readonly TeamMemberRow[] } | null {
    const team = this.team
    const registry = this.agentRegistry
    if (team === null || registry === null) return null
    let fallback: { lead: TeamAgentLike; members: readonly TeamMemberRow[] } | null = null
    for (const agent of registry.list()) {
      if (team.tryMembership(agent)?.role !== 'lead') continue
      const members = team.listMembers(agent)
      if (member === null) return { lead: agent, members }
      if (fallback === null) fallback = { lead: agent, members }
      if (members.some(row => row.role === 'teammate' && row.name === member)) {
        return { lead: agent, members }
      }
    }
    return fallback
  }

  /**
   * Current team roster for the client member picker. available:false covers
   * "no agent-team plugin", "no live Lead", and "no agents registry" alike —
   * the picker hides and the session path stays authoritative.
   */
  teamRoster(): TeamRosterResult {
    const resolved = this.resolveLead(null)
    if (resolved === null) return { available: false, leadSessionId: null, members: [] }
    return { available: true, leadSessionId: resolved.lead.id, members: resolved.members }
  }

  /**
   * Look one board task up by id for the §3.5 status loop-back. The task was
   * created by the Lead owning the dispatched member, but any live Lead's
   * view is a valid read credential — iterate and first hit wins (single-team
   * hosts resolve on the first iteration).
   */
  teamTaskStatus(taskId: string): TeamTaskStatusResult {
    const unavailable: TeamTaskStatusResult = { available: false, status: null, task: null }
    const team = this.team
    const registry = this.agentRegistry
    if (team === null || registry === null) return unavailable
    try {
      let sawLead = false
      for (const agent of registry.list()) {
        if (team.tryMembership(agent)?.role !== 'lead') continue
        sawLead = true
        const task = team.remoteView(agent).tasks.find(row => row.id === taskId)
        if (task !== undefined) {
          return { available: true, status: task.status, task }
        }
      }
      // No live Lead means no board was actually read — unavailable, not "absent".
      if (!sawLead) return unavailable
    } catch {
      // A board read must never break the poll — report unavailable.
      return unavailable
    }
    // Reachable board without the task: the id may have been deleted or
    // never created; that is a definitive "not on the board", not an error.
    return { available: true, status: null, task: null }
  }

  /**
   * Dispatch the assembled instruction to one named teammate through the
   * Team mailbox. Mailbox acceptance IS delivery: the message is durable the
   * moment it is accepted, so `queued: true` (member offline, wakes later)
   * still counts as delivered — the UI labels it "queued" vs "delivered".
   */
  async sendToTeam(input: {
    member: string
    instruction: string
    dryRun?: boolean
  }): Promise<TeamDispatchResult> {
    const base = { delivered: false, member: input.member, sessionId: null, messageId: null, queued: false }
    if (input.dryRun === true) {
      return { ...base, reason: 'dry-run' }
    }
    if (this.team === null) {
      return { ...base, reason: 'no-agent-teams' }
    }
    if (this.agentRegistry === null) {
      return { ...base, reason: 'no-agent-registry' }
    }
    const resolved = this.resolveLead(input.member)
    if (resolved === null) {
      return { ...base, reason: 'no-lead' }
    }
    const row = resolved.members.find(
      member => member.role === 'teammate' && member.name === input.member,
    )
    if (row === undefined) {
      return { ...base, reason: 'unknown-member' }
    }
    try {
      const result = await this.team.sendMessage(resolved.lead, {
        target: input.member,
        content: [{ type: 'text', text: input.instruction }],
        signal: new AbortController().signal,
      })
      return {
        delivered: true,
        member: input.member,
        sessionId: row.id,
        messageId: result.messageId,
        queued: result.status === 'queued',
        reason: 'sent',
      }
    } catch {
      return { ...base, reason: 'team-error' }
    }
  }

  /**
   * Task-mode team dispatch (design/08 §3.3): create one shared board task,
   * then notify the member through the mailbox with the full instruction
   * plus a completion protocol. Task creation alone wakes nobody — the
   * accompanying message is what starts the member (and carries the task id
   * the member must complete when done).
   *
   * Edge case (known limitation): if createTask succeeds but sendMessage
   * fails, the board keeps an unowned pending task while the review stays
   * undispatched — the orphan is visible on the board and re-dispatching
   * creates a fresh task.
   */
  async sendToTeamTask(input: {
    member: string
    subject: string
    instruction: string
    reviewId: string
    writeScopes?: readonly string[]
    dryRun?: boolean
  }): Promise<TeamTaskDispatchResult> {
    const base = { delivered: false, member: input.member, sessionId: null, messageId: null, queued: false, task: null }
    if (input.dryRun === true) {
      return { ...base, reason: 'dry-run' }
    }
    if (this.team === null) {
      return { ...base, reason: 'no-agent-teams' }
    }
    if (this.agentRegistry === null) {
      return { ...base, reason: 'no-agent-registry' }
    }
    const resolved = this.resolveLead(input.member)
    if (resolved === null) {
      return { ...base, reason: 'no-lead' }
    }
    const row = resolved.members.find(
      member => member.role === 'teammate' && member.name === input.member,
    )
    if (row === undefined) {
      return { ...base, reason: 'unknown-member' }
    }
    try {
      const task = await this.team.createTask(resolved.lead, {
        subject: input.subject,
        description: input.instruction,
        writeScopes: input.writeScopes ?? [],
      })
      // Completion protocol appended to the instruction (design/08 §3.3):
      // the member reports back through the board + a lead-facing summary.
      const protocol =
        `\n\nTeam protocol:\n` +
        `5. When done, mark team task ${task.id} completed (updateTask, action=complete)\n` +
        `   and send a summary message to "lead" quoting review id ${input.reviewId}.\n`
      const result = await this.team.sendMessage(resolved.lead, {
        target: input.member,
        content: [{ type: 'text', text: input.instruction + protocol }],
        signal: new AbortController().signal,
      })
      return {
        delivered: true,
        member: input.member,
        sessionId: row.id,
        messageId: result.messageId,
        queued: result.status === 'queued',
        reason: 'sent',
        task: { id: task.id, revision: task.revision },
      }
    } catch {
      return { ...base, reason: 'team-error' }
    }
  }

  /**
   * Send the assembled instruction. When `dryRun` is true nothing is sent and
   * the caller still receives the context (same assembly path — 07 §6).
   */
  async send(input: {
    projectId: string
    instruction: string
    sessionId?: string | null
    dryRun?: boolean
    workspaces: readonly WorkspaceInfo[]
  }): Promise<DispatchResult> {
    if (input.dryRun === true) {
      return { delivered: false, sessionId: null, requestId: null, reason: 'dry-run' }
    }
    if (this.controller === null) {
      return { delivered: false, sessionId: null, requestId: null, reason: 'no-session-controller' }
    }

    let sessionId: string
    if (typeof input.sessionId === 'string' && input.sessionId !== '') {
      sessionId = input.sessionId
    } else {
      const workspace = resolveProjectWorkspace(input.projectId, input.workspaces)
      if (workspace === null) {
        return { delivered: false, sessionId: null, requestId: null, reason: 'no-workspace' }
      }
      const registry = this.getWorkspaceRegistry()
      const existing = registry !== null
        ? existingSessionId(registry, workspace.id)
        : null
      if (existing !== null) {
        sessionId = existing
      } else {
        try {
          const created = await this.controller.create({ workspaceId: workspace.id })
          const createdId = (created as { sessionId?: string; id?: string } | null | undefined)?.sessionId
            ?? (created as { sessionId?: string; id?: string } | null | undefined)?.id
          if (typeof createdId !== 'string' || createdId === '') {
            return { delivered: false, sessionId: null, requestId: null, reason: 'controller-error' }
          }
          sessionId = createdId
        } catch {
          return { delivered: false, sessionId: null, requestId: null, reason: 'controller-error' }
        }
      }
    }

    // Minted before prompt: the platform stamps it onto the user/message
    // source as rpcId, which lets the session/event subscription correlate
    // this run's streamed reply back to the review thread.
    const requestId = randomUUID()
    try {
      const result = await this.controller.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        content: [{
          type: 'text',
          text: input.instruction,
        }],
        clientTimeZone:
          typeof Intl === 'object' && Intl.DateTimeFormat !== undefined
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : undefined,
      }, new AbortController().signal)
      // The wire contract returns { accepted: true }; tolerate void on older builds.
      if (result !== undefined && result !== null && result.accepted === false) {
        return { delivered: false, sessionId, requestId: null, reason: 'controller-error' }
      }
      return { delivered: true, sessionId, requestId, reason: 'sent' }
    } catch {
      return { delivered: false, sessionId, requestId: null, reason: 'controller-error' }
    }
  }
}
