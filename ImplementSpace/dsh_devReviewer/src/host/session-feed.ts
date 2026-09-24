/**
 * session/event feed → ReviewStore correlation (design/07, design/03 §14).
 *
 * The platform emits post-commit, strictly ordered session events:
 *   turn/start  { turn }
 *   user/message  UserMessage  (source.rpcId for RPC-admitted prompts)
 *   assistant/message { turn, step, message, interrupted? }  — emitted ONCE
 *     per attempt with the FULL final content snapshot (streaming deltas live
 *     on a separate agent/assistant-stream channel, never on this feed); a
 *     turn may carry several (multi-step tool loops)
 *   turn/end  { turn, reason: { kind } }
 *
 * rpcId is never echoed back on assistant events, so correlation is
 * session + open turn: the dispatcher minted requestId becomes the
 * user/message source rpcId, binds the registered run to that turn, and the
 * turn's assistant text is flushed as one agent comment when turn/end reports
 * completion. Only agent-origin writes flow through this path; agents can
 * append comments but never produce a ReviewDecision.
 *
 * Platform type packages are not installed in the web profile; mirror the
 * structural shapes here (same approach as dsh-taskboard / dsh-better-sidebar).
 */
import type { ReviewStore } from './review-store.ts'

interface FeedEnvelope {
  type: string
  seq: number
  time: number
  data: unknown
  surfaceOp?: 'append' | unknown
}

interface FeedSession {
  id: string
}

interface FeedContext {
  on(event: 'session/event', listener: (session: unknown, event: unknown) => void): unknown
}

interface TextBlock {
  type: string
  text?: unknown
}

interface AssistantData {
  turn?: unknown
  message?: {
    source?: { kind?: unknown; provider?: unknown; model?: unknown }
    content?: unknown
  }
  interrupted?: unknown
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

/** user/message data IS the UserMessage; rpcId lives at data.source.rpcId. */
function extractRpcId(data: unknown): string | null {
  const message = asObject(data)
  const source = asObject(message?.source)
  if (source === null || source.kind !== 'user' || !('rpcId' in source)) return null
  return typeof source.rpcId === 'string' ? source.rpcId : null
}

/** Concatenate kind === 'text' content blocks (excludes reasoning/tool blocks). */
function extractAssistantText(data: AssistantData): { text: string; provider: string | null; model: string | null } {
  const source = data.message?.source
  const provider = typeof source?.provider === 'string' ? source.provider : null
  const model = typeof source?.model === 'string' ? source.model : null
  const parts: string[] = []
  if (Array.isArray(data.message?.content)) {
    for (const block of data.message.content as TextBlock[]) {
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return { text: parts.join('\n'), provider, model }
}

export function registerSessionFeed(ctx: unknown, store: ReviewStore): () => void {
  const context = ctx as FeedContext
  const handle = (rawSession: unknown, rawEvent: unknown): void => {
    try {
      const session = rawSession as FeedSession | null
      const event = rawEvent as FeedEnvelope | null
      if (session === null || typeof session.id !== 'string') return
      if (event === null || typeof event.type !== 'string') return
      const sessionId = session.id
      const data = asObject(event.data)

      switch (event.type) {
        case 'turn/start': {
          if (data !== null && typeof data.turn === 'number') {
            store.onTurnStart(sessionId, data.turn)
          }
          return
        }
        case 'user/message': {
          store.onUserMessage(sessionId, extractRpcId(event.data))
          return
        }
        case 'assistant/message': {
          if (event.surfaceOp !== 'append') return
          const assistant = event.data as AssistantData
          if (typeof assistant.turn !== 'number') return
          const { text, provider, model } = extractAssistantText(assistant)
          store.onAssistantMessage({
            sessionId,
            turn: assistant.turn,
            text,
            interrupted: assistant.interrupted === true,
            provider,
            model,
          })
          return
        }
        case 'turn/end': {
          if (data === null || typeof data.turn !== 'number') return
          const reason = asObject(data.reason)
          store.onTurnEnd(sessionId, data.turn, reason?.kind === 'completed')
          return
        }
      }
    } catch (error) {
      // Never let feed bookkeeping throw into the platform event bus.
      process.stderr.write(`[dsh-devreviewer] session/event handling failed: ${String(error)}\n`)
    }
  }
  const disposer = context.on('session/event', handle) as (() => void) | undefined
  return typeof disposer === 'function' ? disposer : () => {}
}
