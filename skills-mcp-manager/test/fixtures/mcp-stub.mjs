// Owned disposable stdio MCP fixture. Never binds a port or accesses user config.
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
const trace = process.argv[2]
if (trace) appendFileSync(trace, JSON.stringify({ pid: process.pid, event: 'start' }) + '\n')
const input = createInterface({ input: process.stdin })
function answer(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n') }
input.on('line', line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (trace) appendFileSync(trace, JSON.stringify({ pid: process.pid, method: request.method }) + '\n')
  if (request.id === undefined) return
  switch (request.method) {
    case 'initialize': answer(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'koishi-owned-test', version: '1.0.0' }, instructions: 'Disposable test server; no user resources.' }); break
    case 'tools/list': answer(request.id, { tools: [{ name: 'ping', description: 'Return the test message', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } }] }); break
    case 'tools/call': answer(request.id, { content: [{ type: 'text', text: `pong:${request.params.arguments.message}` }] }); break
    case 'ping': answer(request.id, {}); break
    default: process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n')
  }
})
input.on('close', () => process.exit(0))
