/**
 * DevBuddy loopback HTTP routes, registered on ctx.webServer.
 *
 * Every endpoint is an EXACT route on purpose: the client-connection package
 * owns a prefix route on `/api` carrying browser-auth; webServer matches its
 * exact table before its prefix table, so exact `/api/devbuddy-left/*` rows
 * bypass that channel (and its 401) while keeping our own loopback +
 * same-origin trust fence — the same pattern the dsh task-board plugin family
 * uses.
 *
 * Because the exact table keys on literal pathnames, resource ids ride the
 * query string (GET) or the JSON body (POST), not path segments.
 */
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DEVBUDDY_API_PREFIX, type BindProjectRequest, type WriteNodeRequest } from '../protocol.ts'
import type { DevBuddyStore } from './store.ts'

const MAX_BODY_BYTES = 4 * 1024 * 1024 // markdown nodes can be large; 4 MiB cap

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

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void

/**
 * Build the exact web routes backing the DevBuddy panel.
 *
 * Endpoints:
 *   GET  /api/devbuddy-left/state
 *   POST /api/devbuddy-left/projects                { name, path }
 *   POST /api/devbuddy-left/project/open            { id }
 *   POST /api/devbuddy-left/project/remove          { id }
 *   GET  /api/devbuddy-left/node?projectId&nodeId
 *   POST /api/devbuddy-left/node                    { projectId, nodeId, content, expectedSha? }
 *   GET  /api/devbuddy-left/workspaces
 *   POST /api/devbuddy-left/project/bind            { id, workspaceId: string | null }
 */
export function devbuddyRoutes(store: DevBuddyStore): WebRoute[] {
  const routes: Array<{ method: string; path: string; handler: Handler }> = [
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/state`,
      handler: (_req, res) => sendJson(res, 200, store.state()),
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/projects`,
      handler: async (req, res) => {
        const body = await readBody(req) as { name?: unknown; path?: unknown }
        if (typeof body.name !== 'string' || typeof body.path !== 'string') {
          sendError(res, 400, 'name and path must be strings')
          return
        }
        sendJson(res, 200, await store.createProject({ name: body.name, path: body.path }))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/project/open`,
      handler: async (req, res) => {
        const body = await readBody(req) as { id?: unknown }
        if (typeof body.id !== 'string') { sendError(res, 400, 'id must be a string'); return }
        sendJson(res, 200, await store.openProject(body.id))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/project/remove`,
      handler: async (req, res) => {
        const body = await readBody(req) as { id?: unknown }
        if (typeof body.id !== 'string') { sendError(res, 400, 'id must be a string'); return }
        sendJson(res, 200, await store.removeProject(body.id))
      },
    },
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/workspaces`,
      handler: (_req, res) => sendJson(res, 200, store.listWorkspaces()),
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/project/bind`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<BindProjectRequest>
        if (typeof body.id !== 'string') { sendError(res, 400, 'id must be a string'); return }
        if (typeof body.workspaceId !== 'string' && body.workspaceId !== null) {
          sendError(res, 400, 'workspaceId must be a string or null')
          return
        }
        sendJson(res, 200, await store.bindProject(body.id, body.workspaceId))
      },
    },
    {
      method: 'GET',
      path: `${DEVBUDDY_API_PREFIX}/node`,
      handler: (_req, res, url) => {
        const projectId = url.searchParams.get('projectId') ?? ''
        const nodeId = url.searchParams.get('nodeId') ?? ''
        sendJson(res, 200, store.readNodeView(projectId, nodeId))
      },
    },
    {
      method: 'POST',
      path: `${DEVBUDDY_API_PREFIX}/node`,
      handler: async (req, res) => {
        const body = await readBody(req) as Partial<WriteNodeRequest & { projectId?: unknown; nodeId?: unknown }>
        if (typeof body.projectId !== 'string' || typeof body.nodeId !== 'string') {
          sendError(res, 400, 'projectId and nodeId must be strings')
          return
        }
        if (typeof body.content !== 'string') {
          sendError(res, 400, 'content must be a string')
          return
        }
        sendJson(res, 200, store.writeNodeView(
          body.projectId,
          body.nodeId,
          body.content,
          body.expectedSha ?? null,
        ))
      },
    },
  ]

  // The webserver exact table keys on pathname alone (one route per path), so
  // endpoints sharing a path across methods (GET+POST /node) must be folded
  // into a single registration that dispatches by req.method itself.
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
        sendError(res, 403, 'devbuddy: requests must originate from the loopback web origin')
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
        sendError(res, 400, error instanceof Error ? error.message : String(error))
      }
    },
  }))
}
