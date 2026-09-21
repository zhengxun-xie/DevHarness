/**
 * Document-scoped long-lived AI session (design intent: "AI 按键 → 每个文档
 * 一个长期会话，上下文连续")。
 *
 * Mirrors the reviewer plugin's `agent-dispatch.ts` structural-injection
 * pattern: the platform session-controller Remote service is reached through
 * the cordis 'sessionController' token with a minimal wire shape (no package
 * dependency), so the browser bundle stays standalone.
 *
 * Lifecycle:
 *   1. Resolve the project's workspace (explicit id or realpath auto-match).
 *   2. Find-or-create the "[AI优化]<document>" session and persist the
 *      document → sessionId binding in `<project>/.devbuddy/ai-sessions.json`
 *      so every later turn (incl. the modal's 追问) reuses the SAME session.
 *   3. Admit one prompt (mode 'queue') and collect the assistant's committed
 *      `assistant/message` reply by following the live event stream.
 *
 * Failure anywhere degrades gracefully: the caller gets `delivered:false`
 * with a reason; the document editing flow is never broken by a missing
 * session-controller / workspace / reply.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, basename, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AiActionId, AiDispatchRequest, AiDispatchResult } from '../protocol.ts'

/** Subset of the injected session-controller Remote service. */
export interface SessionControllerLike {
  create(req: {
    workspaceId?: string
    cwd?: string
    sessionId?: string
    agentPreset?: string
  }): Promise<{ sessionId?: string; id?: string } | void>
  rename(req: { sessionId: string; title: string }): Promise<{ title?: string; seq?: number } | void>
  prompt(
    req: {
      requestId: string
      sessionId: string
      mode: 'queue' | 'steer'
      content: Array<{ type: 'text'; text: string }>
      clientTimeZone?: string
    },
    signal: AbortSignal,
  ): Promise<{ accepted?: boolean } | void>
  follow(
    req: { address: { kind: 'session'; sessionId: string }; assistantStream?: true },
    signal: AbortSignal,
  ): AsyncIterable<AiFollowFrame>
}

/** Minimal wire shape of one `follow` frame (structural, see session-controller). */
export type AiFollowFrame =
  | { type: 'snapshot'; header: unknown; cursor: number; records: readonly unknown[]; hasMore: boolean }
  | { type: 'event'; event: AiWireEvent }
  | { type: 'assistant-stream'; frame: unknown }

/** Minimal wire shape of one durable session event. */
export interface AiWireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Reply-collection deadline: models can take tens of seconds. */
const REPLY_TIMEOUT_MS = 180_000

/** Per-document AI session binding file, relative to a project directory. */
const AI_SESSIONS_FILE = '.devbuddy/ai-sessions.json'

/** Session-title prefix, e.g. "[AI优化]CoreRequirements". */
const AI_TITLE_PREFIX = '[AI优化]'

interface AiSessionsFile {
  version: number
  sessions: Record<string, string>
}

/** Strip a trailing extension for a readable session title. */
function documentTitle(document: string): string {
  return basename(document).replace(/\.[^.]+$/, '')
}

/** Join the text parts of a committed assistant message. */
function extractAssistantText(data: unknown): string {
  const record = data as { message?: { content?: unknown } } | null | undefined
  const content = record?.message?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content as Array<{ type?: unknown; text?: unknown }>) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text !== '') {
      parts.push(part.text)
    }
  }
  return parts.join('')
}

/**
 * Defensive cap on each context window (the client already bounds them).
 * 'before' keeps the tail (nearest the caret); 'after' keeps the head.
 */
const CONTEXT_LIMIT = 6000

function clipContext(text: string | undefined, keepTail: boolean): string {
  if (typeof text !== 'string') return ''
  if (text.length <= CONTEXT_LIMIT) return text
  return keepTail ? text.slice(-CONTEXT_LIMIT) : text.slice(0, CONTEXT_LIMIT)
}

/** Actions whose task line is fixed (everything except the user's own text). */
type FixedAiActionId = Exclude<AiActionId, 'custom'>

