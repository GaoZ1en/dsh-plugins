/** Authenticated, loopback-only JSON adapter. All operations live in ManagerService. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { MANAGER_API } from './protocol.ts'
import { ManagerError, safeError, type ManagerService } from './service.ts'

export interface RouteDeps {
  service: Pick<ManagerService, 'execute'>
  requestRejection: (request: { headers: IncomingMessage['headers'] }) => 401 | 403 | undefined
}
const MAX_BODY = 1024 * 1024
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}
async function body(req: IncomingMessage): Promise<unknown> {
  const size = Number(req.headers['content-length'])
  if (Number.isFinite(size) && size > MAX_BODY) throw new ManagerError('BODY_TOO_LARGE', 'Request exceeds 1 MiB')
  let length = 0
  const buffers: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.length
    if (length > MAX_BODY) throw new ManagerError('BODY_TOO_LARGE', 'Request exceeds 1 MiB')
    buffers.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')) }
  catch { throw new ManagerError('INVALID_INPUT', 'Invalid JSON') }
}
export function makeRoute(deps: RouteDeps): WebRoute {
  return {
    kind: 'exact', path: MANAGER_API,
    handler: async (req, res) => {
      const address = req.socket.remoteAddress
      const local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
      let localAuthority = false
      try {
        const authority = new URL(`http://${req.headers.host || ''}`)
        localAuthority = ['127.0.0.1', 'localhost', '[::1]'].includes(authority.hostname) && !authority.username && !authority.password && authority.pathname === '/'
      } catch { /* invalid authority is forbidden */ }
      const rejection = deps.requestRejection(req)
      if (!local || !localAuthority || rejection || req.headers['sec-fetch-site'] === 'cross-site') {
        json(res, rejection || 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Authenticated local access required' } }); return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }); return
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        json(res, 415, { ok: false, error: { code: 'INVALID_INPUT', message: 'application/json required' } }); return
      }
      const controller = new AbortController()
      const closed = () => { if (!res.writableEnded) controller.abort() }
      res.once('close', closed)
      try {
        const value = await deps.service.execute(await body(req), controller.signal)
        json(res, 200, { ok: true, value: value ?? null })
      } catch (error) {
        const safe = safeError(error)
        const status = /CONFLICT|BUSY/.test(safe.code) ? 409 : safe.code === 'BODY_TOO_LARGE' ? 413 : /NOT_FOUND/.test(safe.code) ? 404 : /INVALID|READ_ONLY|FORBIDDEN/.test(safe.code) ? 400 : 500
        if (!res.destroyed) json(res, status, { ok: false, error: safe })
      } finally { res.off('close', closed) }
    },
  }
}
