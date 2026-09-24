import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DEVDELIVERY_API_PREFIX, type DeliveryProjectRef, type DeliveryStageKind, type DeliveryStageStatus } from '../protocol.ts'
import { DeliveryStore } from './store.ts'

const headers: OutgoingHttpHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
function send(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, headers); res.end(JSON.stringify(body)) }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('request body too large'); chunks.push(chunk as Buffer) }
  const text = Buffer.concat(chunks).toString('utf8')
  const value: unknown = text === '' ? {} : JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be a JSON object')
  return value as Record<string, unknown>
}
function text(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function required(value: unknown, field: string): string { const result = text(value)?.trim(); if (!result) throw new Error(`${field} is required`); return result }
function trusted(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? ''; const host = req.headers.host ?? ''
  return (address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.'))
    && /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)
    && req.headers['sec-fetch-site'] !== 'cross-site'
}

/** Exact loopback routes for manual Phase-1 delivery lifecycle operations. */
export function deliveryRoutes(store: DeliveryStore): WebRoute[] {
  type Entry = { method: 'GET' | 'POST'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }
  const route = (method: 'GET' | 'POST', path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Entry => ({
    method, path, handler: async (req, res) => {
      if (!trusted(req)) { send(res, 403, { error: 'devdelivery: requests must originate from loopback web origin' }); return }
      try { await handler(req, res) } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        send(res, /required|invalid|not found/.test(message) ? 400 : 500, { error: message })
      }
    },
  })
  const entries: Entry[] = [
    route('GET', `${DEVDELIVERY_API_PREFIX}/state`, async (req, res) => {
      const projectId = new URL(req.url ?? '', 'http://localhost').searchParams.get('projectId') ?? undefined
      send(res, 200, await store.state(projectId))
    }),
    route('POST', `${DEVDELIVERY_API_PREFIX}/runs`, async (req, res) => {
      const input = await body(req); const project = input.project as DeliveryProjectRef
      if (project === null || typeof project !== 'object') throw new Error('project is required')
      send(res, 200, await store.createRun({ project, version: text(input.version), branch: text(input.branch), commitSha: text(input.commitSha) }))
    }),
    route('POST', `${DEVDELIVERY_API_PREFIX}/runs/select`, async (req, res) => { const input = await body(req); send(res, 200, await store.selectRun(required(input.id, 'id'))) }),
    route('POST', `${DEVDELIVERY_API_PREFIX}/stages`, async (req, res) => {
      const input = await body(req)
      send(res, 200, await store.updateStage({ runId: required(input.runId, 'runId'), kind: required(input.kind, 'kind') as DeliveryStageKind, status: required(input.status, 'status') as DeliveryStageStatus, summary: text(input.summary) }))
    }),
    route('POST', `${DEVDELIVERY_API_PREFIX}/evidence`, async (req, res) => {
      const input = await body(req)
      send(res, 200, await store.addEvidence({ runId: required(input.runId, 'runId'), kind: required(input.kind, 'kind') as DeliveryStageKind, title: required(input.title, 'title'), url: text(input.url), note: text(input.note) }))
    }),
  ]
  return entries.map(entry => ({
    kind: 'exact' as const,
    path: entry.path,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== entry.method) { send(res, 405, { error: `method not allowed: ${req.method ?? ''}` }); return }
      await entry.handler(req, res)
    },
  }))
}