/** Action instructions; the target text is marked in the prompt below. */
const ACTION_TASKS: Record<FixedAiActionId, string> = {
  polish: '请润色【待处理文字】——保留原意，让表达更流畅、准确。',
  translate: '请翻译【待处理文字】——原文是中文就译成英文，否则译成中文。',
  summarize: '请用简洁的语言总结【待处理文字】的要点。',
  explain: '请解释【待处理文字】的含义与意图。',
  continue: '请在 <<<续写点>>> 处自然接续，保持相同的语言与风格。',
}

/** Fallback task line when the 'custom' row was submitted with blank text. */
const CUSTOM_FALLBACK_TASK = '让表达更清晰、准确。'

/**
 * Signature of the document window a prompt conveys. Two consecutive turns with
 * the same signature carry identical context, so the window is then elided.
 * The custom instruction belongs to the signature: a new instruction means a
 * new turn the session has never seen, even when the selection is unchanged.
 */
function contextSignature(
  action: AiActionId,
  selection: string,
  context: { before?: string; after?: string },
  instruction = '',
): string {
  return [action, selection, context.before ?? '', context.after ?? '', instruction].join('\u0000')
}

/**
 * Append the surrounding document window to a prompt body — or the short
 * "unchanged" note when the long-lived session already holds it.
 */
function pushDocumentContext(
  lines: string[],
  includeContext: boolean,
  hasContext: boolean,
  before: string,
  after: string,
): void {
  if (includeContext && hasContext) {
    lines.push('', '【文档上下文】（仅供理解，不要改动）', `${before}\n…\n${after}`)
  } else if (!includeContext && hasContext) {
    lines.push('', '（【文档上下文】与上一轮相同，见本会话上一条消息。）')
  }
}

/**
 * Map an action to the prompt sent to the session's agent.
 * @param action - the requested AI action.
 * @param selection - the selected text ('' for 'continue' at the caret).
 * @param followUp - an extra instruction for a follow-up turn, when present.
 * @param context - surrounding document text around the selection/caret.
 * @param includeContext - false to replace the (unchanged) window with a short
 *   "same as before" note, since the long-lived session already holds it.
 * @param customInstruction - the user's own revision instruction ('custom').
 */
function buildPrompt(
  action: AiActionId,
  selection: string,
  followUp: string | undefined,
  context: { before?: string; after?: string },
  includeContext: boolean,
  customInstruction?: string,
): string {
  // The session runs the full DSH coding agent, so every prompt must forbid
  // tool use and file edits and demand a bare-text reply — otherwise the agent
  // would "helpfully" rewrite the document instead of returning text. These
  // rules are short and are re-sent every turn on purpose (instructions decay
  // in a long-lived session; forgetting them would let the agent edit files).
  const rules = [
    '规则（必须严格遵守）：',
    '1. 不要调用任何工具、不要读取或修改任何文件。',
    '2. 不要做任何解释、注释、前言或结语。',
    '3. 不要用代码块（```）包裹输出。',
    '4. 直接输出结果文本本身，且只输出结果文本。',
  ].join('\n')
  if (followUp !== undefined && followUp.trim() !== '') {
    // The prior turn (with its context) already lives in this session.
    return [
      rules,
      '',
      '请基于本会话上一轮的结果继续调整，用户补充要求：',
      followUp.trim(),
    ].join('\n')
  }

  const before = clipContext(context.before, true)
  const after = clipContext(context.after, false)
  const hasContext = before !== '' || after !== ''

  // 'continue' has no selection: the caret lives only in the document window.
  if (action === 'continue') {
    return [
      rules,
      '',
      '【文档上下文】（<<<续写点>>> 表示需要从这里续写）',
      includeContext
        ? `${before}<<<续写点>>>${after}`
        : '与上一轮相同，续写点未变（详见本会话上一条消息）。',
      '',
      ACTION_TASKS.continue,
      '只输出续写出来的内容本身：不要重复 <<<续写点>>> 之前的文字，不要输出标记，不要任何解释。',
    ].join('\n')
  }

  // 'custom' at the caret (no selection): mirror 'continue' — the document
  // window marks the edit position and the user's instruction is the task.
  if (action === 'custom' && selection === '') {
    const instruction = (customInstruction ?? '').trim()
    return [
      rules,
      '',
      '【文档上下文】（<<<光标>>> 表示当前编辑位置）',
      includeContext
        ? `${before}<<<光标>>>${after}`
        : '与上一轮相同，光标位置未变（详见本会话上一条消息）。',
      '',
      '用户的修改意见：',
      instruction === '' ? CUSTOM_FALLBACK_TASK : instruction,
      '',
      '请按修改意见处理 <<<光标>>> 处的内容：意见是改写或润色光标附近的文字时，输出改写后的完整文字（不要重复未改动的部分）；意见是新增内容时，输出要新增的文字。',
      '只输出结果文本本身，不要任何解释。',
    ].join('\n')
  }

  // Other actions act on the selection. The selection is always stated
  // explicitly; the surrounding window is sent only when it changed.
  const lines = [rules, '', '【待处理文字】', selection]
  pushDocumentContext(lines, includeContext, hasContext, before, after)
  if (action === 'custom') {
    // The popover's own revision row: the user's text IS the task. Keep the
    // instruction scoped to the selection so the agent edits nothing else.
    const instruction = (customInstruction ?? '').trim()
    lines.push(
      '',
      '请严格按下面的修改意见改写【待处理文字】——除该意见要求的改动外，保持原文的内容、语言与格式不变：',
      instruction === '' ? CUSTOM_FALLBACK_TASK : instruction,
      '只输出改写后的文字本身，不要任何解释。',
    )
    return lines.join('\n')
  }
  lines.push('', ACTION_TASKS[action])
  return lines.join('\n')
}

