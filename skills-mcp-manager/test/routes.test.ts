import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { makeRoute } from '../src/routes.ts'

async function invoke(options: { local?: boolean; rejection?: 401 | 403; method?: string; type?: string; raw?: string; size?: string; crossSite?: boolean; host?: string; error?: unknown } = {}) {
  let calls = 0
  let authenticationChecks = 0
  let input: unknown
  const route = makeRoute({
    requestRejection: () => { authenticationChecks++; return options.rejection },
    service: { execute: async value => { calls++; input = value; if (options.error) throw options.error; return ['safe'] } },
  })
  const request = Object.assign(Readable.from([Buffer.from(options.raw ?? '{"action":"workspaces"}')]), { method: options.method ?? 'POST', headers: { host: options.host ?? '127.0.0.1:64215', 'content-type': options.type ?? 'application/json', 'content-length': options.size, 'sec-fetch-site': options.crossSite ? 'cross-site' : 'same-origin' }, socket: { remoteAddress: options.local === false ? '10.0.0.1' : '127.0.0.1' } })
  let status = 0
  let body = ''
  const response = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead(code: number) { status = code }, end(value: string) { body = value; this.writableEnded = true } })
  await route.handler(request as never, response as never)
  return { status, body: JSON.parse(body), calls, input, authenticationChecks }
}

test('local IP alone grants no access; authenticated remote/cross-site requests also fail', async () => {
  for (const options of [{ rejection: 401 as const }, { rejection: 403 as const }, { local: false }, { crossSite: true }, { host: 'trusted-remote.example' }, { host: '127.0.0.1@remote.example' }]) {
    const result = await invoke(options)
    assert.equal(result.calls, 0)
    assert.equal(result.authenticationChecks, 1)
    assert.ok(result.status === 401 || result.status === 403)
  }
})
test('methods, JSON media type and bounded bodies fail before service dispatch', async () => {
  assert.equal((await invoke({ method: 'GET' })).status, 405)
  assert.equal((await invoke({ type: 'text/plain' })).status, 415)
  assert.equal((await invoke({ raw: '{' })).status, 400)
  assert.equal((await invoke({ size: String(1024 * 1024 + 1) })).status, 413)
  assert.equal((await invoke({ raw: ' '.repeat(1024 * 1024 + 1) })).status, 413)
})
test('authenticated UI receives shared operation results and sanitized failures', async () => {
  const result = await invoke()
  assert.equal(result.status, 200)
  assert.deepEqual(result.input, { action: 'workspaces' })
  assert.deepEqual(result.body, { ok: true, value: ['safe'] })
  assert.equal((await invoke({ error: Object.assign(new Error('refresh'), { code: 'REVISION_CONFLICT' }) })).status, 409)
  const error = await invoke({ error: new Error('do-not-leak') })
  assert.equal(error.status, 500)
  assert.ok(!JSON.stringify(error.body).includes('do-not-leak'))
})
