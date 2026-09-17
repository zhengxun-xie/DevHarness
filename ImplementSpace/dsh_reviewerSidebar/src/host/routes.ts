/**
 * DevBuddy Reviewer loopback HTTP routes (design/04-api-protocol.md).
 *
 * Same trust fence as the left sidebar: exact routes, loopback address,
 * localhost Host, same-origin Origin, Sec-Fetch-Site: cross-site rejected,
 * 4 MiB body. Because exact routes key on pathname alone, GET+POST sharing a
 * path (/reviews) are folded into one registration dispatching by method.
 *
 * Error mapping:
 *   403  trust fence failure
 *   404  NotFoundError (unknown project / missing review file)
 *   409  ConflictError (optimistic lock) / IllegalTransitionError
 *   400  ValidationError / ReviewFileError / malformed body
 *   405  method not allowed
 */
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DEVBUDDY_API_PREFIX } from '../protocol.ts'
import type {
  ActivateRequest,
  AppendRequest,
  CreateReviewRequest,
  EditReviewRequest,
  EditThreadEntryRequest,
  RemoveRequest,
  ReanchorRequest,
  SendToAgentRequest,
  TransitionRequest,
} from '../protocol.ts'
import type { ReviewStore } from './review-store.ts'
import { buildAgentContext } from './context-builder.ts'
import type { AgentDispatcher } from './agent-dispatch.ts'
import { NotFoundError } from './projects.ts'
import { ReviewFileError } from './review-files.ts'
import { IllegalTransitionError } from './lifecycle.ts'

const MAX_BODY_BYTES = 4 * 1024 * 1024

const JSON_HEADERS: OutgoingHttpHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const v = address.toLowerCase()
  if (v === '::1') return true
  if (v.startsWith('::ffff:')) return isLoopbackAddress(v.slice('::ffff:'.length))
  const parts = v.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isTrusted(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname.toLowerCase()
  if (hostname !== 'localhost' && hostname !== '[::1]' && !isLoopbackAddress(hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error })
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      req.destroy()
      throw new Error('request body too large')
    }
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