/**
 * Host-side manager for the document-scoped AI session. Constructed once at
 * plugin startup with accessor callbacks (not captured values) so the cordis
 * service binding may resolve after the route effect registers.
 */
export class AiSessionService {
  private readonly getController: () => SessionControllerLike | null
  /** Resolve a project id → { path, workspaceId } (backed by the store). */
  private readonly resolveProject: (projectId: string) => { path: string; workspaceId: string | null }
  /**
   * Whether a session is archived. An archived session is intentionally hidden,
   * so a binding to one must be replaced rather than reused.
   */
  private readonly isArchived: (sessionId: string) => boolean
  /**
   * Signature of the last document window sent, per session. The session keeps
   * its previous turn (with that context) in history, so an unchanged window is
   * not resent — only a short "same as before" note.
   */
  private readonly contextSignatures = new Map<string, string>()

  constructor(
    getController: () => SessionControllerLike | null,
    resolveProject: (projectId: string) => { path: string; workspaceId: string | null },
    isArchived: (sessionId: string) => boolean = () => false,
  ) {
    this.getController = getController
    this.resolveProject = resolveProject
    this.isArchived = isArchived
  }

  private get controller(): SessionControllerLike | null {
    return this.getController()
  }

  /** Read the persisted document → sessionId map (empty when absent). */
  private loadBindings(projectPath: string): Record<string, string> {
    const file = resolve(projectPath, AI_SESSIONS_FILE)
    if (!existsSync(file)) return {}
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AiSessionsFile>
      if (parsed !== null && typeof parsed === 'object' && parsed.sessions !== null
        && typeof parsed.sessions === 'object') {
        return parsed.sessions as Record<string, string>
      }
    } catch {
      // A corrupt binding file degrades to empty; the next create re-writes it.
    }
    return {}
  }

  /** Persist one document → sessionId binding (atomic-ish tmp write). */
  private saveBinding(projectPath: string, document: string, sessionId: string): void {
    const file = resolve(projectPath, AI_SESSIONS_FILE)
    try {
      mkdirSync(dirname(file), { recursive: true })
      const current = this.loadBindings(projectPath)
      const next: AiSessionsFile = { version: 1, sessions: { ...current, [document]: sessionId } }
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
      // Best-effort rename; a failed rename leaves the old bindings intact.
      try { renameSync(tmp, file) } catch { /* ignore */ }
    } catch {
      // Persistence is an optimization; the in-memory flow still works.
    }
  }

  /**
   * Find-or-create the "[AI优化]<document>" session for a project document.
   * Returns null when the platform controller is absent or create fails.
   */
  private async getOrCreateSession(
    projectPath: string,
    workspaceId: string | null,
    document: string,
  ): Promise<string | null> {
    if (this.controller === null) return null
    const title = `${AI_TITLE_PREFIX}${documentTitle(document)}`

    // 1. Reuse a previously bound session — but only while it is still live.
    //    An archived session was deliberately hidden, so a binding to one is
    //    replaced with a fresh session (the archived one stays hidden).
    const bound = this.loadBindings(projectPath)[document]
    if (bound !== undefined && bound !== '' && !this.isArchived(bound)) {
      return bound
    }

    // 2. Create + name a fresh session, bound to the project workspace (or cwd).
    try {
      const created = await this.controller.create(
        workspaceId !== null && workspaceId !== ''
          ? { workspaceId }
          : { cwd: projectPath },
      )
      const createdId = (created as { sessionId?: string; id?: string } | null | undefined)?.sessionId
        ?? (created as { sessionId?: string; id?: string } | null | undefined)?.id
      if (typeof createdId !== 'string' || createdId === '') return null
      try {
        await this.controller.rename({ sessionId: createdId, title })
      } catch {
        // A failed rename leaves an unnamed session; still bind it.
      }
      this.saveBinding(projectPath, document, createdId)
      return createdId
    } catch {
      return null
    }
  }

  /**
   * Run one AI action against the document's long-lived session and return
   * the assistant reply. Consecutive calls (incl. follow-ups) reuse the same
   * session, so context accumulates across turns.
   */
  async dispatch(input: AiDispatchRequest): Promise<AiDispatchResult> {
    if (this.controller === null) {
      return { delivered: false, sessionId: null, text: null, reason: 'no-session-controller' }
    }
    let project: { path: string; workspaceId: string | null }
    try {
      project = this.resolveProject(input.projectId)
    } catch {
      return { delivered: false, sessionId: null, text: null, reason: 'controller-error' }
    }

    const sessionId = await this.getOrCreateSession(project.path, project.workspaceId, input.document)
    if (sessionId === null) {
      return { delivered: false, sessionId: null, text: null, reason: 'controller-error' }
    }

    const controller = this.controller
    const requestId = randomUUID()
    const context = { before: input.contextBefore, after: input.contextAfter }
    // The session persists across turns, so an unchanged document window is
    // already in its history — send the window only when it actually changed.
    const signature = contextSignature(input.action, input.selection, context, input.instruction ?? '')
    const includeContext = this.contextSignatures.get(sessionId) !== signature
    this.contextSignatures.set(sessionId, signature)
    const prompt = buildPrompt(
      input.action, input.selection, input.followUp, context, includeContext, input.instruction,
    )

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), REPLY_TIMEOUT_MS)
    try {
      const stream = controller.follow(
        { address: { kind: 'session', sessionId } },
        ac.signal,
      )
      let cursor: number | null = null
      let dispatched = false
      let reply: string | null = null

      for await (const frame of stream) {
        if (frame.type === 'snapshot') {
          cursor = frame.cursor
          if (!dispatched) {
            dispatched = true
            await controller.prompt({
              requestId,
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text: prompt }],
              clientTimeZone:
                typeof Intl === 'object' && Intl.DateTimeFormat !== undefined
                  ? Intl.DateTimeFormat().resolvedOptions().timeZone
                  : undefined,
            }, ac.signal)
          }
          continue
        }
        if (frame.type === 'event' && frame.event.type === 'assistant/message') {
          if (cursor !== null && frame.event.seq <= cursor) continue
          const text = extractAssistantText(frame.event.data)
          if (text !== '') {
            reply = text
            // The first committed assistant turn is the answer. Stop following
            // now: breaking calls the iterator's return() and runs the host
            // follow generator's finally (it would otherwise idle until the
            // abort timeout, holding the request open for minutes).
            break
          }
        }
      }

      if (reply === null || reply === '') {
        return { delivered: true, sessionId, text: null, reason: 'no-reply' }
      }
      return { delivered: true, sessionId, text: reply, reason: 'sent' }
    } catch {
      // A follow/prompt fault or timeout still counts as delivered when the
      // prompt was admitted; the reply simply did not arrive in time.
      return { delivered: true, sessionId, text: null, reason: 'no-reply' }
    } finally {
      clearTimeout(timer)
    }
  }
}
