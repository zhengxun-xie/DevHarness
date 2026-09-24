/**
 * DevTask loopback HTTP routes, registered on ctx.webServer.
 *
 * Every endpoint is an EXACT route on purpose: the client-connection package
 * owns a prefix route on `/api` carrying browser-auth; webServer matches its
 * exact table before its prefix table, so exact `/api/devtask/*` rows bypass
 * that channel (and its 401) while keeping the loopback + same-origin trust
 * fence — the same pattern the sibling DevBuddy/Reviewer plugins use.
 *
 * Mutations return the full next state rather than a delta, so the browser
 * panel never has to reconcile a partial update against its snapshot.
 */
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  DEVTASK_API_PREFIX,
  type CreateAgentRequest,
  type CreateTaskRequest,
  type CreateViewRequest,
  type MoveTaskRequest,
  type RemoveAgentRequest,
  type RemoveTaskRequest,
  type RemoveViewRequest,
  type SelectViewRequest,
  type UpdateAgentRequest,
  type UpdateTaskRequest,
} from '../protocol.ts'
import type { DevTaskStore } from './store.ts'

const MAX_BODY_BYTES = 1024 * 1024

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

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
  if (text === '') return {}
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Read a required non-empty string field, else throw. */
function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value === '') throw new Error(`${field} is required`)
  return value
}

/** A handler plus the literal method it answers on. */
type RouteEntry = { method: 'GET' | 'POST'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void }

/**
 * Build the DevTask route table.
 * @param store - the registry facade backing every endpoint.
 */
export function devtaskRoutes(store: DevTaskStore): WebRoute[] {
  /** Wrap a handler with the trust fence and uniform error mapping. */
  const route = (
    method: 'GET' | 'POST',
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): RouteEntry => ({
    method,
    path,
    handler: async (req, res) => {
      if (!isTrusted(req)) {
        sendError(res, 403, 'devtask: requests must originate from the loopback web origin')
        return
      }
      try {
        await handler(req, res)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Name/enum validation failures are the caller's fault; anything else
        // (lock contention, disk) is a server-side failure.
        const clientFault = /required|unknown|not found|cannot be removed|must be|already exists/.test(message)
        sendError(res, clientFault ? 400 : 500, message)
      }
    },
  })

  const routes: RouteEntry[] = [
    route('GET', `${DEVTASK_API_PREFIX}/state`, async (_req, res) => {
      sendJson(res, 200, await store.state())
    }),

    // 活动事件流：?limit=N（1–500，默认 100）可选；?fresh=1 绕过 60s 缓存。
    // GET query 解析自己做，readBody 只服务 POST。
    route('GET', `${DEVTASK_API_PREFIX}/activity`, async (req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost')
      const raw = url.searchParams.get('limit')
      const parsed = raw === null ? 100 : Number(raw)
      const limit = Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.trunc(parsed))) : 100
      const fresh = url.searchParams.get('fresh') === '1'
      sendJson(res, 200, await store.activity(limit, fresh))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/views`, async (req, res) => {
      const body = await readBody(req)
      const raw = body as { name?: unknown }
      const request: CreateViewRequest = {
        // Optional: the form asks for the employee only, and the store names
        // the view after it. Kept when supplied so the API stays usable
        // without the panel.
        ...(raw.name === undefined || raw.name === null ? {} : { name: requireString(body, 'name') }),
        employeeId: requireString(body, 'employeeId'),
      }
      sendJson(res, 200, await store.createView(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/views/remove`, async (req, res) => {
      const body = await readBody(req)
      const request: RemoveViewRequest = { id: requireString(body, 'id') }
      sendJson(res, 200, await store.removeView(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/views/select`, async (req, res) => {
      const body = await readBody(req)
      const request: SelectViewRequest = { id: requireString(body, 'id') }
      sendJson(res, 200, await store.selectView(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/tasks`, async (req, res) => {
      const body = await readBody(req)
      const request: CreateTaskRequest = {
        viewId: requireString(body, 'viewId'),
        title: requireString(body, 'title'),
        description: typeof body['description'] === 'string' ? body['description'] : undefined,
        status: typeof body['status'] === 'string' ? body['status'] : undefined,
        priority: typeof body['priority'] === 'string' ? body['priority'] : undefined,
        tags: Array.isArray(body['tags']) ? body['tags'] as string[] : undefined,
      }
      sendJson(res, 200, await store.createTask(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/tasks/update`, async (req, res) => {
      const body = await readBody(req)
      const patch = body['patch']
      const request: UpdateTaskRequest = {
        id: requireString(body, 'id'),
        patch: (patch !== null && typeof patch === 'object' && !Array.isArray(patch))
          ? patch as UpdateTaskRequest['patch']
          : {},
      }
      sendJson(res, 200, await store.updateTask(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/tasks/remove`, async (req, res) => {
      const body = await readBody(req)
      const request: RemoveTaskRequest = { id: requireString(body, 'id') }
      sendJson(res, 200, await store.removeTask(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/tasks/move`, async (req, res) => {
      const body = await readBody(req)
      const request: MoveTaskRequest = {
        id: requireString(body, 'id'),
        status: requireString(body, 'status'),
      }
      sendJson(res, 200, await store.moveTask(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/agents`, async (req, res) => {
      const body = await readBody(req)
      const request: CreateAgentRequest = {
        name: requireString(body, 'name'),
        description: typeof body['description'] === 'string' ? body['description'] : undefined,
      }
      sendJson(res, 200, await store.createAgent(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/agents/update`, async (req, res) => {
      const body = await readBody(req)
      const patch = body['patch']
      const request: UpdateAgentRequest = {
        id: requireString(body, 'id'),
        patch: (patch !== null && typeof patch === 'object' && !Array.isArray(patch))
          ? patch as UpdateAgentRequest['patch']
          : {},
      }
      sendJson(res, 200, await store.updateAgent(request))
    }),

    route('POST', `${DEVTASK_API_PREFIX}/agents/remove`, async (req, res) => {
      const body = await readBody(req)
      const request: RemoveAgentRequest = { id: requireString(body, 'id') }
      sendJson(res, 200, await store.removeAgent(request))
    }),
  ]

  // The webServer exact table keys on literal pathnames, so a path carrying
  // both methods must fold into ONE registration that dispatches on
  // req.method; today every path here is single-method, but the fold keeps
  // that a non-issue as endpoints are added.
  const byPath = new Map<string, RouteEntry[]>()
  for (const entry of routes) {
    const bucket = byPath.get(entry.path) ?? []
    bucket.push(entry)
    byPath.set(entry.path, bucket)
  }

  return [...byPath].map(([path, entries]) => ({
    kind: 'exact' as const,
    path,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const match = entries.find(entry => entry.method === req.method)
      if (match === undefined) {
        sendError(res, 405, `method not allowed: ${req.method ?? ''}`)
        return
      }
      await match.handler(req, res)
    },
  }))
}