/** Map a thrown domain error onto the design/04 §1 status codes. */
function statusForError(error: unknown): number {
  if (error instanceof NotFoundError) return 404
  if ((error as Error)?.name === 'NotFoundError') return 404
  if (error instanceof ReviewFileError) {
    return (error as Error).name === 'NotFoundError' ? 404 : 400
  }
  if ((error as Error)?.name === 'ConflictError') return 409
  if ((error as Error)?.name === 'ForbiddenError') return 403
  if (error instanceof IllegalTransitionError) return 409
  if ((error as Error)?.name === 'ValidationError') return 400
  return 400
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void

function requireString(body: Record<string, unknown>, key: string, res: ServerResponse): string | null {
  const value = body[key]
  if (typeof value !== 'string' || value === '') {
    sendError(res, 400, `${key} must be a non-empty string`)
    return null
  }
  return value
}

/**
 * Endpoints (design/04 §2):
 *   GET  /projects
 *   POST /project/activate
 *   GET  /reviews
 *   POST /reviews
 *   GET  /review
 *   POST /review/append
 *   POST /review/edit
 *   POST /review/thread/edit
 *   POST /review/transition
 *   POST /review/remove
 *   GET  /document
 *   GET  /agent/context
 *   POST /agent/send
 */
export function reviewerRoutes(store: ReviewStore, dispatcher: AgentDispatcher): WebRoute[] {
  const routes: Array<{ method: string; path: string; handler: Handler }> = [
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/projects`,
      handler: (_req, res) => sendJson(res, 200, store.listProjects()),
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/project/activate`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<ActivateRequest>
        const id = requireString(body as Record<string, unknown>, 'id', res)
        if (id === null) return
        sendJson(res, 200, await store.activateProject(id))
      },
    },
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/reviews`,
      handler: (_req, res, url) => {
        const projectId = url.searchParams.get('projectId') ?? ''
        if (projectId === '') { sendError(res, 400, 'projectId is required'); return }
        sendJson(res, 200, store.listReviews({
          projectId,
          status: url.searchParams.get('status') ?? undefined,
          severity: url.searchParams.get('severity') ?? undefined,
          document: url.searchParams.get('document') ?? undefined,
          author: url.searchParams.get('author') ?? undefined,
          tag: url.searchParams.get('tag') ?? undefined,
        }))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/reviews`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<CreateReviewRequest>
        if (typeof body.projectId !== 'string' || body.projectId === '') {
          sendError(res, 400, 'projectId must be a non-empty string'); return
        }
        if (typeof body.document !== 'string' || body.document === '') {
          sendError(res, 400, 'document must be a non-empty string'); return
        }
        if (typeof body.comment !== 'string') {
          sendError(res, 400, 'comment must be a string'); return
        }
        const target = body.target
        if (target === undefined || target === null || typeof target !== 'object') {
          sendError(res, 400, 'target anchor is required'); return
        }
        sendJson(res, 200, await store.createReview(body as CreateReviewRequest))
      },
    },
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/review`,
      handler: (_req, res, url) => {
        const projectId = url.searchParams.get('projectId') ?? ''
        const reviewId = url.searchParams.get('reviewId') ?? ''
        if (projectId === '' || reviewId === '') {
          sendError(res, 400, 'projectId and reviewId are required'); return
        }
        sendJson(res, 200, store.getReview(projectId, reviewId))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/review/append`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<AppendRequest>
        if (typeof body.projectId !== 'string' || typeof body.reviewId !== 'string'
          || typeof body.body !== 'string') {
          sendError(res, 400, 'projectId, reviewId and body must be strings'); return
        }
        sendJson(res, 200, await store.appendReview(body as AppendRequest))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/review/edit`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<EditReviewRequest>
        if (typeof body.projectId !== 'string' || typeof body.reviewId !== 'string') {
          sendError(res, 400, 'projectId and reviewId must be strings'); return
        }
        if (body.comment !== undefined && typeof body.comment !== 'string') {
          sendError(res, 400, 'comment must be a string'); return
        }
        if (body.proposal !== undefined && typeof body.proposal !== 'string') {
          sendError(res, 400, 'proposal must be a string'); return
        }
        if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') {
          sendError(res, 400, 'title must be a string or null'); return
        }
        if (body.severity !== undefined && typeof body.severity !== 'string') {
          sendError(res, 400, 'severity must be a string'); return
        }
        if (body.type !== undefined && typeof body.type !== 'string') {
          sendError(res, 400, 'type must be a string'); return
        }
        if (body.tags !== undefined && !Array.isArray(body.tags)) {
          sendError(res, 400, 'tags must be an array'); return
        }
        if (body.comment === undefined && body.proposal === undefined && body.title === undefined
          && body.severity === undefined && body.type === undefined && body.tags === undefined) {
          sendError(res, 400, 'at least one editable field is required'); return
        }
        sendJson(res, 200, await store.editReview(body as EditReviewRequest))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/review/thread/edit`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<EditThreadEntryRequest>
        if (typeof body.projectId !== 'string' || typeof body.reviewId !== 'string'
          || typeof body.entryId !== 'string' || typeof body.body !== 'string') {
          sendError(res, 400, 'projectId, reviewId, entryId and body must be strings'); return
        }
        sendJson(res, 200, await store.editThreadEntry(body as EditThreadEntryRequest))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/review/transition`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<TransitionRequest>
        if (typeof body.projectId !== 'string' || typeof body.reviewId !== 'string'
          || typeof body.to !== 'string') {
          sendError(res, 400, 'projectId, reviewId and to must be strings'); return
        }
        sendJson(res, 200, await store.transitionReview(body as TransitionRequest))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/review/reanchor`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<ReanchorRequest>
        if (typeof body.projectId !== 'string' || typeof body.reviewId !== 'string') {
          sendError(res, 400, 'projectId and reviewId must be strings'); return
        }
        const target = body.target
        if (target === undefined || target === null || typeof target !== 'object') {
          sendError(res, 400, 'target anchor is required'); return
        }
        sendJson(res, 200, await store.reanchorReview(body as ReanchorRequest))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/review/remove`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<RemoveRequest>
        if (typeof body.projectId !== 'string' || typeof body.reviewId !== 'string') {
          sendError(res, 400, 'projectId and reviewId must be strings'); return
        }
        sendJson(res, 200, await store.removeReview(body as RemoveRequest))
      },
    },
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/document`,
      handler: (_req, res, url) => {
        const projectId = url.searchParams.get('projectId') ?? ''
        const path = url.searchParams.get('path') ?? ''
        if (projectId === '' || path === '') {
          sendError(res, 400, 'projectId and path are required'); return
        }
        sendJson(res, 200, store.getDocument(projectId, path))
      },
    },
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/agent/context`,
      handler: async (_req, res, url) => {
        const projectId = url.searchParams.get('projectId') ?? ''
        const reviewId = url.searchParams.get('reviewId') ?? ''
        if (projectId === '' || reviewId === '') {
          sendError(res, 400, 'projectId and reviewId are required'); return
        }
        const context = await buildAgentContext(projectId, reviewId)
        sendJson(res, 200, context)
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/agent/send`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<SendToAgentRequest>
        if (typeof body.projectId !== 'string' || typeof body.reviewId !== 'string') {
          sendError(res, 400, 'projectId and reviewId must be strings'); return
        }
        const context = await buildAgentContext(body.projectId, body.reviewId, { include: body.include })
        const dispatch = await dispatcher.send({
          projectId: body.projectId,
          instruction: context.instruction,
          sessionId: body.sessionId ?? null,
          dryRun: body.dryRun === true,
          workspaces: store.snapshotWorkspaces(),
        })
        if (dispatch.delivered && dispatch.sessionId !== null) {
          store.markAgentDispatched({
            projectId: body.projectId,
            reviewId: body.reviewId,
            sessionId: dispatch.sessionId,
            requestId: dispatch.requestId,
          })
        }
        sendJson(res, 200, {
          context,
          sessionId: dispatch.sessionId,
          delivered: dispatch.delivered,
          ...(dispatch.delivered ? {} : { fallback: dispatch.reason }),
        })
      },
    },
  ]

  const byPath = new Map<string, { method: string; handler: Handler }[]>()
  for (const route of routes) {
    const entries = byPath.get(route.path) ?? []
    entries.push(route)
    byPath.set(route.path, entries)
  }

  return [...byPath].map(([path, entries]) => ({
    kind: 'exact' as const,
    path,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrusted(req)) {
        sendError(res, 403, 'devbuddy-reviewer: requests must originate from the loopback web origin')
        return
      }
      const match = entries.find(entry => entry.method === req.method)
      if (match === undefined) {
        sendError(res, 405, `method not allowed: ${req.method ?? ''}`)
        return
      }
      try {
        await match.handler(req, res, new URL(req.url ?? '/', 'http://x'))
      } catch (error) {
        const status = statusForError(error)
        sendError(res, status, error instanceof Error ? error.message : String(error))
      }
    },
  }))
}
